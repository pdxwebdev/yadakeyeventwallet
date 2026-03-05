# Fix: ERC-2612 Permit Frontrunning Mitigation

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/30d5f1e7bb97b03c88a8cd193b1b5a31c0ffd5aa

## Overview
Mitigated permit frontrunning attacks that could grief users attempting key registration, balance transfers, and contract upgrades with ERC-20 permit signatures.

## Changes

### Files Modified
- [Bridge.sol](contracts/Bridge.sol) (Lines 333-351)
- [BridgeUpgrade.sol](contracts/BridgeUpgrade.sol) (Lines 333-351)

### Implementation
Wrapped `IERC20Permit2.permit()` calls in try/catch blocks within `_executePermits()`:

```solidity
try IERC20Permit2(permit.token).permit(
    ectx.user,
    address(this),
    permit.amount,
    permit.deadline,
    permit.v,
    permit.r,
    permit.s
) {} catch {
    if (
        IERC20(permit.token).allowance(
            ectx.user,
            address(this)
        ) < permit.amount
    ) {
        revert InsufficientAllowance();
    }
}
```

## Impact
- **Eliminates grief attacks** – Users can complete permit-dependent operations even if signature is frontrun
- **Fallback protection** – If attacker consumes permit, existing allowance enables transaction continuation
- **Three functions protected:**
  - `registerKeyPairWithTransfer()`
  - `transferBalanceToLatestKey()`
  - `upgradeWithKeyRotation()`

## Security
- No change to threat model for fund safety
- Attacker cannot steal funds or profit
- Standard industry mitigation pattern for ERC-2612
