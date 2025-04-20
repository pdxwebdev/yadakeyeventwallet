/*
SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

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
    mapping(address => uint256[]) public byTwicePrerotatedKeyHash;

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
    ) external {
        // Step 1: Validate using validateTransaction for a single entry
        (KeyEventFlag flag, ) = validateTransaction(
            publicKey,
            publicKeyHash,
            prerotatedKeyHash,
            twicePrerotatedKeyHash,
            prevPublicKeyHash,
            outputAddress,
            hasRelationship,
            false, // isPair = false
            address(0), address(0), address(0), address(0), false // Dummy pair params
        );

        // Step 2: Apply state changes after validation
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
        if (twicePrerotatedKeyHash != address(0)) {
            byTwicePrerotatedKeyHash[twicePrerotatedKeyHash].push(newIndex);
        }

        // Step 3: Emit events
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
        // Step 1: Validate both entries in a single call
        (KeyEventFlag unconfirmedFlag, KeyEventFlag confirmingFlag) = validateTransaction(
            publicKey,
            unconfirmedPublicKeyHash,
            unconfirmedPrerotatedKeyHash,
            unconfirmedTwicePrerotatedKeyHash,
            unconfirmedPrevPublicKeyHash,
            unconfirmedOutputAddress,
            unconfirmedHasRelationship,
            true, // isPair = true
            confirmingPublicKeyHash,
            confirmingPrerotatedKeyHash,
            confirmingPrevPublicKeyHash,
            confirmingOutputAddress,
            confirmingHasRelationship
        );

        // Step 2: Apply state changes after validation
        keyLogEntries.push(KeyLogEntry({
            twicePrerotatedKeyHash: unconfirmedTwicePrerotatedKeyHash,
            prerotatedKeyHash: unconfirmedPrerotatedKeyHash,
            publicKeyHash: unconfirmedPublicKeyHash,
            prevPublicKeyHash: unconfirmedPrevPublicKeyHash,
            outputAddress: unconfirmedOutputAddress,
            hasRelationship: unconfirmedHasRelationship,
            isOnChain: true, // Pair entries are always on-chain
            flag: unconfirmedFlag
        }));
        uint256 unconfirmedIndex = keyLogEntries.length - 1;

        byPublicKeyHash[unconfirmedPublicKeyHash].push(unconfirmedIndex);
        if (unconfirmedPrevPublicKeyHash != address(0)) {
            byPrevPublicKeyHash[unconfirmedPrevPublicKeyHash].push(unconfirmedIndex);
        }
        if (unconfirmedPrerotatedKeyHash != address(0)) {
            byPrerotatedKeyHash[unconfirmedPrerotatedKeyHash].push(unconfirmedIndex);
        }
        if (unconfirmedTwicePrerotatedKeyHash != address(0)) {
            byTwicePrerotatedKeyHash[unconfirmedTwicePrerotatedKeyHash].push(unconfirmedIndex);
        }

        keyLogEntries.push(KeyLogEntry({
            twicePrerotatedKeyHash: confirmingTwicePrerotatedKeyHash,
            prerotatedKeyHash: confirmingPrerotatedKeyHash,
            publicKeyHash: confirmingPublicKeyHash,
            prevPublicKeyHash: confirmingPrevPublicKeyHash,
            outputAddress: confirmingOutputAddress,
            hasRelationship: confirmingHasRelationship,
            isOnChain: true, // Pair entries are always on-chain
            flag: confirmingFlag
        }));
        uint256 confirmingIndex = keyLogEntries.length - 1;

        byPublicKeyHash[confirmingPublicKeyHash].push(confirmingIndex);
        if (confirmingPrevPublicKeyHash != address(0)) {
            byPrevPublicKeyHash[confirmingPrevPublicKeyHash].push(confirmingIndex);
        }
        if (confirmingPrerotatedKeyHash != address(0)) {
            byPrerotatedKeyHash[confirmingPrerotatedKeyHash].push(confirmingIndex);
        }
        if (confirmingTwicePrerotatedKeyHash != address(0)) {
            byTwicePrerotatedKeyHash[confirmingTwicePrerotatedKeyHash].push(confirmingIndex);
        }

        // Step 3: Emit events
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
        bool hasRelationship,
        bool isPair,
        address confirmingPublicKeyHash,
        address confirmingPrerotatedKeyHash,
        address confirmingPrevPublicKeyHash,
        address confirmingOutputAddress,
        bool confirmingHasRelationship
    ) public view returns (KeyEventFlag, KeyEventFlag) {
        (KeyLogEntry memory lastEntry, bool hasEntries) = getLatestChainEntry(publicKey);
        address computedPublicKeyHash = address(uint160(uint256(keccak256(publicKey))));

        // Validate previous entry if it exists (applies to the unconfirmed entry in a pair)
        if (hasEntries) {
            require(lastEntry.isOnChain, "Previous entry must be on-chain");
            require(lastEntry.publicKeyHash == prevPublicKeyHash, "Prev public key mismatch");
            require(lastEntry.prerotatedKeyHash == computedPublicKeyHash, "Public key mismatch");
            require(lastEntry.twicePrerotatedKeyHash == prerotatedKeyHash, "Prerotated key must match previous twice prerotated");
        } else if (prevPublicKeyHash != address(0)) {
            revert("Inception event cannot have a prev_public_key_hash");
        }

        // Ensure the provided publicKeyHash matches the computed one
        require(computedPublicKeyHash == publicKeyHash, "Public key hash mismatch");

        // Determine the flag for the first (or only) entry
        KeyEventFlag firstFlag;
        if (!hasEntries && prevPublicKeyHash == address(0)) {
            require(!hasRelationship && outputAddress == prerotatedKeyHash, "Invalid inception");
            firstFlag = KeyEventFlag.INCEPTION;
        } else if (hasRelationship || outputAddress != prerotatedKeyHash) {
            firstFlag = KeyEventFlag.UNCONFIRMED;
        } else {
            require(!hasRelationship && outputAddress == prerotatedKeyHash, "Invalid confirming");
            firstFlag = KeyEventFlag.CONFIRMING;
        }

        // If not a pair, return only the first flag
        if (!isPair) {
            return (firstFlag, KeyEventFlag.UNCONFIRMED); // Second flag is unused
        }

        // Pair case: Validate the confirming entry and sequence
        require(twicePrerotatedKeyHash == confirmingPrerotatedKeyHash, "Sequence mismatch: twicePrerotatedKeyHash != confirmingPrerotatedKeyHash");
        require(hasRelationship || outputAddress != prerotatedKeyHash, "Unconfirmed conditions not met"); // Ensure first is UNCONFIRMED
        require(!confirmingHasRelationship && confirmingOutputAddress == confirmingPrerotatedKeyHash, "Invalid confirming conditions");
        require(prerotatedKeyHash == confirmingPublicKeyHash, "Sequence mismatch: prerotatedKeyHash != publicKeyHash");
        require(confirmingPrevPublicKeyHash == publicKeyHash, "Confirming prevPublicKeyHash must match unconfirmed publicKeyHash");

        // For pairs, firstFlag must be UNCONFIRMED, and confirming is always CONFIRMING
        return (KeyEventFlag.UNCONFIRMED, KeyEventFlag.CONFIRMING);
    }

    function getAddressFromPublicKey(bytes memory publicKey) public pure returns (address) {
        require(publicKey.length == 64, "Public key must be 64 bytes");
        bytes32 hash = keccak256(publicKey);
        return address(uint160(uint256(hash)));
    }

    // Add this function to KeyLogRegistry.sol
    function getLatestEntryByPrerotatedKeyHash(address prerotatedKeyHash) public view returns (KeyLogEntry memory, bool) {
        uint256[] memory indices = byPrerotatedKeyHash[prerotatedKeyHash];
        if (indices.length == 0) {
            indices = byTwicePrerotatedKeyHash[prerotatedKeyHash];
            if (indices.length == 0) {
                KeyLogEntry memory emptyEntry;
                return (emptyEntry, false);
            }
        }
        KeyLogEntry memory entry = keyLogEntries[indices[indices.length - 1]];
        address currentAddress = entry.prerotatedKeyHash;
        indices = byPublicKeyHash[currentAddress];
        require(indices.length == 0, "Not the latest key rotation.");
        return (entry, true);
    }

    function buildFromPublicKey(bytes memory publicKey) public view returns (KeyLogEntry[] memory) {
        address publicKeyHash = getAddressFromPublicKey(publicKey);
        KeyLogEntry[] memory log = new KeyLogEntry[](100);
        uint256 logIndex = 0;

        address currentAddress = publicKeyHash;
        KeyLogEntry memory inception;
        bool foundInception = false;

        KeyLogEntry memory entry;
        while (true) {
            uint256[] memory indices = byPublicKeyHash[currentAddress];
            if(indices.length == 0) {
                indices = byPrerotatedKeyHash[currentAddress];
                if(indices.length == 0) {
                    KeyLogEntry[] memory emptyLog = new KeyLogEntry[](0);
                    return emptyLog;
                }
            }

            entry = keyLogEntries[indices[indices.length - 1]];
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
                uint256[] memory indices = byPublicKeyHash[currentAddress];
                if (indices.length == 0) {
                    break;
                } else {
                    entry = keyLogEntries[indices[indices.length - 1]];
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