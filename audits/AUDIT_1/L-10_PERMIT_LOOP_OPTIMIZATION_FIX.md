# Permit Loop Optimization Fix

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/ad4cb7c13041c48f59ece3cdcdb7c0c9fada6328

## Issue
The `_executePermits` function's loop prematurely exited when checking for mint/burn privileges, preventing full array scan for native transfer detection. This caused valid owner transactions to revert with `MissingPermit()` if permits weren't ordered with the native transfer entry first.

## Solution
Removed early outer loop break while preserving inner loop optimization:
- Changed: `if (permit.token == ectx.token) { ... if (requiresOwner) break; }`
- To: `if (!requiresOwner && permit.token == ectx.token) { ... }`

## Files Modified
- **Bridge.sol** (lines 262-277): Fixed permit loop logic
- **BridgeUpgrade.sol** (lines 262-277): Fixed permit loop logic

## Result
- ✅ Full permits array now always scanned for native transfer
- ✅ Removed misleading `MissingPermit()` error on valid owner transactions
- ✅ Preserved optimization to skip inner loop after `requiresOwner` is found
- ✅ Better separation of two independent concerns
