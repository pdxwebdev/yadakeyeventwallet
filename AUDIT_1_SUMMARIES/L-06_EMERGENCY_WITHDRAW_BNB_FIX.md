# Emergency Withdraw BNB Fix

**GitHub Commit:** https://github.com/pdxwebdev/yadakeyeventwallet/commit/d611b33c234f46ac76fb99a48309d2797b375f07

## Issue
Centralization risk in Bridge.sol lines 458-463. The owner could unilaterally withdraw all native BNB from the bridge via `emergencyWithdrawBNB`, including BNB escrowed to back wrapped tokens, with no solvency check, timelock, or multisig.

## Solution
Removed the `emergencyWithdrawBNB` function entirely, eliminating the centralization risk and owner's ability to withdraw funds unilaterally.

## Files Changed
- **Bridge.sol**: Removed `emergencyWithdrawBNB` function
- **BridgeUpgrade.sol**: Removed `emergencyWithdrawBNB` function

## Technical Details
The removed function was:
```solidity
function emergencyWithdrawBNB(address to) external onlyOwner {
    uint256 balance = address(this).balance;
    require(balance > 0, "No BNB to withdraw");
    (bool sent, ) = to.call{value: balance}("");
    require(sent, "Withdraw failed");
}
```

This ensures the bridge cannot have its entire BNB balance withdrawn by the owner, protecting users' wrapped token backing.
