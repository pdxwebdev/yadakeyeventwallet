/*
SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./KeyLogRegistry.sol";

contract WrappedToken is ERC20, ERC20Permit {
    address public bridge;
    KeyLogRegistry public keyLogRegistry;

    constructor(string memory name, string memory symbol, address _bridge, address _keyLogRegistry)
        ERC20(name, symbol)
        ERC20Permit(name)  // Initialize EIP-2612 with the token name
    {
        bridge = _bridge;
        keyLogRegistry = KeyLogRegistry(_keyLogRegistry);
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

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(_validateKeyLog(msg.sender, to), "Invalid key log for transfer");
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(_validateKeyLog(from, to), "Invalid key log for transfer");
        return super.transferFrom(from, to, amount);
    }

    function _validateKeyLog(address from, address to) internal view returns (bool) {
        (KeyLogRegistry.KeyLogEntry memory latestEntry, bool hasEntry) = keyLogRegistry.getLatestEntryByPrerotatedKeyHash(from);
        if (hasEntry) {
            return latestEntry.prerotatedKeyHash == from || latestEntry.prerotatedKeyHash == to;
        }
        return true;
    }
}