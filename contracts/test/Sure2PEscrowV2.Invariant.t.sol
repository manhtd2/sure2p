// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {Sure2PEscrowV2} from "../Sure2PEscrowV2.sol";
import {Sure2PAccountRegistry} from "../Sure2PAccountRegistry.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Sure2PEscrowV2Handler} from "./Sure2PEscrowV2.Handler.t.sol";

contract Sure2PEscrowV2InvariantTest is Test {
    MockUSDC internal usdc;
    Sure2PEscrowV2 internal escrow;
    Sure2PEscrowV2Handler internal handler;
    address internal owner = makeAddr("owner");
    address internal penaltyW = makeAddr("penaltyWallet");

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC();
        Sure2PAccountRegistry registry = new Sure2PAccountRegistry(makeAddr("admin"), makeAddr("security"));
        escrow = new Sure2PEscrowV2(
            address(usdc), ISure2PAccountRegistry(address(registry)), penaltyW, owner,
            makeAddr("arbiter"), makeAddr("reviewer")
        );
        handler = new Sure2PEscrowV2Handler(escrow, usdc, owner, penaltyW);
        targetContract(address(handler));
        // weight toward the progress driver (3 selectors) so ruling / appeal / finalize paths are reached often
        bytes4[] memory sel = new bytes4[](14);
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
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
    }

    function _funded(Sure2PEscrowV2.Escrow memory e) internal pure returns (uint256) {
        return (e.buyerFunded ? e.price + e.buyerDeposit : 0) + (e.sellerFunded ? e.sellerDeposit : 0);
    }

    function _isTerminal(Sure2PEscrowV2.State s) internal pure returns (bool) {
        return s == Sure2PEscrowV2.State.Finalized || s == Sure2PEscrowV2.State.ExpiredUnfunded;
    }

    /// @notice S7: the contract always holds at least what it owes.
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

    /// @notice S4: at most one appeal per escrow, and an appealed ruling records exactly one appellant who is a party.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_AtMostOneAppeal() public view {
        uint256 n = escrow.escrowCount();
        for (uint256 id = 1; id <= n; ++id) {
            assertLe(handler.appealCount(id), 1, "more than one appeal succeeded");
            Sure2PEscrowV2.Ruling memory r = escrow.getRuling(id);
            Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
            if (e.state == Sure2PEscrowV2.State.Appealed) assertTrue(r.appealed, "Appealed without flag");
            if (r.appealed) {
                assertTrue(r.appealedBy == e.buyer || r.appealedBy == e.seller, "appellant not a party");
                assertLe(r.appealedAt, r.appealDeadline, "appeal after deadline");
                assertEq(handler.appealCount(id), 1);
            } else {
                assertEq(handler.appealCount(id), 0);
            }
        }
    }

    /// @notice Per escrow: credits + claimed == funded once terminal; nothing credited or claimed before.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_CreditsPlusClaimedEqualsFunded() public view {
        uint256 n = escrow.escrowCount();
        for (uint256 id = 1; id <= n; ++id) {
            Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
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

    /// @notice S1/S2/S5: penalty (credited + claimed) never exceeds one party deposit; non-parties get no credit.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_PenaltyBoundedAndOnlyKnownRecipients() public view {
        uint256 n = escrow.escrowCount();
        for (uint256 id = 1; id <= n; ++id) {
            Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
            uint256 pen = escrow.claimable(id, penaltyW) + handler.claimedPenalty(id);
            assertLe(pen, e.sellerDeposit, "penalty above deposit");
            // the owner can never be credited
            assertEq(escrow.claimable(id, owner), 0, "owner credited");
        }
    }

    /// @notice S3: no ruling was ever accepted from a party-arbiter, party-reviewer, or reviewer == preliminary issuer.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_NoConflictedRulings() public view {
        assertEq(handler.conflictPrelims(), 0);
        assertEq(handler.conflictFinals(), 0);
        assertTrue(escrow.arbiter() != escrow.appealReviewer());
        assertTrue(escrow.arbiter() != escrow.penaltyWallet());
        assertTrue(escrow.appealReviewer() != escrow.penaltyWallet());
    }

    /// @notice Owner swaps never alter immutable config or let the owner hold credits.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 200
    function invariant_PenaltyWalletAndOwnerStable() public view {
        assertEq(escrow.penaltyWallet(), penaltyW);
        assertEq(escrow.owner(), owner);
    }

    /// @dev Liveness proof for the handler: scripted calls reach every ruling path (so invariants are not vacuous).
    function test_Handler_ReachesRulingPaths() public {
        // seed % 5 != 0 -> overdue route; seed % 3 == 1 -> unappealed finalize; seed % 3 == 0 -> appeal
        for (uint256 i; i < 40; ++i) {
            handler.progress(4); // create / fund / flag / prelim / finalize / claim
        }
        assertGt(handler.nCreated(), 0, "nCreated");
        assertGt(handler.nFunded(), 0, "nFunded");
        assertGt(handler.nFlagged(), 0, "nFlagged");
        assertGt(handler.nPrelim(), 0, "nPrelim");
        assertGt(handler.nFinalizedUnappealed(), 0, "nFinalizedUnappealed");
        assertGt(handler.nClaims(), 0, "nClaims");

        // appeal route: seed 6 -> %5 != 0 (overdue), %3 == 0 (appeal), then final ruling
        for (uint256 i; i < 80; ++i) {
            handler.progress(6);
        }
        assertGt(handler.nAppeals(), 0, "nAppeals");
        assertGt(handler.nFinalRulings(), 0, "nFinalRulings");

        // dispute route: seed 10 -> %5 == 0 (dispute)
        for (uint256 i; i < 200 && handler.nDisputed() == 0; ++i) {
            handler.progress(10 * (i + 1));
        }
        assertGt(handler.nDisputed(), 0, "nDisputed");
        handler.swapArbiter(1);
        assertGt(handler.nRoleSwaps(), 0, "nRoleSwaps");
        handler.anchor(0, false);
    }

    function afterInvariant() public view {
        console2.log("created/funded/disputed/flagged", handler.nCreated(), handler.nFunded(), handler.nDisputed());
        console2.log("flagged/prelim/appeals", handler.nFlagged(), handler.nPrelim(), handler.nAppeals());
        console2.log("finalizedUnappealed/finalRulings/settled", handler.nFinalizedUnappealed(), handler.nFinalRulings(), handler.nSettled());
        console2.log("claims/roleSwaps/evidence", handler.nClaims(), handler.nRoleSwaps(), handler.nEvidence());
    }
}
