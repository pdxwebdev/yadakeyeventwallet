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

contract Bridge is Initializable, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
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

    uint256 private constant MAX_FEE_RATE = 1e18;
    uint256 private constant PUBLIC_KEY_LENGTH = 64;
    uint256 private constant MAX_TOKEN_PAIRS = 10;
    uint256 private constant GAS_LIMIT = 30000;
    uint256 private constant NONCE_INCREMENT = 2;

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
        if (feeInfo.fee > MAX_FEE_RATE) revert InvalidFeeRate(); // Cap fee at 100%

        bytes32 messageHash = keccak256(
            abi.encode(feeInfo.token, feeInfo.fee, feeInfo.expires)
        ).toEthSignedMessageHash();

        address signer = messageHash.recover(feeInfo.signature);
        if (signer != feeSigner) revert InvalidSignature();

        return feeInfo.fee;
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (feeCollector != owner()) revert RestrictedToOwnerRelayer();
        
        feeCollector = newOwner;
        super.transferOwnership(newOwner);
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

    function _executePermits(address token, address user, PermitData[] calldata permits, FeeInfo calldata feeInfo, address confirmingPrerotatedKeyHash) internal {
        for (uint256 i = 0; i < permits.length; i++) {
            PermitData memory permit = permits[i];

            if (permit.token != address(0)) {
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
            }
            bool transferOnly = true;
            if (permit.token == token) {
                for (uint256 j = 0; j < permit.recipients.length; j++) {
                    Recipient memory recipient = permit.recipients[j];
                    if(recipient.unwrap || recipient.mint || recipient.unwrap) {
                        transferOnly = false;
                    }
                }
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
                    uint256 tokenFee = (permit.amount * feeRate) / MAX_FEE_RATE;
                    WrappedToken(permit.token).burn(recipient.recipientAddress, recipient.amount);
                    TokenPairData memory pair = tokenPairs[permit.token];

                    uint256 netAmount = recipient.amount - tokenFee;
                    if (pair.originalToken == address(0)) {
                        _transferNative(recipient.recipientAddress, netAmount);
                        _transferNative(feeCollector, tokenFee);
                    } else {
                        IERC20(pair.originalToken).safeTransfer(recipient.recipientAddress, netAmount);
                        IERC20(pair.originalToken).safeTransfer(feeCollector, tokenFee);
                    }

                    uint256 remainder = permit.amount - (recipient.amount + tokenFee);
                    if (remainder > 0) _transferToNext(permit.token, confirmingPrerotatedKeyHash, remainder);
                } else if (recipient.mint && permit.token == token) { 
                    // here we are minting a cross chain token, WYDA in this case
                    // this is a special case because it is a non-Yada Wrapped Token (YWT). It is an ERC20.
                    uint256 tokenFee = (permit.amount * feeRate) / MAX_FEE_RATE;
                    uint256 netAmount = recipient.amount - tokenFee;
                    WrappedToken(permit.token).mint(recipient.recipientAddress, netAmount);
                } else if (recipient.wrap && permit.token == token) {
                    // here we are wrapping an erc20 token into a Yada Wrapped Token minus the token fee
                    // no other recipients are allowed other than this contract, the next key rotation, and the fee collector
                    uint256 tokenFee = (permit.amount * feeRate) / 1e18;
                    TokenPairData memory pair = tokenPairs[permit.token];

                    if (isNative) {
                        _transferNative(feeCollector, tokenFee);
                    } else {
                        IERC20(pair.originalToken).safeTransferFrom(user, address(this), recipient.amount - tokenFee);
                        IERC20(pair.originalToken).safeTransferFrom(user, feeCollector, tokenFee);
                    }

                    if (recipient.amount + tokenFee < permit.amount) {
                        // there's a remainder, send it to the next key rotation
                        uint256 remainder = permit.amount - recipient.amount;
                        if (remainder > 0) _transferToNext(permit.token, confirmingPrerotatedKeyHash, remainder);
                    }
                } else if (transferOnly) {
                    // here we are just carrying forward any remaining balance to the next key rotation.
                    // this is the only place where we can send tokens/coins to whomever
                    if (isNative) {
                        _transferNative(recipient.recipientAddress, recipient.amount);
                    } else {
                        IERC20(permit.token).safeTransferFrom(user, recipient.recipientAddress, recipient.amount);
                    }
                }
                totalTransferred += recipient.amount;
            }
            if (totalTransferred != permit.amount) revert TransferFailed();
        }
    }

    function _transferNative(address to, uint256 amount) private {
        (bool success, ) = to.call{value: amount, gas: 30000}("");
        if (!success) revert TransferFailed();
    }


    function _transferToNext(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            _transferNative(to, amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
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
        Params calldata unconfirmed,
        Params calldata confirming
    ) external payable nonReentrant {
        uint256 nonce = nonces[msg.sender];
        bytes32 unconfirmedHash = keccak256(abi.encode(token, unconfirmed.amount, unconfirmed.outputAddress, nonce));
        
        if (unconfirmed.outputAddress == address(0)) revert ZeroAddress();
        if (unconfirmed.publicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKey();

        if (
            !_verifySignature(unconfirmedHash, unconfirmed.signature, getAddressFromPublicKey(unconfirmed.publicKey))
        ) revert InvalidSignature();

        if (confirming.outputAddress != address(0)) {
            bytes32 confirmingHash = keccak256(abi.encode(token, 0, confirming.outputAddress, nonce + 1));
            if (confirming.publicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKey();
            if (confirming.outputAddress == address(0)) revert ZeroAddress();

            if (
                !_verifySignature(confirmingHash, confirming.signature, getAddressFromPublicKey(confirming.publicKey))
            ) revert InvalidSignature();
        }

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
        if (unconfirmed.permits.length > 0) {
            _executePermits(token, msg.sender, unconfirmed.permits, fee, confirming.prerotatedKeyHash);
        }

        if (confirming.outputAddress == address(0)) {
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
        } else {
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
        }
        nonces[msg.sender] += NONCE_INCREMENT;
    }

    function originalToWrapped(address originalToken) external view returns (address) {
        TokenPairData memory pair = tokenPairs[originalToken];
        if (pair.wrappedToken == address(0)) revert TokenPairNotSupported();
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
}