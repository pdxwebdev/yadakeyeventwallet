/*
SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "./WrappedToken.sol";
import "./KeyLogRegistry.sol";

// Custom interface for ERC-20 tokens with decimals
interface IERC20WithDecimals is IERC20 {
    function decimals() external view returns (uint8);
}

// Interface for ERC-2612 permit
interface IERC20Permit2 {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

contract Bridge is Initializable, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    KeyLogRegistry public keyLogRegistry;
    address public relayer;

    mapping(address => address) public originalToWrapped;
    mapping(address => address) public wrappedToOriginal;
    mapping(address => bool) public isCrossChain;
    mapping(address => uint256) public nonces;
    address[] public supportedOriginalTokens; // Track supported tokens

    address public feeCollector;
    uint256 public feePercentage;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant FEE_CAP_USD = 1000 * 10**18; // 1000 USD with 18 decimals
    mapping(bytes32 => bool) public processedLocks;
    mapping(address => AggregatorV3Interface) public tokenPriceFeeds;

    event TokensWrapped(address indexed user, address wrappedToken, uint256 amount);
    event UnwrapCrossChain(address indexed originalToken, address targetAddress, uint256 amount, address indexed user);
    event TokensLocked(address indexed user, address indexed originalToken, uint256 amount);
    event FeesCollected(address indexed token, uint256 amount);
    event TokensMinted(address indexed wrappedToken, address indexed user, uint256 amount);
    event EthTransferred(address indexed from, address indexed to, uint256 amount);

    struct PermitData {
        address token;
        uint256 amount;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
        address recipient;
    }

    struct WrapParams {
        uint256 amount;
        bytes signature;
        bytes publicKey;
        address prerotatedKeyHash;
        address twicePrerotatedKeyHash;
        address prevPublicKeyHash;
        address outputAddress;
        bool hasRelationship;
        address tokenSource;
        PermitData[] permits;
    }

    struct UnwrapParams {
        uint256 amount;
        bytes signature;
        bytes publicKey;
        address prerotatedKeyHash;
        address twicePrerotatedKeyHash;
        address prevPublicKeyHash;
        address targetAddress;
        bool hasRelationship;
        PermitData[] permits; // Array of permits for multiple tokens
    }

    event OwnershipTransferredToNextKey(address indexed previousOwner, address indexed newOwner);

    function initialize(address _keyLogRegistry) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        keyLogRegistry = KeyLogRegistry(_keyLogRegistry);
        feeCollector = msg.sender;
        feePercentage = 1; // .01% default fee
    }
    
    /**
     * @dev Overrides transferOwnership to also update feeCollector to the new owner.
     * @param newOwner The address to transfer ownership to.
     */
    function transferOwnership(address newOwner) public override onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        feeCollector = newOwner; // Update feeCollector to new owner
        super.transferOwnership(newOwner); // Call parent function to transfer ownership
        emit OwnershipTransferredToNextKey(owner(), newOwner);
    }

    function setRelayer(address _relayer) external onlyOwner {
        relayer = _relayer;
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "Invalid fee collector");
        feeCollector = _feeCollector;
    }

    function setFeePercentage(uint256 _feePercentage) external onlyOwner {
        require(_feePercentage <= FEE_DENOMINATOR, "Fee too high");
        feePercentage = _feePercentage;
    }

    function setTokenPriceFeed(address token, address priceFeed) external onlyOwner {
        tokenPriceFeeds[token] = AggregatorV3Interface(priceFeed);
    }

    function addTokenPair(address originalToken, address wrappedToken, bool _isCrossChain) external onlyOwner {
        require(originalToWrapped[originalToken] == address(0), "Token pair already exists");
        originalToWrapped[originalToken] = wrappedToken;
        wrappedToOriginal[wrappedToken] = originalToken;
        isCrossChain[wrappedToken] = _isCrossChain;
        supportedOriginalTokens.push(originalToken);
    }

    function getSupportedTokens() external view returns (address[] memory) {
        return supportedOriginalTokens;
    }

    function getTokenFee(address token, uint256 amount) internal view returns (uint256) {
        uint256 calculatedFee = (amount * feePercentage) / FEE_DENOMINATOR;
        
        if (!isCrossChain[token]) {
            AggregatorV3Interface priceFeed = tokenPriceFeeds[token];
            if (address(priceFeed) != address(0)) {
                (, int256 price, , , ) = priceFeed.latestRoundData();
                require(price > 0, "Invalid price feed");
                
                uint8 priceDecimals = priceFeed.decimals();
                uint8 tokenDecimals = IERC20WithDecimals(token).decimals();
                uint256 tokenPrice = uint256(price);
                
                uint256 feeCapBase = FEE_CAP_USD;
                if (tokenDecimals > 18) {
                    feeCapBase = feeCapBase * (10 ** (tokenDecimals - 18));
                } else if (tokenDecimals < 18) {
                    feeCapBase = feeCapBase / (10 ** (18 - tokenDecimals));
                }
                
                uint256 feeCapInTokens;
                if (priceDecimals > 0) {
                    feeCapInTokens = (feeCapBase * (10 ** priceDecimals)) / tokenPrice;
                } else {
                    feeCapInTokens = feeCapBase / tokenPrice;
                }
                
                return calculatedFee > feeCapInTokens ? feeCapInTokens : calculatedFee;
            }
        }
        return calculatedFee;
    }

    function wrapPairWithTransfer(
        address originalToken,
        WrapParams calldata unconfirmed,
        WrapParams calldata confirming
    ) external payable nonReentrant {
        address wrappedToken = originalToWrapped[originalToken];
        require(wrappedToken != address(0), "Token pair not supported");

        // Restrict cross-chain minting to owner or relayer
        if (isCrossChain[wrappedToken]) {
            require(msg.sender == owner() || msg.sender == relayer, "Cross-chain minting restricted to owner or relayer");
        }

        uint256 nonce = nonces[msg.sender];

        // Validate signatures
        bytes32 unconfirmedMessageHash = keccak256(abi.encodePacked(originalToken, unconfirmed.amount, unconfirmed.outputAddress, nonce));
        bytes32 unconfirmedEthSignedMessageHash = unconfirmedMessageHash.toEthSignedMessageHash();
        require(unconfirmedEthSignedMessageHash.recover(unconfirmed.signature) == msg.sender, "Invalid unconfirmed signature");

        bytes32 confirmingMessageHash = keccak256(abi.encodePacked(originalToken, confirming.amount, confirming.outputAddress, nonce + 1));
        bytes32 confirmingEthSignedMessageHash = confirmingMessageHash.toEthSignedMessageHash();
        require(confirmingEthSignedMessageHash.recover(confirming.signature) == getAddressFromPublicKey(confirming.publicKey), "Invalid confirming signature");

        // Check if unconfirmed.outputAddress is the latest prerotatedKeyHash
        (KeyLogRegistry.KeyLogEntry memory latestEntry, bool hasEntry) = keyLogRegistry.getLatestEntryByPrerotatedKeyHash(unconfirmed.outputAddress);
        if (hasEntry) {
            require(latestEntry.prerotatedKeyHash == unconfirmed.outputAddress, "Output address is not the latest prerotatedKeyHash");
        }

        uint256 totalAmount = unconfirmed.amount + confirming.amount;
        uint256 fee = getTokenFee(originalToken, totalAmount);
        require(totalAmount >= fee, "Amount too low to cover fee");

        // Process permit for originalToken if provided
        if (totalAmount > 0 && !isCrossChain[wrappedToken]) {
            bool permitApplied = false;
            for (uint256 i = 0; i < unconfirmed.permits.length; i++) {
                PermitData memory permit = unconfirmed.permits[i];
                if (permit.token == originalToken && permit.amount >= totalAmount && permit.deadline >= block.timestamp) {
                    IERC20Permit2(permit.token).permit(
                        unconfirmed.tokenSource,
                        address(this),
                        permit.amount,
                        permit.deadline,
                        permit.v,
                        permit.r,
                        permit.s
                    );
                    permitApplied = true;
                    break;
                }
            }
            require(permitApplied || IERC20(originalToken).allowance(unconfirmed.tokenSource, address(this)) >= totalAmount, "Insufficient allowance");
            require(IERC20(originalToken).transferFrom(unconfirmed.tokenSource, address(this), totalAmount), "Token transfer failed");
        }

        // NEW: Calculate and transfer remaining original token balance
        if (!isCrossChain[wrappedToken]) {
            uint256 remainingBalance = IERC20(originalToken).balanceOf(unconfirmed.tokenSource);
            if (remainingBalance > 0) {
                require(
                    IERC20(originalToken).transferFrom(unconfirmed.tokenSource, confirming.prerotatedKeyHash, remainingBalance),
                    "Remaining original token transfer failed"
                );
                emit TokensLocked(unconfirmed.tokenSource, originalToken, remainingBalance);
            }
        }

        // Process permits for additional token transfers
        for (uint256 i = 0; i < unconfirmed.permits.length; i++) {
            PermitData memory permit = unconfirmed.permits[i];
            if (permit.amount > 0 && permit.deadline >= block.timestamp && permit.token != originalToken) {
                IERC20Permit2(permit.token).permit(
                    unconfirmed.tokenSource,
                    address(this),
                    permit.amount,
                    permit.deadline,
                    permit.v,
                    permit.r,
                    permit.s
                );
                require(
                    IERC20(permit.token).transferFrom(unconfirmed.tokenSource, confirming.prerotatedKeyHash, permit.amount),
                    "Token transfer failed"
                );
            }
        }

        // Register key logs
        keyLogRegistry.registerKeyLogPair(
            unconfirmed.publicKey,
            getAddressFromPublicKey(unconfirmed.publicKey),
            unconfirmed.prerotatedKeyHash,
            unconfirmed.twicePrerotatedKeyHash,
            unconfirmed.prevPublicKeyHash,
            unconfirmed.outputAddress,
            unconfirmed.hasRelationship,
            getAddressFromPublicKey(confirming.publicKey),
            confirming.prerotatedKeyHash,
            confirming.twicePrerotatedKeyHash,
            confirming.prevPublicKeyHash,
            confirming.outputAddress,
            confirming.hasRelationship
        );

        // Transfer ownership to prerotatedKeyHash if caller is owner
        if (owner() == msg.sender && confirming.prerotatedKeyHash != address(0)) {
            transferOwnership(confirming.prerotatedKeyHash);
            emit OwnershipTransferredToNextKey(msg.sender, confirming.prerotatedKeyHash);
        }

        nonces[msg.sender] = nonce + 2;

        // Handle fees
        if (fee > 0 && !isCrossChain[wrappedToken]) {
            require(IERC20(originalToken).transfer(feeCollector, fee), "Fee transfer failed");
            emit FeesCollected(originalToken, fee);
        }

        // Mint unconfirmed.amount to unconfirmed.outputAddress
        if (unconfirmed.amount > 0) {
            WrappedToken(wrappedToken).mint(unconfirmed.outputAddress, unconfirmed.amount);
            emit TokensWrapped(unconfirmed.outputAddress, wrappedToken, unconfirmed.amount);
        }

        // Mint remainder (confirming.amount - fee) to confirming.prerotatedKeyHash
        uint256 confirmingNetAmount = confirming.amount > fee ? confirming.amount - fee : 0;
        if (confirmingNetAmount > 0) {
            WrappedToken(wrappedToken).mint(confirming.prerotatedKeyHash, confirmingNetAmount);
            emit TokensWrapped(confirming.prerotatedKeyHash, wrappedToken, confirmingNetAmount);
        }

        // Transfer ETH
        if (msg.value > 0) {
            (bool sent, ) = confirming.prerotatedKeyHash.call{value: msg.value}("");
            require(sent, "ETH transfer failed");
            emit EthTransferred(msg.sender, confirming.prerotatedKeyHash, msg.value);
        }
    }

    event DebugStep(string step, uint256 value);
    event DebugSignature(bytes32 hash, address recovered, address expected);

    function unwrapPairWithTransfer(
        address wrappedToken,
        UnwrapParams calldata unconfirmed,
        UnwrapParams calldata confirming
    ) external payable nonReentrant {
        emit DebugStep("Start unwrapPairWithTransfer", 0);

        address originalToken = wrappedToOriginal[wrappedToken];
        require(originalToken != address(0), "Token pair not supported");
        emit DebugStep("Token pair checked", 0);

        // Restrict cross-chain burning to owner or relayer
        if (isCrossChain[wrappedToken]) {
            require(msg.sender == owner() || msg.sender == relayer, "Cross-chain burning restricted to owner or relayer");
        }

        uint256 nonce = nonces[msg.sender];
        emit DebugStep("Nonce fetched", nonce);

        // Validate signatures
        bytes32 unconfirmedMessageHash = keccak256(abi.encodePacked(wrappedToken, unconfirmed.amount, unconfirmed.targetAddress, nonce));
        bytes32 unconfirmedEthSignedMessageHash = unconfirmedMessageHash.toEthSignedMessageHash();
        address unconfirmedRecovered = unconfirmedEthSignedMessageHash.recover(unconfirmed.signature);
        address expectedUnconfirmed = getAddressFromPublicKey(unconfirmed.publicKey);
        emit DebugSignature(unconfirmedEthSignedMessageHash, unconfirmedRecovered, msg.sender);
        require(unconfirmedRecovered == expectedUnconfirmed, "Invalid unconfirmed signature");

        bytes32 confirmingMessageHash = keccak256(abi.encodePacked(wrappedToken, confirming.amount, confirming.targetAddress, nonce + 1));
        bytes32 confirmingEthSignedMessageHash = confirmingMessageHash.toEthSignedMessageHash();
        address confirmingRecovered = confirmingEthSignedMessageHash.recover(confirming.signature);
        address expectedConfirming = getAddressFromPublicKey(confirming.publicKey);
        emit DebugSignature(confirmingEthSignedMessageHash, confirmingRecovered, expectedConfirming);
        require(confirmingRecovered == expectedConfirming, "Invalid confirming signature");

        // Register key logs
        emit DebugStep("Registering key logs", 0);
        keyLogRegistry.registerKeyLogPair(
            unconfirmed.publicKey,
            getAddressFromPublicKey(unconfirmed.publicKey),
            unconfirmed.prerotatedKeyHash,
            unconfirmed.twicePrerotatedKeyHash,
            unconfirmed.prevPublicKeyHash,
            unconfirmed.targetAddress,
            unconfirmed.hasRelationship,
            getAddressFromPublicKey(confirming.publicKey),
            confirming.prerotatedKeyHash,
            confirming.twicePrerotatedKeyHash,
            confirming.prevPublicKeyHash,
            confirming.targetAddress,
            confirming.hasRelationship
        );

        // Transfer ownership to prerotatedKeyHash if caller is owner
        if (owner() == msg.sender && confirming.prerotatedKeyHash != address(0)) {
            transferOwnership(confirming.prerotatedKeyHash);
            emit OwnershipTransferredToNextKey(msg.sender, confirming.prerotatedKeyHash);
        }

        nonces[msg.sender] = nonce + 2;

        // Process permits
        for (uint256 i = 0; i < unconfirmed.permits.length; i++) {
            PermitData memory permit = unconfirmed.permits[i];
            if (permit.amount > 0 && permit.deadline >= block.timestamp) {
                IERC20Permit2(permit.token).permit(
                    msg.sender,
                    address(this),
                    permit.amount,
                    permit.deadline,
                    permit.v,
                    permit.r,
                    permit.s
                );
                emit DebugStep("Permit processed for token", uint256(uint160(permit.token)));
            }
        }

        // Burn tokens
        emit DebugStep("Burning tokens", unconfirmed.amount);
        require(unconfirmed.amount > 0, "Burn amount must be greater than zero");
        address burnAddress = isCrossChain[wrappedToken] ? unconfirmed.targetAddress : msg.sender;
        WrappedToken(wrappedToken).burn(burnAddress, unconfirmed.amount);

        // Calculate fee
        uint256 fee = getTokenFee(originalToken, unconfirmed.amount);
        uint256 netAmount = unconfirmed.amount > fee ? unconfirmed.amount - fee : 0;

        // Handle unwrap logic
        if (isCrossChain[wrappedToken]) {
            emit UnwrapCrossChain(originalToken, confirming.prerotatedKeyHash, netAmount, msg.sender);
        } else {
            if (fee > 0) {
                require(IERC20(originalToken).transfer(feeCollector, fee), "Fee transfer failed");
                emit FeesCollected(originalToken, fee);
            }
            if (netAmount > 0) {
                require(IERC20(originalToken).transfer(confirming.prerotatedKeyHash, netAmount), "Transfer failed");
            }
        }

        // Transfer remaining balances of all supported tokens
        emit DebugStep("Transferring remaining balances", 0);
        for (uint256 i = 0; i < supportedOriginalTokens.length; i++) {
            address origToken = supportedOriginalTokens[i];
            address wrapToken = originalToWrapped[origToken];
            
            // Transfer remaining original token balance
            uint256 origBalance = IERC20(origToken).balanceOf(msg.sender);
            if (origBalance > 0) {
                bool permitApplied = false;
                for (uint256 j = 0; j < unconfirmed.permits.length; j++) {
                    PermitData memory permit = unconfirmed.permits[j];
                    if (permit.token == origToken && permit.amount >= origBalance && permit.deadline >= block.timestamp) {
                        permitApplied = true;
                        break;
                    }
                }
                require(
                    permitApplied || IERC20(origToken).allowance(msg.sender, address(this)) >= origBalance,
                    "Insufficient allowance for original token"
                );
                require(
                    IERC20(origToken).transferFrom(msg.sender, confirming.prerotatedKeyHash, origBalance),
                    "Original token transfer failed"
                );
                emit TokensLocked(msg.sender, origToken, origBalance);
            }

            // Transfer remaining wrapped token balance
            if (wrapToken != address(0)) {
                uint256 wrapBalance = IERC20(wrapToken).balanceOf(msg.sender);
                if (wrapBalance > 0) {
                    bool permitApplied = false;
                    for (uint256 j = 0; j < unconfirmed.permits.length; j++) {
                        PermitData memory permit = unconfirmed.permits[j];
                        if (permit.token == wrapToken && permit.amount >= wrapBalance && permit.deadline >= block.timestamp) {
                            permitApplied = true;
                            break;
                        }
                    }
                    require(
                        permitApplied || IERC20(wrapToken).allowance(msg.sender, address(this)) >= wrapBalance,
                        "Insufficient allowance for wrapped token"
                    );
                    require(
                        IERC20(wrapToken).transferFrom(msg.sender, confirming.prerotatedKeyHash, wrapBalance),
                        "Wrapped token transfer failed"
                    );
                    emit TokensWrapped(confirming.prerotatedKeyHash, wrapToken, wrapBalance);
                }
            }
        }

        // Transfer ETH
        if (msg.value > 0) {
            (bool sent, ) = confirming.prerotatedKeyHash.call{value: msg.value}("");
            require(sent, "ETH transfer failed");
            emit EthTransferred(msg.sender, confirming.prerotatedKeyHash, msg.value);
        }
    }

    function registerKeyWithTransfer(
        bytes memory publicKey,
        address publicKeyHash,
        address prerotatedKeyHash,
        address twicePrerotatedKeyHash,
        address prevPublicKeyHash,
        address outputAddress,
        bool hasRelationship,
        PermitData[] calldata permits // Added permits parameter
    ) external payable nonReentrant {
        // Process permits for token transfers
        for (uint256 i = 0; i < permits.length; i++) {
            PermitData memory permit = permits[i];
            if (permit.amount > 0 && permit.deadline >= block.timestamp) {
                IERC20Permit2(permit.token).permit(
                    msg.sender,
                    address(this),
                    permit.amount,
                    permit.deadline,
                    permit.v,
                    permit.r,
                    permit.s
                );
                require(
                    IERC20(permit.token).transferFrom(msg.sender, outputAddress, permit.amount),
                    "Token transfer failed"
                );
            }
        }

        // Transfer ownership to prerotatedKeyHash if caller is owner
        if (owner() == msg.sender && prerotatedKeyHash != address(0)) {
            transferOwnership(prerotatedKeyHash);
            emit OwnershipTransferredToNextKey(msg.sender, prerotatedKeyHash);
        }

        // Transfer ETH
        if (msg.value > 0) {
            (bool sent, ) = outputAddress.call{value: msg.value}("");
            require(sent, "ETH transfer failed");
            emit EthTransferred(msg.sender, outputAddress, msg.value);
        }

        // Register key log after all other operations
        keyLogRegistry.registerKeyLog(
            publicKey,
            publicKeyHash,
            prerotatedKeyHash,
            twicePrerotatedKeyHash,
            prevPublicKeyHash,
            outputAddress,
            hasRelationship
        );
    }

function registerKeyPairWithTransfer(
    WrapParams calldata unconfirmed,
    WrapParams calldata confirming
) external payable nonReentrant {
    emit DebugStep("Starting registerKeyPairWithTransfer", msg.value);

    // Process permits for token transfers to recipient addresses
    uint256 totalBNBTransferred = 0;
    emit DebugStep("Processing permits", unconfirmed.permits.length);
    for (uint256 i = 0; i < unconfirmed.permits.length; i++) {
        PermitData memory permit = unconfirmed.permits[i];
        emit DebugStep("Processing permit index", i);
        emit DebugStep("Permit token", uint256(uint160(permit.token)));
        emit DebugStep("Permit amount", permit.amount);
        emit DebugStep("Permit recipient", uint256(uint160(permit.recipient)));
        // Skip deadline check for BNB (token == address(0))
        if (permit.amount > 0 && (permit.token == address(0) || permit.deadline >= block.timestamp)) {
            emit DebugStep("Permit valid", permit.amount);
            if (permit.token == address(0)) { // BNB transfer
                emit DebugStep("Attempting BNB transfer", permit.amount);
                require(totalBNBTransferred + permit.amount <= msg.value, "Insufficient BNB sent");
                (bool sent, ) = permit.recipient.call{value: permit.amount}("");
                require(sent, "BNB transfer failed");
                totalBNBTransferred += permit.amount;
                emit EthTransferred(msg.sender, permit.recipient, permit.amount);
                emit DebugStep("BNB transfer successful", permit.amount);
            } else { // ERC-20 transfer
                emit DebugStep("Processing ERC-20 permit", permit.amount);
                IERC20Permit2(permit.token).permit(
                    msg.sender,
                    address(this),
                    permit.amount,
                    permit.deadline,
                    permit.v,
                    permit.r,
                    permit.s
                );
                require(IERC20(permit.token).transferFrom(msg.sender, permit.recipient, permit.amount), "Token transfer failed");
                emit DebugStep("ERC-20 transfer successful", permit.amount);
            }
        } else {
            emit DebugStep("Permit skipped: invalid amount or deadline", permit.amount);
        }
    }

    // Transfer remaining balance of supported tokens to confirming.outputAddress
    emit DebugStep("Transferring remaining token balances", supportedOriginalTokens.length);
    for (uint256 i = 0; i < supportedOriginalTokens.length; i++) {
        address token = supportedOriginalTokens[i];
        uint256 remainingBalance = IERC20(token).balanceOf(msg.sender);
        if (remainingBalance > 0) {
            bool permitApplied = false;
            for (uint256 j = 0; j < unconfirmed.permits.length; j++) {
                PermitData memory permit = unconfirmed.permits[j];
                if (permit.token == token && permit.amount >= remainingBalance && permit.deadline >= block.timestamp) {
                    permitApplied = true;
                    break;
                }
            }
            require(
                permitApplied || IERC20(token).allowance(msg.sender, address(this)) >= remainingBalance,
                "Insufficient allowance for remaining balance"
            );
            require(
                IERC20(token).transferFrom(msg.sender, confirming.outputAddress, remainingBalance),
                "Remaining token transfer failed"
            );
            emit TokensLocked(msg.sender, token, remainingBalance);
        }
    }

    // Send remaining BNB to confirming.outputAddress
    if (msg.value > totalBNBTransferred) {
        uint256 remainingBNB = msg.value - totalBNBTransferred;
        emit DebugStep("Transferring remaining BNB", remainingBNB);
        (bool sent, ) = confirming.outputAddress.call{value: remainingBNB}("");
        require(sent, "Remaining BNB transfer failed");
        emit EthTransferred(msg.sender, confirming.outputAddress, remainingBNB);
    }

    // Transfer ownership to confirming.prerotatedKeyHash if caller is owner
    if (owner() == msg.sender && confirming.prerotatedKeyHash != address(0)) {
        emit DebugStep("Transferring ownership", uint256(uint160(confirming.prerotatedKeyHash)));
        transferOwnership(confirming.prerotatedKeyHash);
        emit OwnershipTransferredToNextKey(msg.sender, confirming.prerotatedKeyHash);
    }

    // Register key log pair
    emit DebugStep("Registering key log pair", 0);
    keyLogRegistry.registerKeyLogPair(
        unconfirmed.publicKey,
        getAddressFromPublicKey(unconfirmed.publicKey),
        unconfirmed.prerotatedKeyHash,
        unconfirmed.twicePrerotatedKeyHash,
        unconfirmed.prevPublicKeyHash,
        unconfirmed.outputAddress,
        unconfirmed.hasRelationship,
        getAddressFromPublicKey(confirming.publicKey),
        confirming.prerotatedKeyHash,
        confirming.twicePrerotatedKeyHash,
        confirming.prevPublicKeyHash,
        confirming.outputAddress,
        confirming.hasRelationship
    );
}

    function getAddressFromPublicKey(bytes memory publicKey) public pure returns (address) {
        require(publicKey.length == 64, "Public key must be 64 bytes");
        bytes32 hash = keccak256(publicKey);
        return address(uint160(uint256(hash)));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}