// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Plain 6-decimal mock USDC. Decimals are adjustable only to test constructor validation.
contract MockUSDC is ERC20 {
    uint8 private _dec = 6;

    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function setDecimals(uint8 d) external {
        _dec = d;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
