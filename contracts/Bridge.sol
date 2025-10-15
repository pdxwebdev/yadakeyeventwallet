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
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./WrappedToken.sol";
import "./KeyLogRegistry.sol";
import "./WrappedTokenFactory.sol";

interface IMockERC20 {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}

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
    function nonces(address owner) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

interface IUUPSUpgradeable {
    function upgradeTo(address newImplementation) external;
    function owner() external view returns (address);
}

contract Bridge is Initializable, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    KeyLogRegistry public keyLogRegistry;
    address public relayer;
    address public feeCollector;
    address public feeSigner;
    address public wrappedTokenBeacon;

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
        bool burn;
    }

    struct Params {
        uint256 amount;
        bytes publicKey;
        address prerotatedKeyHash;
        address twicePrerotatedKeyHash;
        address prevPublicKeyHash;
        address outputAddress;
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

    error UpgradeFailed(address contractAddress, string reason);

    error ZeroAddress();
    error InvalidFeeCollector();
    error TokenPairExists();
    error TokenPairNotSupported();
    error InvalidSignature();
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
    error MissingPermit();
    error NotOwnerOfTarget(address contractAddress);
    error InvalidOwnershipTransfer();
    error InsufficientBalance();
    error InvalidRecipientForNonMatchingSigner();
    error InvalidPermits();

    uint256 private constant PUBLIC_KEY_LENGTH = 64;
    uint256 private constant MAX_TOKEN_PAIRS = 10;
    uint256 private constant GAS_LIMIT = 30000;
    uint256 private constant NONCE_INCREMENT = 2;

    function initialize(address _keyLogRegistry, address _wrappedTokenBeacon) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        if (_keyLogRegistry == address(0)) revert ZeroAddress();
        keyLogRegistry = KeyLogRegistry(_keyLogRegistry);
        feeCollector = msg.sender;
        wrappedTokenBeacon = _wrappedTokenBeacon;
    }

    function setFeeSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddress();
        feeSigner = _signer;
    }

    function _verifyFee(FeeInfo calldata feeInfo) internal view returns (uint256) {
        if (feeInfo.expires < block.timestamp) revert PermitDeadlineExpired();
        uint8 decimals = (feeInfo.token == address(0)) ? 18 : IERC20WithDecimals(feeInfo.token).decimals();
        uint256 maxFeeRate = 10 ** decimals;
        if (feeInfo.fee > maxFeeRate) revert InvalidFeeRate();
        bytes32 messageHash = keccak256(
            abi.encode(feeInfo.token, feeInfo.fee, feeInfo.expires)
        ).toEthSignedMessageHash();
        address signer = messageHash.recover(feeInfo.signature);
        if (signer != feeSigner) revert InvalidSignature();
        return feeInfo.fee;
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (!keyLogRegistry.isValidOwnershipTransfer(owner(), newOwner)) revert InvalidOwnershipTransfer();
        feeCollector = newOwner;
        super.transferOwnership(newOwner);
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        if (_feeCollector == address(0)) revert InvalidFeeCollector();
        feeCollector = _feeCollector;
    }

    function getSupportedTokens() external view returns (address[] memory) {
        return supportedOriginalTokens;
    }

    function _executePermits(
        address token,
        address user,
        PermitData[] calldata permits,
        FeeInfo calldata feeInfo,
        address prerotatedKeyHash,
        bytes memory currentPublicKey // Add current public key as parameter
    ) internal {
        bool hasNativeTransfer = false;
        bool requiresOwner = false;  // Flag for direct mint/burn only (IMockERC20 ops)
        uint256 totalNativeWrap = 0;  // For native wrap balance check
        address expectedSigner = getAddressFromPublicKey(currentPublicKey);

        // Existing native check + owner scan (only for direct mint/burn, not wrap/unwrap)
        for (uint256 i = 0; i < permits.length; i++) {
            PermitData memory permit = permits[i];
            if (permit.token == address(0)) {
                hasNativeTransfer = true;
            }
            if (permit.token == token) {
                for (uint256 j = 0; j < permit.recipients.length; j++) {
                    Recipient memory recipient = permit.recipients[j];
                    if (recipient.mint || recipient.burn) {  // Only direct ops require owner
                        requiresOwner = true;
                        break;
                    }
                }
                if (requiresOwner) break;
            }
        }
        if (!hasNativeTransfer) revert MissingPermit();
        if (requiresOwner && msg.sender != owner()) revert InvalidOwnershipTransfer();

        for (uint256 i = 0; i < permits.length; i++) {
            PermitData memory permit = permits[i];

            bool transferOnly = true;
            bool isMint = false;
            bool isBurn = false;
            if (permit.token == token) {
                for (uint256 j = 0; j < permit.recipients.length; j++) {
                    Recipient memory recipient = permit.recipients[j];
                    if (recipient.wrap || recipient.mint || recipient.unwrap || recipient.burn) {
                        transferOnly = false;

                        if (
                            token != address(0) &&
                            feeInfo.token != tokenPairs[token].originalToken &&
                            feeInfo.token != tokenPairs[token].wrappedToken
                        ) revert InvalidFeeRate();
                    }
                    if (recipient.mint) {
                        isMint = true;
                    }
                    if (recipient.burn) {
                        isBurn = true;
                    }
                }
            }

            if (permit.token != address(0) && !isMint && !isBurn) {
                if (permit.deadline < block.timestamp) revert PermitDeadlineExpired();

                // Verify permit signature matches the current public key
                bytes32 permitMessageHash = keccak256(
                    abi.encodePacked(
                        "\x19\x01",
                        IERC20Permit2(permit.token).DOMAIN_SEPARATOR(),
                        keccak256(
                            abi.encode(
                                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                                user,
                                address(this),
                                permit.amount,
                                IERC20Permit2(permit.token).nonces(user),
                                permit.deadline
                            )
                        )
                    )
                );

                address permitSigner = permitMessageHash.recover(abi.encodePacked(permit.r, permit.s, permit.v));
                if (permitSigner != expectedSigner) {
                    // If signer doesn't match, ensure all recipients are prerotatedKeyHash
                    for (uint256 j = 0; j < permit.recipients.length; j++) {
                        if (permit.recipients[j].recipientAddress != prerotatedKeyHash) {
                            revert InvalidRecipientForNonMatchingSigner();
                        }
                    }
                }
                IERC20Permit2(permit.token).permit(
                    user,
                    address(this),
                    permit.amount,
                    permit.deadline,
                    permit.v,
                    permit.r,
                    permit.s
                );
            }

            uint256 feeRate = 0;
            if (!transferOnly) {
                feeRate = _verifyFee(feeInfo);
            }

            bool isNative = permit.token == address(0);
            
            uint256 totalTransferred = 0;
            for (uint256 j = 0; j < permit.recipients.length; j++) {
                // here we are burning the entire amount requested of a Yada Wrapped Token (YWT)
                // then we are sending the original token/coin amount back to the recipient minus a token fee 
                // then finally sending he remainder to the next key rotation
                // no other recipients are allowed other than this contract, the next key rotation, and the fee collector
                Recipient memory recipient = permit.recipients[j];
                if (recipient.recipientAddress == address(0)) revert ZeroAddress();
                if (recipient.amount == 0) continue;
                if (recipient.amount > permit.amount) revert InvalidRecipientAmount();

                if (recipient.unwrap && permit.token == token) {
                    // Balance check for unwrap
                    require(WrappedToken(permit.token).balanceOf(user) >= recipient.amount, "Insufficient wrapped balance for unwrap");

                    IERC20(permit.token).safeTransferFrom(user, address(this), recipient.amount);
                    WrappedToken(permit.token).burn(address(this), recipient.amount);

                    TokenPairData memory pair = tokenPairs[permit.token];
                    uint8 decimals = (permit.token == address(0)) ? 18 : IERC20WithDecimals(permit.token).decimals();
                    uint256 maxFeeRate = 10 ** decimals;
                    uint256 tokenFee = (recipient.amount * feeInfo.fee) / maxFeeRate;
                    uint256 netAmount = recipient.amount - tokenFee;

                    if (pair.originalToken == address(0)) {
                        _transferNative(prerotatedKeyHash, netAmount);
                        if (tokenFee > 0) _transferNative(feeCollector, tokenFee);
                    } else {
                        IERC20(pair.originalToken).safeTransfer(prerotatedKeyHash, netAmount);
                        if (tokenFee > 0) IERC20(pair.originalToken).safeTransfer(feeCollector, tokenFee);
                    }

                    uint256 remainder = permit.amount - recipient.amount;
                    if (remainder > 0) {
                        IERC20(permit.token).safeTransferFrom(user, prerotatedKeyHash, remainder);
                        totalTransferred += remainder;
                    }
                } else if (recipient.burn && permit.token == token) {
                    IMockERC20(permit.token).burn(recipient.recipientAddress, recipient.amount);
                } else if (recipient.mint && permit.token == token) {
                    uint8 decimals = (permit.token == address(0)) ? 18 : IERC20WithDecimals(permit.token).decimals();
                    uint256 maxFeeRate = 10 ** decimals;
                    uint256 tokenFee = (recipient.amount * feeInfo.fee) / maxFeeRate;
                    uint256 netAmount = recipient.amount - tokenFee;
                    IMockERC20(permit.token).mint(recipient.recipientAddress, netAmount);
                } else if (recipient.wrap && permit.token == token) {
                    TokenPairData memory pair = tokenPairs[permit.token];
                    if (!isNative) {
                        require(IERC20(pair.originalToken).balanceOf(user) >= recipient.amount, "Insufficient original balance for wrap");
                    } else {
                        totalNativeWrap += recipient.amount;
                    }

                    uint8 decimals = (permit.token == address(0)) ? 18 : IERC20WithDecimals(permit.token).decimals();
                    uint256 maxFeeRate = 10 ** decimals;
                    uint256 tokenFee = (recipient.amount * feeInfo.fee) / maxFeeRate;
                    if (isNative) {
                        if (tokenFee > 0) _transferNative(feeCollector, tokenFee);
                    } else {
                        IERC20(pair.originalToken).safeTransferFrom(user, address(this), recipient.amount - tokenFee);
                        if (tokenFee > 0) IERC20(pair.originalToken).safeTransferFrom(user, feeCollector, tokenFee);
                    }
                    WrappedToken(pair.wrappedToken).mint(prerotatedKeyHash, recipient.amount - tokenFee);
                    if (recipient.amount < permit.amount) {
                        uint256 remainder = permit.amount - recipient.amount;
                        if (remainder > 0) {
                            if (token == address(0)) {
                                _transferNative(prerotatedKeyHash, remainder);
                            } else {
                                IERC20(permit.token).safeTransferFrom(user, prerotatedKeyHash, remainder);
                            }
                            totalTransferred += remainder;
                        }
                    }
                } else if (transferOnly) {
                    if (isNative) {
                        _transferNative(recipient.recipientAddress, recipient.amount);
                    } else {
                        IERC20(permit.token).safeTransferFrom(user, recipient.recipientAddress, recipient.amount);
                    }
                }
                totalTransferred += recipient.amount;
            }
            if (transferOnly) {
                uint256 remainder = permit.amount - totalTransferred;
                if (remainder > 0) {
                    if (token == address(0)) {
                        _transferNative(prerotatedKeyHash, remainder);
                    } else {
                        IERC20(permit.token).safeTransferFrom(user, prerotatedKeyHash, remainder);
                    }
                    totalTransferred += remainder;
                }
            }
            if (totalTransferred != permit.amount) revert TransferFailed();
        }
    }

    function _transferNative(address to, uint256 amount) private {
        (bool success, ) = to.call{value: amount, gas: GAS_LIMIT}("");
        if (!success) revert TransferFailed();
    }

    function emergencyWithdrawBNB(address to) external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No BNB to withdraw");
        (bool sent, ) = to.call{value: balance}("");
        require(sent, "Withdraw failed");
    }

    function _verifySignature(bytes32 messageHash, bytes memory signature, address expectedSigner) internal pure returns (bool) {
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        return ethSignedMessageHash.recover(signature) == expectedSigner;
    }

    function registerKeyPairWithTransfer(
        address token,
        FeeInfo calldata fee,
        TokenPair[] calldata newTokenPairs,
        PermitData[] calldata permits,
        Params calldata unconfirmed,
        bytes calldata unconfirmedSignature,
        Params calldata confirming,
        bytes calldata confirmingSignature
    ) external payable nonReentrant {
        address unconfirmedPublicKey = getAddressFromPublicKey(unconfirmed.publicKey);
        if (msg.sender != unconfirmedPublicKey) revert InvalidPublicKey();
        uint256 nonce = nonces[msg.sender];
        bytes32 unconfirmedHash = keccak256(abi.encode(token, newTokenPairs, unconfirmed, nonce));
        if (unconfirmed.outputAddress == address(0)) revert ZeroAddress();
        if (unconfirmed.publicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKey();
        if (!_verifySignature(unconfirmedHash, unconfirmedSignature, getAddressFromPublicKey(unconfirmed.publicKey))) {
            revert InvalidSignature();
        }
        if (confirming.outputAddress != address(0)) {
            bytes32 confirmingHash = keccak256(abi.encode(token, newTokenPairs, confirming, nonce + 1));
            if (confirming.publicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKey();
            if (confirming.outputAddress == address(0)) revert ZeroAddress();
            if (!_verifySignature(confirmingHash, confirmingSignature, getAddressFromPublicKey(confirming.publicKey))) {
                revert InvalidSignature();
            }
        }
        for (uint256 i = 0; i < newTokenPairs.length; i++) {
            TokenPair memory pair = newTokenPairs[i];
            if (tokenPairs[pair.originalToken].wrappedToken != address(0)) revert TokenPairExists();
            address wrappedToken = pair.wrappedToken;
            if (wrappedToken == address(0)) {
                // Use WrappedTokenFactory to deploy a new proxy pointing to the beacon
                bytes memory initData = abi.encodeWithSelector(
                    WrappedToken.initialize.selector,
                    pair.tokenName,
                    pair.tokenSymbol,
                    address(this),
                    address(keyLogRegistry)
                );
                WrappedTokenProxy proxy = new WrappedTokenProxy(wrappedTokenBeacon, initData);
                wrappedToken = address(proxy);
            }
            tokenPairs[pair.originalToken] = TokenPairData(pair.originalToken, wrappedToken);
            tokenPairs[wrappedToken] = TokenPairData(pair.originalToken, wrappedToken);
            supportedOriginalTokens.push(pair.originalToken);
        }
        bool isPair = confirming.outputAddress != address(0);
        if (permits.length > 0) {
            (KeyLogEntry memory latest, bool exists) = keyLogRegistry.getLatestChainEntry(unconfirmed.publicKey);
            if (!isPair && exists) revert InvalidPermits();
            _executePermits(
                token,
                msg.sender,
                permits,
                fee,
                isPair ? confirming.prerotatedKeyHash : unconfirmed.prerotatedKeyHash,
                unconfirmed.publicKey
            );
        }
        if (isPair) {
            keyLogRegistry.registerKeyLogPair(
                unconfirmed.publicKey,
                unconfirmed.prerotatedKeyHash,
                unconfirmed.twicePrerotatedKeyHash,
                unconfirmed.prevPublicKeyHash,
                unconfirmed.outputAddress,
                confirming.publicKey,
                confirming.prerotatedKeyHash,
                confirming.twicePrerotatedKeyHash,
                confirming.prevPublicKeyHash,
                confirming.outputAddress
            );
            if (owner() == msg.sender) {
                transferOwnership(confirming.prerotatedKeyHash);
            }
        } else {
            keyLogRegistry.registerKeyLog(
                unconfirmed.publicKey,
                unconfirmed.prerotatedKeyHash,
                unconfirmed.twicePrerotatedKeyHash,
                unconfirmed.prevPublicKeyHash,
                unconfirmed.outputAddress
            );
            if (owner() == msg.sender) {
                transferOwnership(unconfirmed.prerotatedKeyHash);
            }
        }
        nonces[msg.sender] += NONCE_INCREMENT;
    }

    function transferBalanceToLatestKey(
        bytes memory publicKey,
        PermitData[] calldata permits
    ) external nonReentrant {

        address expectedSigner = getAddressFromPublicKey(publicKey);
        for(uint256 i = 0; i < permits.length; i++) {
            PermitData memory permit = permits[i];
            if (permit.token == address(0)) revert InvalidPermits();
            // Get latest key log entry for the public key
            (KeyLogEntry memory latestEntry, bool exists) = keyLogRegistry.getLatestChainEntry(publicKey);
            if (!exists) revert InvalidPublicKey();

            uint256 balance = IERC20(permit.token).balanceOf(expectedSigner);
            if (balance == 0) revert InsufficientBalance();
            if (permit.deadline < block.timestamp) revert PermitDeadlineExpired();

            //Verify permit signature matches the current public key
            bytes32 permitMessageHash = keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    IERC20Permit2(permit.token).DOMAIN_SEPARATOR(),
                    keccak256(
                        abi.encode(
                            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                            expectedSigner,
                            address(this),
                            balance,
                            IERC20Permit2(permit.token).nonces(expectedSigner),
                            permit.deadline
                        )
                    )
                )
            );

            address permitSigner = permitMessageHash.recover(abi.encodePacked(permit.r, permit.s, permit.v));
            if (permitSigner != expectedSigner) {
                revert InvalidRecipientForNonMatchingSigner();
            }
            IERC20Permit2(permit.token).permit(
                expectedSigner,
                address(this),
                balance,
                permit.deadline,
                permit.v,
                permit.r,
                permit.s
            );
            IERC20(permit.token).safeTransferFrom(expectedSigner, latestEntry.prerotatedKeyHash, balance);
        }
    }

    function originalToWrapped(address originalToken) external view returns (address) {
        TokenPairData memory pair = tokenPairs[originalToken];
        return pair.wrappedToken;
    }

    function getAddressFromPublicKey(bytes memory publicKey) public pure returns (address) {
        if (publicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKey();
        bytes32 hash = keccak256(publicKey);
        return address(uint160(uint256(hash)));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function getOwner() external view returns (address) {
        return owner();
    }

    function setWrappedTokenBeacon(address _wrappedTokenBeacon) external onlyOwner {
        if (_wrappedTokenBeacon == address(0)) revert ZeroAddress();
        wrappedTokenBeacon = _wrappedTokenBeacon;
    }
}