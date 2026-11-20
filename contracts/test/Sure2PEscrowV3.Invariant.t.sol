// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {Sure2PEscrowV3} from "../Sure2PEscrowV3.sol";
import {Sure2PAccountRegistry} from "../Sure2PAccountRegistry.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Sure2PEscrowV3Handler} from "./Sure2PEscrowV3.Handler.t.sol";

contract Sure2PEscrowV3InvariantTest is Test {
    MockUSDC internal usdc;
    Sure2PEscrowV3 internal escrow;
    Sure2PEscrowV3Handler internal handler;
    address internal owner0 = makeAddr("owner");
    address internal penaltyW = makeAddr("penaltyWallet");

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC();
        Sure2PAccountRegistry registry = new Sure2PAccountRegistry(makeAddr("admin"), makeAddr("security"));
        escrow = new Sure2PEscrowV3(
            address(usdc), ISure2PAccountRegistry(address(registry)), penaltyW, owner0,
            makeAddr("arbiter"), makeAddr("reviewer")
        );
        handler = new Sure2PEscrowV3Handler(escrow, usdc, penaltyW);
        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](19);
        sel[0] = handler.progress.selector;
        sel[1] = handler.progressB.selector;
        sel[2] = handler.progressC.selector;
        sel[3] = handler.appeal.selector;
        sel[4] = handler.warp.selector;
        sel[5] = handler.swapArbiter.selector;
        sel[6] = handler.swapReviewer.selector;
        sel[7] = handler.settle.selector;
        sel[8] = handler.claim.selector;
        sel[9] = handler.donate.selector;
        sel[10] = handler.finalizeRuling.selector;
        sel[11] = handler.finalRuling.selector;
        sel[12] = handler.anchor.selector;
        sel[13] = handler.prelim.selector;
        sel[14] = handler.transferOwner.selector;
        sel[15] = handler.acceptOwner.selector;
        sel[16] = handler.renounce.selector;
        sel[17] = handler.expire.selector;
        sel[18] = handler.dispute.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
    }

    function _funded(Sure2PEscrowV3.Escrow memory e) internal pure returns (uint256) {
        return (e.buyerFunded ? e.price + e.buyerDeposit : 0) + (e.sellerFunded ? e.sellerDeposit : 0);
    }

    function _isTerminal(Sure2PEscrowV3.State s) internal pure returns (bool) {
        return s == Sure2PEscrowV3.State.Finalized || s == Sure2PEscrowV3.State.ExpiredUnfunded;
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_BalanceCoversOutstanding() public view {
        assertGe(usdc.balanceOf(address(escrow)), escrow.totalOutstanding());
    }

    /// @notice Independent ghost flow: in - out == totalOutstanding; balance == outstanding + donations.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_GhostFlowMatchesOutstanding() public view {
        assertEq(handler.ghostIn() - handler.ghostOut(), escrow.totalOutstanding());
        assertEq(usdc.balanceOf(address(escrow)), escrow.totalOutstanding() + handler.donated());
    }

    /// @notice At most one appeal per escrow; an appealed ruling records exactly one appellant who is a party.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_AtMostOneAppeal() public view {
        uint256 n = escrow.escrowCount();
        for (uint256 id = 1; id <= n; ++id) {
            assertLe(handler.appealCount(id), 1, "more than one appeal succeeded");
            Sure2PEscrowV3.Ruling memory r = escrow.getRuling(id);
            Sure2PEscrowV3.Escrow memory e = escrow.getEscrow(id);
            if (e.state == Sure2PEscrowV3.State.Appealed) assertTrue(r.appealed, "Appealed without flag");
            if (r.appealed) {
                assertTrue(r.appealedBy == e.buyer || r.appealedBy == e.seller, "appellant not a party");
                assertLe(r.appealedAt, r.appealDeadline, "appeal after deadline");
                assertEq(handler.appealCount(id), 1);
            } else {
                assertEq(handler.appealCount(id), 0);
            }
        }
    }

    /// @notice No credit and no claim before an escrow reaches Finalized / ExpiredUnfunded; afterwards
    /// credits + claimed == funded.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_NoCreditBeforeFinalization_CreditsPlusClaimedEqualsFunded() public view {
        uint256 n = escrow.escrowCount();
        for (uint256 id = 1; id <= n; ++id) {
            Sure2PEscrowV3.Escrow memory e = escrow.getEscrow(id);
            uint256 credits = escrow.claimable(id, e.buyer) + escrow.claimable(id, e.seller)
                + escrow.claimable(id, penaltyW);
            if (_isTerminal(e.state)) {
                assertEq(credits + handler.claimedTotal(id), _funded(e), "credits + claimed != funded");
            } else {
                assertEq(credits, 0, "credit before terminal state");
                assertEq(handler.claimedTotal(id), 0, "claimed before terminal state");
            }
        }
    }

    /// @notice Penalty (credited + claimed) never exceeds both deposits, and outcome / fraud data only exist
    /// once an escrow is Finalized; outcome.byAppeal matches whether an appeal happened.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_PenaltyBoundedAndOutcomeConsistent() public view {
        uint256 n = escrow.escrowCount();
        for (uint256 id = 1; id <= n; ++id) {
            Sure2PEscrowV3.Escrow memory e = escrow.getEscrow(id);
            uint256 pen = escrow.claimable(id, penaltyW) + handler.claimedPenalty(id);
            assertLe(pen, e.buyerDeposit + e.sellerDeposit, "penalty above deposits");

            Sure2PEscrowV3.Outcome memory o = escrow.outcomeOf(id);
            (bool bf, bool sf) = escrow.fraudConfirmed(id);
            if (e.state != Sure2PEscrowV3.State.Finalized || o.decidedBy == address(0)) {
                assertFalse(bf || sf, "fraud flagged without a finalizing ruling");
            }
            if (e.state != Sure2PEscrowV3.State.Finalized) {
                assertEq(o.decidedBy, address(0), "outcome before finalization");
            }
            if (o.decidedBy != address(0)) {
                assertEq(o.byAppeal, escrow.getRuling(id).appealed, "byAppeal mismatch");
                assertEq(bf, o.input.buyerFraud);
                assertEq(sf, o.input.sellerFraud);
                if (o.input.buyerFraud) assertTrue(o.input.buyerAtFault, "fraud without fault");
                if (o.input.sellerFraud) assertTrue(o.input.sellerAtFault, "fraud without fault");
                if (!o.input.buyerAtFault) assertEq(o.input.buyerDepositRefund, e.buyerDeposit);
                if (!o.input.sellerAtFault) assertEq(o.input.sellerDepositRefund, e.sellerDeposit);
            }
        }
    }

    /// @notice Owner, arbiter and reviewer are pairwise distinct; penalty wallet differs from both judges and is
    /// immutable; renouncing never succeeded; no ruling was accepted from a conflicted judge.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_RolesPairwiseDistinct() public view {
        address o = escrow.owner();
        address a = escrow.arbiter();
        address r = escrow.appealReviewer();
        assertTrue(o != address(0), "owner renounced");
        assertTrue(o != a, "owner == arbiter");
        assertTrue(o != r, "owner == reviewer");
        assertTrue(a != r, "arbiter == reviewer");
        assertTrue(escrow.penaltyWallet() != a, "penaltyWallet == arbiter");
        assertTrue(escrow.penaltyWallet() != r, "penaltyWallet == reviewer");
        assertEq(escrow.penaltyWallet(), penaltyW);
        assertEq(handler.roleViolations(), 0, "role violation observed after an action");
        assertEq(handler.conflictPrelims(), 0);
        assertEq(handler.conflictFinals(), 0);
    }

    /// @dev Liveness proof: scripted calls reach every ruling / role path so the invariants are not vacuous.
    function test_Handler_ReachesRulingPaths() public {
        for (uint256 i; i < 60; ++i) {
            handler.progress(4); // overdue route, unappealed finalize, claim
        }
        assertGt(handler.nCreated(), 0, "nCreated");
        assertGt(handler.nFunded(), 0, "nFunded");
        assertGt(handler.nFlagged(), 0, "nFlagged");
        assertGt(handler.nPrelim(), 0, "nPrelim");
        assertGt(handler.nFinalizedUnappealed(), 0, "nFinalizedUnappealed");
        assertGt(handler.nClaims(), 0, "nClaims");

        for (uint256 i; i < 120; ++i) {
            handler.progress(6); // appeal route
        }
        assertGt(handler.nAppeals(), 0, "nAppeals");
        assertGt(handler.nFinalRulings(), 0, "nFinalRulings");

        for (uint256 i; i < 300 && handler.nDisputed() == 0; ++i) {
            handler.progress(10 * (i + 1)); // dispute route
        }
        assertGt(handler.nDisputed(), 0, "nDisputed");

        for (uint256 i; i < 300 && handler.nCompleted() == 0; ++i) {
            handler.progress(7 * (i + 1)); // mutual completion route
        }
        assertGt(handler.nCompleted(), 0, "nCompleted");

        handler.swapArbiter(4); // cands[0]
        handler.swapReviewer(5); // cands[1]
        assertGt(handler.nRoleSwaps(), 0, "nRoleSwaps");
        handler.transferOwner(6); // cands[2]
        assertGt(handler.nOwnerTransfers(), 0, "nOwnerTransfers");
        handler.acceptOwner(1);
        assertGt(handler.nOwnerAccepts(), 0, "nOwnerAccepts");
        handler.anchor(0, false);
        handler.renounce();
        assertEq(handler.roleViolations(), 0);
    }

    function afterInvariant() public view {
        console2.log("created/funded/disputed/flagged", handler.nCreated(), handler.nFunded(), handler.nDisputed());
        console2.log("flagged/prelim/appeals", handler.nFlagged(), handler.nPrelim(), handler.nAppeals());
        console2.log("finalizedUnappealed/finalRulings/settled", handler.nFinalizedUnappealed(), handler.nFinalRulings(), handler.nSettled());
        console2.log("claims/roleSwaps/ownerXfer", handler.nClaims(), handler.nRoleSwaps(), handler.nOwnerTransfers());
        console2.log("ownerAccepts/expired/completed", handler.nOwnerAccepts(), handler.nExpired(), handler.nCompleted());
    }
}
