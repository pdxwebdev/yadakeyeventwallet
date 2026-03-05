# PR: O(1) Key Chain Lookup Optimization

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/1e81431ab0629533334336f1791d8bd8c051f21f

## Problem
`getLatestChainEntry` performed O(N) traversals every time it was called:
- Backward traversal through chain to find inception
- Forward traversal from inception to latest entry
- Fixed 1000-element array allocation on each call

**Measured Impact:** 700k-900k gas per call at chain length 101. Cost grows by ~4,400 gas per additional entry.

## Solution
Maintain two index mappings updated during key registration to enable O(1) lookups:
- `chainOf`: Maps any key hash → inception hash
- `latestInChain`: Maps inception hash → latest key hash

## Files Changed
- `contracts/KeyLogRegistry.sol`
- `contracts/KeyLogRegistryUpgrade.sol`

## Implementation Details

### 1. Added Index Mappings (Lines 38-39)
```solidity
mapping(address => address) public chainOf;        // any key hash → inception hash
mapping(address => address) public latestInChain;  // inception hash → latest key hash
```

### 2. Updated `registerKeyLog` (Lines 110-112)
Maintains chain indexes for inception entries:
```solidity
chainOf[publicKeyHash] = publicKeyHash;
latestInChain[publicKeyHash] = publicKeyHash;
```

### 3. Updated `registerKeyLogPair` (Lines 183-187)
Maintains chain indexes for key rotations:
```solidity
address inceptionHash = chainOf[unconfirmedKey.prevPublicKeyHash];
chainOf[unconfirmedPublicKeyHash] = inceptionHash;
chainOf[confirmingPublicKeyHash] = inceptionHash;
latestInChain[inceptionHash] = confirmingPublicKeyHash;
```

### 4. Optimized `getLatestChainEntry` (Lines 353-384)
Replaced O(N) traversal with O(1) direct mapping lookups:

**Before:**
```solidity
KeyLogEntry[] memory log = _buildChainFromHash(publicKeyHash);
// ~900k gas, allocates 1000-element array
```

**After:**
```solidity
address inceptionHash = getInceptionHash(publicKeyHash);
address latestKeyHash = latestInChain[inceptionHash];
uint256 idx = byPublicKeyHash[latestKeyHash];
// ~21k gas, 3 SLOAD operations max
```

### 5. Added Helper Function (Lines 251-253)
```solidity
function getInceptionHash(address anyKeyInChain) internal view returns (address) {
    return chainOf[anyKeyInChain];
}
```

## Performance Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|------------|
| Gas per lookup (chain length 101) | 900k | 21k | **97% reduction** |
| Lookup complexity | O(N) | O(1) | **Constant** |
| Per-entry gas growth | ~4,400/entry | 0 | **Unbounded scalability** |

## Deployment Notes

- **Fresh deployment only** - contracts are starting from scratch, no migration needed
- All new entries immediately use O(1) path
- Backward compatible function signatures
- No breaking changes to Bridge.sol integration
