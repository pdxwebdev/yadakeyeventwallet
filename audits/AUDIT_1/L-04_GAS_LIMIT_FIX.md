# Fix: Remove Hardcoded Gas Limit on Native BNB Transfers

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/5bbc150cc70d676a7522e4c0e823d6743dce4c05

## Overview
Removed the 30,000 gas stipend restriction on native BNB transfers to support smart contract wallets with heavier receive()/fallback() logic.

## Changes

### Files Modified
- [Bridge.sol](contracts/Bridge.sol) (Line 167, Line 475)
- [BridgeUpgrade.sol](contracts/BridgeUpgrade.sol) (Line 168, Line 475)

### Implementation
1. Removed `GAS_LIMIT` constant (30,000 gas)
2. Updated `_transferNative()` to use unrestricted gas:

```solidity
function _transferNative(address to, uint256 amount) private {
    (bool success, ) = to.call{value: amount}("");
    if (!success) revert TransferFailed();
}
```

## Impact
- **Supports smart contract wallets** – Gnosis Safe, custom contracts with complex receive logic no longer blocked
- **Consistent pattern** – Now aligns with `emergencyWithdrawBNB()` implementation
- **Functions protected:**
  - `_handleWrap()` – Fee collection
  - `_handleUnwrap()` – Unwrap payouts
  - `transferNativeBalance()` – Plain native transfers

## Security
- **No reentrancy risk** – All entry points protected by `nonReentrant` modifier
- **No semantics change** – Users receive full transfer amounts as intended
- **Standard practice** – Industry-standard pattern for unrestricted native transfers
