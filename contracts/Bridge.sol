// SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1
pragma solidity 0.8.24;

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

struct FeeInfo {
    address token;
    uint256 fee;
    uint256 expires;
    bytes signature;
}

struct PermitContext {
    address token;
    address user;
    FeeInfo feeInfo;
    bytes publicKey;
    address prerotatedKeyHash;
    PermitData[] permits;
}

struct Recipient {
    address recipientAddress;
    uint256 amount;
    bool wrap;
    bool unwrap;
    bool mint;
    bool burn;
}

struct PermitData {
    address token;
    uint256 amount;
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
    Recipient[] recipients;
}

struct Params {
    uint256 amount;
    bytes publicKey;
    address prerotatedKeyHash;
    address twicePrerotatedKeyHash;
    address prevPublicKeyHash;
    address outputAddress;
}

struct UpgradeContext {
    address newImplementation;
    PermitData[] permits;
    Params unconfirmed;
    bytes unconfirmedSignature;
    Params confirming;
    bytes confirmingSignature;
}

struct TokenPair {
    address originalToken;
    string tokenName;
    string tokenSymbol;
    address wrappedToken;
}

struct RegisterKeyPairContext {
    address token;
    FeeInfo fee;
    TokenPair[] newTokenPairs;
    PermitData[] permits;
    Params unconfirmed;
    bytes unconfirmedSignature;
    Params confirming;
    bytes confirmingSignature;
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
    error InsufficientNativeProvided(); // Added for native token protection

    uint256 private constant PUBLIC_KEY_LENGTH = 64;
    uint256 private constant MAX_TOKEN_PAIRS = 10;
    uint256 private constant GAS_LIMIT = 30000;
    uint256 private constant NONCE_INCREMENT = 2;

    event BurnForYadaCoinWithdrawal(
        address indexed user,
        address indexed wrappedToken,
        uint256 indexed amount,
        string bitcoinAddress
    );

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

    function _verifyFee(FeeInfo memory feeInfo) internal view returns (uint256) {
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
        PermitContext memory ectx
    ) internal {
        bool hasNativeTransfer = false;
        bool requiresOwner = false;  // Flag for direct mint/burn only (IMockERC20 ops)
        // NEW: Track how much native token (ETH/BNB) the caller is expected to provide via msg.value
        uint256 expectedNativeProvided = 0;

        address expectedSigner = getAddressFromPublicKey(ectx.publicKey);

        // Existing native check + owner scan (only for direct mint/burn, not wrap/unwrap)
        for (uint256 i = 0; i < ectx.permits.length; i++) {
            PermitData memory permit = ectx.permits[i];
            if (permit.token == address(0)) {
                hasNativeTransfer = true;
                expectedNativeProvided += permit.amount;
            }
            if (permit.token == ectx.token) {
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

        for (uint256 i = 0; i < ectx.permits.length; i++) {
            PermitData memory permit = ectx.permits[i];

            bool transferOnly = true;
            bool isMint = false;
            bool isBurn = false;
            if (permit.token == ectx.token) {
                for (uint256 j = 0; j < permit.recipients.length; j++) {
                    Recipient memory recipient = permit.recipients[j];
                    if (recipient.wrap || recipient.mint || recipient.unwrap || recipient.burn) {
                        transferOnly = false;

                        if (
                            ectx.token != address(0) &&
                            ectx.feeInfo.token != tokenPairs[ectx.token].originalToken &&
                            ectx.feeInfo.token != tokenPairs[ectx.token].wrappedToken
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

            if (permit.token != address(0) && !isMint && !isBurn && permit.v != 0) {
                if (permit.deadline < block.timestamp) revert PermitDeadlineExpired();

                // Verify permit signature matches the current public key
                bytes32 permitMessageHash = _buildPermitHash(permit, ectx);

                address permitSigner = permitMessageHash.recover(abi.encodePacked(permit.r, permit.s, permit.v));
                if (permitSigner != expectedSigner) {
                    // If signer doesn't match, ensure all recipients are prerotatedKeyHash
                    for (uint256 j = 0; j < permit.recipients.length; j++) {
                        if (permit.recipients[j].recipientAddress != ectx.prerotatedKeyHash) {
                            revert InvalidRecipientForNonMatchingSigner();
                        }
                    }
                }
                IERC20Permit2(permit.token).permit(
                    ectx.user,
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
                feeRate = _verifyFee(ectx.feeInfo);
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

                if (recipient.unwrap && permit.token == ectx.token) {
                    _handleUnwrap(permit, ectx, recipient, totalTransferred);
                } else if (recipient.burn && permit.token == ectx.token && msg.sender == owner()) {
                    IMockERC20(permit.token).burn(recipient.recipientAddress, recipient.amount);
                } else if (recipient.mint && permit.token == ectx.token && msg.sender == owner()) {
                    _handleMint(permit, ectx, recipient);
                } else if (recipient.wrap && permit.token == ectx.token) {
                    _handleWrap(permit, ectx, recipient, totalTransferred, isNative);
                } else if (transferOnly) {
                    if (isNative) {
                        _transferNative(recipient.recipientAddress, recipient.amount);
                    } else {
                        IERC20(permit.token).safeTransferFrom(ectx.user, recipient.recipientAddress, recipient.amount);
                    }
                }
                totalTransferred += recipient.amount;
            }
            if (transferOnly) {
                uint256 remainder = permit.amount - totalTransferred;
                if (remainder > 0) {

                    if (ectx.token == address(0)) {
                        _transferNative(ectx.prerotatedKeyHash, remainder);
                    } else {
                        IERC20(permit.token).safeTransferFrom(ectx.user, ectx.prerotatedKeyHash, remainder);
                    }
                    totalTransferred += remainder;
                }
            }
            if (totalTransferred != permit.amount) revert TransferFailed();
        }

        if (hasNativeTransfer && expectedNativeProvided > 0) {
            if (msg.value < expectedNativeProvided) revert InsufficientNativeProvided();
        }
    }

    function _handleMint(
        PermitData memory permit,
        PermitContext memory mctx,
        Recipient memory recipient
    ) internal {
        uint8 decimals = (permit.token == address(0)) ? 18 : IERC20WithDecimals(permit.token).decimals();
        uint256 maxFeeRate = 10 ** decimals;
        uint256 tokenFee = (recipient.amount * mctx.feeInfo.fee) / maxFeeRate;
        uint256 netAmount = recipient.amount - tokenFee;
        IMockERC20(permit.token).mint(recipient.recipientAddress, netAmount);
    }

    function _handleWrap(
        PermitData memory permit,
        PermitContext memory wctx,
        Recipient memory recipient,
        uint256 totalTransferred,
        bool isNative
    ) internal {

        TokenPairData memory pair = tokenPairs[permit.token];
        if (!isNative) {
            require(IERC20(pair.originalToken).balanceOf(wctx.user) >= recipient.amount, "Insufficient original balance for wrap");
        }

        uint8 decimals = (permit.token == address(0)) ? 18 : IERC20WithDecimals(permit.token).decimals();
        uint256 maxFeeRate = 10 ** decimals;
        uint256 tokenFee = (recipient.amount * wctx.feeInfo.fee) / maxFeeRate;
        if (isNative) {
            if (tokenFee > 0) _transferNative(feeCollector, tokenFee);
        } else {
            IERC20(pair.originalToken).safeTransferFrom(wctx.user, address(this), recipient.amount - tokenFee);
            if (tokenFee > 0) IERC20(pair.originalToken).safeTransferFrom(wctx.user, feeCollector, tokenFee);
        }
        WrappedToken(pair.wrappedToken).mint(wctx.prerotatedKeyHash, recipient.amount - tokenFee);
        if (recipient.amount < permit.amount) {
            uint256 remainder = permit.amount - recipient.amount;
            if (remainder > 0) {
                if (wctx.token == address(0)) {
                    _transferNative(wctx.prerotatedKeyHash, remainder);
                } else {
                    IERC20(permit.token).safeTransferFrom(wctx.user, wctx.prerotatedKeyHash, remainder);
                }
                totalTransferred += remainder;
            }
        }
    }

    function _handleUnwrap(
        PermitData memory permit,
        PermitContext memory uctx,
        Recipient memory recipient,
        uint256 totalTransferred
    ) internal {

        // Balance check for unwrap
        require(WrappedToken(permit.token).balanceOf(uctx.user) >= recipient.amount, "Insufficient wrapped balance for unwrap");

        IERC20(permit.token).safeTransferFrom(uctx.user, address(this), recipient.amount);
        WrappedToken(permit.token).burn(address(this), recipient.amount);

        TokenPairData memory pair = tokenPairs[permit.token];
        uint8 decimals = (permit.token == address(0)) ? 18 : IERC20WithDecimals(permit.token).decimals();
        uint256 maxFeeRate = 10 ** decimals;
        uint256 tokenFee = (recipient.amount * uctx.feeInfo.fee) / maxFeeRate;
        uint256 netAmount = recipient.amount - tokenFee;

        if (pair.originalToken == address(0)) {
            _transferNative(uctx.prerotatedKeyHash, netAmount);
            if (tokenFee > 0) _transferNative(feeCollector, tokenFee);
        } else {
            IERC20(pair.originalToken).safeTransfer(uctx.prerotatedKeyHash, netAmount);
            if (tokenFee > 0) IERC20(pair.originalToken).safeTransfer(feeCollector, tokenFee);
        }

        uint256 remainder = permit.amount - recipient.amount;
        if (remainder > 0) {
            IERC20(permit.token).safeTransferFrom(uctx.user, uctx.prerotatedKeyHash, remainder);
            totalTransferred += remainder;
        }
    }

    function _getPermitNonce(address token, address owner) internal view returns (uint256) {
        return IERC20Permit2(token).nonces(owner);
    }

    function _buildPermitHash(PermitData memory permit, PermitContext memory ectx) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                IERC20Permit2(permit.token).DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        ectx.user,
                        address(this),
                        permit.amount,
                        _getPermitNonce(permit.token, ectx.user),
                        permit.deadline
                    )
                )
            )
        );
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
        RegisterKeyPairContext memory ctx
    ) external payable nonReentrant {
        address unconfirmedPublicKey = getAddressFromPublicKey(ctx.unconfirmed.publicKey);
        if (msg.sender != unconfirmedPublicKey) revert InvalidPublicKey();
        uint256 nonce = nonces[msg.sender];
        bytes32 unconfirmedHash = keccak256(abi.encode(ctx.token, ctx.newTokenPairs, ctx.unconfirmed, nonce));
        if (ctx.unconfirmed.outputAddress == address(0)) revert ZeroAddress();
        if (ctx.unconfirmed.publicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKey();
        if (!_verifySignature(unconfirmedHash, ctx.unconfirmedSignature, getAddressFromPublicKey(ctx.unconfirmed.publicKey))) {
            revert InvalidSignature();
        }
        if (ctx.confirming.outputAddress != address(0)) {
            bytes32 confirmingHash = keccak256(abi.encode(ctx.token, ctx.newTokenPairs, ctx.confirming, nonce + 1));
            if (ctx.confirming.publicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKey();
            if (ctx.confirming.outputAddress == address(0)) revert ZeroAddress();
            if (!_verifySignature(confirmingHash, ctx.confirmingSignature, getAddressFromPublicKey(ctx.confirming.publicKey))) {
                revert InvalidSignature();
            }
        }
        if (owner() == msg.sender) {
            for (uint256 i = 0; i < ctx.newTokenPairs.length; i++) {
                TokenPair memory pair = ctx.newTokenPairs[i];
                if (tokenPairs[pair.originalToken].wrappedToken != address(0)) revert TokenPairExists();
                // Use WrappedTokenFactory to deploy a new proxy pointing to the beacon
                bytes memory initData = abi.encodeWithSelector(
                    WrappedToken.initialize.selector,
                    pair.tokenName,
                    pair.tokenSymbol,
                    address(this),
                    address(keyLogRegistry)
                );
                WrappedTokenProxy proxy = new WrappedTokenProxy(wrappedTokenBeacon, initData);
                address wrappedToken = address(proxy);
                tokenPairs[pair.originalToken] = TokenPairData(pair.originalToken, wrappedToken);
                tokenPairs[wrappedToken] = TokenPairData(pair.originalToken, wrappedToken);
                supportedOriginalTokens.push(pair.originalToken);
            }
        }
        bool isPair = ctx.confirming.outputAddress != address(0);
        if (ctx.permits.length > 0) {
            (KeyLogEntry memory latest, bool exists) = keyLogRegistry.getLatestChainEntry(ctx.unconfirmed.publicKey);
            if (!isPair && exists) revert InvalidPermits();
            _executePermits(
                PermitContext({
                    token: ctx.token,
                    user: msg.sender,
                    feeInfo: ctx.fee,
                    prerotatedKeyHash: isPair ? ctx.confirming.prerotatedKeyHash : ctx.unconfirmed.prerotatedKeyHash,
                    publicKey: ctx.unconfirmed.publicKey,
                    permits: ctx.permits
                })
            );
        }
        if (isPair) {
            keyLogRegistry.registerKeyLogPair(
                KeyData({
                    publicKey: ctx.unconfirmed.publicKey,
                    prerotatedKeyHash: ctx.unconfirmed.prerotatedKeyHash,
                    twicePrerotatedKeyHash: ctx.unconfirmed.twicePrerotatedKeyHash,
                    prevPublicKeyHash: ctx.unconfirmed.prevPublicKeyHash,
                    outputAddress: ctx.unconfirmed.outputAddress
                }),
                KeyData({
                    publicKey: ctx.confirming.publicKey,
                    prerotatedKeyHash: ctx.confirming.prerotatedKeyHash,
                    twicePrerotatedKeyHash: ctx.confirming.twicePrerotatedKeyHash,
                    prevPublicKeyHash: ctx.confirming.prevPublicKeyHash,
                    outputAddress: ctx.confirming.outputAddress
                })
            );
            if (owner() == msg.sender) {
                transferOwnership(ctx.confirming.prerotatedKeyHash);
            }
        } else {
            keyLogRegistry.registerKeyLog(
                KeyData({
                    publicKey: ctx.unconfirmed.publicKey,
                    prerotatedKeyHash: ctx.unconfirmed.prerotatedKeyHash,
                    twicePrerotatedKeyHash: ctx.unconfirmed.twicePrerotatedKeyHash,
                    prevPublicKeyHash: ctx.unconfirmed.prevPublicKeyHash,
                    outputAddress: ctx.unconfirmed.outputAddress
                })
            );
            if (owner() == msg.sender) {
                transferOwnership(ctx.unconfirmed.prerotatedKeyHash);
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

    function getTestString() external pure returns (string memory) {
      return 'bridge v46';
    }

    function upgradeWithKeyRotation(
        UpgradeContext memory ctx
    ) external onlyProxy nonReentrant {
        address unconfirmedPublicKeyHash = getAddressFromPublicKey(ctx.unconfirmed.publicKey);
        require(msg.sender == unconfirmedPublicKeyHash, "Invalid public key owner");
        uint256 nonce = nonces[msg.sender];
        uint256[] memory emptyArray = new uint256[](0);
        bytes32 unconfirmedHash = keccak256(abi.encode(ctx.newImplementation, emptyArray, ctx.unconfirmed, nonce));

        require(
            _verifySignature(
                unconfirmedHash,
                ctx.unconfirmedSignature,
                unconfirmedPublicKeyHash
            ),
            "Invalid unconfirmed upgrade signature"
        );

        bytes32 confirmingHash = keccak256(abi.encode(ctx.newImplementation, emptyArray, ctx.confirming, nonce + 1));

        require(
            _verifySignature(
                confirmingHash,
                ctx.confirmingSignature,
                getAddressFromPublicKey(ctx.confirming.publicKey)
            ),
            "Invalid confirming upgrade signature"
        );

        (KeyLogEntry memory latest, bool exists) = keyLogRegistry.getLatestChainEntry(ctx.unconfirmed.publicKey);
        require(exists, "Key log not initialized.");

        if (ctx.permits.length > 0) {
            _executePermits(
                PermitContext({
                    token: address(0),
                    user: msg.sender,
                    feeInfo: FeeInfo({
                        token: address(0),
                        fee: 0,
                        expires: 0,
                        signature: ""
                    }),
                    prerotatedKeyHash: ctx.confirming.prerotatedKeyHash,
                    publicKey: ctx.unconfirmed.publicKey,
                    permits: ctx.permits
                })
            );
        }

        keyLogRegistry.registerKeyLogPair(
            KeyData({
                publicKey: ctx.unconfirmed.publicKey,
                prerotatedKeyHash: ctx.unconfirmed.prerotatedKeyHash,
                twicePrerotatedKeyHash: ctx.unconfirmed.twicePrerotatedKeyHash,
                prevPublicKeyHash: ctx.unconfirmed.prevPublicKeyHash,
                outputAddress: ctx.unconfirmed.outputAddress
            }),
            KeyData({
                publicKey: ctx.confirming.publicKey,
                prerotatedKeyHash: ctx.confirming.prerotatedKeyHash,
                twicePrerotatedKeyHash: ctx.confirming.twicePrerotatedKeyHash,
                prevPublicKeyHash:ctx.confirming.prevPublicKeyHash,
                outputAddress: ctx.confirming.outputAddress
            })
        );
        require(
            ctx.newImplementation.code.length > 0,
            "Implementation has no code"
        );
        require(
            IERC1822Proxiable(ctx.newImplementation).proxiableUUID()
                == ERC1967Utils.IMPLEMENTATION_SLOT,
            "New implementation is not UUPS compatible"
        );
        upgradeToAndCall(
            ctx.newImplementation,
            ""
        );
        if (owner() == msg.sender) {
            transferOwnership(ctx.confirming.prerotatedKeyHash);
        }
        nonces[msg.sender] += NONCE_INCREMENT;
    }

    function unwrap(
        address wrappedToken,
        uint256 amount,
        string calldata yadacoinAddress
    ) external nonReentrant {
        if (amount == 0) revert BurnAmountZero();
        if (bytes(yadacoinAddress).length == 0 || bytes(yadacoinAddress).length > 42) revert InvalidPublicKey();

        TokenPairData memory pair = tokenPairs[wrappedToken];
        if (pair.wrappedToken == address(0)) revert TokenPairNotSupported();

        // Transfer wrapped tokens to bridge and burn them (mirrors IMockERC20 burn logic)
        IMockERC20(wrappedToken).burn(msg.sender, amount);

        // // Emit minimal, highly visible event
        emit BurnForYadaCoinWithdrawal(msg.sender, wrappedToken, amount, yadacoinAddress);
    }

    function rotateToPublicKey(bytes memory existingOwnerPublicKey) external {
        if (existingOwnerPublicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKey();

        address existingOwnerAddress = getAddressFromPublicKey(existingOwnerPublicKey);

        if (existingOwnerAddress == address(0)) revert ZeroAddress();
        if (existingOwnerAddress != owner()) revert("Incorrect public key provided.");
        (KeyLogEntry memory latest, bool exists) = keyLogRegistry.getLatestChainEntry(existingOwnerPublicKey);


        // Update fee collector if desired
        feeCollector = latest.prerotatedKeyHash;

        // Transfer ownership
        transferOwnership(latest.prerotatedKeyHash); // use internal to bypass any hooks if needed
    }
}