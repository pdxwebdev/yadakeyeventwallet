# Fix for Regression in KeyLogRegistryUpgrade

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/100c1fc1621ea02cb3f70d40873ff1e4409eb551

## Files Modified

- `KeyLogRegistryUpgrade.sol`
- `KeyLogRegistry.sol`

## Changes Made

Moved the computation of `confirmingPublicKeyHash` from being unconditional to only executing within the `isPair` code path.

**validateTransaction() function:**

**Before:**

```solidity
address confirmingPublicKeyHash = getAddressFromPublicKey(confirming.publicKey);
// ... validation logic ...
if (!isPair) {
    // early return
}
// ... pair-specific validation ...
```

**After:**

```solidity
address confirmingPublicKeyHash;  // only computed for pairs
// ... validation logic ...
if (!isPair) {
    // early return
}
confirmingPublicKeyHash = getAddressFromPublicKey(confirming.publicKey);
// ... pair-specific validation ...
```

## Why This Fixes the Issue

The regression occurred because `registerKeyLog()` (single registration) passes an empty `confirming.publicKey` ("") with `isPair = false`. Previously, the code unconditionally called `getAddressFromPublicKey("")` which reverts with "Public key must be 64 bytes", breaking all new user onboarding.

Now, for single registrations, the early return prevents the problematic call. For pair registrations, `confirmingPublicKeyHash` is computed after the check, allowing the C-02 fix to remain intact.

## Impact

- ✅ Single key registration (`registerKeyLog()`) now works correctly
- ✅ Pair key registration (`registerKeyLogPair()`) continues to work
- ✅ New user onboarding is no longer broken
