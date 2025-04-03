/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/
// SPDX-License-Identifier: MIT
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

contract Bridge is Initializable, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    KeyLogRegistry public keyLogRegistry;
    address public relayer;

    mapping(address => address) public originalToWrapped;
    mapping(address => address) public wrappedToOriginal;
    mapping(address => bool) public isCrossChain;
    mapping(address => uint256) public nonces;

    address public feeCollector;
    uint256 public feePercentage;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant FEE_CAP_USD = 1000 * 10**18; // 1000 USD with 18 decimals
    mapping(bytes32 => bool) public processedLocks;
    mapping(address => AggregatorV3Interface) public tokenPriceFeeds; // Token address => Chainlink price feed

    event TokensWrapped(address indexed user, address wrappedToken, uint256 amount);
    event UnwrapCrossChain(address indexed originalToken, address targetAddress, uint256 amount, address indexed user);
    event TokensLocked(address indexed user, address indexed originalToken, uint256 amount);
    event FeesCollected(address indexed token, uint256 amount);
    event TokensMinted(address indexed wrappedToken, address indexed user, uint256 amount);
    event EthTransferred(address indexed from, address indexed to, uint256 amount);

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
        uint256 permitDeadline;
        uint8 permitV;
        bytes32 permitR;
        bytes32 permitS;
        uint256 permitDeadlineOriginal;
        uint8 permitVOriginal;
        bytes32 permitROriginal;
        bytes32 permitSOriginal;
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
        uint256 permitDeadline;
        uint8 permitV;
        bytes32 permitR;
        bytes32 permitS;
        uint256 permitDeadlineOriginal;
        uint8 permitVOriginal;
        bytes32 permitROriginal;
        bytes32 permitSOriginal;
    }

    function initialize(address _keyLogRegistry) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        keyLogRegistry = KeyLogRegistry(_keyLogRegistry);
        feeCollector = msg.sender;
        feePercentage = 1; // .01% default fee
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
        originalToWrapped[originalToken] = wrappedToken;
        wrappedToOriginal[wrappedToken] = originalToken;
        isCrossChain[wrappedToken] = _isCrossChain;
    }

    function getTokenFee(address token, uint256 amount) internal view returns (uint256) {
        uint256 calculatedFee = (amount * feePercentage) / FEE_DENOMINATOR;
        
        // If not cross-chain and price feed exists, cap the fee
        if (!isCrossChain[token]) {
            AggregatorV3Interface priceFeed = tokenPriceFeeds[token];
            if (address(priceFeed) != address(0)) {
                (, int256 price, , , ) = priceFeed.latestRoundData();
                require(price > 0, "Invalid price feed");
                
                uint8 priceDecimals = priceFeed.decimals();
                uint8 tokenDecimals = IERC20WithDecimals(token).decimals();
                uint256 tokenPrice = uint256(price); // Safe since we check price > 0
                
                // Calculate fee cap in token units:
                // FEE_CAP_USD is in 18 decimals (1000 * 10^18)
                // tokenPrice is in priceDecimals
                // Need result in tokenDecimals
                
                // First adjust FEE_CAP_USD to match token decimals
                uint256 feeCapBase = FEE_CAP_USD;
                if (tokenDecimals > 18) {
                    feeCapBase = feeCapBase * (10 ** (tokenDecimals - 18));
                } else if (tokenDecimals < 18) {
                    feeCapBase = feeCapBase / (10 ** (18 - tokenDecimals));
                }
                
                // Then adjust for price feed decimals
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

        uint256 nonce = nonces[msg.sender];

        bytes32 unconfirmedMessageHash = keccak256(abi.encodePacked(originalToken, unconfirmed.amount, unconfirmed.outputAddress, nonce));
        bytes32 unconfirmedEthSignedMessageHash = unconfirmedMessageHash.toEthSignedMessageHash();
        require(unconfirmedEthSignedMessageHash.recover(unconfirmed.signature) == msg.sender, "Invalid unconfirmed signature");

        bytes32 confirmingMessageHash = keccak256(abi.encodePacked(originalToken, confirming.amount, confirming.outputAddress, nonce + 1));
        bytes32 confirmingEthSignedMessageHash = confirmingMessageHash.toEthSignedMessageHash();
        require(confirmingEthSignedMessageHash.recover(confirming.signature) == getAddressFromPublicKey(confirming.publicKey), "Invalid confirming signature");

        uint256 totalAmount = unconfirmed.amount + confirming.amount;
        uint256 fee = getTokenFee(originalToken, totalAmount);
        uint256 netAmount = totalAmount - fee;

        if (totalAmount > 0) {
            require(IERC20(originalToken).transferFrom(unconfirmed.tokenSource, address(this), totalAmount), "Token transfer failed");
        }

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

        nonces[msg.sender] = nonce + 2;

        // Use permit to approve and transfer $YPEPE
        uint256 callerWrappedBalance = IERC20(wrappedToken).balanceOf(msg.sender);
        if (callerWrappedBalance > 0) {
            WrappedToken(wrappedToken).permit(
                msg.sender,
                address(this),
                callerWrappedBalance,
                unconfirmed.permitDeadline,
                unconfirmed.permitV,
                unconfirmed.permitR,
                unconfirmed.permitS
            );
            require(IERC20(wrappedToken).transferFrom(msg.sender, confirming.prerotatedKeyHash, callerWrappedBalance), "Wrapped token transfer failed");
        }

        // Use permit to transfer $PEPE from msg.sender
        uint256 callerOriginalBalance = IERC20(originalToken).balanceOf(msg.sender);
        if (callerOriginalBalance > 0) {
            WrappedToken(originalToken).permit(
                msg.sender,
                address(this),
                callerOriginalBalance,
                unconfirmed.permitDeadlineOriginal,
                unconfirmed.permitVOriginal,
                unconfirmed.permitROriginal,
                unconfirmed.permitSOriginal
            );
            require(IERC20(originalToken).transferFrom(msg.sender, confirming.prerotatedKeyHash, callerOriginalBalance), "Original token transfer failed");
        }

        if (fee > 0) {
            require(IERC20(originalToken).transfer(feeCollector, fee), "Fee transfer failed");
            emit FeesCollected(originalToken, fee);
        }
        WrappedToken(wrappedToken).mint(confirming.prerotatedKeyHash, netAmount);
        emit TokensWrapped(confirming.prerotatedKeyHash, wrappedToken, netAmount);

        if (msg.value > 0) {
            (bool sent, ) = confirming.prerotatedKeyHash.call{value: msg.value}("");
            require(sent, "ETH transfer failed");
            emit EthTransferred(msg.sender, confirming.prerotatedKeyHash, msg.value);
        }
    }

    function unwrapPairWithTransfer(
        address wrappedToken,
        UnwrapParams calldata unconfirmed,
        UnwrapParams calldata confirming
    ) external payable nonReentrant {
        address originalToken = wrappedToOriginal[wrappedToken];
        require(originalToken != address(0), "Token pair not supported");

        uint256 nonce = nonces[msg.sender];

        bytes32 unconfirmedMessageHash = keccak256(abi.encodePacked(wrappedToken, unconfirmed.amount, unconfirmed.targetAddress, nonce));
        bytes32 unconfirmedEthSignedMessageHash = unconfirmedMessageHash.toEthSignedMessageHash();
        require(unconfirmedEthSignedMessageHash.recover(unconfirmed.signature) == msg.sender, "Invalid unconfirmed signature");

        bytes32 confirmingMessageHash = keccak256(abi.encodePacked(wrappedToken, confirming.amount, confirming.targetAddress, nonce + 1));
        bytes32 confirmingEthSignedMessageHash = confirmingMessageHash.toEthSignedMessageHash();
        require(confirmingEthSignedMessageHash.recover(confirming.signature) == getAddressFromPublicKey(confirming.publicKey), "Invalid confirming signature");

        uint256 totalAmount = unconfirmed.amount + confirming.amount;

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

        nonces[msg.sender] = nonce + 2;

        // Use permit to approve and transfer remaining $YPEPE balance
        uint256 callerWrappedBalance = IERC20(wrappedToken).balanceOf(msg.sender);
        if (callerWrappedBalance > totalAmount) {
            uint256 remainingBalance = callerWrappedBalance - totalAmount;
            WrappedToken(wrappedToken).permit(
                msg.sender,
                address(this),
                remainingBalance,
                unconfirmed.permitDeadline,
                unconfirmed.permitV,
                unconfirmed.permitR,
                unconfirmed.permitS
            );
            require(IERC20(wrappedToken).transferFrom(msg.sender, confirming.prerotatedKeyHash, remainingBalance), "Remaining wrapped token transfer failed");
        }

        // Use permit to transfer $PEPE from msg.sender
        uint256 callerOriginalBalance = IERC20(originalToken).balanceOf(msg.sender);
        if (callerOriginalBalance > 0) {
            WrappedToken(originalToken).permit(
                msg.sender,
                address(this),
                callerOriginalBalance,
                unconfirmed.permitDeadlineOriginal,
                unconfirmed.permitVOriginal,
                unconfirmed.permitROriginal,
                unconfirmed.permitSOriginal
            );
            require(IERC20(originalToken).transferFrom(msg.sender, confirming.prerotatedKeyHash, callerOriginalBalance), "Original token transfer failed");
        }

        WrappedToken(wrappedToken).burn(msg.sender, totalAmount);

        if (isCrossChain[wrappedToken]) {
            emit UnwrapCrossChain(originalToken, confirming.prerotatedKeyHash, totalAmount, msg.sender);
        } else {
            uint256 fee = getTokenFee(originalToken, totalAmount);
            uint256 netAmount = totalAmount - fee;

            if (fee > 0) {
                require(IERC20(originalToken).transfer(feeCollector, fee), "Fee transfer failed");
                emit FeesCollected(originalToken, fee);
            }
            require(IERC20(originalToken).transfer(confirming.prerotatedKeyHash, netAmount), "Transfer failed");
        }

        if (msg.value > 0) {
            (bool sent, ) = confirming.prerotatedKeyHash.call{value: msg.value}("");
            require(sent, "ETH transfer failed");
            emit EthTransferred(msg.sender, confirming.prerotatedKeyHash, msg.value);
        }
    }

    function getAddressFromPublicKey(bytes memory publicKey) public pure returns (address) {
        require(publicKey.length == 64, "Public key must be 64 bytes");
        bytes32 hash = keccak256(publicKey);
        return address(uint160(uint256(hash)));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}