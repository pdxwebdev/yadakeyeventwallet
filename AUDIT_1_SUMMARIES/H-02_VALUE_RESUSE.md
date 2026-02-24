**Summary of the fix for the vulnerability (msg.value reused across multiple native wrap permits / operations)**

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/d02f24083ffbf5f6546b762e28349a9f52a7b171

**Problem it solves**  
In the original code, the check `msg.value >= recipient.amount` was performed **per recipient** inside `_handleWrap`. Since `msg.value` is fixed for the entire transaction and never decreases, the same deposited amount could satisfy the check multiple times → allowing minting of wrapped native tokens far exceeding the actual ETH/BNB sent.

**Core changes implemented**

1. **Removed** the per-recipient / per-wrap check

   ```solidity
   // Deleted this line from _handleWrap:
   require(msg.value >= recipient.amount, "Insufficient native token sent");
   ```

2. **Added cumulative tracking** in the **first pass** over all permits (before any execution):

   ```solidity
   if (permit.token == address(0)) {
       hasNativeTransfer = true;
       expectedNativeProvided += permit.amount;   // ← key line
   }
   ```

   → For **every native permit** (`token == address(0)`), the **full `permit.amount`** is added to the required native input.

3. **Final single enforcement** at the end of `_executePermits`:

   ```solidity
   if (hasNativeTransfer && expectedNativeProvided > 0) {
       if (msg.value < expectedNativeProvided) revert InsufficientNativeProvided();
   }
   ```

4. **Removed** the late / partial addition of remainder inside the `transferOnly` block:
   ```solidity
   // Deleted this:
   if (ectx.token == address(0)) {
       expectedNativeProvided += remainder;
   }
   ```
   (it was too late and incomplete anyway)

**Why this works (conservative & effective)**

- `permit.amount` is the **maximum possible native outflow** per native permit (covers recipients + remainder + fees in wrap/unwrap/transfer-only cases)
- Summing `permit.amount` across **all** native permits gives a safe upper bound for total native tokens needed
- One final check at the end prevents under-supply → attacker cannot reuse the same `msg.value` across multiple permits or recipients
- Slight overestimation (e.g. when fees reduce net amount) is harmless — extra ETH just stays in the contract

**Result**  
The bridge now enforces:  
**total native tokens sent out / wrapped ≤ actual `msg.value` received in the transaction**  
→ solvency preserved, no more unbacked wrapped native token minting via `msg.value` reuse.

The fix is now **simple, conservative, and complete** for the described issue.

Let me know if you'd like a small Foundry-style test example showing old vs new behavior.
