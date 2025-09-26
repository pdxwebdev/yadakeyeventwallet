// SPDX-License-Identifier: YOSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

interface IBridge {
    function getOwner() external view returns (address);
}

contract WrappedTokenBeacon is UpgradeableBeacon {
    address public bridgeAddress;

    constructor(address implementation, address _bridgeAddress) 
        UpgradeableBeacon(implementation, IBridge(_bridgeAddress).getOwner()) 
    {
        bridgeAddress = _bridgeAddress;
    }

    // Override the owner() function to return the bridge's current owner
    function owner() public view virtual override returns (address) {
        return IBridge(bridgeAddress).getOwner();
    }
}