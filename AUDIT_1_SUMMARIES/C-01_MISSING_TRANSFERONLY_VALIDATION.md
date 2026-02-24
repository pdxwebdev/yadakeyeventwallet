**Updated Bug Summary – Bridge.sol**

The previously reported vulnerability (zero-cost drainage of native tokens / ETH / BNB held by the bridge during key registration or rotation calls using native-token permits in transfer-only mode) has now been **fixed in Bridge.sol** as well.

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/3876cf05a9b2549813cd5e2bc880075c88e90f5b

**Fixed logic (now present in both Bridge.sol and BridgeUpgrade.sol):**

- Added accumulator `uint256 expectedNativeProvided = 0;`
- Accumulate required `msg.value` for every native-token recipient transfer and remainder send in `_executePermits`
- Final check at the end of `_executePermits`:
  ```solidity
  if (hasNativeTransfer && expectedNativeProvided > 0) {
      if (msg.value < expectedNativeProvided) revert InsufficientNativeProvided();
  }
  ```
- New custom error: `error InsufficientNativeProvided();`

**Current status (as of February 16, 2026):**

- The attack vector allowing an attacker to drain the bridge’s entire native token balance with only gas cost (no `msg.value` required) is closed.
- Native token operations now correctly require the caller to send sufficient value via `msg.value`.
- All original comments and non-native logic paths remain unchanged.

**Recommendation:**  
You can safely use the updated `Bridge.sol` in production — both `Bridge.sol` and `BridgeUpgrade.sol` now contain the complete patch for this vulnerability.

The native token drainage issue has been fully addressed across both files.
