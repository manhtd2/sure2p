// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowV3} from "../Sure2PEscrowV3.sol";
import {Sure2PEscrowV3Base} from "./Sure2PEscrowV3.Base.t.sol";

/// @dev appeal() and finalizeRuling() (the unappealed path).
contract Sure2PEscrowV3AppealTest is Sure2PEscrowV3Base {
    event RulingAppealed(uint256 indexed id, address indexed by, bytes32 reasonHash);
    event RulingFinalized(uint256 indexed id, bool byAppeal);
    event CreditAssigned(uint256 indexed escrowId, address indexed account, uint256 amount);

    uint256 internal constant DEP = 25e6;

    // ------------------------------------------------------------ appeal

    function test_Appeal_BuyerSucceedsAndEmits() public {
        uint256 id = _ruled(PRICE, 20e6, DEP, 15e6, SF);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit RulingAppealed(id, buyer, REASON);
        _appeal(id, buyer);

        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Appealed));
        Sure2PEscrowV3.Ruling memory r = escrow.getRuling(id);
        assertTrue(r.appealed);
        assertEq(r.appealedBy, buyer);
        assertEq(r.appealedAt, uint64(block.timestamp));
        assertEq(r.appealReasonHash, REASON);
        assertFalse(escrow.appealOpen(id));
        // no credits created by an appeal
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b + s + p, 0);
    }

    function test_Appeal_SellerSucceeds() public {
        uint256 id = _ruled(PRICE, 20e6, DEP, 15e6, SF);
        _appeal(id, seller);
        assertEq(escrow.getRuling(id).appealedBy, seller);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Appealed));
    }

    function test_Appeal_AllowedExactlyAtDeadline() public {
        uint256 id = _ruledClean(PRICE, 0);
        uint64 dl = escrow.getRuling(id).appealDeadline;
        vm.warp(dl);
        assertTrue(escrow.appealOpen(id));
        _appeal(id, buyer);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Appealed));
    }

    function test_Appeal_RevertsOneSecondAfterDeadline() public {
        uint256 id = _ruledClean(PRICE, 0);
        uint64 dl = escrow.getRuling(id).appealDeadline;
        vm.warp(uint256(dl) + 1);
        assertFalse(escrow.appealOpen(id));
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV3.DeadlinePassed.selector);
        escrow.appeal(id, REASON);
    }

    function test_Appeal_OnlyOnce_SameParty() public {
        uint256 id = _ruledClean(PRICE, 0);
        _appeal(id, buyer);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Appealed));
        escrow.appeal(id, REASON);
    }

    function test_Appeal_OnlyOnce_OtherParty() public {
        uint256 id = _ruledClean(PRICE, 0);
        _appeal(id, buyer);
        vm.prank(seller);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Appealed));
        escrow.appeal(id, REASON);
        assertEq(escrow.getRuling(id).appealedBy, buyer);
    }

    function test_Appeal_RevertsOnZeroReasonHash() public {
        uint256 id = _ruledClean(PRICE, 0);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV3.ZeroCommitment.selector);
        escrow.appeal(id, bytes32(0));
    }

    function test_Appeal_RevertsForNonParties() public {
        uint256 id = _ruledClean(PRICE, 0);
        address[4] memory who = [stranger, arbiter, reviewer, owner];
        for (uint256 i; i < who.length; ++i) {
            vm.prank(who[i]);
            vm.expectRevert(Sure2PEscrowV3.Unauthorized.selector);
            escrow.appeal(id, REASON);
        }
    }

    function test_Appeal_RevertsInWrongState() public {
        uint256 active = _activeEscrow(PRICE);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Active));
        escrow.appeal(active, REASON);

        uint256 disputed = _disputed(PRICE);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Disputed));
        escrow.appeal(disputed, REASON);

        uint256 done = _ruledClean(PRICE, 0);
        _finalizeUnappealed(done);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Finalized));
        escrow.appeal(done, REASON);
    }

    function test_Appeal_RevertsOnUnknownEscrow() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.UnknownEscrow.selector, 7));
        escrow.appeal(7, REASON);
    }

    // ------------------------------------------------------------ finalizeRuling

    function test_Finalize_RevertsAtDeadline() public {
        uint256 id = _ruledClean(PRICE, 0);
        uint64 dl = escrow.getRuling(id).appealDeadline;
        vm.warp(dl);
        vm.expectRevert(Sure2PEscrowV3.DeadlineNotPassed.selector);
        escrow.finalizeRuling(id);
    }

    function test_Finalize_RevertsImmediately() public {
        uint256 id = _ruledClean(PRICE, 0);
        vm.expectRevert(Sure2PEscrowV3.DeadlineNotPassed.selector);
        escrow.finalizeRuling(id);
    }

    function test_Finalize_SucceedsOneSecondAfterDeadline() public {
        uint256 id = _ruledClean(PRICE, 0);
        uint64 dl = escrow.getRuling(id).appealDeadline;
        vm.warp(uint256(dl) + 1);
        escrow.finalizeRuling(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Finalized));
    }

    function test_Finalize_AnyoneMayCall() public {
        address[3] memory callers = [stranger, buyer, owner];
        for (uint256 i; i < callers.length; ++i) {
            uint256 id = _ruledClean(PRICE, 0);
            skip(APPEAL_WINDOW + 1);
            vm.prank(callers[i]);
            escrow.finalizeRuling(id);
            assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Finalized));
        }
    }

    function test_Finalize_EmitsEventsAndAssignsCredits() public {
        uint256 id = _ruled(PRICE, 20e6, DEP, 15e6, SF);
        skip(APPEAL_WINDOW + 1);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CreditAssigned(id, buyer, 45e6);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CreditAssigned(id, seller, 95e6);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CreditAssigned(id, penaltyW, 10e6);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit RulingFinalized(id, false);
        escrow.finalizeRuling(id);
    }

    function test_Finalize_ZeroCreditsAreNotAssigned() public {
        // buyer gets the full price back and both deposits; seller gets nothing and there is no penalty
        uint256 id = _ruledClean(PRICE, PRICE);
        _finalizeUnappealed(id);
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, PRICE + DEP);
        assertEq(s, DEP);
        assertEq(p, 0);
        vm.prank(penaltyW);
        vm.expectRevert(Sure2PEscrowV3.NoCredit.selector);
        escrow.claim(id);
    }

    function test_Finalize_WritesOutcomeNotByAppeal() public {
        uint256 id = _ruled(PRICE, 20e6, DEP, 15e6, SF);
        uint64 dl = escrow.getRuling(id).appealDeadline;
        _finalizeUnappealed(id);
        Sure2PEscrowV3.Outcome memory o = escrow.outcomeOf(id);
        assertEq(o.decidedBy, arbiter);
        assertEq(o.decidedAt, uint64(block.timestamp));
        assertGt(o.decidedAt, dl);
        assertFalse(o.byAppeal);
        assertEq(o.input.buyerPriceRefund, 20e6);
        assertEq(o.input.buyerDepositRefund, DEP);
        assertEq(o.input.sellerDepositRefund, 15e6);
        assertFalse(o.input.buyerAtFault);
        assertTrue(o.input.sellerAtFault);
        assertEq(o.input.reasonHash, RULE_HASH);
        assertEq(o.input.evidenceRoot, EVID_ROOT);
    }

    function test_Finalize_OutcomeKeepsOriginalIssuerAfterArbiterSwap() public {
        uint256 id = _ruledClean(PRICE, 0);
        vm.prank(owner);
        escrow.setArbiter(makeAddr("newArbiter"));
        _finalizeUnappealed(id);
        assertEq(escrow.outcomeOf(id).decidedBy, arbiter);
    }

    function test_Finalize_RevertsWhenAppealed() public {
        uint256 id = _ruledClean(PRICE, 0);
        _appeal(id, seller);
        skip(APPEAL_WINDOW + 1);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Appealed));
        escrow.finalizeRuling(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Appealed));
    }

    function test_Finalize_RevertsInWrongState() public {
        uint256 disputed = _disputed(PRICE);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Disputed));
        escrow.finalizeRuling(disputed);

        uint256 done = _ruledClean(PRICE, 0);
        _finalizeUnappealed(done);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Finalized));
        escrow.finalizeRuling(done);
    }

    function test_Finalize_RevertsOnUnknownEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.UnknownEscrow.selector, 5));
        escrow.finalizeRuling(5);
    }

    function test_Finalize_CannotBeAppealedAfterwards() public {
        uint256 id = _ruledClean(PRICE, 0);
        _finalizeUnappealed(id);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Finalized));
        escrow.appeal(id, REASON);
    }
}
