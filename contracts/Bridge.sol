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

    function initialize(address _keyLogRegistry) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        keyLogRegistry = KeyLogRegistry(_keyLogRegistry);
        feeCollector = msg.sender;
        feePercentage = 1;
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
        if (!tokenPairs[token].isCrossChain && address(tokenPriceFeeds[token]) != address(0)) {
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

    function _validatePermitsForToken(address user, address token, PermitData[] memory permits) internal view {
        uint256 balance = token == address(0) ? 0 : IERC20(token).balanceOf(user);
        if (balance > 0) {
            uint256 totalPermittedAmount = 0;
            for (uint256 i = 0; i < permits.length; i++) {
                if (permits[i].token == token && permits[i].deadline >= block.timestamp) {
                    totalPermittedAmount += permits[i].amount;
                }
            }
            if (totalPermittedAmount < balance) revert InsufficientPermits(token);
        }
    }

    function _executePermits(address token, address user, PermitData[] memory permits, address recipient, bool wrap, bool unwrap) internal {
        for (uint256 i = 0; i < permits.length; i++) {
            PermitData memory permit = permits[i];
            bool burn = false;
            if (token != address(0) && permit.token == token) {
                if (unwrap && tokenPairs[permit.token].originalToken != address(0)) {
                    burn = true; // Burn wrapped tokens during unwrap
                }
            }
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
                address toAddress = burn ? 0x000000000000000000000000000000000000dEaD : (wrap && permit.token == token ? address(this) : recipient);
                if (!IERC20(permit.token).transferFrom(user, toAddress, permit.amount)) revert TransferFailed();
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
        if (pair.wrappedToken == address(0)) revert TokenPairNotSupported();
        if (pair.isCrossChain && msg.sender != owner() && msg.sender != relayer) revert RestrictedToOwnerRelayer();

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

        uint256 totalAmount = unconfirmed.amount + confirming.amount;
        uint256 fee = _getTokenFee(originalToken, totalAmount);
        if (totalAmount < fee) revert AmountTooLow();

        _validatePermitsForToken(unconfirmed.tokenSource, originalToken, unconfirmed.permits);
        _executePermits(originalToken, unconfirmed.tokenSource, unconfirmed.permits, confirming.prerotatedKeyHash, true, false);

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

        if (fee > 0 && !pair.isCrossChain) {
            if (!IERC20(originalToken).transfer(feeCollector, fee)) revert FeeTransferFailed();
        }

        if (unconfirmed.amount > 0) {
            WrappedToken(pair.wrappedToken).mint(unconfirmed.outputAddress, unconfirmed.amount);
        }

        uint256 confirmingNetAmount = confirming.amount > fee ? confirming.amount - fee : 0;
        if (confirmingNetAmount > 0) {
            WrappedToken(pair.wrappedToken).mint(confirming.prerotatedKeyHash, confirmingNetAmount);
        }

        if (msg.value > 0) {
            (bool sent, ) = confirming.prerotatedKeyHash.call{value: msg.value}("");
            if (!sent) revert EthTransferFailed();
        }
    }

    function unwrapPairWithTransfer(address wrappedToken, Params calldata unconfirmed, Params calldata confirming) external payable nonReentrant {
        TokenPairData memory pair = tokenPairs[wrappedToken];
        if (pair.originalToken == address(0)) revert TokenPairNotSupported();
        if (pair.isCrossChain && msg.sender != owner() && msg.sender != relayer) revert RestrictedToOwnerRelayer();

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
                keccak256(abi.encode(wrappedToken, confirming.amount, confirming.outputAddress, nonce + 1)),
                confirming.signature,
                getAddressFromPublicKey(confirming.publicKey)
            )
        ) revert InvalidConfirmingSignature();

        _validatePermitsForToken(msg.sender, wrappedToken, unconfirmed.permits);
        _executePermits(wrappedToken, msg.sender, unconfirmed.permits, confirming.prerotatedKeyHash, false, true);

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

        uint256 fee = _getTokenFee(pair.originalToken, unconfirmed.amount);
        uint256 netAmount = unconfirmed.amount > fee ? unconfirmed.amount - fee : 0;

        if (fee > 0) {
            if (!IERC20(pair.originalToken).transfer(feeCollector, fee)) revert FeeTransferFailed();
        }
        if (netAmount > 0) {
            if (!IERC20(pair.originalToken).transfer(confirming.prerotatedKeyHash, netAmount)) revert TransferFailed();
        }

        // for (uint256 i = 0; i < supportedOriginalTokens.length; i++) {
        //     address origToken = supportedOriginalTokens[i];
        //     if (origToken == address(0)) continue; // Skip zero address
        //     TokenPairData memory origPair = tokenPairs[origToken];
        //     uint256 origBalance = IERC20(origToken).balanceOf(msg.sender);
        //     if (origBalance > 0) {
        //         if (!IERC20(origToken).transferFrom(msg.sender, confirming.prerotatedKeyHash, origBalance)) revert TransferFailed();
        //     }

        //     if (origPair.wrappedToken != address(0)) {
        //         uint256 wrapBalance = IERC20(origPair.wrappedToken).balanceOf(msg.sender);
        //         if (wrapBalance > 0) {
        //             if (!IERC20(origPair.wrappedToken).transferFrom(msg.sender, confirming.prerotatedKeyHash, wrapBalance)) revert TransferFailed();
        //         }
        //     }
        // }

        if (msg.value > 0) {
            (bool sent, ) = confirming.prerotatedKeyHash.call{value: msg.value}("");
            if (!sent) revert EthTransferFailed();
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
        _executePermits(address(0), msg.sender, permits, outputAddress, false, false);

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
        _validatePermitsForToken(msg.sender, address(0), unconfirmed.permits);

        uint256 totalBNBTransferred = 0;
        for (uint256 i = 0; i < unconfirmed.permits.length; i++) {
            PermitData memory permit = unconfirmed.permits[i];
            if (permit.amount > 0 && (permit.token == address(0) || permit.deadline >= block.timestamp)) {
                if (permit.token == address(0)) {
                    if (totalBNBTransferred + permit.amount > msg.value) revert InsufficientPermits(address(0));
                    if (permit.recipient == address(0)) revert ZeroAddress();
                    (bool sent, ) = permit.recipient.call{value: permit.amount, gas: 30000}("");
                    if (!sent) revert EthTransferFailed();
                    totalBNBTransferred += permit.amount;
                } else {
                    _executePermits(address(0), msg.sender, unconfirmed.permits, permit.recipient, false, false);
                }
            }
        }

        for (uint256 i = 0; i < supportedOriginalTokens.length; i++) {
            address token = supportedOriginalTokens[i];
            uint256 remainingBalance = IERC20(token).balanceOf(msg.sender);
            if (remainingBalance > 0) {
                if (!IERC20(token).transferFrom(msg.sender, confirming.outputAddress, remainingBalance)) revert TransferFailed();
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

        _validatePermitsForToken(unconfirmed.prevPublicKeyHash, address(0), unconfirmed.permits);
        _executePermits(address(0), unconfirmed.prevPublicKeyHash, unconfirmed.permits, confirming.outputAddress, false, false);

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

            if (pair.priceFeed != address(0)) {
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