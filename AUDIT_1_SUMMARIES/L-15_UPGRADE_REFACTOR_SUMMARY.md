# Upgrade Refactor Summary

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/958bfb66aa15f2fac0389bb3b6846f72d5abcc64

## Overview

Refactored contract upgrade system to enforce key rotation for all upgrades and enable atomic multi-contract upgrades.

## Key Changes

### 1. Disabled Direct `_authorizeUpgrade`

**Files:** All contract implementations

- Bridge.sol, BridgeUpgrade.sol: `revert("Must use upgradeWithKeyRotation")`
- KeyLogRegistry.sol, WrappedToken.sol, Factory, MockERC20: `revert("Upgrades disabled")`
- **Impact:** Eliminates unilateral owner upgrade capability

### 2. Extended `UpgradeContext` Struct

**Changed from:**

```solidity
struct UpgradeContext {
    address newImplementation;
    PermitData[] permits;
    Params unconfirmed;
    Params confirming;
}
```

**Changed to:**

```solidity
struct UpgradeContext {
    address bridgeImplementation;
    address keyLogRegistryImplementation;
    address wrappedTokenBeaconImplementation;
    address wrappedTokenFactoryImplementation;
    PermitData[] permits;
    Params unconfirmed;
    Params confirming;
}
```

### 3. Atomic Multi-Contract Upgrades

`upgradeWithKeyRotation()` now upgrades all Bridge-owned contracts in sequence:

1. **Bridge** - via UUPS `upgradeToAndCall()`
2. **KeyLogRegistry** - via UUPS `upgradeToAndCall()`
3. **WrappedTokenBeacon** - all wrapped tokens auto-update via beacon proxy
4. **WrappedTokenFactory** - via UUPS `upgradeToAndCall()`

Each upgrade is conditional (checks if implementation != address(0))

### 4. State & Interface Updates

- Added `wrappedTokenFactory` state variable to Bridge contracts
- Added `setWrappedTokenFactory()` setter function
- Updated `initialize()` to accept factory address parameter
- Added custom interfaces: `IUpgradeableBeacon`, `IUpgradeable`
- Imported `draft-IERC1822.sol` and `IBeacon.sol` from OpenZeppelin

### 5. Signature Hash Updated

Hash now includes all 4 implementation addresses:

```solidity
keccak256(abi.encode(
    ctx.bridgeImplementation,
    ctx.keyLogRegistryImplementation,
    ctx.wrappedTokenBeaconImplementation,
    ctx.wrappedTokenFactoryImplementation,
    params,
    nonce
))
```

## Security Benefits

✅ **No Unilateral Upgrades:** Compromised owner cannot upgrade contracts directly  
✅ **Atomic Consistency:** All owned contracts upgrade together, preventing version mismatches  
✅ **Key Rotation Required:** Every upgrade tied to confirmed key rotation event  
✅ **Cryptographic Proof:** Requires valid signatures from both unconfirmed and confirming keys  
✅ **Transparent Chain:** All upgrades immutably recorded in key log

## Migration Required

Deployment scripts must:

1. Pass `wrappedTokenFactory` address to Bridge initialization
2. Provide all 4 implementation addresses in `UpgradeContext` when upgrading
3. Update signature generation to include all 4 implementations

## Files Modified

- `contracts/Bridge.sol`
- `contracts/BridgeUpgrade.sol`
- `contracts/KeyLogRegistry.sol`, `KeyLogRegistryUpgrade.sol`
- `contracts/WrappedToken.sol`, `WrappedTokenUpgrade.sol`
- `contracts/WrappedTokenFactory.sol`
- `contracts/MockERC20.sol`, `MockERC20Upgrade.sol`
