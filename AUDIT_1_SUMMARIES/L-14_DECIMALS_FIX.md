# L-14: Hardcoded 18-Decimal Wrapped Tokens - Fix Summary

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/55c87521af84f8121bda2d489c77b7ebc759cf5d

## Problem

WrappedToken contracts defaulted to 18 decimals regardless of the original token's decimals, causing:

- **Asymmetric fee calculations**: Unwrap fees calculated with incorrect decimals, losing protocol revenue
- **Display issues**: Non-18-decimal tokens displayed with wrong amounts in wallets (e.g., 1 USDC shown as 0.000000000001)

## Solution

Pass the original token's decimals to wrapped token initialization and override the `decimals()` function.

## Files Modified

### 1. WrappedToken.sol

- Added `uint8 private _decimals` state variable
- Updated `initialize()` to accept `uint8 decimals_` parameter
- Implemented `decimals()` override to return `_decimals`

### 2. WrappedTokenUpgrade.sol

- Added `uint8 private _decimals` state variable
- Updated `initialize()` to accept `uint8 decimals_` parameter
- Implemented `decimals()` override to return `_decimals`

### 3. WrappedTokenFactory.sol

- Updated `IWrappedToken` interface to include `uint8 decimals_` parameter in `initialize()`

### 4. WrappedTokenFactoryUpgrade.sol

- Updated `IWrappedToken` interface to include `uint8 decimals_` parameter in `initialize()`

### 5. Bridge.sol

- Modified token pair registration to retrieve original token's decimals
- Pass decimals value when initializing wrapped tokens: `tokenDecimals = (pair.originalToken == address(0)) ? 18 : IERC20WithDecimals(pair.originalToken).decimals()`

### 6. BridgeUpgrade.sol

- Same changes as Bridge.sol to maintain consistency

## Verification

✅ All 6 Solidity files compiled successfully with no errors
