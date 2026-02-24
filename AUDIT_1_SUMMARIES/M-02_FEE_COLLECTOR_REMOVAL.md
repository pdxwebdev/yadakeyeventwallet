# PR Summary: Security Fix M-02 – Remove Redundant feeCollector

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/26e0dbe6d17febe77291f82d24c34106bbb128b5

## Overview
Fixed Medium severity security audit issue by removing the redundant `feeCollector` state variable and decoupling fee recipient from ownership state. Protocol fees now flow directly to the contract owner.

## Changes

### Smart Contracts
**[Bridge.sol](contracts/Bridge.sol) & [BridgeUpgrade.sol](contracts/BridgeUpgrade.sol):**
- Removed `feeCollector` state variable
- Removed `setFeeCollector()` external function
- Removed `feeCollector = msg.sender` initialization in `initialize()`
- Replaced all 4 fee redistribution references to use `owner()`:
  - [Line 388](contracts/Bridge.sol#L388): `_handleWrap()` native token fees
  - [Line 393](contracts/Bridge.sol#L393): `_handleWrap()` ERC20 token fees
  - [Line 430](contracts/Bridge.sol#L430): `_handleUnwrap()` native token fees
  - [Line 433](contracts/Bridge.sol#L433): `_handleUnwrap()` ERC20 token fees
- Updated [Line 768](contracts/Bridge.sol#L768) comment in `rotateToPublicKey()`: clarified that fees flow to new owner after key rotation

## Impact
- **Vulnerability resolved:** Protocol fees automatically flow to the owner without race conditions or manual intervention
- **Simplified state management:** No separate fee recipient configuration needed
- **Atomic owner/fee synchronization:** Ownership transfer and fee recipient change happen together
- **Cleaner API:** One fewer admin function to manage

## Testing 
Existing test suite continues to pass. Fee flow paths tested in:
- Wrap operations (native and ERC20)
- Unwrap operations (native and ERC20)
