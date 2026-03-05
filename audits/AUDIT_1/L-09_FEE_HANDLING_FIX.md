# Fee Handling Fix

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/d9f10d56721c4453259070706827737720688938

## Issue
The `_handleMint` function calculated a `tokenFee` but never transferred it to the `feeCollector` or owner, resulting in lost fees.

## Solution
Added a conditional mint of the calculated fee to the contract owner:

```solidity
if (tokenFee > 0) IMockERC20(permit.token).mint(owner(), tokenFee);
```

## Files Modified
- **Bridge.sol** (lines 366-377): Added fee minting to owner
- **BridgeUpgrade.sol** (lines 366-377): Added fee minting to owner

## Changes
The `_handleMint` function now:
1. Calculates the token fee as before
2. Mints the net amount (excluding fee) to the recipient
3. Mints the fee to the contract owner (if > 0)

This ensures fees are properly collected and not lost in the minting process.
