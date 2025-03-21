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

    mapping(address => KeyLogEntry[]) public keyLogs;

    event KeyLogRegistered(address indexed user, uint256 entryCount);
    event KeyRotated(address indexed user, uint256 newIndex);

    constructor() Ownable(msg.sender) {}

    function registerKeyLog(
        address user,
        address publicKeyHash,
        address prerotatedKeyHash,
        address twicePrerotatedKeyHash,
        address prevPublicKeyHash,
        address outputAddress,
        bool hasRelationship
    ) external onlyAuthorized {
        KeyLogEntry[] storage entries = keyLogs[user];
        uint256 currentIndex = entries.length > 0 ? getCurrentIndex(user) : 0;

        if (currentIndex > 0) {
            KeyLogEntry memory prevEntry = entries[currentIndex - 1];
            require(prevEntry.isOnChain, "Previous entry must be on-chain");
            require(prevEntry.publicKeyHash == prevPublicKeyHash, "Invalid prev public key hash");
            require(prevEntry.prerotatedKeyHash == publicKeyHash, "Public key must match previous prerotated");
            require(prevEntry.twicePrerotatedKeyHash == prerotatedKeyHash, "Prerotated key must match previous twice prerotated");
        } else if (prevPublicKeyHash != address(0)) {
            revert("Inception event cannot have a prev_public_key_hash");
        }

        KeyEventFlag flag;
        if (currentIndex == 0 && prevPublicKeyHash == address(0)) {
            require(!hasRelationship && outputAddress == prerotatedKeyHash, "Invalid inception");
            flag = KeyEventFlag.INCEPTION;
        } else if (hasRelationship || outputAddress != prerotatedKeyHash) {
            flag = KeyEventFlag.UNCONFIRMED;
        } else {
            require(!hasRelationship && outputAddress == prerotatedKeyHash, "Invalid confirming");
            flag = KeyEventFlag.CONFIRMING;
        }

        entries.push(KeyLogEntry({
            twicePrerotatedKeyHash: twicePrerotatedKeyHash,
            prerotatedKeyHash: prerotatedKeyHash,
            publicKeyHash: publicKeyHash,
            prevPublicKeyHash: prevPublicKeyHash,
            outputAddress: outputAddress,
            hasRelationship: hasRelationship,
            isOnChain: flag == KeyEventFlag.INCEPTION || flag == KeyEventFlag.CONFIRMING,
            flag: flag
        }));

        emit KeyLogRegistered(user, entries.length);
        if (flag != KeyEventFlag.UNCONFIRMED) {
            emit KeyRotated(user, currentIndex + 1);
        }
    }

    function registerKeyLogPair(
        address user,
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
        KeyLogEntry[] storage entries = keyLogs[user];
        uint256 currentIndex = entries.length > 0 ? getCurrentIndex(user) : 0;

        if (currentIndex > 0) {
            KeyLogEntry memory prevEntry = entries[currentIndex - 1];
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

        entries.push(KeyLogEntry({
            twicePrerotatedKeyHash: unconfirmedTwicePrerotatedKeyHash,
            prerotatedKeyHash: unconfirmedPrerotatedKeyHash,
            publicKeyHash: unconfirmedPublicKeyHash,
            prevPublicKeyHash: unconfirmedPrevPublicKeyHash,
            outputAddress: unconfirmedOutputAddress,
            hasRelationship: unconfirmedHasRelationship,
            isOnChain: true,
            flag: KeyEventFlag.UNCONFIRMED
        }));

        entries.push(KeyLogEntry({
            twicePrerotatedKeyHash: confirmingTwicePrerotatedKeyHash,
            prerotatedKeyHash: confirmingPrerotatedKeyHash,
            publicKeyHash: confirmingPublicKeyHash,
            prevPublicKeyHash: confirmingPrevPublicKeyHash,
            outputAddress: confirmingOutputAddress,
            hasRelationship: confirmingHasRelationship,
            isOnChain: true,
            flag: KeyEventFlag.CONFIRMING
        }));

        emit KeyLogRegistered(user, entries.length - 1);
        emit KeyLogRegistered(user, entries.length);
        emit KeyRotated(user, entries.length);
    }

    function validateTransaction(
        address user,
        bytes memory publicKey,
        address prerotatedKeyHash,
        address twicePrerotatedKeyHash,
        address prevPublicKeyHash,
        address outputAddress,
        bool hasRelationship
    ) external view returns (KeyEventFlag) {
        address publicKeyHash = address(uint160(uint256(keccak256(publicKey))));
        KeyLogEntry[] memory entries = keyLogs[user];

        if (entries.length == 0) {
            require(prevPublicKeyHash == address(0), "Inception event cannot have a prev_public_key_hash");
            require(!hasRelationship && outputAddress == prerotatedKeyHash, "Invalid inception");
            return KeyEventFlag.INCEPTION;
        }

        uint256 currentIndex = getCurrentIndex(user);
        require(currentIndex < entries.length, "Key log exhausted");

        if (currentIndex > 0) {
            KeyLogEntry memory prevEntry = entries[currentIndex - 1];
            require(prevEntry.isOnChain, "Previous entry must be on-chain");
            require(prevEntry.publicKeyHash == prevPublicKeyHash, "Prev public key mismatch");
            require(prevEntry.prerotatedKeyHash == publicKeyHash, "Public key mismatch");
            require(prevEntry.twicePrerotatedKeyHash == prerotatedKeyHash, "Prerotated key must match previous twice prerotated");
        } else if (prevPublicKeyHash != address(0)) {
            revert("Inception event cannot have a prev_public_key_hash");
        }

        if (currentIndex == 0 && prevPublicKeyHash == address(0)) {
            require(!hasRelationship && outputAddress == prerotatedKeyHash && !entries[currentIndex].isOnChain, "Invalid inception");
            return KeyEventFlag.INCEPTION;
        } else if (hasRelationship || outputAddress != prerotatedKeyHash) {
            return KeyEventFlag.UNCONFIRMED;
        } else {
            require(!hasRelationship && outputAddress == prerotatedKeyHash, "Invalid confirming");
            return KeyEventFlag.CONFIRMING;
        }
    }

    function getCurrentIndex(address user) public view returns (uint256) {
        KeyLogEntry[] memory entries = keyLogs[user];
        for (uint256 i = 0; i < entries.length; i++) {
            if (!entries[i].isOnChain) {
                return i;
            }
        }
        return entries.length;
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