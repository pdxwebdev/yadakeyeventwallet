// SPDX-License-Identifier: YOSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./WrappedTokenProxy.sol";

interface IBridge {
    function getOwner() external view returns (address);
}

interface IWrappedToken {
    function initialize(
        string memory name,
        string memory symbol,
        address _bridge,
        address _keyLogRegistry
    ) external;
}

contract WrappedTokenFactoryUpgrade is OwnableUpgradeable, UUPSUpgradeable {
    address public bridge;
    address public beacon;

    event TokenDeployed(address proxy);

    function initialize(address _beacon, address _owner, address _bridge) public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        beacon = _beacon;
        bridge = _bridge;
    }

    function createToken(
        string memory name,
        string memory symbol,
        address keyLogRegistry
    ) external onlyOwner returns (address) {
        bytes memory initData = abi.encodeWithSelector(
            IWrappedToken.initialize.selector,
            name,
            symbol,
            bridge,
            keyLogRegistry
        );
        WrappedTokenProxy proxy = new WrappedTokenProxy(beacon, initData);
        emit TokenDeployed(address(proxy));
        return address(proxy);
    }

    function owner() public view override returns (address) {
        return IBridge(bridge).getOwner();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function getTestString() external pure returns (string memory) {
        return "Upgraded WrappedTokenFactory v5!";
    }
}