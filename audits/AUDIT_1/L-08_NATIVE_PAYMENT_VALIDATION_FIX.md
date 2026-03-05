# Native BNB Payment Validation Fix

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/cc519417c1b9d9ce18aeac7480af6462eb647642

## Issue
The `_executePermits` function in Bridge.sol validated the structural presence of a native permit (token == address(0)) but did not enforce actual BNB payment. Users could bypass the mandatory payment requirement by providing a zero-amount no-op permit:

```solidity
{ token: address(0), amount: 0, deadline: 0, v: 0, r: 0, s: 0, recipients: [] }
```

The strict accounting check `(totalTransferred != permit.amount)` would pass since `0 == 0`.

## Solution
Added explicit validation to require msg.value > 0 after confirming a native permit exists:

```solidity
if (!hasNativeTransfer) revert MissingPermit();
require(msg.value > 0, "Native BNB payment required");
```

This ensures both:
1. A native permit must be present in the permits array
2. Actual BNB payment must accompany the transaction

## Files Changed
- **contracts/Bridge.sol**: Added msg.value validation at line 288
- **contracts/BridgeUpgrade.sol**: Added msg.value validation at line 288
