// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./WrappedToken.sol";
import "./KeyLogRegistry.sol";

contract Bridge is Initializable, OwnableUpgradeable, UUPSUpgradeable {
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
    mapping(bytes32 => bool) public processedLocks;

    event TokensWrapped(address indexed user, address wrappedToken, uint256 amount);
    event UnwrapCrossChain(address indexed originalToken, address targetAddress, uint256 amount, address indexed user);
    event TokensLocked(address indexed user, address indexed originalToken, uint256 amount);
    event FeesCollected(address indexed token, uint256 amount);

    // Structs to group unwrapPair parameters
    struct UnwrapParams {
        uint256 amount;
        bytes signature;
        bytes publicKey;
        address prerotatedKeyHash;
        address twicePrerotatedKeyHash;
        address prevPublicKeyHash;
        address targetAddress;
        bool hasRelationship;
    }

    function initialize(address _keyLogRegistry) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        keyLogRegistry = KeyLogRegistry(_keyLogRegistry);
        feeCollector = msg.sender;
        feePercentage = 100; // 1% default fee
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

    function addTokenPair(address originalToken, address wrappedToken, bool _isCrossChain) external onlyOwner {
        originalToWrapped[originalToken] = wrappedToken;
        wrappedToOriginal[wrappedToken] = originalToken;
        isCrossChain[originalToken] = _isCrossChain;
    }

    function lockCrossChain(
        address originalToken,
        uint256 amount,
        bytes calldata publicKey,
        address prerotatedKeyHash,
        address twicePrerotatedKeyHash
    ) external {
        require(IERC20(originalToken).transferFrom(msg.sender, address(this), amount), "Transfer failed");
        keyLogRegistry.registerKeyLog(
            msg.sender,
            address(uint160(uint256(keccak256(publicKey)))),
            prerotatedKeyHash,
            twicePrerotatedKeyHash,
            address(0),
            msg.sender,
            false
        );
        emit TokensLocked(msg.sender, originalToken, amount);
    }

    // Assuming wrapPair could also be refactored similarly if needed
    function wrapPair(
        address originalToken,
        uint256 unconfirmedAmount,
        bytes calldata unconfirmedSignature,
        bytes calldata unconfirmedPublicKey,
        address unconfirmedPrerotatedKeyHash,
        address unconfirmedTwicePrerotatedKeyHash,
        address unconfirmedPrevPublicKeyHash,
        address unconfirmedOutputAddress,
        bool unconfirmedHasRelationship,
        uint256 confirmingAmount,
        bytes calldata confirmingSignature,
        bytes calldata confirmingPublicKey,
        address confirmingPrerotatedKeyHash,
        address confirmingTwicePrerotatedKeyHash,
        address confirmingPrevPublicKeyHash,
        address confirmingOutputAddress,
        bool confirmingHasRelationship
    ) external {
        address wrappedToken = originalToWrapped[originalToken];
        require(wrappedToken != address(0), "Token pair not supported");

        uint256 nonce = nonces[msg.sender];
        nonces[msg.sender] += 2;

        bytes32 unconfirmedMessageHash = keccak256(abi.encodePacked(originalToken, unconfirmedAmount, unconfirmedOutputAddress, nonce));
        bytes32 unconfirmedEthSignedMessageHash = unconfirmedMessageHash.toEthSignedMessageHash();
        address unconfirmedSigner = unconfirmedEthSignedMessageHash.recover(unconfirmedSignature);
        require(unconfirmedSigner == msg.sender, "Invalid unconfirmed signature");

        bytes32 confirmingMessageHash = keccak256(abi.encodePacked(originalToken, confirmingAmount, confirmingOutputAddress, nonce + 1));
        bytes32 confirmingEthSignedMessageHash = confirmingMessageHash.toEthSignedMessageHash();
        address confirmingSigner = confirmingEthSignedMessageHash.recover(confirmingSignature);
        require(confirmingSigner == msg.sender, "Invalid confirming signature");

        keyLogRegistry.registerKeyLogPair(
            msg.sender,
            address(uint160(uint256(keccak256(unconfirmedPublicKey)))),
            unconfirmedPrerotatedKeyHash,
            unconfirmedTwicePrerotatedKeyHash,
            unconfirmedPrevPublicKeyHash,
            unconfirmedOutputAddress,
            unconfirmedHasRelationship,
            address(uint160(uint256(keccak256(confirmingPublicKey)))),
            confirmingPrerotatedKeyHash,
            confirmingTwicePrerotatedKeyHash,
            confirmingPrevPublicKeyHash,
            confirmingOutputAddress,
            confirmingHasRelationship
        );

        uint256 totalAmount = unconfirmedAmount + confirmingAmount;
        uint256 fee = (totalAmount * feePercentage) / FEE_DENOMINATOR;
        uint256 netAmount = totalAmount - fee;

        require(IERC20(originalToken).transferFrom(msg.sender, address(this), totalAmount), "Transfer failed");
        if (fee > 0) {
            require(IERC20(originalToken).transfer(feeCollector, fee), "Fee transfer failed");
            emit FeesCollected(originalToken, fee);
        }
        WrappedToken(wrappedToken).mint(unconfirmedOutputAddress, netAmount);
        emit TokensWrapped(unconfirmedOutputAddress, wrappedToken, netAmount);
    }

    function mintWrappedToken(address wrappedToken, address user, uint256 amount) external {
        require(msg.sender == relayer, "Only relayer can mint");
        require(isCrossChain[wrappedToOriginal[wrappedToken]], "Not a cross-chain token");
        WrappedToken(wrappedToken).mint(user, amount);
    }

    function mintWrappedTokenWithLock(
        address wrappedToken,
        address user,
        uint256 amount,
        bytes32 lockHash
    ) external onlyOwner {
        require(!processedLocks[lockHash], "Lock already processed");
        processedLocks[lockHash] = true;

        uint256 fee = (amount * feePercentage) / FEE_DENOMINATOR;
        uint256 netAmount = amount - fee;

        address originalToken = wrappedToOriginal[wrappedToken];
        if (fee > 0) {
            require(IERC20(originalToken).transfer(feeCollector, fee), "Fee transfer failed");
            emit FeesCollected(originalToken, fee);
        }
        WrappedToken(wrappedToken).mint(user, netAmount);
    }

    function unwrapPair(
        address wrappedToken,
        UnwrapParams calldata unconfirmed,
        UnwrapParams calldata confirming
    ) external {
        address originalToken = wrappedToOriginal[wrappedToken];
        require(originalToken != address(0), "Token pair not supported");

        uint256 nonce = nonces[msg.sender];
        nonces[msg.sender] += 2;

        // Verify unconfirmed signature
        bytes32 unconfirmedMessageHash = keccak256(abi.encodePacked(wrappedToken, unconfirmed.amount, unconfirmed.targetAddress, nonce));
        bytes32 unconfirmedEthSignedMessageHash = unconfirmedMessageHash.toEthSignedMessageHash();
        address unconfirmedSigner = unconfirmedEthSignedMessageHash.recover(unconfirmed.signature);
        require(unconfirmedSigner == msg.sender, "Invalid unconfirmed signature");

        // Verify confirming signature
        bytes32 confirmingMessageHash = keccak256(abi.encodePacked(wrappedToken, confirming.amount, confirming.targetAddress, nonce + 1));
        bytes32 confirmingEthSignedMessageHash = confirmingMessageHash.toEthSignedMessageHash();
        address confirmingSigner = confirmingEthSignedMessageHash.recover(confirming.signature);
        require(confirmingSigner == msg.sender, "Invalid confirming signature");

        // Register key log pair
        keyLogRegistry.registerKeyLogPair(
            msg.sender,
            address(uint160(uint256(keccak256(unconfirmed.publicKey)))),
            unconfirmed.prerotatedKeyHash,
            unconfirmed.twicePrerotatedKeyHash,
            unconfirmed.prevPublicKeyHash,
            unconfirmed.targetAddress,
            unconfirmed.hasRelationship,
            address(uint160(uint256(keccak256(confirming.publicKey)))),
            confirming.prerotatedKeyHash,
            confirming.twicePrerotatedKeyHash,
            confirming.prevPublicKeyHash,
            confirming.targetAddress,
            confirming.hasRelationship
        );

        uint256 totalAmount = unconfirmed.amount + confirming.amount;
        
        // Burn wrapped tokens
        WrappedToken(wrappedToken).burn(msg.sender, totalAmount);

        // Handle transfer based on cross-chain status
        if (isCrossChain[originalToken]) {
            emit UnwrapCrossChain(originalToken, unconfirmed.targetAddress, totalAmount, msg.sender);
        } else {
            uint256 fee = (totalAmount * feePercentage) / FEE_DENOMINATOR;
            uint256 netAmount = totalAmount - fee;

            if (fee > 0) {
                require(IERC20(originalToken).transfer(feeCollector, fee), "Fee transfer failed");
                emit FeesCollected(originalToken, fee);
            }
            require(IERC20(originalToken).transfer(unconfirmed.targetAddress, netAmount), "Transfer failed");
        }
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}