# Fix: Restrict rotateToPublicKey with onlyOwner Modifier

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/873e07a01e4ebf11baf10ef6b2ac731c5ed31462

## Overview
Added access control to prevent unauthorized ownership rotations.

## Changes

### Files Modified
- [Bridge.sol](contracts/Bridge.sol) (Line 764)
- [BridgeUpgrade.sol](contracts/BridgeUpgrade.sol) (Line 764)

### Implementation
Added `onlyOwner` modifier to `rotateToPublicKey()` function:

```solidity
function rotateToPublicKey(bytes memory existingOwnerPublicKey) external onlyOwner {
    // ... existing validation and execution
}
```

## Security Impact
- **Prevents permissionless rotation** – Only the current owner can trigger key rotations
- **Protects fee routing** – Prevents unauthorized state changes if owner-controlled fee mechanisms are introduced
- **Maintains validation** – Public key verification and explicit `require(exists, "Key log not initialized")` remain in place

## Status
✅ Explicit revert check (`require(exists, "Key log not initialized")`) already present in original code
