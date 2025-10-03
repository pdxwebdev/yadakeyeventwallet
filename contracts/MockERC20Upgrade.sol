// SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

interface IBridge {
    function getOwner() external view returns (address);
}

contract MockERC20Upgrade is Initializable, ERC20Upgradeable, ERC20PermitUpgradeable, UUPSUpgradeable, OwnableUpgradeable {
    address public bridge;

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
        return IBridge(bridge).getOwner();
    }

    modifier onlyBridge() {
        require(msg.sender == bridge, "Only bridge can call");
        _;
    }

    function mint(address to, uint256 amount) external onlyBridge {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Mint amount must be greater than 0");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyBridge {
        require(from != address(0), "Cannot burn from zero address");
        require(amount > 0, "Burn amount must be greater than 0");
        _burn(from, amount);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // New function for testing
    function getTestString() external pure returns (string memory) {
        return "Upgraded MockERC20 v7!";
    }
}