# Fix: Synchronize Ownership Transfer in rotateToPublicKey

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/afb977743c4c5eea03a8e60d806992134329f1b1

## Problem
`rotateToPublicKey` only transferred Bridge ownership, leaving KeyLogRegistry desynchronized. A compromised old owner could revoke Bridge authorization or upgrade KeyLogRegistry maliciously.

## Solution
- Added validation: `require(exists, "Key log not initialized")`
- Sync both contracts atomically:
  ```solidity
  transferOwnership(latest.prerotatedKeyHash);
  keyLogRegistry.transferOwnership(latest.prerotatedKeyHash);
  ```

## Files
- `contracts/Bridge.sol`
- `contracts/BridgeUpgrade.sol`
