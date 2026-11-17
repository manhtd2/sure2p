// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowV2} from "../Sure2PEscrowV2.sol";
import {Sure2PEscrowV2Base} from "./Sure2PEscrowV2.Base.t.sol";

/// @dev appeal, finalizeRuling, and the getRuling / appealOpen views.
contract Sure2PEscrowV2AppealTest is Sure2PEscrowV2Base {
    event RulingAppealed(uint256 indexed id, address indexed by, bytes32 reasonHash);
    event RulingFinalized(uint256 indexed id, bool byAppeal);
    event CreditAssigned(uint256 indexed escrowId, address indexed account, uint256 amount);

    uint256 internal id;
    uint64 internal deadline;

    function setUp() public override {
        super.setUp();
        id = _ruled(PRICE, 40e6, Sure2PEscrowV2.Fault.Seller, 10e6);
        deadline = escrow.getRuling(id).appealDeadline;
    }

    // ------------------------------------------------------------ appeal

    function test_Appeal_BuyerSucceedsAndEmits() public {
        vm.expectEmit(true, true, false, true, address(escrow));
        emit RulingAppealed(id, buyer, REASON);
        _appeal(id, buyer);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV2.State.Appealed));
        Sure2PEscrowV2.Ruling memory r = escrow.getRuling(id);
        assertTrue(r.appealed);
        assertEq(r.appealedBy, buyer);
        assertEq(r.appealedAt, uint64(block.timestamp));
        assertEq(r.appealReasonHash, REASON);
        // original preliminary data retained
        assertEq(r.issuedBy, arbiter);
        assertEq(r.penalty, 10e6);
    }

    function test_Appeal_SellerSucceeds() public {
        _appeal(id, seller);
        assertEq(escrow.getRuling(id).appealedBy, seller);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV2.State.Appealed));
    }

    function test_Appeal_AppealDoesNotMoveFundsOrAssignCredits() public {
        _appeal(id, buyer);
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b + s + p, 0);
        assertEq(escrow.totalOutstanding(), PRICE + 50e6);
    }

    function test_Appeal_SucceedsExactlyAtDeadline() public {
        vm.warp(deadline);
        _appeal(id, seller);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV2.State.Appealed));
    }

    function test_Appeal_RevertsOneSecondAfterDeadline() public {
        vm.warp(uint256(deadline) + 1);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV2.DeadlinePassed.selector);
        escrow.appeal(id, REASON);
    }

    function test_Appeal_RevertsForNonParties() public {
        address[5] memory bad = [stranger, arbiter, reviewer, owner, penaltyW];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
            escrow.appeal(id, REASON);
        }
    }

    function test_Appeal_RevertsOnZeroHash() public {
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV2.ZeroCommitment.selector);
        escrow.appeal(id, bytes32(0));
    }

    function test_Appeal_OnlyOnce_SamePartyAndCounterparty() public {
        _appeal(id, buyer);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV2.State.Appealed));
        escrow.appeal(id, REASON);
        vm.prank(seller);
        vm.expectRevert(_invalidState(Sure2PEscrowV2.State.Appealed));
        escrow.appeal(id, REASON);
        assertEq(escrow.getRuling(id).appealedBy, buyer, "first appeal retained");
    }

    function test_Appeal_RevertsInWrongStates() public {
        // Disputed (no ruling yet)
        uint256 d = _disputed(PRICE);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV2.State.Disputed));
        escrow.appeal(d, REASON);
        // Active
        uint256 a = _activeEscrow(PRICE);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV2.State.Active));
        escrow.appeal(a, REASON);
        // Finalized (after finalizeRuling)
        skip(APPEAL_WINDOW + 1);
        escrow.finalizeRuling(id);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV2.State.Finalized));
        escrow.appeal(id, REASON);
    }

    function test_Appeal_RevertsOnUnknownEscrow() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV2.UnknownEscrow.selector, 77));
        escrow.appeal(77, REASON);
    }

    // ------------------------------------------------------------ finalizeRuling

    function test_Finalize_RevertsAtDeadline() public {
        vm.warp(deadline);
        vm.expectRevert(Sure2PEscrowV2.DeadlineNotPassed.selector);
        escrow.finalizeRuling(id);
    }

    function test_Finalize_RevertsImmediatelyAfterIssue() public {
        vm.expectRevert(Sure2PEscrowV2.DeadlineNotPassed.selector);
        escrow.finalizeRuling(id);
    }

    function test_Finalize_SucceedsOneSecondAfterDeadline() public {
        vm.warp(uint256(deadline) + 1);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit RulingFinalized(id, false);
        escrow.finalizeRuling(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV2.State.Finalized));
    }

    function test_Finalize_AssignsCreditsPerRuling() public {
        vm.warp(uint256(deadline) + 1);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CreditAssigned(id, penaltyW, 10e6);
        escrow.finalizeRuling(id);
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, 40e6 + 25e6);
        assertEq(s, 60e6 + 25e6 - 10e6);
        assertEq(p, 10e6);
    }

    function test_Finalize_AnyoneMayCall() public {
        address[4] memory callers = [stranger, buyer, seller, penaltyW];
        for (uint256 i; i < callers.length; ++i) {
            uint256 nid = _ruled(PRICE, 0, Sure2PEscrowV2.Fault.None, 0);
            skip(APPEAL_WINDOW + 1);
            vm.prank(callers[i]);
            escrow.finalizeRuling(nid);
            assertEq(uint8(_state(nid)), uint8(Sure2PEscrowV2.State.Finalized));
        }
    }

    function test_Finalize_RevertsIfAppealed() public {
        _appeal(id, seller);
        vm.warp(uint256(deadline) + 1);
        vm.expectRevert(_invalidState(Sure2PEscrowV2.State.Appealed));
        escrow.finalizeRuling(id);
    }

    function test_Finalize_RevertsTwice() public {
        vm.warp(uint256(deadline) + 1);
        escrow.finalizeRuling(id);
        vm.expectRevert(_invalidState(Sure2PEscrowV2.State.Finalized));
        escrow.finalizeRuling(id);
    }

    function test_Finalize_RevertsInWrongState() public {
        uint256 d = _disputed(PRICE);
        vm.expectRevert(_invalidState(Sure2PEscrowV2.State.Disputed));
        escrow.finalizeRuling(d);
    }

    function test_Finalize_RevertsOnUnknownEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV2.UnknownEscrow.selector, 55));
        escrow.finalizeRuling(55);
    }

    function test_Finalize_DeadlineIsExactly72HoursFromIssue() public view {
        assertEq(uint256(deadline), block.timestamp + APPEAL_WINDOW);
    }

    // ------------------------------------------------------------ views

    function test_AppealOpen_TrueDuringWindowIncludingDeadline() public {
        assertTrue(escrow.appealOpen(id));
        vm.warp(deadline);
        assertTrue(escrow.appealOpen(id));
    }

    function test_AppealOpen_FalseAfterDeadline() public {
        vm.warp(uint256(deadline) + 1);
        assertFalse(escrow.appealOpen(id));
    }

    function test_AppealOpen_FalseAfterAppeal() public {
        _appeal(id, buyer);
        assertFalse(escrow.appealOpen(id));
    }

    function test_AppealOpen_FalseAfterFinalize() public {
        vm.warp(uint256(deadline) + 1);
        escrow.finalizeRuling(id);
        assertFalse(escrow.appealOpen(id));
    }

    function test_AppealOpen_FalseBeforeAnyRuling() public {
        assertFalse(escrow.appealOpen(_disputed(PRICE)));
    }

    function test_AppealOpen_RevertsOnUnknownEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV2.UnknownEscrow.selector, 1234));
        escrow.appealOpen(1234);
    }

    function test_GetRuling_ZeroBeforeRuling() public {
        Sure2PEscrowV2.Ruling memory r = escrow.getRuling(_disputed(PRICE));
        assertEq(r.issuedBy, address(0));
        assertEq(r.issuedAt, 0);
        assertEq(r.appealDeadline, 0);
        assertEq(r.reasonHash, bytes32(0));
        assertFalse(r.appealed);
    }

    function test_GetRuling_ReflectsIssuedRuling() public view {
        Sure2PEscrowV2.Ruling memory r = escrow.getRuling(id);
        assertEq(r.issuedBy, arbiter);
        assertEq(r.buyerPriceRefund, 40e6);
        assertEq(r.penalty, 10e6);
        assertEq(uint8(r.fault), uint8(Sure2PEscrowV2.Fault.Seller));
        assertEq(r.reasonHash, RULE_HASH);
    }

    function test_GetRuling_RevertsOnUnknownEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV2.UnknownEscrow.selector, 4321));
        escrow.getRuling(4321);
    }
}
