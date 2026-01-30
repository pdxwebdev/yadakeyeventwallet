// SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

struct KeyData {
    bytes publicKey;
    address prerotatedKeyHash;
    address twicePrerotatedKeyHash;
    address prevPublicKeyHash;
    address outputAddress;
}

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
        KeyData memory key
    ) external onlyAuthorized {
        address publicKeyHash = getAddressFromPublicKey(key.publicKey);
        (KeyEventFlag flag, ) = validateTransaction(
            key,
            KeyData({
                publicKey: "",
                prerotatedKeyHash: address(0),
                twicePrerotatedKeyHash: address(0),
                outputAddress: address(0),
                prevPublicKeyHash: address(0)
            }),
            false
        );

        keyLogEntries.push(KeyLogEntry({
            twicePrerotatedKeyHash: key.twicePrerotatedKeyHash,
            prerotatedKeyHash: key.prerotatedKeyHash,
            publicKeyHash: publicKeyHash,
            prevPublicKeyHash: key.prevPublicKeyHash,
            outputAddress: key.outputAddress,
            isOnChain: flag == KeyEventFlag.INCEPTION || flag == KeyEventFlag.CONFIRMING,
            flag: flag
        }));

        uint256 newIndex = keyLogEntries.length - 1;
        byPublicKeyHash[publicKeyHash] = newIndex + 1;
        if (key.prevPublicKeyHash != address(0)) {
            byPrevPublicKeyHash[key.prevPublicKeyHash] = newIndex + 1;
        }
        if (key.prerotatedKeyHash != address(0)) {
            byPrerotatedKeyHash[key.prerotatedKeyHash] = newIndex + 1;
        }
        if (key.twicePrerotatedKeyHash != address(0)) {
            byTwicePrerotatedKeyHash[key.twicePrerotatedKeyHash] = newIndex + 1;
        }

        emit KeyLogRegistered(publicKeyHash, newIndex);
        if (flag != KeyEventFlag.UNCONFIRMED) {
            emit KeyRotated(publicKeyHash, newIndex);
        }

        if (owner() == publicKeyHash) {
            _transferOwnershipForKeyRotation(key.prerotatedKeyHash);
        }
    }

    function registerKeyLogPair(
        KeyData memory unconfirmedKey,
        KeyData memory confirmingKey
    ) external onlyAuthorized {
        address unconfirmedPublicKeyHash = getAddressFromPublicKey(unconfirmedKey.publicKey);
        address confirmingPublicKeyHash = getAddressFromPublicKey(confirmingKey.publicKey);
        (KeyEventFlag unconfirmedFlag, KeyEventFlag confirmingFlag) = validateTransaction(
            unconfirmedKey,
            confirmingKey,
            true
        );

        keyLogEntries.push(KeyLogEntry({
            twicePrerotatedKeyHash: unconfirmedKey.twicePrerotatedKeyHash,
            prerotatedKeyHash: unconfirmedKey.prerotatedKeyHash,
            publicKeyHash: unconfirmedPublicKeyHash,
            prevPublicKeyHash: unconfirmedKey.prevPublicKeyHash,
            outputAddress: unconfirmedKey.outputAddress,
            isOnChain: true,
            flag: unconfirmedFlag
        }));
        uint256 unconfirmedIndex = keyLogEntries.length - 1;

        byPublicKeyHash[unconfirmedPublicKeyHash] = unconfirmedIndex + 1;
        if (unconfirmedKey.prevPublicKeyHash != address(0)) {
            byPrevPublicKeyHash[unconfirmedKey.prevPublicKeyHash] = unconfirmedIndex + 1;
        }
        if (unconfirmedKey.prerotatedKeyHash != address(0)) {
            byPrerotatedKeyHash[unconfirmedKey.prerotatedKeyHash] = unconfirmedIndex + 1;
        }
        if (unconfirmedKey.twicePrerotatedKeyHash != address(0)) {
            byTwicePrerotatedKeyHash[unconfirmedKey.twicePrerotatedKeyHash] = unconfirmedIndex + 1;
        }

        keyLogEntries.push(KeyLogEntry({
            twicePrerotatedKeyHash: confirmingKey.twicePrerotatedKeyHash,
            prerotatedKeyHash: confirmingKey.prerotatedKeyHash,
            publicKeyHash: confirmingPublicKeyHash,
            prevPublicKeyHash: confirmingKey.prevPublicKeyHash,
            outputAddress: confirmingKey.outputAddress,
            isOnChain: true,
            flag: confirmingFlag
        }));
        uint256 confirmingIndex = keyLogEntries.length - 1;

        byPublicKeyHash[confirmingPublicKeyHash] = confirmingIndex + 1;
        if (confirmingKey.prevPublicKeyHash != address(0)) {
            byPrevPublicKeyHash[confirmingKey.prevPublicKeyHash] = confirmingIndex + 1;
        }
        if (confirmingKey.prerotatedKeyHash != address(0)) {
            byPrerotatedKeyHash[confirmingKey.prerotatedKeyHash] = confirmingIndex + 1;
        }
        if (confirmingKey.twicePrerotatedKeyHash != address(0)) {
            byTwicePrerotatedKeyHash[confirmingKey.twicePrerotatedKeyHash] = confirmingIndex + 1;
        }

        if (owner() == unconfirmedPublicKeyHash) {
            _transferOwnershipForKeyRotation(confirmingKey.prerotatedKeyHash);
        }

        emit KeyLogRegistered(unconfirmedPublicKeyHash, unconfirmedIndex);
        emit KeyLogRegistered(confirmingPublicKeyHash, confirmingIndex);
        emit KeyRotated(confirmingPublicKeyHash, confirmingIndex);
    }

    function validateTransaction(
        KeyData memory unconfirmed,
        KeyData memory confirming,
        bool isPair
    ) public view returns (KeyEventFlag, KeyEventFlag) {
        (KeyLogEntry memory lastEntry, bool hasEntries) = getLatestChainEntry(unconfirmed.publicKey);
        address unconfirmedPublicKeyHash = getAddressFromPublicKey(unconfirmed.publicKey);
        address confirmingPublicKeyHash = getAddressFromPublicKey(unconfirmed.publicKey);

        if (hasEntries) {
            require(lastEntry.isOnChain, "Previous entry must be on-chain");
            require(lastEntry.publicKeyHash == unconfirmed.prevPublicKeyHash, "Prev public key mismatch");
            require(lastEntry.prerotatedKeyHash == unconfirmedPublicKeyHash, "Public key mismatch");
            require(lastEntry.twicePrerotatedKeyHash == unconfirmed.prerotatedKeyHash, "Prerotated key must match previous twice prerotated");
        } else if (unconfirmed.prevPublicKeyHash != address(0)) {
            revert("Inception event cannot have a prev_public_key_hash");
        }

        require(byPrevPublicKeyHash[unconfirmed.prevPublicKeyHash] == 0, "Previous public key hash already used");
        require(byPublicKeyHash[unconfirmedPublicKeyHash] == 0, "Public key hash already used");
        require(byPrerotatedKeyHash[unconfirmed.prerotatedKeyHash] == 0, "Prerotated key hash already used");
        require(byTwicePrerotatedKeyHash[unconfirmed.twicePrerotatedKeyHash] == 0, "Twice prerotated key hash already used");

        KeyEventFlag firstFlag;
        if (!hasEntries && unconfirmed.prevPublicKeyHash == address(0)) {
            require(unconfirmed.outputAddress == unconfirmed.prerotatedKeyHash, "Invalid inception");
            firstFlag = KeyEventFlag.INCEPTION;
        } else if (unconfirmed.outputAddress != unconfirmed.prerotatedKeyHash) {
            firstFlag = KeyEventFlag.UNCONFIRMED;
        } else {
            require(unconfirmed.outputAddress == unconfirmed.prerotatedKeyHash, "Invalid confirming");
            firstFlag = KeyEventFlag.CONFIRMING;
        }

        if (!isPair) {
            require(unconfirmed.prerotatedKeyHash == unconfirmed.outputAddress, "Confirming twice prerotated key hash already used");
            require(confirming.outputAddress == address(0), "Confirming twice prerotated key hash already used");
            return (firstFlag, KeyEventFlag.UNCONFIRMED);
        }

        require(getAddressFromPublicKey(confirming.publicKey) == confirmingPublicKeyHash, "Invalid confirmingPublicKey");
        require(unconfirmed.twicePrerotatedKeyHash == confirming.prerotatedKeyHash, "Sequence mismatch: twicePrerotatedKeyHash != confirmingPrerotatedKeyHash");
        require(confirming.outputAddress == confirming.prerotatedKeyHash, "Invalid confirming conditions");
        require(unconfirmed.prerotatedKeyHash == confirmingPublicKeyHash, "Sequence mismatch: prerotatedKeyHash != publicKeyHash");
        require(confirming.prevPublicKeyHash == unconfirmedPublicKeyHash, "Confirming prevPublicKeyHash must match unconfirmed publicKeyHash");
        require(byPrevPublicKeyHash[confirming.prevPublicKeyHash] == 0, "Previous public key hash already used");
        require(byPublicKeyHash[confirmingPublicKeyHash] == 0, "Public key hash already used");
        require(byPrerotatedKeyHash[confirming.prerotatedKeyHash] == 0, "Confirming prerotated key hash already used");
        require(byTwicePrerotatedKeyHash[confirming.twicePrerotatedKeyHash] == 0, "Confirming twice prerotated key hash already used");

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
        KeyLogEntry[] memory log = new KeyLogEntry[](1000);
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