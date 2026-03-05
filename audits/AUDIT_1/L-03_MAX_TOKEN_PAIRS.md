# PR Summary: MAX_TOKEN_PAIRS Enforcement

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/0db8fecf7606caf3f5984867fb5ce0ca81aa8ef4

## Changes

**Smart Contracts:**
- [Bridge.sol](contracts/Bridge.sol#L514) & [BridgeUpgrade.sol](contracts/BridgeUpgrade.sol#L514): Added `require(supportedOriginalTokens.length < MAX_TOKEN_PAIRS, "max token pairs reached");` to `registerKeyPairWithTransfer()` to enforce the 10-pair limit.

**Tests:**
- New [bridgeMaxTokenPairs.test.js](tests/bridgeMaxTokenPairs.test.js): Validates the cap reverts when registering 11+ pairs.
- Updated [test.js](tests/test.js): Fixed imports, added admin setter tests (feeSigner, feeCollector, wrappedTokenBeacon), non-owner reverts, and zero-address guards.

Both test suites pass.
