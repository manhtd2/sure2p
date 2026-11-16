// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {Sure2PEscrow} from "../Sure2PEscrow.sol";
import {Sure2PAccountRegistry} from "../Sure2PAccountRegistry.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Sure2PEscrowHandler} from "./Sure2PEscrow.Handler.t.sol";

contract Sure2PEscrowInvariantTest is Test {
    MockUSDC internal usdc;
    Sure2PEscrow internal escrow;
    Sure2PEscrowHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC();
        Sure2PAccountRegistry registry = new Sure2PAccountRegistry(makeAddr("admin"), makeAddr("security"));
        escrow = new Sure2PEscrow(address(usdc), ISure2PAccountRegistry(address(registry)));
        handler = new Sure2PEscrowHandler(escrow, usdc);
        targetContract(address(handler));
    }

    /// @dev Funds still held for an escrow that have not yet become a credit.
    function _locked(Sure2PEscrow.Escrow memory e) internal pure returns (uint256) {
        if (e.state == Sure2PEscrow.State.Funding) {
            return (e.buyerFunded ? e.price + e.buyerDeposit : 0) + (e.sellerFunded ? e.sellerDeposit : 0);
        }
        if (
            e.state == Sure2PEscrow.State.Active || e.state == Sure2PEscrow.State.Overdue
                || e.state == Sure2PEscrow.State.Disputed
        ) {
            return e.price + e.buyerDeposit + e.sellerDeposit;
        }
        return 0; // None / Finalized / ExpiredUnfunded: funds (if any) are credits
    }

    /// @notice The contract always holds at least what it owes.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 150
    function invariant_BalanceCoversOutstanding() public view {
        assertGe(usdc.balanceOf(address(escrow)), escrow.totalOutstanding());
    }

    /// @notice Σ credits + Σ locked funds across all escrows == totalOutstanding.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 150
    function invariant_CreditsPlusLockedEqualsOutstanding() public view {
        uint256 n = escrow.escrowCount();
        uint256 sum;
        for (uint256 id = 1; id <= n; ++id) {
            Sure2PEscrow.Escrow memory e = escrow.getEscrow(id);
            sum += escrow.claimable(id, e.buyer) + escrow.claimable(id, e.seller) + _locked(e);
        }
        assertEq(sum, escrow.totalOutstanding());
    }

    /// @notice Independent ghost: Σ pulled in − Σ paid out == totalOutstanding; balance = outstanding + donations.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 150
    function invariant_GhostFlowMatchesOutstanding() public view {
        assertEq(handler.ghostIn() - handler.ghostOut(), escrow.totalOutstanding());
        assertEq(usdc.balanceOf(address(escrow)), escrow.totalOutstanding() + handler.donated());
    }

    /// @notice An escrow can never owe more than was put into it, and credits exist only after a terminal state.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 150
    function invariant_PerEscrowCreditsBoundedAndTerminal() public view {
        uint256 n = escrow.escrowCount();
        for (uint256 id = 1; id <= n; ++id) {
            Sure2PEscrow.Escrow memory e = escrow.getEscrow(id);
            uint256 credits = escrow.claimable(id, e.buyer) + escrow.claimable(id, e.seller);
            assertLe(credits, e.price + e.buyerDeposit + e.sellerDeposit);
            if (credits > 0) {
                assertTrue(
                    e.state == Sure2PEscrow.State.Finalized || e.state == Sure2PEscrow.State.ExpiredUnfunded,
                    "credit before terminal state"
                );
            }
        }
    }

    /// @notice Funding flags agree with the lifecycle state.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 150
    function invariant_StateMatchesFundingFlags() public view {
        uint256 n = escrow.escrowCount();
        for (uint256 id = 1; id <= n; ++id) {
            Sure2PEscrow.Escrow memory e = escrow.getEscrow(id);
            if (e.state == Sure2PEscrow.State.Funding) {
                assertFalse(e.buyerFunded && e.sellerFunded);
            } else if (
                e.state == Sure2PEscrow.State.Active || e.state == Sure2PEscrow.State.Overdue
                    || e.state == Sure2PEscrow.State.Disputed || e.state == Sure2PEscrow.State.Finalized
            ) {
                assertTrue(e.buyerFunded && e.sellerFunded);
            }
        }
    }

    /// @dev Liveness evidence: prints how many of each action actually succeeded (visible with -vv).
    function afterInvariant() public view {
        console2.log("created/fundB/fundS", handler.nCreated(), handler.nFundBuyer(), handler.nFundSeller());
        console2.log("decl/ack/accept", handler.nDeclared(), handler.nAcked(), handler.nAccepted());
        console2.log("complete/flag/dispute", handler.nCompleted(), handler.nFlagged(), handler.nDisputed());
        console2.log("settle/expire/claim", handler.nSettled(), handler.nExpired(), handler.nClaims());
    }
}
