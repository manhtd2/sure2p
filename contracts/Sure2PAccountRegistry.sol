// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ISure2PAccountRegistry} from "./interfaces/ISure2PAccountRegistry.sol";

/// @notice Wallet-only eligibility registry. Bans do not affect existing escrows.
contract Sure2PAccountRegistry is AccessControl, ISure2PAccountRegistry {
    bytes32 public constant SECURITY_ROLE = keccak256("SECURITY_ROLE");
    mapping(address wallet => bool) public banned;

    error ZeroAddress();

    event WalletBanStatusChanged(address indexed wallet, bool banned);

    /// @notice Assigns initial role administration and security operation separately.
    constructor(address defaultAdmin, address security) {
        if (defaultAdmin == address(0) || security == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(SECURITY_ROLE, security);
    }

    /// @notice Sets a wallet's ban status; callable only by SECURITY_ROLE.
    function setBanned(address wallet, bool status) external onlyRole(SECURITY_ROLE) {
        banned[wallet] = status;
        emit WalletBanStatusChanged(wallet, status);
    }

    /// @notice Sets each supplied wallet's ban status; callable only by SECURITY_ROLE.
    function setBannedBatch(address[] calldata wallets, bool status) external onlyRole(SECURITY_ROLE) {
        for (uint256 i; i < wallets.length; ++i) {
            banned[wallets[i]] = status;
            emit WalletBanStatusChanged(wallets[i], status);
        }
    }

    /// @inheritdoc ISure2PAccountRegistry
    function isEligible(address wallet) external view override returns (bool) {
        return wallet != address(0) && !banned[wallet];
    }
}
