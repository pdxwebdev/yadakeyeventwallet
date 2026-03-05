# Keylog Chain Length Guard

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/9a149c5733d1afdbe6f12f380f576b632573b79d

## Summary

Prevent silent truncation in `_buildChainFromHash` by reverting when the chain exceeds the fixed 1000 entry buffer. This ensures downstream callers never receive a stale "latest" entry.

## Changes

- Added a length check before each write and revert with `"Chain exceeds maximum length"`.
- Applied the same guard to both `KeyLogRegistry` and `KeyLogRegistryUpgrade`.

## Files Updated

- contracts/KeyLogRegistry.sol
- contracts/KeyLogRegistryUpgrade.sol
