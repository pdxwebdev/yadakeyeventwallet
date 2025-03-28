// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

contract KeyLogRegistry is Ownable {
    enum KeyEventFlag { INCEPTION, UNCONFIRMED, CONFIRMING }

    struct KeyLogEntry {
        address twicePrerotatedKeyHash;
        address prerotatedKeyHash;
        address publicKeyHash;
        address prevPublicKeyHash;
        address outputAddress;
        bool hasRelationship;
        bool isOnChain;
        KeyEventFlag flag;
    }

    KeyLogEntry[] public keyLogEntries;

    mapping(address => uint256[]) public byPublicKeyHash;
    mapping(address => uint256[]) public byPrevPublicKeyHash;
    mapping(address => uint256[]) public byPrerotatedKeyHash;

    event KeyLogRegistered(address indexed publicKeyHash, uint256 index);
    event KeyRotated(address indexed publicKeyHash, uint256 index);

    constructor() Ownable(msg.sender) {}

    function registerKeyLog(
        bytes memory publicKey,
        address publicKeyHash,
        address prerotatedKeyHash,
        address twicePrerotatedKeyHash,
        address prevPublicKeyHash,
        address outputAddress,
        bool hasRelationship
    ) external onlyAuthorized {
        (KeyLogEntry memory prevEntry, bool hasPrevEntry) = getPreviousEntry(publicKey);

        if (hasPrevEntry) {
            require(prevEntry.isOnChain, "Previous entry must be on-chain");
            require(prevEntry.publicKeyHash == prevPublicKeyHash, "Invalid prev public key hash");
            require(prevEntry.prerotatedKeyHash == publicKeyHash, "Public key must match previous prerotated");
            require(prevEntry.twicePrerotatedKeyHash == prerotatedKeyHash, "Prerotated key must match previous twice prerotated");
        } else if (prevPublicKeyHash != address(0)) {
            revert("Inception event cannot have a prev_public_key_hash");
        }

        KeyEventFlag flag;
        if (!hasPrevEntry && prevPublicKeyHash == address(0)) {
            require(!hasRelationship && outputAddress == prerotatedKeyHash, "Invalid inception");
            flag = KeyEventFlag.INCEPTION;
        } else if (hasRelationship || outputAddress != prerotatedKeyHash) {
            flag = KeyEventFlag.UNCONFIRMED;
        } else {
            require(!hasRelationship && outputAddress == prerotatedKeyHash, "Invalid confirming");
            flag = KeyEventFlag.CONFIRMING;
        }

        keyLogEntries.push(KeyLogEntry({
            twicePrerotatedKeyHash: twicePrerotatedKeyHash,
            prerotatedKeyHash: prerotatedKeyHash,
            publicKeyHash: publicKeyHash,
            prevPublicKeyHash: prevPublicKeyHash,
            outputAddress: outputAddress,
            hasRelationship: hasRelationship,
            isOnChain: flag == KeyEventFlag.INCEPTION || flag == KeyEventFlag.CONFIRMING,
            flag: flag
        }));

        uint256 newIndex = keyLogEntries.length - 1;
        byPublicKeyHash[publicKeyHash].push(newIndex);
        if (prevPublicKeyHash != address(0)) {
            byPrevPublicKeyHash[prevPublicKeyHash].push(newIndex);
        }
        if (prerotatedKeyHash != address(0)) {
            byPrerotatedKeyHash[prerotatedKeyHash].push(newIndex);
        }

        emit KeyLogRegistered(publicKeyHash, newIndex);
        if (flag != KeyEventFlag.UNCONFIRMED) {
            emit KeyRotated(publicKeyHash, newIndex);
        }
    }

    function registerKeyLogPair(
        bytes memory publicKey,
        address unconfirmedPublicKeyHash,
        address unconfirmedPrerotatedKeyHash,
        address unconfirmedTwicePrerotatedKeyHash,
        address unconfirmedPrevPublicKeyHash,
        address unconfirmedOutputAddress,
        bool unconfirmedHasRelationship,
        address confirmingPublicKeyHash,
        address confirmingPrerotatedKeyHash,
        address confirmingTwicePrerotatedKeyHash,
        address confirmingPrevPublicKeyHash,
        address confirmingOutputAddress,
        bool confirmingHasRelationship
    ) external onlyAuthorized {
        (KeyLogEntry memory prevEntry, bool hasPrevEntry) = getPreviousEntry(publicKey);

        if (hasPrevEntry) {
            require(prevEntry.isOnChain, "Previous entry must be on-chain");
            require(prevEntry.publicKeyHash == unconfirmedPrevPublicKeyHash, "Invalid prev public key hash");
            require(prevEntry.prerotatedKeyHash == unconfirmedPublicKeyHash, "Public key must match previous prerotated");
            require(prevEntry.twicePrerotatedKeyHash == unconfirmedPrerotatedKeyHash, "Prerotated key must match previous twice prerotated");
        } else if (unconfirmedPrevPublicKeyHash != address(0)) {
            revert("Inception event cannot have a prev_public_key_hash");
        }

        require(unconfirmedHasRelationship || unconfirmedOutputAddress != unconfirmedPrerotatedKeyHash, "Unconfirmed conditions not met");
        require(!confirmingHasRelationship && confirmingOutputAddress == confirmingPrerotatedKeyHash, "Invalid confirming conditions");
        require(unconfirmedPrerotatedKeyHash == confirmingPublicKeyHash, "Sequence mismatch: prerotatedKeyHash != publicKeyHash");
        require(unconfirmedTwicePrerotatedKeyHash == confirmingPrerotatedKeyHash, "Sequence mismatch: twicePrerotatedKeyHash != prerotatedKeyHash");

        keyLogEntries.push(KeyLogEntry({
            twicePrerotatedKeyHash: unconfirmedTwicePrerotatedKeyHash,
            prerotatedKeyHash: unconfirmedPrerotatedKeyHash,
            publicKeyHash: unconfirmedPublicKeyHash,
            prevPublicKeyHash: unconfirmedPrevPublicKeyHash,
            outputAddress: unconfirmedOutputAddress,
            hasRelationship: unconfirmedHasRelationship,
            isOnChain: true,
            flag: KeyEventFlag.UNCONFIRMED
        }));
        uint256 unconfirmedIndex = keyLogEntries.length - 1;

        byPublicKeyHash[unconfirmedPublicKeyHash].push(unconfirmedIndex);
        if (unconfirmedPrevPublicKeyHash != address(0)) {
            byPrevPublicKeyHash[unconfirmedPrevPublicKeyHash].push(unconfirmedIndex);
        }
        if (unconfirmedPrerotatedKeyHash != address(0)) {
            byPrerotatedKeyHash[unconfirmedPrerotatedKeyHash].push(unconfirmedIndex);
        }

        keyLogEntries.push(KeyLogEntry({
            twicePrerotatedKeyHash: confirmingTwicePrerotatedKeyHash,
            prerotatedKeyHash: confirmingPrerotatedKeyHash,
            publicKeyHash: confirmingPublicKeyHash,
            prevPublicKeyHash: confirmingPrevPublicKeyHash,
            outputAddress: confirmingOutputAddress,
            hasRelationship: confirmingHasRelationship,
            isOnChain: true,
            flag: KeyEventFlag.CONFIRMING
        }));
        uint256 confirmingIndex = keyLogEntries.length - 1;

        byPublicKeyHash[confirmingPublicKeyHash].push(confirmingIndex);
        if (confirmingPrevPublicKeyHash != address(0)) {
            byPrevPublicKeyHash[confirmingPrevPublicKeyHash].push(confirmingIndex);
        }
        if (confirmingPrerotatedKeyHash != address(0)) {
            byPrerotatedKeyHash[confirmingPrerotatedKeyHash].push(confirmingIndex);
        }

        emit KeyLogRegistered(unconfirmedPublicKeyHash, unconfirmedIndex);
        emit KeyLogRegistered(confirmingPublicKeyHash, confirmingIndex);
        emit KeyRotated(confirmingPublicKeyHash, confirmingIndex);
    }

    function validateTransaction(
        bytes memory publicKey,
        address prerotatedKeyHash,
        address twicePrerotatedKeyHash,
        address prevPublicKeyHash,
        address outputAddress,
        bool hasRelationship
    ) external view returns (KeyEventFlag) {
        (KeyLogEntry memory lastEntry, bool hasEntries) = getLatestChainEntry(publicKey);
        address publicKeyHash = address(uint160(uint256(keccak256(publicKey))));

        if (!hasEntries && prevPublicKeyHash == address(0)) {
            require(!hasRelationship && outputAddress == prerotatedKeyHash, "Invalid inception");
            return KeyEventFlag.INCEPTION;
        }

        if (hasEntries) {
            require(lastEntry.isOnChain, "Previous entry must be on-chain");
            require(lastEntry.publicKeyHash == prevPublicKeyHash, "Prev public key mismatch");
            require(lastEntry.prerotatedKeyHash == publicKeyHash, "Public key mismatch");
            require(lastEntry.twicePrerotatedKeyHash == prerotatedKeyHash, "Prerotated key must match previous twice prerotated");
        } else if (prevPublicKeyHash != address(0)) {
            revert("Inception event cannot have a prev_public_key_hash");
        }

        if (hasRelationship || outputAddress != prerotatedKeyHash) {
            return KeyEventFlag.UNCONFIRMED;
        } else {
            require(!hasRelationship && outputAddress == prerotatedKeyHash, "Invalid confirming");
            return KeyEventFlag.CONFIRMING;
        }
    }


    function getAddressFromPublicKey(bytes memory publicKey) public pure returns (address) {
        require(publicKey.length == 64, "Public key must be 64 bytes");
        bytes32 hash = keccak256(publicKey);
        return address(uint160(uint256(hash)));
    }

    function buildFromPublicKey(bytes memory publicKey) public view returns (KeyLogEntry[] memory) {
        address publicKeyHash = getAddressFromPublicKey(publicKey);
        KeyLogEntry[] memory log = new KeyLogEntry[](100); // Adjust size based on expected max log length
        uint256 logIndex = 0;

        // Step 1: Find the inception by traversing backward using byPublicKeyHash and byPrevPublicKeyHash
        address currentAddress = publicKeyHash;
        KeyLogEntry memory inception;
        bool foundInception = false;

        while (true) {
            uint256[] memory indices = byPublicKeyHash[currentAddress];
            if (indices.length == 0) {
                // Check if this address is a prevPublicKeyHash in another entry
                indices = byPrevPublicKeyHash[currentAddress];
                if (indices.length == 0) {
                    break; // No entries found in either mapping, stop traversal
                }
                KeyLogEntry memory entry = keyLogEntries[indices[indices.length - 1]];
                currentAddress = entry.publicKeyHash; // Move to the publicKeyHash of this entry
                continue;
            }

            KeyLogEntry memory entry = keyLogEntries[indices[indices.length - 1]];
            if (entry.prevPublicKeyHash == address(0)) {
                inception = entry;
                foundInception = true;
                break;
            }

            currentAddress = entry.prevPublicKeyHash;
        }

        // Step 2: Build the log forward from inception using byPublicKeyHash and byPrerotatedKeyHash
        if (foundInception) {
            log[logIndex] = inception;
            logIndex++;
            currentAddress = inception.prerotatedKeyHash;

            while (true) {
                uint256[] memory indices = byPublicKeyHash[currentAddress];
                if (indices.length == 0) {
                    break;
                } else {
                    KeyLogEntry memory entry = keyLogEntries[indices[indices.length - 1]];
                    log[logIndex] = entry;
                    logIndex++;
                    currentAddress = entry.prerotatedKeyHash;
                }

                if (logIndex >= log.length) {
                    break; // Prevent overflow
                }
            }
        }

        // Trim the array to the actual size
        KeyLogEntry[] memory result = new KeyLogEntry[](logIndex);
        for (uint256 i = 0; i < logIndex; i++) {
            result[i] = log[i];
        }

        return result;
    }

    function getCurrentIndex(bytes memory publicKey) public view returns (uint256) {
        KeyLogEntry[] memory log = buildFromPublicKey(publicKey);
        return log.length;
    }

    function getPreviousEntry(bytes memory publicKey) public view returns (KeyLogEntry memory, bool) {
        uint256[] memory indices = byPrerotatedKeyHash[getAddressFromPublicKey(publicKey)];
        if (indices.length == 0) {
            KeyLogEntry memory emptyEntry;
            return (emptyEntry, false);
        }

        KeyLogEntry memory currentEntry = keyLogEntries[indices[indices.length - 1]];

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

    function getLatestEntry(address publicKeyHash) public view returns (KeyLogEntry memory, bool) {
        uint256[] memory indices = byPublicKeyHash[publicKeyHash];
        if (indices.length == 0) {
            KeyLogEntry memory emptyEntry;
            return (emptyEntry, false);
        }
        return (keyLogEntries[indices[indices.length - 1]], true);
    }

    address public authorizedCaller;
    modifier onlyAuthorized() {
        require(msg.sender == authorizedCaller || msg.sender == owner(), "Not authorized");
        _;
    }

    function setAuthorizedCaller(address _caller) external onlyOwner {
        authorizedCaller = _caller;
    }
}