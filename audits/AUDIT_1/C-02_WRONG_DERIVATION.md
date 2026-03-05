**Updated Bug Summary – KeyLogRegistry.sol**

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/3876cf05a9b2549813cd5e2bc880075c88e90f5b

The previously reported bug (incorrect computation of `confirmingPublicKeyHash` using `unconfirmed.publicKey` instead of `confirming.publicKey`) has now been **fixed in KeyLogRegistry.sol** as well.

**Fixed line (now correct in both KeyLogRegistry.sol and KeyLogRegistryUpgrade.sol):**

```solidity
address confirmingPublicKeyHash = getAddressFromPublicKey(confirming.publicKey);
```

**Current status (as of February 16, 2026):**

- The copy-paste error that caused every `registerKeyLogPair` call to revert with `"Invalid confirmingPublicKey"` is resolved.
- Key rotation / pair registration now works correctly.
- The bridge key chain is no longer permanently stuck after inception.
- Both the original and upgraded registry implementations now support proper multi-key rotation.

**Recommendation:**  
You can safely use the updated `KeyLogRegistry.sol` in production (no need to rely solely on the `Upgrade` variant for this particular fix).

The vulnerability has been fully addressed across both files.
