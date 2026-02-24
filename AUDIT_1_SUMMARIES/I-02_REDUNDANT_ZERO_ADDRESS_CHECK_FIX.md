# I-02 Fix: Redundant Zero Address Checks

## Issue Summary

**Severity:** Informational  
**Status:** FIXED  
**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/529e9f24d74b41ee4096b1864e1d61c5e5866dd3

Two unreachable zero address checks that can never trigger due to prior guards.

## Problem Details

### Location 1: registerKeyPairWithTransfer (Line 524)

Inside the confirming logic, the code first checks that outputAddress is non-zero:

```solidity
if (ctx.confirming.outputAddress != address(0)) {
```

Then inside that same block, it checks again if the address is zero:

```solidity
if (ctx.confirming.outputAddress == address(0)) revert ZeroAddress();
```

**Issue:** This second check can never be true since execution only enters the block when `ctx.confirming.outputAddress != address(0)`. This is dead code.

### Location 2: rotateToPublicKey (Line 828)

The code checks whether the derived owner address is zero:

```solidity
if (existingOwnerAddress == address(0)) revert ZeroAddress();
```

However, this address is obtained from:

```solidity
address existingOwnerAddress = getAddressFromPublicKey(existingOwnerPublicKey);
```

**Issue:** `getAddressFromPublicKey` strictly enforces a 64-byte public key before hashing with keccak256. Getting address(0) would require the hash to end with 20 zero bytes — for a valid 64-byte input, the probability is ~1/2^160, which is practically impossible.

## Solution Implemented

### Changes Made

**Location 1 - registerKeyPairWithTransfer:**

```solidity
// REMOVED:
if (ctx.confirming.outputAddress == address(0)) revert ZeroAddress();
```

**Location 2 - rotateToPublicKey:**

```solidity
// REMOVED:
if (existingOwnerAddress == address(0)) revert ZeroAddress();
```

## Files Modified

- `contracts/Bridge.sol` (Lines 524, 828)
- `contracts/BridgeUpgrade.sol` (Lines 524, 828)

## Impact

### Before Fix:

- ❌ Unreachable dead code
- ❌ Unnecessary gas cost for unreachable checks
- ⚠️ Misleading code that suggests edge cases that cannot occur

### After Fix:

- ✅ Cleaner, more accurate code
- ✅ Slightly reduced gas costs
- ✅ No behavioral change (code was already unreachable)

## Compilation Status

```
Compiled 2 Solidity files successfully (evm target: cancun)
```

All contracts compile successfully with no errors.
