# Issue [L-13] Fix Summary: Token Pair Lifecycle Management

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/6ea0d600502bf4ae6d4b05842333da4de0696248

## Overview

Implemented a token pair lifecycle management system to allow disabling and enabling token pairs. This prevents permanent persistence of compromised or deprecated token pairs and provides a mechanism to halt operations for specific pairs without requiring a full contract upgrade.

## Problem

Previously, once a token pair was registered via `registerKeyPairWithTransfer()`, it was permanent with no mechanism to:

- Remove a pair from `tokenPairs`
- Remove an entry from `supportedOriginalTokens`
- Disable wrap/unwrap for a specific pair
- Blacklist a compromised wrapped token

The `TokenPairExists` check at line 492 also prevented re-registration, meaning the owner couldn't point an original token to a new wrapped token even if the existing one was compromised.

This became problematic when:

1. A wrapped token's beacon implementation is compromised and all wrapping/unwrapping should be halted
2. An original token is deprecated, migrated, or becomes unsafe (e.g., exploited on BSC)
3. A malicious or incorrect pair is registered by mistake

## Solution

### Bridge.sol and BridgeUpgrade.sol

**Added mapping:**

```solidity
mapping(address => bool) public disabledPairs;
```

**Added error:**

```solidity
error TokenPairDisabled();
```

**New functions:**

```solidity
function disableTokenPair(address token) external onlyOwner {
    if (tokenPairs[token].wrappedToken == address(0)) revert TokenPairNotSupported();
    disabledPairs[token] = true;
}

function enableTokenPair(address token) external onlyOwner {
    if (tokenPairs[token].wrappedToken == address(0)) revert TokenPairNotSupported();
    disabledPairs[token] = false;
}
```

**Added checks in \_handleWrap() and \_handleUnwrap():**

```solidity
if (disabledPairs[permit.token]) revert TokenPairDisabled();
```

## Benefits

1. **Immediate Response**: Owner can disable a compromised token pair without requiring a contract upgrade
2. **Flexibility**: Pairs can be re-enabled if the issue is resolved
3. **Safety**: Prevents accidental or malicious use of problematic pairs
4. **No Breaking Changes**: Existing pair registrations remain unchanged; only the ability to control access is added

## Testing Recommendations

1. Verify that disabled pairs cannot be wrapped/unwrapped
2. Verify that enabled pairs work normally
3. Verify that only the owner can enable/disable pairs
4. Verify that disabling a non-existent pair reverts with `TokenPairNotSupported`
5. Test re-enabling previously disabled pairs
