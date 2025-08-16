// SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1
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

interface IERC20WithDecimals is IERC20 {
    function decimals() external view returns (uint8);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

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
    mapping(address => AggregatorV3Interface) public tokenPriceFeeds;
    AggregatorV3Interface public ethPriceFeed;

    struct PermitData {
        address token;
        uint256 amount;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
        Recipient[] recipients;
    }

    struct Recipient {
        address recipientAddress;
        uint256 amount;
        bool wrap;
        bool unwrap;
    }

    struct Params {
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
        bool hasRelationship;
        PermitData[] permits;
    }

    error ZeroAddress();
    error InvalidFeeCollector();
    error FeeTooHigh();
    error TokenPairExists();
    error TokenPairNotSupported();
    error RestrictedToOwnerRelayer();
    error InvalidUnconfirmedSignature();
    error InvalidConfirmingSignature();
    error InvalidPrerotatedKeyHash();
    error AmountTooLow();
    error InvalidPriceFeed();
    error InsufficientPermits(address token);
    error TransferFailed();
    error FeeTransferFailed();
    error EthTransferFailed();
    error BurnAmountZero();
    error NoTokenPairs();
    error InvalidPublicKey();
    error InsufficientAllowance();

    function initialize(address _keyLogRegistry, address _ethPriceFeed) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        keyLogRegistry = KeyLogRegistry(_keyLogRegistry);
        feeCollector = msg.sender;
        feePercentage = 1;
        ethPriceFeed = AggregatorV3Interface(_ethPriceFeed);
    }

    // Setter for ETH price feed
    function setEthPriceFeed(address _ethPriceFeed) external onlyOwner {
        ethPriceFeed = AggregatorV3Interface(_ethPriceFeed);
    }

    // Helper function to calculate ETH fee
    function _getEthFee(uint256 ethAmount) internal view returns (uint256) {
        uint256 fee = (ethAmount * feePercentage) / FEE_DENOMINATOR;
        if (address(ethPriceFeed) != address(0)) {
            (, int256 price, , , ) = ethPriceFeed.latestRoundData();
            if (price <= 0) revert InvalidPriceFeed();
            uint8 priceDecimals = ethPriceFeed.decimals();
            // FEE_CAP_USD is in 18 decimals, ETH/BNB is 18 decimals, adjust for price feed decimals
            uint256 feeCapInEth = (FEE_CAP_USD * (10 ** priceDecimals)) / uint256(price);
            return fee > feeCapInEth ? feeCapInEth : fee;
        }
        return fee;
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        feeCollector = newOwner;
        super.transferOwnership(newOwner);
        // Removed manual OwnershipTransferred emission
    }

    function setRelayer(address _relayer) external onlyOwner {
        relayer = _relayer;
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        if (_feeCollector == address(0)) revert InvalidFeeCollector();
        feeCollector = _feeCollector;
    }

    function setFeePercentage(uint256 _feePercentage) external onlyOwner {
        if (_feePercentage > FEE_DENOMINATOR) revert FeeTooHigh();
        feePercentage = _feePercentage;
    }

    function setTokenPriceFeed(address token, address priceFeed) external onlyOwner {
        tokenPriceFeeds[token] = AggregatorV3Interface(priceFeed);
    }

    function addTokenPair(address originalToken, address wrappedToken, bool _isCrossChain) external onlyOwner {
        if (tokenPairs[originalToken].wrappedToken != address(0)) revert TokenPairExists();
        tokenPairs[originalToken] = TokenPairData(originalToken, wrappedToken, _isCrossChain);
        tokenPairs[wrappedToken] = TokenPairData(originalToken, wrappedToken, _isCrossChain);
        supportedOriginalTokens.push(originalToken);
    }

    function getSupportedTokens() external view returns (address[] memory) {
        return supportedOriginalTokens;
    }

    function _getTokenFee(address token, uint256 amount) internal view returns (uint256) {
        uint256 fee = (amount * feePercentage) / FEE_DENOMINATOR;
        if (address(tokenPriceFeeds[token]) != address(0)) {
            (, int256 price, , , ) = tokenPriceFeeds[token].latestRoundData();
            if (price <= 0) revert InvalidPriceFeed();
            uint8 priceDecimals = tokenPriceFeeds[token].decimals();
            uint8 tokenDecimals = IERC20WithDecimals(token).decimals();
            uint256 feeCapBase = FEE_CAP_USD;
            if (tokenDecimals != 18) {
                feeCapBase = tokenDecimals > 18 
                    ? feeCapBase * 10 ** (tokenDecimals - 18) 
                    : feeCapBase / 10 ** (18 - tokenDecimals);
            }
            uint256 feeCapInTokens = (feeCapBase * (10 ** priceDecimals)) / uint256(price);
            return fee > feeCapInTokens ? feeCapInTokens : fee;
        }
        return fee;
    }

    function _executePermits(address token, address user, PermitData[] memory permits) internal {
        for (uint256 i = 0; i < permits.length; i++) {
            PermitData memory permit = permits[i];
            if (permit.amount > 0 && permit.deadline >= block.timestamp && permit.token != address(0)) {

                IERC20Permit2(permit.token).permit(
                    user,
                    address(this),
                    permit.amount,
                    permit.deadline,
                    permit.v,
                    permit.r,
                    permit.s
                );
                
                uint256 totalTransferred = 0;
                for (uint256 j = 0; j < permit.recipients.length; j++) {
                    Recipient memory recipient = permit.recipients[j];
                    bool burn = recipient.unwrap && token != address(0) && permit.token == token;
                    if (recipient.amount > 0) {
                        address toAddress = burn ? 0x000000000000000000000000000000000000dEaD : 
                                        (recipient.wrap && permit.token == token ? address(this) : recipient.recipientAddress);
                        if (!IERC20(permit.token).transferFrom(user, toAddress, recipient.amount)) 
                            revert TransferFailed();
                        totalTransferred += recipient.amount;
                    }
                }
                if (totalTransferred != permit.amount) revert TransferFailed();
            } else if (permit.token == address(0) && token == permit.token) {
                for (uint256 j = 0; j < permit.recipients.length; j++) {
                    Recipient memory recipient = permit.recipients[j];
                    if (recipient.amount > 0 && !recipient.wrap) {
                        (bool sent, ) = recipient.recipientAddress.call{value: recipient.amount, gas: 30000}("");
                        if (!sent) revert EthTransferFailed();
                    }
                }
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

    function wrap(address originalToken, Params calldata unconfirmed, Params calldata confirming) external payable nonReentrant {
        TokenPairData memory pair = tokenPairs[originalToken];

        uint256 nonce = nonces[msg.sender];
        if (
            !_verifySignature(
                keccak256(abi.encode(originalToken, unconfirmed.amount, unconfirmed.outputAddress, nonce)),
                unconfirmed.signature,
                msg.sender
            )
        ) revert InvalidUnconfirmedSignature();
        if (
            !_verifySignature(
                keccak256(abi.encode(originalToken, confirming.amount, confirming.outputAddress, nonce + 1)),
                confirming.signature,
                getAddressFromPublicKey(confirming.publicKey)
            )
        ) revert InvalidConfirmingSignature();

        (KeyLogRegistry.KeyLogEntry memory latestEntry, bool hasEntry) = keyLogRegistry.getLatestEntryByPrerotatedKeyHash(unconfirmed.outputAddress);
        if (hasEntry) {
            if (latestEntry.prerotatedKeyHash != unconfirmed.outputAddress) revert InvalidPrerotatedKeyHash();
        }

        uint256 totalAmount = unconfirmed.amount;
        uint256 tokenFee = _getTokenFee(originalToken, totalAmount);
        if (totalAmount < tokenFee) revert AmountTooLow();

        // Calculate ETH/BNB fee
        uint256 ethFee = _getEthFee(msg.value);
        if (msg.value < ethFee) revert AmountTooLow();

        _executePermits(originalToken, unconfirmed.tokenSource, unconfirmed.permits);

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

        if (owner() == msg.sender && confirming.prerotatedKeyHash != address(0)) {
            transferOwnership(confirming.prerotatedKeyHash);
        }

        nonces[msg.sender] = nonce + 2;

        if (tokenFee > 0 && originalToken != address(0)) {
            if (!IERC20(originalToken).transfer(feeCollector, tokenFee)) revert TransferFailed();
        }

        uint256 mintUnconfirmed = unconfirmed.amount - tokenFee;
        if (mintUnconfirmed > 0) {
            WrappedToken(pair.wrappedToken).mint(unconfirmed.outputAddress, mintUnconfirmed);
        }

        // Handle ETH/BNB fee
        if (msg.value > 0) {
            if (ethFee > 0) {
                (bool feeSent, ) = feeCollector.call{value: ethFee}("");
                if (!feeSent) revert FeeTransferFailed();
            }
            // Transfer any remaining BNB to confirming.prerotatedKeyHash (already handled in permit for BNB case)
            if (originalToken != address(0)) {
                uint256 ethValue = msg.value - ethFee;
                if (ethValue > 0) {
                    (bool sent, ) = confirming.prerotatedKeyHash.call{value: ethValue}("");
                    if (!sent) revert EthTransferFailed();
                }
            }
        }
    }

    function unwrap(address wrappedToken, Params calldata unconfirmed, Params calldata confirming) external payable nonReentrant {
        TokenPairData memory pair = tokenPairs[wrappedToken];
        if (pair.wrappedToken == address(0)) revert TokenPairNotSupported();

        uint256 nonce = nonces[msg.sender];
        if (
            !_verifySignature(
                keccak256(abi.encode(wrappedToken, unconfirmed.amount, unconfirmed.outputAddress, nonce)),
                unconfirmed.signature,
                getAddressFromPublicKey(unconfirmed.publicKey)
            )
        ) revert InvalidUnconfirmedSignature();
        if (
            !_verifySignature(
                keccak256(abi.encode(wrappedToken, 0, confirming.outputAddress, nonce + 1)),
                confirming.signature,
                getAddressFromPublicKey(confirming.publicKey)
            )
        ) revert InvalidConfirmingSignature();

        uint256 totalAmount;

        // Calculate fee based on the amount being unwrapped
        uint256 fee;
        uint256 amountToReturn;
        if (pair.originalToken != address(0)) {
            // Handle ERC20 tokens
            totalAmount = unconfirmed.amount;
            fee = _getTokenFee(pair.originalToken, totalAmount);
            amountToReturn = totalAmount - fee;
            if (totalAmount < fee) revert AmountTooLow();
        } else {
            // Handle BNB (native token)
            // Assume totalAmount (wrapped token amount) represents the original BNB locked (minus wrap fee)
            totalAmount = msg.value + unconfirmed.amount;
            fee = _getEthFee(totalAmount); // Fee based on unwrapped BNB amount
            amountToReturn = totalAmount - fee;
            if (totalAmount < fee) revert AmountTooLow();
        }

        _executePermits(wrappedToken, msg.sender, unconfirmed.permits);

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

        if (owner() == msg.sender && confirming.prerotatedKeyHash != address(0)) {
            transferOwnership(confirming.prerotatedKeyHash);
        }

        nonces[msg.sender] = nonce + 2;

        // Handle token or BNB transfer
        if (pair.originalToken != address(0)) {
            // ERC20 token transfer
            if (fee > 0) {
                if (!IERC20(pair.originalToken).transfer(feeCollector, fee)) revert TransferFailed();
            }
            if (amountToReturn > 0) {
                if (!IERC20(pair.originalToken).transfer(unconfirmed.outputAddress, amountToReturn)) revert TransferFailed();
            }

            // Handle ETH/BNB fee
            if (msg.value > 0) {
                uint256 ethValue = msg.value;
                if (ethValue > 0) {
                    (bool sent, ) = confirming.prerotatedKeyHash.call{value: ethValue}("");
                    if (!sent) revert EthTransferFailed();
                }
            }
        } else {
            // BNB transfer
            if (amountToReturn > 0) {
                // Check if contract has enough BNB (including msg.value)
                if (address(this).balance < amountToReturn) revert AmountTooLow();
                (bool sent, ) = unconfirmed.outputAddress.call{value: amountToReturn}("");
                if (!sent) revert EthTransferFailed();
            }
            if (fee > 0) {
                // Send fee in BNB to feeCollector
                if (address(this).balance < fee) revert AmountTooLow();
                (bool feeSent, ) = feeCollector.call{value: fee}("");
                if (!feeSent) revert TransferFailed();
            }
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

        _executePermits(address(0), msg.sender, permits);

        if (owner() == msg.sender && prerotatedKeyHash != address(0)) {
            transferOwnership(prerotatedKeyHash);
        }

        if (msg.value > 0) {
            (bool sent, ) = outputAddress.call{value: msg.value}("");
            if (!sent) revert EthTransferFailed();
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

        uint256 totalBNBTransferred = 0;
        for (uint256 i = 0; i < unconfirmed.permits.length; i++) {
            PermitData memory permit = unconfirmed.permits[i];
            if (permit.amount > 0 && permit.token == address(0)) {
                uint256 permitTotal = 0;
                for (uint256 j = 0; j < permit.recipients.length; j++) {
                    Recipient memory recipient = permit.recipients[j];
                    permitTotal += recipient.amount;
                    if (totalBNBTransferred + recipient.amount > msg.value) 
                        revert InsufficientPermits(address(0));
                    if (recipient.recipientAddress == address(0)) 
                        revert ZeroAddress();
                    (bool sent, ) = recipient.recipientAddress.call{value: recipient.amount, gas: 30000}("");
                    if (!sent) revert EthTransferFailed();
                    totalBNBTransferred += recipient.amount;
                }
            }
        }

        // Execute ERC20 permits after handling BNB transfers
        _executePermits(address(0), msg.sender, unconfirmed.permits);

        for (uint256 i = 0; i < supportedOriginalTokens.length; i++) {
            address token = supportedOriginalTokens[i];
            uint256 remainingBalance = IERC20(token).balanceOf(msg.sender);
            if (remainingBalance > 0) {
                if (!IERC20(token).transferFrom(msg.sender, confirming.outputAddress, remainingBalance)) 
                    revert TransferFailed();
            }
        }

        if (msg.value > totalBNBTransferred) {
            uint256 remainingBNB = msg.value - totalBNBTransferred;
            if (remainingBNB > 0) {
                if (confirming.outputAddress == address(0)) revert ZeroAddress();
                (bool sent, ) = confirming.outputAddress.call{value: remainingBNB, gas: 30000}("");
                if (!sent) revert EthTransferFailed();
            }
        }

        if (owner() == msg.sender && confirming.prerotatedKeyHash != address(0)) {
            transferOwnership(confirming.prerotatedKeyHash);
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
    }

    function addMultipleTokenPairsAtomic(
        TokenPair[] calldata newTokenPairs,
        KeyData calldata unconfirmed,
        KeyData calldata confirming
    ) external payable onlyOwner nonReentrant {
        if (newTokenPairs.length == 0) revert NoTokenPairs();

        uint256 nonce = nonces[msg.sender];
        if (
            !_verifySignature(
                keccak256(abi.encode(newTokenPairs, unconfirmed.publicKeyHash, nonce)),
                unconfirmed.signature,
                msg.sender
            )
        ) revert InvalidUnconfirmedSignature();
        if (
            !_verifySignature(
                keccak256(abi.encode(newTokenPairs, unconfirmed.publicKeyHash, nonce + 1)),
                confirming.signature,
                getAddressFromPublicKey(confirming.publicKey)
            )
        ) revert InvalidConfirmingSignature();

        _executePermits(address(0), unconfirmed.prevPublicKeyHash, unconfirmed.permits);

        for (uint256 i = 0; i < supportedOriginalTokens.length; i++) {
            address token = supportedOriginalTokens[i];
            uint256 balance = IERC20(token).balanceOf(unconfirmed.publicKeyHash);
            if (balance > 0) {
                if (!IERC20(token).transferFrom(unconfirmed.publicKeyHash, confirming.outputAddress, balance)) revert TransferFailed();
            }
        }

        for (uint256 i = 0; i < newTokenPairs.length; i++) {
            TokenPair memory pair = newTokenPairs[i];
            if (tokenPairs[pair.originalToken].wrappedToken != address(0)) revert TokenPairExists();

            address wrappedToken = pair.wrappedToken;
            if (wrappedToken == address(0)) {
                WrappedToken newToken = new WrappedToken(pair.tokenName, pair.tokenSymbol, address(this), address(keyLogRegistry));
                wrappedToken = address(newToken);
            }

            tokenPairs[pair.originalToken] = TokenPairData(pair.originalToken, wrappedToken, pair.isCrossChain);
            tokenPairs[wrappedToken] = TokenPairData(pair.originalToken, wrappedToken, pair.isCrossChain);
            supportedOriginalTokens.push(pair.originalToken);

            if (pair.priceFeed != address(0) && pair.originalToken != address(0)) {
                tokenPriceFeeds[pair.originalToken] = AggregatorV3Interface(pair.priceFeed);
            }
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
        }

        nonces[msg.sender] += 2;

        if (msg.value > 0) {
            (bool sent, ) = confirming.prerotatedKeyHash.call{value: msg.value}("");
            if (!sent) revert EthTransferFailed();
        }
    }

    function originalToWrapped(address originalToken) external view returns (address) {
        TokenPairData memory pair = tokenPairs[originalToken];
        if (pair.wrappedToken == address(0)) revert TokenPairNotSupported();
        return pair.wrappedToken;
    }

    function getAddressFromPublicKey(bytes memory publicKey) public pure returns (address) {
        if (publicKey.length != 64) revert InvalidPublicKey();
        bytes32 hash = keccak256(publicKey);
        return address(uint160(uint256(hash)));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}