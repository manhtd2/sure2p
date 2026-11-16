// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ITokenHook {
    function onTokenHook() external;
}

/// @dev 6-decimal token (ERC777-style) that calls `onTokenHook()` on contract senders/recipients
/// after every transfer when enabled. Hook failures are swallowed so the transfer itself succeeds.
contract ReentrantToken is ERC20 {
    bool public hookEnabled;

    constructor() ERC20("Hostile USDC", "hUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setHookEnabled(bool on) external {
        hookEnabled = on;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (hookEnabled && from != address(0) && to != address(0)) {
            if (from.code.length > 0) {
                try ITokenHook(from).onTokenHook() {} catch {}
            }
            if (to.code.length > 0) {
                try ITokenHook(to).onTokenHook() {} catch {}
            }
        }
    }
}

/// @dev Contract wallet (always-valid ERC-1271) that fires one configured re-entrant call
/// into the escrow from inside the token hook, recording whether it succeeded.
contract ReentrancyAttacker is ITokenHook {
    address public immutable escrow;
    ERC20 public immutable token;

    bytes public payload;
    bool public armed;
    bool public attempted;
    bool public reentrySucceeded;
    bytes public revertData;

    constructor(address escrow_, ERC20 token_) {
        escrow = escrow_;
        token = token_;
        token_.approve(escrow_, type(uint256).max);
    }

    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }

    function arm(bytes calldata data) external {
        payload = data;
        armed = true;
        attempted = false;
        reentrySucceeded = false;
        delete revertData;
    }

    /// @dev Forwards a call to the escrow with this contract as msg.sender, bubbling reverts.
    function exec(bytes calldata data) external {
        (bool ok, bytes memory ret) = escrow.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    function onTokenHook() external override {
        if (!armed || attempted || msg.sender != address(token)) return;
        attempted = true;
        (bool ok, bytes memory ret) = escrow.call(payload);
        reentrySucceeded = ok;
        revertData = ret;
    }
}
