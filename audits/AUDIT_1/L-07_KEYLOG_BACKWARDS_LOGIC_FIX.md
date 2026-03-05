# KeyLog Backwards Logic Fix

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/62e5af709a00c71fbd0b6006dc51143784825190

## Issue
The function `getLatestEntryByPrerotatedKeyHash` in KeyLogRegistry.sol contained backwards logic that caused it to always fail. The problematic require statement checked:
```solidity
require(idx == 0, "Not the latest key rotation.");
```
This condition was inverted—the function should return the entry directly without this check.

## Solution
Removed the backwards require statement and unnecessary intermediate lookups. The function now correctly returns the entry when found.

## Files Changed
- **contracts/KeyLogRegistry.sol**: Removed `require(idx == 0)` check and simplified return logic
- **contracts/KeyLogRegistryUpgrade.sol**: Applied same fix

## Updated Function
```solidity
function getLatestEntryByPrerotatedKeyHash(address prerotatedKeyHash) public view returns (KeyLogEntry memory, bool) {
    uint256 idx = byPrerotatedKeyHash[prerotatedKeyHash];
    if (idx == 0) {
        idx = byTwicePrerotatedKeyHash[prerotatedKeyHash];
        if (idx == 0) {
            KeyLogEntry memory emptyEntry;
            return (emptyEntry, false);
        }
    }
    KeyLogEntry memory entry = keyLogEntries[idx - 1];
    return (entry, true);
}
```
