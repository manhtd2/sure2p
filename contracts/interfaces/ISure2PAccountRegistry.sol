// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Eligibility boundary used by Sure2PEscrow when creating an agreement.
interface ISure2PAccountRegistry {
    /// @notice Returns whether a nonzero wallet is currently eligible.
    function isEligible(address wallet) external view returns (bool);
}
