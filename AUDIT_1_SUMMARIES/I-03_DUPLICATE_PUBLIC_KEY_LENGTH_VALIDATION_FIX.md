# I-03 Fix: Duplicate Public Key Length Validation

## Issue Summary

**Severity:** Informational  
**Status:** FIXED  
**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/475dca683e184a4764fd398291bfdc2182266785

The `registerKeyPairWithTransfer` function validates public key length multiple times, creating redundant checks that will never catch new issues.

## Problem Details

In `Bridge::registerKeyPairWithTransfer`, the public key length is validated more than once:

### Redundant Check 1 (Line 515)

First, the contract calls:

```solidity
address unconfirmedPublicKey = getAddressFromPublicKey(ctx.unconfirmed.publicKey);
```

Inside `Bridge::getAddressFromPublicKey`, the length is already checked:

```solidity
function getAddressFromPublicKey(bytes memory publicKey) public pure returns (address) {
    if (publicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKey();
    // ...
}
```

Later in the same function, the code checks the length again:

```solidity
if (ctx.unconfirmed.publicKey.length != PUBLIC_KEY_LENGTH)
    revert InvalidPublicKey();
```

**Issue:** Since `getAddressFromPublicKey` already reverts if the length is incorrect, this additional check is unnecessary and will never catch anything new.

### Redundant Check 2 (Line 521)

Similarly, for the confirming public key:

```solidity
if (ctx.confirming.publicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKey();
if (!_verifySignature(confirmingHash, ctx.confirmingSignature, getAddressFromPublicKey(ctx.confirming.publicKey))) {
```

The second line calls `getAddressFromPublicKey(ctx.confirming.publicKey)`, which already validates the length, making the first check redundant.

## Solution Implemented

### Changes Made

Removed both duplicate length validations:

**Line 515 - Unconfirmed Key Check:**

```solidity
// REMOVED:
if (ctx.unconfirmed.publicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKey();
```

**Line 521 - Confirming Key Check:**

```solidity
// REMOVED:
if (ctx.confirming.publicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKey();
```

The validation is now handled exclusively by `getAddressFromPublicKey`, which is called for both keys:

- Line 511: `getAddressFromPublicKey(ctx.unconfirmed.publicKey)` - validates unconfirmed key
- Line 517: `getAddressFromPublicKey(ctx.unconfirmed.publicKey)` - validates again during signature verification
- Line 520: `getAddressFromPublicKey(ctx.confirming.publicKey)` - validates confirming key

## Files Modified

- `contracts/Bridge.sol` (Lines 515, 521)
- `contracts/BridgeUpgrade.sol` (Lines 515, 521)

## Impact

### Before Fix:

- ❌ Duplicate validation checks
- ❌ Unnecessary gas cost for redundant checks
- ⚠️ Less maintainable code with scattered validation logic

### After Fix:

- ✅ Single point of validation in `getAddressFromPublicKey`
- ✅ Reduced gas costs
- ✅ More maintainable code
- ✅ No behavioral change (validation still occurs, just not redundantly)

## Compilation Status

```
Compiled 2 Solidity files successfully (evm target: cancun)
```

All contracts compile successfully with no errors.
