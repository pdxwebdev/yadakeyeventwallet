# L-16 Fix: No Refund of Excess msg.value in Native BNB Operations

## Issue Summary

**Severity:** Low  
**Status:** FIXED  
**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/9e23ba02802f02bb8158e0a2a359e0788e69e2c2

In native BNB operations, if `msg.value` exceeds the total BNB needed for the operation, the excess remains in the bridge's balance permanently. There is no refund mechanism anywhere in the transaction flow.

### Problem Details

- The validation at line 395 uses: `if (msg.value < expectedNativeProvided) revert InsufficientNativeProvided();`
- This check was only preventing **insufficient** payment, not handling **excess** payment
- If a user sends more BNB than needed, the excess gets absorbed by the contract
- The only way to extract BNB from the bridge is `emergencyWithdrawBNB`, which sweeps the **entire** native balance including collateral backing wrapped native tokens
- This creates a fund lock situation where excess deposits cannot be selectively recovered

### Root Cause

The `_executePermits` function:

1. Calculates `expectedNativeProvided` by summing all native token permits
2. Validates that `msg.value >= expectedNativeProvided`
3. **BUT** never handles the case where `msg.value > expectedNativeProvided`

## Solution Implemented

Added automatic refund logic at the end of `_executePermits` function:

```solidity
if (hasNativeTransfer && expectedNativeProvided > 0) {
    if (msg.value < expectedNativeProvided) revert InsufficientNativeProvided();

    // Refund excess native tokens if msg.value > expectedNativeProvided (L-16 fix)
    uint256 excess = msg.value - expectedNativeProvided;
    if (excess > 0) {
        _transferNative(ectx.user, excess);
    }
}
```

### How It Works

1. After validating that `msg.value >= expectedNativeProvided`
2. Calculates excess: `excess = msg.value - expectedNativeProvided`
3. If excess > 0, immediately transfers it back to the transaction sender (`ectx.user`)
4. This ensures users cannot accidentally overpay and lose funds

## Files Modified

- `contracts/Bridge.sol` - Line 393-401
- `contracts/BridgeUpgrade.sol` - Line 393-401 (same fix)

## Transaction Flow After Fix

### Before:

```
User sends 10 BNB
Only 8 BNB needed
Result: 2 BNB permanently stuck in contract
```

### After:

```
User sends 10 BNB
Only 8 BNB needed
Result: 8 BNB used for transaction, 2 BNB refunded to user
```

## Testing Recommendations

1. Test native wrap with `msg.value > required amount`, verify excess is refunded
2. Test native wrap with `msg.value == required amount`, verify no extra refund
3. Test native wrap with `msg.value < required amount`, verify transaction reverts
4. Verify refund is sent to transaction originator, not prerotatedKeyHash
5. Check gas optimization - ensure refund doesn't significantly increase gas costs

## Entry Points Affected

- `registerKeyPairWithTransfer()` - payable function that may receive excess BNB
- Any future payable functions calling `_executePermits()`

## Security Notes

✅ **No unilateral risk introduced** - Refund is only paid to transaction sender (`ectx.user`)  
✅ **No re-entrancy issues** - Using existing `_transferNative()` private function with standard call pattern  
✅ **No state mutations** - Simple value transfer, no contract state modifications  
✅ **Maintains atomicity** - Refund happens within same transaction on success or fails entirely

## Compilation Status

```
Compiled 2 Solidity files successfully (evm target: cancun)
```

All contracts compile without errors.
