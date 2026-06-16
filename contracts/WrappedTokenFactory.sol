// SPDX-License-Identifier: YOSL-1.1
pragma solidity ^0.8.0;

import "./WrappedTokenProxy.sol";

interface IBridge {
    function getOwner() external view returns (address);
}

interface IWrappedToken {
    function initialize(
        string memory name,
        string memory symbol,
        address _bridge,
        address _keyLogRegistry,
        uint8 decimals_
    ) external;
}

contract WrappedTokenFactory {
    address public bridge;
    address public beacon;

    event TokenDeployed(address proxy);

    modifier onlyOwner() {
        require(msg.sender == IBridge(bridge).getOwner(), "Not owner");
        _;
    }

    constructor(address _beacon, address _bridge) {
        require(_beacon != address(0), "Zero address");
        require(_bridge != address(0), "Zero address");
        beacon = _beacon;
        bridge = _bridge;
    }

    function createToken(
        string memory name,
        string memory symbol,
        address keyLogRegistry,
        uint8 decimals_
    ) external onlyOwner returns (address) {
        bytes memory initData = abi.encodeWithSelector(
            IWrappedToken.initialize.selector,
            name,
            symbol,
            bridge,
            keyLogRegistry,
            decimals_
        );
        WrappedTokenProxy proxy = new WrappedTokenProxy(beacon, initData);
        emit TokenDeployed(address(proxy));
        return address(proxy);
    }

    function owner() public view returns (address) {
        return IBridge(bridge).getOwner();
    }
}
