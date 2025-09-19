// SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "./WrappedToken.sol";
import "./KeyLogRegistry.sol";
import "./MockERC20.sol";

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

contract Bridge2 is Initializable, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    KeyLogRegistry public keyLogRegistry;
    address public relayer;
    address public feeCollector;
    address public feeSigner;

    struct TokenPairData {
        address originalToken;
        address wrappedToken;
    }

    mapping(address => TokenPairData) public tokenPairs;
    mapping(address => uint256) public nonces;
    address[] public supportedOriginalTokens;

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
        bool mint;
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
        address wrappedToken;
    }

    struct FeeInfo {
        address token;
        uint256 fee;
        uint256 expires;
        bytes signature;
    }

    error ZeroAddress();
    error InvalidFeeCollector();
    error TokenPairExists();
    error TokenPairNotSupported();
    error RestrictedToOwnerRelayer();
    error InvalidUnconfirmedSignature();
    error InvalidConfirmingSignature();
    error InvalidPrerotatedKeyHash();
    error AmountTooLow();
    error InsufficientPermits(address token);
    error TransferFailed();
    error FeeTransferFailed();
    error EthTransferFailed();
    error BurnAmountZero();
    error NoTokenPairs();
    error InvalidPublicKey();
    error InsufficientAllowance();
    error InvalidFeeRate();
    error InvalidRecipientAmount();
    error PermitDeadlineExpired();

    function initialize(address _keyLogRegistry) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        if (_keyLogRegistry == address(0)) revert ZeroAddress();
        keyLogRegistry = KeyLogRegistry(_keyLogRegistry);
        feeCollector = msg.sender;
    }

    function setFeeSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddress();
        feeSigner = _signer;
    }

    function _verifyFee(
        FeeInfo calldata feeInfo
    ) internal view returns (uint256) {
        if (feeInfo.expires < block.timestamp) revert PermitDeadlineExpired();
        if (feeInfo.fee > 1e18) revert InvalidFeeRate(); // Cap fee at 100%

        bytes32 messageHash = keccak256(
            abi.encode(feeInfo.token, feeInfo.fee, feeInfo.expires)
        ).toEthSignedMessageHash();

        address signer = messageHash.recover(feeInfo.signature);
        if (signer != feeSigner) revert InvalidConfirmingSignature();

        return feeInfo.fee;
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (feeCollector != owner()) revert RestrictedToOwnerRelayer();
        
        feeCollector = newOwner;
        super.transferOwnership(newOwner);
    }

    function setRelayer(address _relayer) external onlyOwner {
        if (_relayer == address(0)) revert ZeroAddress();
        relayer = _relayer;
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        if (_feeCollector == address(0)) revert InvalidFeeCollector();
        feeCollector = _feeCollector;
    }

    function addTokenPair(address originalToken, address wrappedToken) external onlyOwner {
        if (originalToken == address(0) || wrappedToken == address(0)) revert ZeroAddress();
        if (tokenPairs[originalToken].wrappedToken != address(0)) revert TokenPairExists();
        tokenPairs[originalToken] = TokenPairData(originalToken, wrappedToken);
        tokenPairs[wrappedToken] = TokenPairData(originalToken, wrappedToken);
        supportedOriginalTokens.push(originalToken);
    }

    function getSupportedTokens() external view returns (address[] memory) {
        return supportedOriginalTokens;
    }

    function _executePermits(address token, address user, PermitData[] memory permits) internal {
        for (uint256 i = 0; i < permits.length; i++) {
            PermitData memory permit = permits[i];
            if (permit.amount > 0 && permit.deadline >= block.timestamp && permit.token != address(0)) {
                if (permit.deadline < block.timestamp) revert PermitDeadlineExpired();

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
                    if (recipient.amount > 0 && recipient.recipientAddress != address(0)) {
                        if (recipient.amount > permit.amount) revert InvalidRecipientAmount();
                        
                        if (recipient.unwrap && permit.token == token) {
                            WrappedToken(permit.token).burn(recipient.recipientAddress, recipient.amount);
                        } else if (recipient.mint && permit.token == token) {
                            WrappedToken(permit.token).mint(recipient.recipientAddress, recipient.amount);
                        } else if (recipient.wrap && permit.token == token) {
                            IERC20(permit.token).safeTransferFrom(user, address(this), recipient.amount);
                        } else {
                            IERC20(permit.token).safeTransferFrom(user, recipient.recipientAddress, recipient.amount);
                        }
                        totalTransferred += recipient.amount;
                    }
                }
                if (totalTransferred != permit.amount) revert TransferFailed();
            } else if (permit.token == address(0)) {
                uint256 totalEth = 0;
                for (uint256 j = 0; j < permit.recipients.length; j++) {
                    Recipient memory recipient = permit.recipients[j];
                    if (recipient.amount > 0 && !recipient.wrap && recipient.recipientAddress != address(0)) {
                        if (recipient.amount > permit.amount) revert InvalidRecipientAmount();
                        totalEth += recipient.amount;
                    }
                }
                if (totalEth > msg.value) revert AmountTooLow();
                
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
        if (unconfirmedPublicKey.length != 64 || confirmingPublicKey.length != 64) revert InvalidPublicKey();
        
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

    function wrap(address originalToken, FeeInfo calldata feeInfo, Params calldata unconfirmed, Params calldata confirming) external payable nonReentrant {
        TokenPairData memory pair = tokenPairs[originalToken];
        if (pair.wrappedToken == address(0)) revert TokenPairNotSupported();

        uint256 nonce = nonces[msg.sender];
        bytes32 unconfirmedHash = keccak256(abi.encode(originalToken, unconfirmed.amount, unconfirmed.outputAddress, nonce));
        bytes32 confirmingHash = keccak256(abi.encode(originalToken, confirming.amount, confirming.outputAddress, nonce + 1));
        
        if (
            !_verifySignature(unconfirmedHash, unconfirmed.signature, msg.sender)
        ) revert InvalidUnconfirmedSignature();
        if (
            !_verifySignature(confirmingHash, confirming.signature, getAddressFromPublicKey(confirming.publicKey))
        ) revert InvalidConfirmingSignature();

        (KeyLogRegistry.KeyLogEntry memory latestEntry, bool hasEntry) = keyLogRegistry.getLatestEntryByPrerotatedKeyHash(unconfirmed.outputAddress);
        if (hasEntry && latestEntry.prerotatedKeyHash != unconfirmed.outputAddress) revert InvalidPrerotatedKeyHash();

        if (unconfirmed.amount == 0) revert AmountTooLow();

        uint256 totalAmount = unconfirmed.amount;
        uint256 feeRate = _verifyFee(feeInfo);

        uint256 tokenFee = (totalAmount * feeRate) / 1e18;
        if (totalAmount < tokenFee) revert AmountTooLow();

        uint256 ethFee = (msg.value * feeRate) / 1e18;
        if (msg.value < ethFee) revert AmountTooLow();

        _finalize(originalToken, unconfirmed, confirming, false);

        if (tokenFee > 0 && originalToken != address(0)) {
            IERC20(originalToken).safeTransfer(feeCollector, tokenFee);
        }

        uint256 mintUnconfirmed = unconfirmed.amount - tokenFee;
        if (mintUnconfirmed > 0) {
            WrappedToken(pair.wrappedToken).mint(unconfirmed.outputAddress, mintUnconfirmed);
        }

        // Handle ETH/BNB fee
        if (msg.value > 0) {
            if (ethFee > 0) {
                (bool feeSent, ) = feeCollector.call{value: ethFee, gas: 30000}("");
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

    function unwrap(address wrappedToken, FeeInfo calldata feeInfo, Params calldata unconfirmed, Params calldata confirming) external payable nonReentrant {
        TokenPairData memory pair = tokenPairs[wrappedToken];
        if (pair.wrappedToken == address(0)) revert TokenPairNotSupported();

        uint256 nonce = nonces[msg.sender];
        bytes32 unconfirmedHash = keccak256(abi.encode(wrappedToken, unconfirmed.amount, unconfirmed.outputAddress, nonce));
        bytes32 confirmingHash = keccak256(abi.encode(wrappedToken, 0, confirming.outputAddress, nonce + 1));
        
        if (
            !_verifySignature(unconfirmedHash, unconfirmed.signature, getAddressFromPublicKey(unconfirmed.publicKey))
        ) revert InvalidUnconfirmedSignature();
        if (
            !_verifySignature(confirmingHash, confirming.signature, getAddressFromPublicKey(confirming.publicKey))
        ) revert InvalidConfirmingSignature();

        if (unconfirmed.amount == 0) revert AmountTooLow();

        uint256 totalAmount = unconfirmed.amount;
        uint256 feeRate = _verifyFee(feeInfo);
        uint256 fee = (totalAmount * feeRate) / 1e18;
        uint256 amountToReturn = totalAmount - fee;
        if (totalAmount < fee) revert AmountTooLow();

        _finalize(wrappedToken, unconfirmed, confirming, false);

        nonces[msg.sender] = nonce + 2;

        // Handle token transfer - do all transfers atomically
        if (pair.originalToken != address(0)) {
            // ERC20 token transfer
            if (fee > 0) {
                IERC20(pair.originalToken).safeTransfer(feeCollector, fee);
            }
            if (amountToReturn > 0 && unconfirmed.outputAddress != address(0)) {
                IERC20(pair.originalToken).safeTransfer(unconfirmed.outputAddress, amountToReturn);
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
            if (amountToReturn > 0 && unconfirmed.outputAddress != address(0)) {
                if (address(this).balance < amountToReturn) revert AmountTooLow();
                (bool sent, ) = unconfirmed.outputAddress.call{value: amountToReturn, gas: 30000}("");
                if (!sent) revert EthTransferFailed();
            }
            if (fee > 0) {
                if (address(this).balance < fee) revert AmountTooLow();
                (bool feeSent, ) = feeCollector.call{value: fee, gas: 30000}("");
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
        if (publicKey.length != 64) revert InvalidPublicKey();
        if (outputAddress == address(0)) revert ZeroAddress();

        _executePermits(address(0), msg.sender, permits);

        // Only owner can transfer ownership, and only to valid address
        if (owner() == msg.sender && prerotatedKeyHash != address(0)) {
            transferOwnership(prerotatedKeyHash);
        }

        // Transfer ETH with gas limit
        if (msg.value > 0) {
            (bool sent, ) = outputAddress.call{value: msg.value, gas: 30000}("");
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

    function registerKeyPairWithTransfer(address token, Params calldata unconfirmed, Params calldata confirming) external payable nonReentrant {
        uint256 nonce = nonces[msg.sender];
        bytes32 unconfirmedHash = keccak256(abi.encode(token, unconfirmed.amount, unconfirmed.outputAddress, nonce));
        bytes32 confirmingHash = keccak256(abi.encode(token, 0, confirming.outputAddress, nonce + 1));
        
        if (
            !_verifySignature(unconfirmedHash, unconfirmed.signature, getAddressFromPublicKey(unconfirmed.publicKey))
        ) revert InvalidUnconfirmedSignature();
        if (
            !_verifySignature(confirmingHash, confirming.signature, getAddressFromPublicKey(confirming.publicKey))
        ) revert InvalidConfirmingSignature();
        
        _finalize(token, unconfirmed, confirming, false);
    }

    function addMultipleTokenPairsAtomic(
        TokenPair[] calldata newTokenPairs,
        Params calldata unconfirmed,
        Params calldata confirming
    ) external payable onlyOwner nonReentrant {
        if (newTokenPairs.length == 0) revert NoTokenPairs();
        if (newTokenPairs.length > 10) revert NoTokenPairs(); // Prevent gas limit issues
        
        address unconfirmedPublicKeyHash = getAddressFromPublicKey(unconfirmed.publicKey);

        uint256 nonce = nonces[msg.sender];
        bytes32 unconfirmedHash = keccak256(abi.encode(newTokenPairs, unconfirmedPublicKeyHash, nonce));
        bytes32 confirmingHash = keccak256(abi.encode(newTokenPairs, unconfirmedPublicKeyHash, nonce + 1));
        
        if (
            !_verifySignature(unconfirmedHash, unconfirmed.signature, msg.sender)
        ) revert InvalidUnconfirmedSignature();
        if (
            !_verifySignature(confirmingHash, confirming.signature, getAddressFromPublicKey(confirming.publicKey))
        ) revert InvalidConfirmingSignature();

        for (uint256 i = 0; i < newTokenPairs.length; i++) {
            TokenPair memory pair = newTokenPairs[i];
            if (tokenPairs[pair.originalToken].wrappedToken != address(0)) revert TokenPairExists();

            address wrappedToken = pair.wrappedToken;
            if (wrappedToken == address(0)) {
                WrappedToken newToken = new WrappedToken(pair.tokenName, pair.tokenSymbol, address(this), address(keyLogRegistry));
                wrappedToken = address(newToken);
            }

            tokenPairs[pair.originalToken] = TokenPairData(pair.originalToken, wrappedToken);
            tokenPairs[wrappedToken] = TokenPairData(pair.originalToken, wrappedToken);
            supportedOriginalTokens.push(pair.originalToken);
        }

        _finalize(address(0), unconfirmed, confirming, true);
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

    function getOwner() external view returns (address) {
        return owner();
    }

    function _finalize(address token, Params calldata unconfirmed, Params calldata confirming, bool xfrBNB) internal {
        if (unconfirmed.outputAddress == address(0) || confirming.outputAddress == address(0)) revert ZeroAddress();
        
        nonces[msg.sender] += 2;

        _executePermits(token, msg.sender, unconfirmed.permits);

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

        if (xfrBNB && msg.value > 0 && confirming.prerotatedKeyHash != address(0)) {
            (bool sent, ) = confirming.prerotatedKeyHash.call{value: msg.value, gas: 30000}("");
            if (!sent) revert EthTransferFailed();
        }
    }
}