// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract WrappedToken is ERC20, Ownable, ERC20Permit {
    address public bridge;

    constructor(
        string memory name,
        string memory symbol,
        address _bridge
    ) ERC20(name, symbol) Ownable(msg.sender) ERC20Permit(name) {
        bridge = _bridge;
    }

    modifier onlyBridge() {
        require(msg.sender == bridge, "Only Bridge can call this function");
        _;
    }

    function mint(address to, uint256 amount) external onlyBridge {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyBridge {
        _burn(from, amount);
    }

    function setBridge(address _newBridge) external onlyOwner {
        require(_newBridge != address(0), "Invalid Bridge address");
        bridge = _newBridge;
    }
}