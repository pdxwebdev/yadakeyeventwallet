// SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

interface IBridge {
    function owner() external view returns (address);
}

contract MockERC20 is ERC20, ERC20Permit {
    address public bridge;

    constructor(string memory name, string memory symbol, uint256 initialSupply, address _bridge) 
        ERC20(name, symbol) 
        ERC20Permit(name) 
    {
        bridge = _bridge;
        _mint(msg.sender, initialSupply);
    }

    modifier onlyBridgeOwnerCaller() {
        require(msg.sender == bridge, "Only bridge can call");
        address bridgeOwner = IBridge(bridge).owner();
        require(tx.origin == bridgeOwner, "Original caller must be bridge owner");
        _;
    }

    function mint(address to, uint256 amount) external onlyBridgeOwnerCaller {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Mint amount must be greater than 0");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyBridgeOwnerCaller {
        require(from != address(0), "Cannot burn from zero address");
        require(amount > 0, "Burn amount must be greater than 0");
        _burn(from, amount);
    }
}