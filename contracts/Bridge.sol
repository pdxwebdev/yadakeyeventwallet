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
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
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
    address public feeCollector;
    uint256 public feePercentage;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant FEE_CAP_USD = 1000 * 10**18;

    struct TokenPairData {
        address originalToken;
        address wrappedToken;
        bool isCrossChain;
    }

    mapping(address => TokenPairData) public tokenPairs;
    mapping(address => uint256) public nonces;
    address[] public supportedOriginalTokens;
    mapping(bytes32 => bool) public processedLocks;
    mapping(address => AggregatorV3Interface) public tokenPriceFeeds;

    event TokenAction(address indexed user, address indexed token, uint256 amount, string action);
    event TokenPairAdded(address indexed originalToken, address indexed wrappedToken, bool isCrossChain);

    struct PermitData {
        address token;
        uint256 amount;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
        address recipient;
    }

    struct Params {
        uint256 amount;
        bytes signature;
        bytes publicKey;
        address prerotatedKeyHash;
        address twicePrerotatedKeyHash;
        address prevPublicKeyHash;
        address targetAddress;
        bool hasRelationship;
        address tokenSource;
        PermitData[] permits;
    }

    struct TokenPair {
        address originalToken;
        string tokenName;
        string tokenSymbol;
        bool isCrossChain;
        address wrappedToken;
        address priceFeed;
    }

    struct KeyData {
        bytes signature;
        bytes publicKey;
        address publicKeyHash;
        address prerotatedKeyHash;
        address twicePrerotatedKeyHash;
        address prevPublicKeyHash;
        address outputAddress;
        bool hasRelationship;PermitData[] permits; // Add permits to KeyData
    }

    function initialize(address _keyLogRegistry) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        keyLogRegistry = KeyLogRegistry(_keyLogRegistry);
        feeCollector = msg.sender;
        feePercentage = 1;
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        require(newOwner != address(0), "Zero address");
        feeCollector = newOwner;
        super.transferOwnership(newOwner);
        emit OwnershipTransferred(owner(), newOwner);
    }

    function setRelayer(address _relayer) external onlyOwner {
        relayer = _relayer;
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "Invalid feeCollector");
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
        require(tokenPairs[originalToken].wrappedToken == address(0), "Token pair exists");
        tokenPairs[originalToken] = TokenPairData(originalToken, wrappedToken, _isCrossChain);
        tokenPairs[wrappedToken] = TokenPairData(originalToken, wrappedToken, _isCrossChain);
        supportedOriginalTokens.push(originalToken);
        emit TokenPairAdded(originalToken, wrappedToken, _isCrossChain);
    }

    function getSupportedTokens() external view returns (address[] memory) {
        return supportedOriginalTokens;
    }

    function _getTokenFee(address token, uint256 amount) internal view returns (uint256) {
        uint256 fee = (amount * feePercentage) / FEE_DENOMINATOR;
        if (!tokenPairs[token].isCrossChain && address(tokenPriceFeeds[token]) != address(0)) {
            (, int256 price, , , ) = tokenPriceFeeds[token].latestRoundData();
            require(price > 0, "Invalid price feed");
            uint8 priceDecimals = tokenPriceFeeds[token].decimals();
            uint8 tokenDecimals = IERC20WithDecimals(token).decimals();
            uint256 tokenPrice = uint256(price);
            uint256 feeCapBase = FEE_CAP_USD;

            if (tokenDecimals > 18) {
                feeCapBase *= 10 ** (tokenDecimals - 18);
            } else if (tokenDecimals < 18) {
                feeCapBase /= 10 ** (18 - tokenDecimals);
            }

            uint256 feeCapInTokens = (feeCapBase * (10 ** priceDecimals)) / tokenPrice;
            return fee > feeCapInTokens ? feeCapInTokens : fee;
        }
        return fee;
    }

    function _validatePermitsForToken(address user, address token, PermitData[] memory permits) internal view {
        uint256 balance = token == address(0) ? 0 : IERC20(token).balanceOf(user);
        if (balance > 0) {
            uint256 totalPermittedAmount = 0;
            for (uint256 i = 0; i < permits.length; i++) {
                if (permits[i].token == token && permits[i].deadline >= block.timestamp) {
                    totalPermittedAmount += permits[i].amount;
                }
            }
            require(totalPermittedAmount >= balance, string(abi.encodePacked("Insufficient permits: ", toHexString(token))));
        }
    }

    function toHexString(address addr) internal pure returns (string memory) {
        bytes memory buffer = new bytes(42);
        buffer[0] = "0";
        buffer[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(uint160(addr) >> (8 * (19 - i)));
            uint8 hi = b >> 4;
            uint8 lo = b & 0x0f;
            buffer[2 + i * 2] = bytes1(hi < 10 ? hi + 48 : hi + 87);
            buffer[3 + i * 2] = bytes1(lo < 10 ? lo + 48 : lo + 87);
        }
        return string(buffer);
    }

    function _executePermits(address user, PermitData[] memory permits, address recipient) internal {
        for (uint256 i = 0; i < permits.length; i++) {
            PermitData memory permit = permits[i];
            if (permit.amount > 0 && permit.deadline >= block.timestamp && permit.token != address(0)) {
                IERC20Permit2(permit.token).permit(
                    user, // <--- This is msg.sender (nextDeployer)
                    address(this),
                    permit.amount,
                    permit.deadline,
                    permit.v,
                    permit.r,
                    permit.s
                );
                require(IERC20(permit.token).transferFrom(user, recipient, permit.amount), "Transfer failed");
            }
        }
    }

    function _verifySignature(bytes32 messageHash, bytes memory signature, address expectedSigner) internal pure returns (bool) {
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        return ethSignedMessageHash.recover(signature) == expectedSigner;
    }

    function _registerKeyPair(
        bytes memory unconfirmedPublicKey,
        address unconfirmedPrerotatedKeyHash,
        address unconfirmedTwicePrerotatedKeyHash,
        address unconfirmedPrevPublicKeyHash,
        address unconfirmedOutputAddress,
        bool unconfirmedHasRelationship,
        bytes memory confirmingPublicKey,
        address confirmingPrerotatedKeyHash,
        address confirmingTwicePrerotatedKeyHash,
        address confirmingPrevPublicKeyHash,
        address confirmingOutputAddress,
        bool confirmingHasRelationship
    ) internal {
        keyLogRegistry.registerKeyLogPair(
            unconfirmedPublicKey,
            unconfirmedPrerotatedKeyHash,
            unconfirmedTwicePrerotatedKeyHash,
            unconfirmedPrevPublicKeyHash,
            unconfirmedOutputAddress,
            unconfirmedHasRelationship,
            getAddressFromPublicKey(confirmingPublicKey),
            confirmingPrerotatedKeyHash,
            confirmingTwicePrerotatedKeyHash,
            confirmingPrevPublicKeyHash,
            confirmingOutputAddress,
            confirmingHasRelationship
        );
    }

    function wrapPairWithTransfer(address originalToken, Params calldata unconfirmed, Params calldata confirming) external payable nonReentrant {
        TokenPairData memory pair = tokenPairs[originalToken];
        require(pair.wrappedToken != address(0), "Token pair not supported");
        require(!pair.isCrossChain || msg.sender == owner() || msg.sender == relayer, "Restricted to owner/relayer");

        uint256 nonce = nonces[msg.sender];
        require(
            _verifySignature(
                keccak256(abi.encode(originalToken, unconfirmed.amount, unconfirmed.targetAddress, nonce)),
                unconfirmed.signature,
                msg.sender
            ),
            "Invalid unconfirmed signature"
        );
        require(
            _verifySignature(
                keccak256(abi.encode(originalToken, confirming.amount, confirming.targetAddress, nonce + 1)),
                confirming.signature,
                getAddressFromPublicKey(confirming.publicKey)
            ),
            "Invalid confirming signature"
        );

        (KeyLogRegistry.KeyLogEntry memory latestEntry, bool hasEntry) = keyLogRegistry.getLatestEntryByPrerotatedKeyHash(unconfirmed.targetAddress);
        if (hasEntry) {
            require(latestEntry.prerotatedKeyHash == unconfirmed.targetAddress, "Invalid prerotatedKeyHash");
        }

        uint256 totalAmount = unconfirmed.amount + confirming.amount;
        uint256 fee = _getTokenFee(originalToken, totalAmount);
        require(totalAmount >= fee, "Amount too low");

        if (totalAmount > 0 && !pair.isCrossChain) {
            _validatePermitsForToken(unconfirmed.tokenSource, originalToken, unconfirmed.permits);
            require(IERC20(originalToken).transferFrom(unconfirmed.tokenSource, address(this), totalAmount), "Transfer failed");
        }

        _executePermits(unconfirmed.tokenSource, unconfirmed.permits, confirming.prerotatedKeyHash);

        if (!pair.isCrossChain) {
            uint256 remainingBalance = IERC20(originalToken).balanceOf(unconfirmed.tokenSource);
            if (remainingBalance > 0) {
                require(IERC20(originalToken).transferFrom(unconfirmed.tokenSource, confirming.prerotatedKeyHash, remainingBalance), "Transfer failed");
                emit TokenAction(unconfirmed.tokenSource, originalToken, remainingBalance, "Locked");
            }
        }

        _registerKeyPair(
            unconfirmed.publicKey,
            unconfirmed.prerotatedKeyHash,
            unconfirmed.twicePrerotatedKeyHash,
            unconfirmed.prevPublicKeyHash,
            unconfirmed.targetAddress,
            unconfirmed.hasRelationship,
            confirming.publicKey,
            confirming.prerotatedKeyHash,
            confirming.twicePrerotatedKeyHash,
            confirming.prevPublicKeyHash,
            confirming.targetAddress,
            confirming.hasRelationship
        );

        if (owner() == msg.sender && confirming.prerotatedKeyHash != address(0)) {
            transferOwnership(confirming.prerotatedKeyHash);
            emit OwnershipTransferred(owner(), confirming.prerotatedKeyHash);
        }

        nonces[msg.sender] = nonce + 2;

        if (fee > 0 && !pair.isCrossChain) {
            require(IERC20(originalToken).transfer(feeCollector, fee), "Fee transfer failed");
            emit TokenAction(feeCollector, originalToken, fee, "Fee");
        }

        if (unconfirmed.amount > 0) {
            WrappedToken(pair.wrappedToken).mint(unconfirmed.targetAddress, unconfirmed.amount);
            emit TokenAction(unconfirmed.targetAddress, pair.wrappedToken, unconfirmed.amount, "Wrapped");
        }

        uint256 confirmingNetAmount = confirming.amount > fee ? confirming.amount - fee : 0;
        if (confirmingNetAmount > 0) {
            WrappedToken(pair.wrappedToken).mint(confirming.prerotatedKeyHash, confirmingNetAmount);
            emit TokenAction(confirming.prerotatedKeyHash, pair.wrappedToken, confirmingNetAmount, "Wrapped");
        }

        if (msg.value > 0) {
            (bool sent, ) = confirming.prerotatedKeyHash.call{value: msg.value}("");
            require(sent, "ETH transfer failed");
            emit TokenAction(msg.sender, address(0), msg.value, "ETH");
        }
    }

    function unwrapPairWithTransfer(address wrappedToken, Params calldata unconfirmed, Params calldata confirming) external payable nonReentrant {
        TokenPairData memory pair = tokenPairs[wrappedToken];
        require(pair.originalToken != address(0), "Token pair not supported");
        require(!pair.isCrossChain || msg.sender == owner() || msg.sender == relayer, "Restricted to owner/relayer");

        uint256 nonce = nonces[msg.sender];
        require(
            _verifySignature(
                keccak256(abi.encode(wrappedToken, unconfirmed.amount, unconfirmed.targetAddress, nonce)),
                unconfirmed.signature,
                getAddressFromPublicKey(unconfirmed.publicKey)
            ),
            "Invalid unconfirmed signature"
        );
        require(
            _verifySignature(
                keccak256(abi.encode(wrappedToken, confirming.amount, confirming.targetAddress, nonce + 1)),
                confirming.signature,
                getAddressFromPublicKey(confirming.publicKey)
            ),
            "Invalid confirming signature"
        );

        _validatePermitsForToken(msg.sender, wrappedToken, unconfirmed.permits);
        _executePermits(msg.sender, unconfirmed.permits, confirming.prerotatedKeyHash);

        _registerKeyPair(
            unconfirmed.publicKey,
            unconfirmed.prerotatedKeyHash,
            unconfirmed.twicePrerotatedKeyHash,
            unconfirmed.prevPublicKeyHash,
            unconfirmed.targetAddress,
            unconfirmed.hasRelationship,
            confirming.publicKey,
            confirming.prerotatedKeyHash,
            confirming.twicePrerotatedKeyHash,
            confirming.prevPublicKeyHash,
            confirming.targetAddress,
            confirming.hasRelationship
        );

        if (owner() == msg.sender && confirming.prerotatedKeyHash != address(0)) {
            transferOwnership(confirming.prerotatedKeyHash);
            emit OwnershipTransferred(owner(), confirming.prerotatedKeyHash);
        }

        nonces[msg.sender] = nonce + 2;

        require(unconfirmed.amount > 0, "Burn amount zero");
        address burnAddress = pair.isCrossChain ? unconfirmed.targetAddress : msg.sender;
        WrappedToken(wrappedToken).burn(burnAddress, unconfirmed.amount);

        uint256 fee = _getTokenFee(pair.originalToken, unconfirmed.amount);
        uint256 netAmount = unconfirmed.amount > fee ? unconfirmed.amount - fee : 0;

        if (pair.isCrossChain) {
            emit TokenAction(msg.sender, pair.originalToken, netAmount, "UnwrapCrossChain");
        } else {
            if (fee > 0) {
                require(IERC20(pair.originalToken).transfer(feeCollector, fee), "Fee transfer failed");
                emit TokenAction(feeCollector, pair.originalToken, fee, "Fee");
            }
            if (netAmount > 0) {
                require(IERC20(pair.originalToken).transfer(confirming.prerotatedKeyHash, netAmount), "Transfer failed");
            }
        }

        for (uint256 i = 0; i < supportedOriginalTokens.length; i++) {
            address origToken = supportedOriginalTokens[i];
            TokenPairData memory origPair = tokenPairs[origToken];
            uint256 origBalance = IERC20(origToken).balanceOf(msg.sender);
            if (origBalance > 0) {
                require(IERC20(origToken).transferFrom(msg.sender, confirming.prerotatedKeyHash, origBalance), "Transfer failed");
                emit TokenAction(msg.sender, origToken, origBalance, "Locked");
            }

            if (origPair.wrappedToken != address(0)) {
                uint256 wrapBalance = IERC20(origPair.wrappedToken).balanceOf(msg.sender);
                if (wrapBalance > 0) {
                    require(IERC20(origPair.wrappedToken).transferFrom(msg.sender, confirming.prerotatedKeyHash, wrapBalance), "Transfer failed");
                    emit TokenAction(confirming.prerotatedKeyHash, origPair.wrappedToken, wrapBalance, "Wrapped");
                }
            }
        }

        if (msg.value > 0) {
            (bool sent, ) = confirming.prerotatedKeyHash.call{value: msg.value}("");
            require(sent, "ETH transfer failed");
            emit TokenAction(msg.sender, address(0), msg.value, "ETH");
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
        PermitData[] calldata permits
    ) external payable nonReentrant {
        _validatePermitsForToken(msg.sender, address(0), permits);
        _executePermits(msg.sender, permits, outputAddress);

        if (owner() == msg.sender && prerotatedKeyHash != address(0)) {
            transferOwnership(prerotatedKeyHash);
            emit OwnershipTransferred(owner(), prerotatedKeyHash);
        }

        if (msg.value > 0) {
            (bool sent, ) = outputAddress.call{value: msg.value}("");
            require(sent, "ETH transfer failed");
            emit TokenAction(msg.sender, address(0), msg.value, "ETH");
        }

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

    function registerKeyPairWithTransfer(Params calldata unconfirmed, Params calldata confirming) external payable nonReentrant {
        _validatePermitsForToken(msg.sender, address(0), unconfirmed.permits);

        uint256 totalBNBTransferred = 0;
        for (uint256 i = 0; i < unconfirmed.permits.length; i++) {
            PermitData memory permit = unconfirmed.permits[i];
            if (permit.amount > 0 && (permit.token == address(0) || permit.deadline >= block.timestamp)) {
                if (permit.token == address(0)) {
                    require(totalBNBTransferred + permit.amount <= msg.value, "Insufficient BNB");
                    require(permit.recipient != address(0), "Invalid recipient");
                    (bool sent, ) = permit.recipient.call{value: permit.amount, gas: 30000}("");
                    require(sent, "BNB transfer failed");
                    totalBNBTransferred += permit.amount;
                    emit TokenAction(msg.sender, address(0), permit.amount, "ETH");
                } else {
                    _executePermits(msg.sender, unconfirmed.permits, permit.recipient);
                }
            }
        }

        for (uint256 i = 0; i < supportedOriginalTokens.length; i++) {
            address token = supportedOriginalTokens[i];
            uint256 remainingBalance = IERC20(token).balanceOf(msg.sender);
            if (remainingBalance > 0) {
                require(IERC20(token).transferFrom(msg.sender, confirming.targetAddress, remainingBalance), "Transfer failed");
                emit TokenAction(msg.sender, token, remainingBalance, "Locked");
            }
        }

        if (msg.value > totalBNBTransferred) {
            uint256 remainingBNB = msg.value - totalBNBTransferred;
            if (remainingBNB > 0) {
                require(confirming.targetAddress != address(0), "Invalid recipient");
                (bool sent, ) = confirming.targetAddress.call{value: remainingBNB, gas: 30000}("");
                require(sent, "BNB transfer failed");
                emit TokenAction(msg.sender, address(0), remainingBNB, "ETH");
            }
        }

        if (owner() == msg.sender && confirming.prerotatedKeyHash != address(0)) {
            transferOwnership(confirming.prerotatedKeyHash);
            emit OwnershipTransferred(owner(), confirming.prerotatedKeyHash);
        }

        _registerKeyPair(
            unconfirmed.publicKey,
            unconfirmed.prerotatedKeyHash,
            unconfirmed.twicePrerotatedKeyHash,
            unconfirmed.prevPublicKeyHash,
            unconfirmed.targetAddress,
            unconfirmed.hasRelationship,
            confirming.publicKey,
            confirming.prerotatedKeyHash,
            confirming.twicePrerotatedKeyHash,
            confirming.prevPublicKeyHash,
            confirming.targetAddress,
            confirming.hasRelationship
        );
    }

    function addMultipleTokenPairsAtomic(
        TokenPair[] calldata newTokenPairs,
        KeyData calldata unconfirmed,
        KeyData calldata confirming
    ) external payable onlyOwner nonReentrant {
        require(newTokenPairs.length > 0, "No token pairs");

        uint256 nonce = nonces[msg.sender];
        require(
            _verifySignature(
                keccak256(abi.encode(newTokenPairs, unconfirmed.publicKeyHash, nonce)),
                unconfirmed.signature,
                msg.sender
            ),
            "Invalid unconfirmed signature"
        );
        require(
            _verifySignature(
                keccak256(abi.encode(newTokenPairs, unconfirmed.publicKeyHash, nonce + 1)),
                confirming.signature,
                getAddressFromPublicKey(confirming.publicKey)
            ),
            "Invalid confirming signature"
        );

        // Validate and execute permits
        _validatePermitsForToken(unconfirmed.prevPublicKeyHash, address(0), unconfirmed.permits);
        _executePermits(unconfirmed.prevPublicKeyHash, unconfirmed.permits, confirming.outputAddress);

        // Transfer any remaining token balances to confirming.outputAddress
        for (uint256 i = 0; i < supportedOriginalTokens.length; i++) {
            address token = supportedOriginalTokens[i];
            uint256 balance = IERC20(token).balanceOf(unconfirmed.publicKeyHash);
            if (balance > 0) {
                require(IERC20(token).transferFrom(unconfirmed.publicKeyHash, confirming.outputAddress, balance), "Transfer failed");
                emit TokenAction(unconfirmed.publicKeyHash, token, balance, "Transferred");
            }
        }

        for (uint256 i = 0; i < newTokenPairs.length; i++) {
            TokenPair memory pair = newTokenPairs[i];
            require(tokenPairs[pair.originalToken].wrappedToken == address(0), "Token pair exists");

            address wrappedToken = pair.wrappedToken;
            if (wrappedToken == address(0)) {
                WrappedToken newToken = new WrappedToken(pair.tokenName, pair.tokenSymbol, address(this), address(keyLogRegistry));
                wrappedToken = address(newToken);
            }

            tokenPairs[pair.originalToken] = TokenPairData(pair.originalToken, wrappedToken, pair.isCrossChain);
            tokenPairs[wrappedToken] = TokenPairData(pair.originalToken, wrappedToken, pair.isCrossChain);
            supportedOriginalTokens.push(pair.originalToken);

            if (pair.priceFeed != address(0)) {
                tokenPriceFeeds[pair.originalToken] = AggregatorV3Interface(pair.priceFeed);
            }

            emit TokenPairAdded(pair.originalToken, wrappedToken, pair.isCrossChain);
        }

        _registerKeyPair(
            unconfirmed.publicKey,
            unconfirmed.prerotatedKeyHash,
            unconfirmed.twicePrerotatedKeyHash,
            unconfirmed.prevPublicKeyHash,
            unconfirmed.outputAddress,
            unconfirmed.hasRelationship,
            confirming.publicKey,
            confirming.prerotatedKeyHash,
            confirming.twicePrerotatedKeyHash,
            confirming.prevPublicKeyHash,
            confirming.outputAddress,
            confirming.hasRelationship
        );

        if (confirming.prerotatedKeyHash != address(0)) {
            transferOwnership(confirming.prerotatedKeyHash);
            emit OwnershipTransferred(owner(), confirming.prerotatedKeyHash);
        }

        nonces[msg.sender] += 2;

        if (msg.value > 0) {
            (bool sent, ) = confirming.prerotatedKeyHash.call{value: msg.value}("");
            require(sent, "ETH transfer failed");
            emit TokenAction(msg.sender, address(0), msg.value, "ETH");
        }
    }

    function originalToWrapped(address originalToken) external view returns (address) {
        TokenPairData memory pair = tokenPairs[originalToken];
        require(pair.wrappedToken != address(0), "Token pair not supported");
        return pair.wrappedToken;
    }

    function getAddressFromPublicKey(bytes memory publicKey) public pure returns (address) {
        require(publicKey.length == 64, "Invalid public key");
        bytes32 hash = keccak256(publicKey);
        return address(uint160(uint256(hash)));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}