**Remediation Summary – Token Pair Registration Vulnerability in Bridge.sol**

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/6dfdb6d9813bffeea8381d4dcfd33f3e50be599a

During the audit, a critical issue was identified in the `registerKeyPairWithTransfer` function allowing any caller to register arbitrary token pairs, including binding legitimate original tokens (e.g. USDC, WETH) to attacker-controlled wrapped token contracts. This could enable permanent griefing (DoS on legitimate pair registration) and, in the worst case, drainage of bridge reserves via unrestricted mint/burn on a malicious wrapped token.

To address this, I implemented the following changes in the latest version:

1. **Restricted registration to contract owner only**  
   The entire token pair registration logic is now guarded by `if (owner() == msg.sender) { … }`.  
   Non-owners can no longer register or influence any token pairs.

2. **Eliminated trust in caller-supplied wrappedToken addresses**  
   The function no longer reads or uses the `wrappedToken` field from the input `TokenPair` struct.  
   Any previously existing conditional logic that could accept a user-provided wrapped token address has been completely removed.

3. **Enforced beacon-based deployment for all wrapped tokens**  
   Whenever token pairs are registered (now only by the owner), a fresh `WrappedToken` proxy is always deployed via the trusted `wrappedTokenBeacon`:
   ```solidity
   WrappedTokenProxy proxy = new WrappedTokenProxy(wrappedTokenBeacon, initData);
   address wrappedToken = address(proxy);
   ```
   This guarantees that every wrapped token inherits the access controls (e.g. mint/burn restricted to the bridge) defined in the canonical implementation.

These changes fully close the reported attack vector:

- No external party can frontrun or grief legitimate token registrations.
- No caller (even the owner) can register a malicious or non-beacon-controlled ERC20 as a wrapped token.
- All wrapped tokens are now verifiably created under bridge control.

A small compilation fix remains pending (`address wrappedToken = address(proxy);` instead of the undeclared `wrappedToken = …`), which will be applied before deployment.

I believe this resolves the issue with strong defense-in-depth while preserving the intended key-rotation + pair-registration workflow.
