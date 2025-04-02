// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract MockERC20 is ERC20, ERC20Permit {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) ERC20Permit(name) {
        _mint(msg.sender, initialSupply);
    }
}