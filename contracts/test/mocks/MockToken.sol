// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @dev Test token with permit, a chosen number of decimals, and a freeze switch like wARS's pause.
contract MockToken is ERC20Permit {
    uint8 private immutable _dec;
    bool public frozen;
    // wARS-style flags that only report; they don't stop transfers here, so tests can check the pool reads them.
    bool public paused;
    bool public enforceBlocklist;
    mapping(address => bool) public isBlocked;

    error TokenFrozen();

    constructor(string memory name_, string memory symbol_, uint8 dec_) ERC20(name_, symbol_) ERC20Permit(name_) {
        _dec = dec_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFrozen(bool f) external {
        frozen = f;
    }

    function setFlags(bool paused_, bool enforce, address blocked, bool isBlocked_) external {
        paused = paused_;
        enforceBlocklist = enforce;
        if (blocked != address(0)) isBlocked[blocked] = isBlocked_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (frozen) revert TokenFrozen();
        super._update(from, to, value);
    }
}
