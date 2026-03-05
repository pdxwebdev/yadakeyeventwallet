# Fee-on-Transfer Token Vulnerability Fix

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/ee4968ef236da71bd56cf0321a2a4277b7640803

## Summary

Fixed a critical vulnerability in the bridge's token wrapping mechanism that could lead to under-collateralization when fee-on-transfer tokens are used.

## Vulnerability Description

In the `_handleWrap` function, the bridge was minting wrapped tokens based on the nominal transfer amount without verifying how many original tokens were actually received. If a token applies a transfer tax (fee-on-transfer), the bridge receives fewer tokens than expected but still mints the full nominal amount of wrapped tokens. Over time, this creates a collateral deficit where more wrapped tokens exist than the bridge holds in original tokens.

This is particularly relevant on BSC, where fee-on-transfer tokens (SafeMoon-style) are prevalent.

## Root Cause

```solidity
// BEFORE: Vulnerable code
IERC20(pair.originalToken).safeTransferFrom(
    hctx.user, address(this), recipient.amount - tokenFee
);
if (tokenFee > 0) {
    IERC20(pair.originalToken).safeTransferFrom(
        hctx.user, feeCollector, tokenFee
    );
}
// Mints full nominal amount without accounting for transfer tax
WrappedToken(pair.wrappedToken).mint(
    hctx.prerotatedKeyHash, recipient.amount - tokenFee
);
```

## Solution

Implemented balance-before/after accounting to detect the actual amount received and mint wrapped tokens only for what was actually transferred:

```solidity
// AFTER: Fixed code with balance accounting
uint256 balBefore = IERC20(pair.originalToken).balanceOf(address(this));
IERC20(pair.originalToken).safeTransferFrom(
    hctx.user, address(this), recipient.amount - tokenFee
);
uint256 actualReceived = IERC20(pair.originalToken)
    .balanceOf(address(this)) - balBefore;
if (tokenFee > 0) {
    IERC20(pair.originalToken).safeTransferFrom(
        hctx.user, feeCollector, tokenFee
    );
}
// Mints only the actual received amount
WrappedToken(pair.wrappedToken).mint(
    hctx.prerotatedKeyHash, actualReceived
);
```

## Affected Files

- **contracts/Bridge.sol** - Lines ~394-407
- **contracts/BridgeUpgrade.sol** - Lines ~394-407

## Changes Made

1. Added balance check before token transfer
2. Calculated actual amount received after transfer
3. Updated wrapped token mint amount to use `actualReceived` instead of nominal `recipient.amount - tokenFee`
4. Declared `actualReceived` at function scope to handle both native and non-native token cases:
   - For native tokens: `actualReceived = recipient.amount - tokenFee`
   - For non-native tokens: `actualReceived = balanceAfter - balanceBefore`

## Impact

- **Security**: Prevents under-collateralization of the bridge when fee-on-transfer tokens are registered
- **Collateral Safety**: Ensures wrapped token supply never exceeds the bridge's holdings of original tokens
- **Redemption Guarantee**: All wrapped token holders can fully redeem their tokens

## Testing Recommendations

- Test with standard ERC20 tokens to ensure normal operation
- Test with fee-on-transfer tokens (e.g., simulated SafeMoon-style tokens)
- Verify that wrapped token supply matches actual collateral held
- Test edge cases with high transfer fees
