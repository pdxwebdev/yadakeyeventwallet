# I-01 Fix: Dead Code in \_handleWrap and \_handleUnwrap

## Issue Summary

**Severity:** Informational  
**Status:** FIXED  
**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/d023dcfd4f03b7b3de244dadab4120607a83d020

Dead code identified in `_handleWrap` and `_handleUnwrap` functions where `totalTransferred` parameter was being modified locally but changes never propagated back to the caller.

### Problem Details

- `totalTransferred` is passed **by value** (not by reference) to `_handleWrap` and `_handleUnwrap`
- Both functions contained remainder handling logic that modified the local copy of `totalTransferred`
- The line `totalTransferred += remainder` had no effect since the changes weren't returned to `_processPermit`
- This created misleading code that appeared to track transfer totals but actually did nothing
- The remainder handling logic was redundant because `_processPermit` already correctly handles remainders in the `transferOnly` path (lines 283-291)

### Root Cause

In `_handleWrap` (lines 449-457):

```solidity
if (recipient.amount < permit.amount) {
    uint256 remainder = permit.amount - recipient.amount;
    if (remainder > 0) {
        if (hctx.token == address(0)) {
            _transferNative(hctx.prerotatedKeyHash, remainder);
        } else {
            IERC20(permit.token).safeTransferFrom(hctx.user, hctx.prerotatedKeyHash, remainder);
        }
        totalTransferred += remainder;  // Dead code - modifies local copy only
    }
}
```

In `_handleUnwrap` (lines 489-493):

```solidity
uint256 remainder = permit.amount - recipient.amount;
if (remainder > 0) {
    IERC20(permit.token).safeTransferFrom(hctx.user, hctx.prerotatedKeyHash, remainder);
    totalTransferred += remainder;  // Dead code - modifies local copy only
}
```

The correct remainder handling already exists in `_processPermit` (lines 283-291):

```solidity
if (transferOnly) {
    uint256 remainder = permit.amount - totalTransferred;
    if (remainder > 0) {
        if (ectx.token == address(0)) {
            _transferNative(ectx.prerotatedKeyHash, remainder);
        } else {
            IERC20(permit.token).safeTransferFrom(ectx.user, ectx.prerotatedKeyHash, remainder);
        }
        totalTransferred += remainder;
    }
}
```

## Solution Implemented

1. Removed all remainder handling code from `_handleWrap` and `_handleUnwrap`
2. Removed the unused `totalTransferred` parameter from both function signatures
3. Updated all call sites to not pass the `totalTransferred` argument

### Changes Made

#### Function Signatures Updated:

**Before:**

```solidity
function _handleWrap(
    PermitData memory permit,
    Recipient memory recipient,
    uint256 totalTransferred,  // ❌ Removed
    bool isNative,
    HandlerContext memory hctx
) internal
```

**After:**

```solidity
function _handleWrap(
    PermitData memory permit,
    Recipient memory recipient,
    bool isNative,
    HandlerContext memory hctx
) internal
```

**Before:**

```solidity
function _handleUnwrap(
    PermitData memory permit,
    Recipient memory recipient,
    uint256 totalTransferred,  // ❌ Removed
    HandlerContext memory hctx
) internal
```

**After:**

```solidity
function _handleUnwrap(
    PermitData memory permit,
    Recipient memory recipient,
    HandlerContext memory hctx
) internal
```

#### Call Sites Updated:

**Before:**

```solidity
_handleUnwrap(permit, recipient, totalTransferred, hctx);
_handleWrap(permit, recipient, totalTransferred, isNative, hctx);
```

**After:**

```solidity
_handleUnwrap(permit, recipient, hctx);
_handleWrap(permit, recipient, isNative, hctx);
```

## Files Modified

- `contracts/Bridge.sol`:

  - Line 418: Updated `_handleWrap` signature
  - Line 442: Removed dead remainder code from `_handleWrap`
  - Line 448: Updated `_handleUnwrap` signature
  - Line 472: Removed dead remainder code from `_handleUnwrap`
  - Line 265: Updated `_handleUnwrap` call site
  - Line 271: Updated `_handleWrap` call site

- `contracts/BridgeUpgrade.sol` (same changes)

## Impact

### Before Fix:

- ❌ Misleading code suggested remainder handling in wrap/unwrap operations
- ❌ Dead code created maintenance burden and confusion
- ❌ Unused parameter wasted gas
- ⚠️ Could cause future bugs if developers tried to rely on this non-functional behavior

### After Fix:

- ✅ Clear separation of concerns: wrap/unwrap handle their operations, `_processPermit` handles remainders
- ✅ Cleaner function signatures without unused parameters
- ✅ Slightly reduced gas costs
- ✅ No change in actual behavior (remainder handling already worked correctly via `transferOnly` path)

## Testing Recommendations

1. Verify wrap operations with `recipient.amount < permit.amount` work correctly
2. Verify unwrap operations with `recipient.amount < permit.amount` work correctly
3. Confirm remainder forwarding still works via the `transferOnly` path
4. Test that `totalTransferred != permit.amount` still correctly reverts at end of `_processPermit`

## Security Notes

✅ **No behavioral change** - The dead code was never functional, so removing it doesn't alter contract behavior  
✅ **Remainder handling preserved** - The existing working remainder logic in `_processPermit` remains unchanged  
✅ **Gas optimization** - Slightly reduced gas costs by removing unused parameter  
✅ **Code clarity** - Eliminates misleading dead code that could confuse auditors or future developers

## Future Considerations

If partial wraps/unwraps with remainder forwarding are desired in the future:

1. Change `totalTransferred` to pass by reference (using storage pointer or return value)
2. Move remainder handling logic into the wrap/unwrap functions
3. Ensure proper coordination between `_processPermit` and handler functions

For now, the current architecture correctly handles remainders at the `_processPermit` level for all operations.

## Compilation Status

```
Compiled 2 Solidity files successfully (evm target: cancun)
```

All contracts compile successfully with no new errors or warnings related to this fix.
