// SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

enum KeyEventFlag { INCEPTION, UNCONFIRMED, CONFIRMING }

struct KeyLogEntry {
    address twicePrerotatedKeyHash;
    address prerotatedKeyHash;
    address publicKeyHash;
    address prevPublicKeyHash;
    address outputAddress;
    bool isOnChain;
    KeyEventFlag flag;
}

contract KeyLogRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {

    KeyLogEntry[] public keyLogEntries;

    mapping(address => uint256) public byPublicKeyHash;
    mapping(address => uint256) public byPrevPublicKeyHash;
    mapping(address => uint256) public byPrerotatedKeyHash;
    mapping(address => uint256) public byTwicePrerotatedKeyHash;

    address public authorizedCaller;

    event KeyLogRegistered(address indexed publicKeyHash, uint256 index);
    event KeyRotated(address indexed publicKeyHash, uint256 index);

    error ZeroAddress();
    error InvalidOwnershipTransfer();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers(); // Prevents initialization in the implementation contract
    }

    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
    }

    modifier onlyAuthorized() {
        require(msg.sender == authorizedCaller || msg.sender == owner(), "Not authorized");
        _;
    }

    function setAuthorizedCaller(address _caller) external onlyOwner {
        authorizedCaller = _caller;
    }

    function registerKeyLog(
        bytes memory publicKey,
        address prerotatedKeyHash,
        address twicePrerotatedKeyHash,
        address prevPublicKeyHash,
        address outputAddress
    ) external onlyAuthorized {
        address publicKeyHash = getAddressFromPublicKey(publicKey);
        (KeyEventFlag flag, ) = validateTransaction(
            publicKey,
            publicKeyHash,
            prerotatedKeyHash,
            twicePrerotatedKeyHash,
            prevPublicKeyHash,
            outputAddress,
            "", address(0), address(0), address(0), address(0), address(0), false
        );

        keyLogEntries.push(KeyLogEntry({
            twicePrerotatedKeyHash: twicePrerotatedKeyHash,
            prerotatedKeyHash: prerotatedKeyHash,
            publicKeyHash: publicKeyHash,
            prevPublicKeyHash: prevPublicKeyHash,
            outputAddress: outputAddress,
            isOnChain: flag == KeyEventFlag.INCEPTION || flag == KeyEventFlag.CONFIRMING,
            flag: flag
        }));

        uint256 newIndex = keyLogEntries.length - 1;
        byPublicKeyHash[publicKeyHash] = newIndex + 1;
        if (prevPublicKeyHash != address(0)) {
            byPrevPublicKeyHash[prevPublicKeyHash] = newIndex + 1;
        }
        if (prerotatedKeyHash != address(0)) {
            byPrerotatedKeyHash[prerotatedKeyHash] = newIndex + 1;
        }
        if (twicePrerotatedKeyHash != address(0)) {
            byTwicePrerotatedKeyHash[twicePrerotatedKeyHash] = newIndex + 1;
        }

        emit KeyLogRegistered(publicKeyHash, newIndex);
        if (flag != KeyEventFlag.UNCONFIRMED) {
            emit KeyRotated(publicKeyHash, newIndex);
        }

        if (owner() == publicKeyHash) {
            _transferOwnershipForKeyRotation(prerotatedKeyHash);
        }
    }

    function registerKeyLogPair(
        bytes calldata unconfirmedPublicKey,
        address unconfirmedPrerotatedKeyHash,
        address unconfirmedTwicePrerotatedKeyHash,
        address unconfirmedPrevPublicKeyHash,
        address unconfirmedOutputAddress,
        bytes calldata confirmingPublicKey,
        address confirmingPrerotatedKeyHash,
        address confirmingTwicePrerotatedKeyHash,
        address confirmingPrevPublicKeyHash,
        address confirmingOutputAddress
    ) external onlyAuthorized {
        address unconfirmedPublicKeyHash = getAddressFromPublicKey(unconfirmedPublicKey);
        address confirmingPublicKeyHash = getAddressFromPublicKey(confirmingPublicKey);
        (KeyEventFlag unconfirmedFlag, KeyEventFlag confirmingFlag) = validateTransaction(
            unconfirmedPublicKey,
            unconfirmedPublicKeyHash,
            unconfirmedPrerotatedKeyHash,
            unconfirmedTwicePrerotatedKeyHash,
            unconfirmedPrevPublicKeyHash,
            unconfirmedOutputAddress,
            confirmingPublicKey,
            confirmingPublicKeyHash,
            confirmingPrerotatedKeyHash,
            confirmingTwicePrerotatedKeyHash,
            confirmingPrevPublicKeyHash,
            confirmingOutputAddress,
            true
        );

        keyLogEntries.push(KeyLogEntry({
            twicePrerotatedKeyHash: unconfirmedTwicePrerotatedKeyHash,
            prerotatedKeyHash: unconfirmedPrerotatedKeyHash,
            publicKeyHash: unconfirmedPublicKeyHash,
            prevPublicKeyHash: unconfirmedPrevPublicKeyHash,
            outputAddress: unconfirmedOutputAddress,
            isOnChain: true,
            flag: unconfirmedFlag
        }));
        uint256 unconfirmedIndex = keyLogEntries.length - 1;

        byPublicKeyHash[unconfirmedPublicKeyHash] = unconfirmedIndex + 1;
        if (unconfirmedPrevPublicKeyHash != address(0)) {
            byPrevPublicKeyHash[unconfirmedPrevPublicKeyHash] = unconfirmedIndex + 1;
        }
        if (unconfirmedPrerotatedKeyHash != address(0)) {
            byPrerotatedKeyHash[unconfirmedPrerotatedKeyHash] = unconfirmedIndex + 1;
        }
        if (unconfirmedTwicePrerotatedKeyHash != address(0)) {
            byTwicePrerotatedKeyHash[unconfirmedTwicePrerotatedKeyHash] = unconfirmedIndex + 1;
        }

        keyLogEntries.push(KeyLogEntry({
            twicePrerotatedKeyHash: confirmingTwicePrerotatedKeyHash,
            prerotatedKeyHash: confirmingPrerotatedKeyHash,
            publicKeyHash: confirmingPublicKeyHash,
            prevPublicKeyHash: confirmingPrevPublicKeyHash,
            outputAddress: confirmingOutputAddress,
            isOnChain: true,
            flag: confirmingFlag
        }));
        uint256 confirmingIndex = keyLogEntries.length - 1;

        byPublicKeyHash[confirmingPublicKeyHash] = confirmingIndex + 1;
        if (confirmingPrevPublicKeyHash != address(0)) {
            byPrevPublicKeyHash[confirmingPrevPublicKeyHash] = confirmingIndex + 1;
        }
        if (confirmingPrerotatedKeyHash != address(0)) {
            byPrerotatedKeyHash[confirmingPrerotatedKeyHash] = confirmingIndex + 1;
        }
        if (confirmingTwicePrerotatedKeyHash != address(0)) {
            byTwicePrerotatedKeyHash[confirmingTwicePrerotatedKeyHash] = confirmingIndex + 1;
        }

        if (owner() == unconfirmedPublicKeyHash) {
            _transferOwnershipForKeyRotation(confirmingPrerotatedKeyHash);
        }

        emit KeyLogRegistered(unconfirmedPublicKeyHash, unconfirmedIndex);
        emit KeyLogRegistered(confirmingPublicKeyHash, confirmingIndex);
        emit KeyRotated(confirmingPublicKeyHash, confirmingIndex);
    }

    function validateTransaction(
        bytes memory publicKey,
        address publicKeyHash,
        address prerotatedKeyHash,
        address twicePrerotatedKeyHash,
        address prevPublicKeyHash,
        address outputAddress,
        bytes memory confirmingPublicKey,
        address confirmingPublicKeyHash,
        address confirmingPrerotatedKeyHash,
        address confirmingTwicePrerotatedKeyHash,
        address confirmingPrevPublicKeyHash,
        address confirmingOutputAddress,
        bool isPair
    ) public view returns (KeyEventFlag, KeyEventFlag) {
        (KeyLogEntry memory lastEntry, bool hasEntries) = getLatestChainEntry(publicKey);
        address calculatedPublicKeyhash = getAddressFromPublicKey(publicKey);

        if (hasEntries) {
            require(lastEntry.isOnChain, "Previous entry must be on-chain");
            require(lastEntry.publicKeyHash == prevPublicKeyHash, "Prev public key mismatch");
            require(lastEntry.prerotatedKeyHash == calculatedPublicKeyhash, "Public key mismatch");
            require(lastEntry.twicePrerotatedKeyHash == prerotatedKeyHash, "Prerotated key must match previous twice prerotated");
        } else if (prevPublicKeyHash != address(0)) {
            revert("Inception event cannot have a prev_public_key_hash");
        }

        require(calculatedPublicKeyhash == publicKeyHash, "Public key hash mismatch");
        require(byPrevPublicKeyHash[prevPublicKeyHash] == 0, "Previous public key hash already used");
        require(byPublicKeyHash[publicKeyHash] == 0, "Public key hash already used");
        require(byPrerotatedKeyHash[prerotatedKeyHash] == 0, "Prerotated key hash already used");
        require(byTwicePrerotatedKeyHash[twicePrerotatedKeyHash] == 0, "Twice prerotated key hash already used");

        KeyEventFlag firstFlag;
        if (!hasEntries && prevPublicKeyHash == address(0)) {
            require(outputAddress == prerotatedKeyHash, "Invalid inception");
            firstFlag = KeyEventFlag.INCEPTION;
        } else if (outputAddress != prerotatedKeyHash) {
            firstFlag = KeyEventFlag.UNCONFIRMED;
        } else {
            require(outputAddress == prerotatedKeyHash, "Invalid confirming");
            firstFlag = KeyEventFlag.CONFIRMING;
        }

        if (!isPair) {
            require(prerotatedKeyHash == outputAddress, "Confirming twice prerotated key hash already used");
            require(confirmingOutputAddress == address(0), "Confirming twice prerotated key hash already used");
            return (firstFlag, KeyEventFlag.UNCONFIRMED);
        }

        require(getAddressFromPublicKey(confirmingPublicKey) == confirmingPublicKeyHash, "Invalid confirmingPublicKey");
        require(twicePrerotatedKeyHash == confirmingPrerotatedKeyHash, "Sequence mismatch: twicePrerotatedKeyHash != confirmingPrerotatedKeyHash");
        require(confirmingOutputAddress == confirmingPrerotatedKeyHash, "Invalid confirming conditions");
        require(prerotatedKeyHash == confirmingPublicKeyHash, "Sequence mismatch: prerotatedKeyHash != publicKeyHash");
        require(confirmingPrevPublicKeyHash == publicKeyHash, "Confirming prevPublicKeyHash must match unconfirmed publicKeyHash");
        require(byPrevPublicKeyHash[confirmingPrevPublicKeyHash] == 0, "Previous public key hash already used");
        require(byPublicKeyHash[confirmingPublicKeyHash] == 0, "Public key hash already used");
        require(byPrerotatedKeyHash[confirmingPrerotatedKeyHash] == 0, "Confirming prerotated key hash already used");
        require(byTwicePrerotatedKeyHash[confirmingTwicePrerotatedKeyHash] == 0, "Confirming twice prerotated key hash already used");

        return (KeyEventFlag.UNCONFIRMED, KeyEventFlag.CONFIRMING);
    }

    function getAddressFromPublicKey(bytes memory publicKey) public pure returns (address) {
        require(publicKey.length == 64, "Public key must be 64 bytes");
        bytes32 hash = keccak256(publicKey);
        return address(uint160(uint256(hash)));
    }

    function getLatestEntryByPrerotatedKeyHash(address prerotatedKeyHash) public view returns (KeyLogEntry memory, bool) {
        uint256 idx = byPrerotatedKeyHash[prerotatedKeyHash];
        if (idx == 0) {
            idx = byTwicePrerotatedKeyHash[prerotatedKeyHash];
            if (idx == 0) {
                KeyLogEntry memory emptyEntry;
                return (emptyEntry, false);
            }
        }
        KeyLogEntry memory entry = keyLogEntries[idx - 1];
        address currentAddress = entry.prerotatedKeyHash;
        idx = byPublicKeyHash[currentAddress];
        require(idx == 0, "Not the latest key rotation.");
        return (entry, true);
    }

    function _buildChainFromHash(address startHash) internal view returns (KeyLogEntry[] memory) {
        KeyLogEntry[] memory log = new KeyLogEntry[](100);
        uint256 logIndex = 0;

        address currentAddress = startHash;
        KeyLogEntry memory inception;
        bool foundInception = false;

        KeyLogEntry memory entry;
        while (true) {
            uint256 idx = byPublicKeyHash[currentAddress];
            if (idx == 0) {
                idx = byPrerotatedKeyHash[currentAddress];
            }
            if (idx == 0) {
                idx = byTwicePrerotatedKeyHash[currentAddress];
            }
            if (idx == 0) {
                KeyLogEntry[] memory emptyLog = new KeyLogEntry[](0);
                return emptyLog;
            }

            entry = keyLogEntries[idx - 1];
            if (entry.prevPublicKeyHash == address(0)) {
                inception = entry;
                foundInception = true;
                break;
            }

            currentAddress = entry.prevPublicKeyHash;
        }

        if (foundInception) {
            log[logIndex] = inception;
            logIndex++;
            currentAddress = inception.prerotatedKeyHash;

            while (true) {
                uint256 idx = byPublicKeyHash[currentAddress];
                if (idx == 0) {
                    break;
                } else {
                    entry = keyLogEntries[idx - 1];
                    log[logIndex] = entry;
                    logIndex++;
                    currentAddress = entry.prerotatedKeyHash;
                }

                if (logIndex >= log.length) {
                    break;
                }
            }
        }

        KeyLogEntry[] memory result = new KeyLogEntry[](logIndex);
        for (uint256 i = 0; i < logIndex; i++) {
            result[i] = log[i];
        }

        return result;
    }

    function buildFromPublicKey(bytes memory publicKey) public view returns (KeyLogEntry[] memory) {
        address publicKeyHash = getAddressFromPublicKey(publicKey);
        return _buildChainFromHash(publicKeyHash);
    }

    function getCurrentIndex(bytes memory publicKey) public view returns (uint256) {
        KeyLogEntry[] memory log = buildFromPublicKey(publicKey);
        return log.length;
    }

    function getPreviousEntry(bytes memory publicKey) public view returns (KeyLogEntry memory, bool) {
        uint256 idx = byPrerotatedKeyHash[getAddressFromPublicKey(publicKey)];
        if (idx == 0) {
            KeyLogEntry memory emptyEntry;
            return (emptyEntry, false);
        }

        KeyLogEntry memory currentEntry = keyLogEntries[idx - 1];
        return (currentEntry, true);
    }

    function getLatestChainEntry(bytes memory publicKey) public view returns (KeyLogEntry memory, bool) {
        KeyLogEntry[] memory log = buildFromPublicKey(publicKey);
        if (log.length == 0) {
            KeyLogEntry memory emptyEntry;
            return (emptyEntry, false);
        }
        return (log[log.length - 1], true);
    }

    function getLatestChainEntry(address publicKeyHash) public view returns (KeyLogEntry memory, bool) {
        KeyLogEntry[] memory log = _buildChainFromHash(publicKeyHash);
        if (log.length == 0) {
            KeyLogEntry memory emptyEntry;
            return (emptyEntry, false);
        }
        return (log[log.length - 1], true);
    }

    function getLatestEntry(address publicKeyHash) public view returns (KeyLogEntry memory, bool) {
        uint256 idx = byPublicKeyHash[publicKeyHash];
        if (idx == 0) {
            KeyLogEntry memory emptyEntry;
            return (emptyEntry, false);
        }
        return (keyLogEntries[idx - 1], true);
    }

    function isValidOwnershipTransfer(address currentOwner, address newOwner) external view returns (bool) {
        if (currentOwner == address(0) || newOwner == address(0)) return false;
        (KeyLogEntry memory latest, bool exists) = getLatestChainEntry(currentOwner);
        if (!exists) return false;
        return latest.prerotatedKeyHash == newOwner && latest.flag != KeyEventFlag.UNCONFIRMED;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function _transferOwnershipForKeyRotation(address newOwner) internal onlyAuthorized {
        if (newOwner == address(0)) revert ZeroAddress();
        if (!this.isValidOwnershipTransfer(owner(), newOwner)) revert InvalidOwnershipTransfer();
        _transferOwnership(newOwner);
    }
}