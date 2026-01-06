// SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

interface IBridge2 {
    function getOwner() external view returns (address);
}

contract WrappedTokenUpgrade is Initializable, ERC20Upgradeable, ERC20PermitUpgradeable, UUPSUpgradeable, OwnableUpgradeable {
    address public bridge;

    event BridgeUpdated(address indexed oldBridge, address indexed newBridge);

    function initialize(
        string memory name,
        string memory symbol,
        address _bridge
    ) public initializer {
        __ERC20_init(name, symbol);
        __ERC20Permit_init(name);
        __Ownable_init(_bridge);
        __UUPSUpgradeable_init();
        bridge = _bridge;
    }

    function owner() public view override returns (address) {
        return IBridge2(bridge).getOwner();
    }

    modifier onlyBridge() {
        require(msg.sender == bridge, "Only bridge can call");
        _;
    }

    function mint(address to, uint256 amount) external onlyBridge {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyBridge {
        _burn(from, amount);
    }

    function transfer(address to, uint256 amount) public override onlyBridge returns (bool) {
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override onlyBridge returns (bool) {
        return super.transferFrom(from, to, amount);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function getTestString() external pure returns (string memory) {
        return "Upgraded WrappedToken v10!";
    }
    
    function setBridge(address newBridge) external {
        require(newBridge != address(0), "New bridge cannot be zero address");
        require(newBridge != bridge, "New bridge is same as current");

        address oldBridge = bridge;
        bridge = newBridge;

        emit BridgeUpdated(oldBridge, newBridge);
    }
    
    uint256[50] private __gap;
}