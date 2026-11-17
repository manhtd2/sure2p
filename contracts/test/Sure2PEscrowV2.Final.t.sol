// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowV2} from "../Sure2PEscrowV2.sol";
import {Sure2PEscrowV2Base} from "./Sure2PEscrowV2.Base.t.sol";

/// @dev issueFinalRuling and anchorEvidence.
contract Sure2PEscrowV2FinalTest is Sure2PEscrowV2Base {
    event FinalRulingIssued(
        uint256 indexed id, address indexed issuedBy, uint256 buyerPriceRefund,
        Sure2PEscrowV2.Fault fault, uint256 penalty, bytes32 reasonHash
    );
    event RulingFinalized(uint256 indexed id, bool byAppeal);
    event EvidenceAnchored(uint256 indexed id, address indexed by, bytes32 evidenceHash, uint64 at);

    uint256 internal constant DEP = 25e6;
    bytes32 internal constant EVID = keccak256("evidence");
    Sure2PEscrowV2.Fault internal constant NONE = Sure2PEscrowV2.Fault.None;
    Sure2PEscrowV2.Fault internal constant BUYER = Sure2PEscrowV2.Fault.Buyer;
    Sure2PEscrowV2.Fault internal constant SELLER = Sure2PEscrowV2.Fault.Seller;

    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _ruled(PRICE, 100e6, SELLER, 25e6); // arbiter favours buyer
        _appeal(id, seller);
    }

    // ------------------------------------------------------------ issueFinalRuling happy

    function test_Final_ReviewerSucceedsAndEmits() public {
        vm.expectEmit(true, true, false, true, address(escrow));
        emit FinalRulingIssued(id, reviewer, 0, BUYER, DEP, RULE_HASH);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit RulingFinalized(id, true);
        _final(id, 0, BUYER, DEP);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV2.State.Finalized));
    }

    function test_Final_CanOverturnInAnyDirection() public {
        _final(id, 0, BUYER, DEP);
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, 0 + DEP - DEP);
        assertEq(s, PRICE + DEP);
        assertEq(p, DEP);
        assertEq(b + s + p, PRICE + 2 * DEP);
    }

    function test_Final_SameAsPreliminaryAllowed() public {
        _final(id, 100e6, SELLER, 25e6);
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, 125e6);
        assertEq(s, 0);
        assertEq(p, 25e6);
    }

    function test_Final_PreliminaryAndAppealRemainStored() public {
        _final(id, 0, NONE, 0);
        Sure2PEscrowV2.Ruling memory r = escrow.getRuling(id);
        assertEq(r.issuedBy, arbiter);
        assertEq(r.buyerPriceRefund, 100e6);
        assertTrue(r.appealed);
        assertEq(r.appealedBy, seller);
    }

    function test_Final_CreditsClaimable() public {
        _final(id, 60e6, BUYER, DEP / 2);
        vm.prank(buyer);
        escrow.claim(id);
        vm.prank(seller);
        escrow.claim(id);
        vm.prank(penaltyW);
        escrow.claim(id);
        assertEq(usdc.balanceOf(penaltyW), DEP / 2);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalOutstanding(), 0);
    }

    // ------------------------------------------------------------ issueFinalRuling reverts

    function test_Final_RevertsForNonReviewer() public {
        address[5] memory bad = [stranger, arbiter, owner, penaltyW, address(this)];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
            escrow.issueFinalRuling(id, 0, NONE, 0, RULE_HASH);
        }
    }

    function test_Final_RevertsForParties() public {
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
        escrow.issueFinalRuling(id, 0, NONE, 0, RULE_HASH);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
        escrow.issueFinalRuling(id, 0, NONE, 0, RULE_HASH);
    }

    function test_Final_RevertsWhenReviewerIsAParty() public {
        vm.prank(owner);
        escrow.setAppealReviewer(buyer);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
        escrow.issueFinalRuling(id, 0, NONE, 0, RULE_HASH);

        vm.prank(owner);
        escrow.setAppealReviewer(seller);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
        escrow.issueFinalRuling(id, 0, NONE, 0, RULE_HASH);
    }

    function test_Final_RevertsForPreliminaryIssuerEvenAfterRoleSwap() public {
        address newArbiter = makeAddr("newArbiter");
        vm.startPrank(owner);
        escrow.setArbiter(newArbiter);
        escrow.setAppealReviewer(arbiter); // old arbiter (the preliminary issuer) becomes reviewer
        vm.stopPrank();
        assertEq(escrow.appealReviewer(), arbiter);

        vm.prank(arbiter);
        vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
        escrow.issueFinalRuling(id, 0, NONE, 0, RULE_HASH);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV2.State.Appealed));

        // a different reviewer can still decide it
        address third = makeAddr("third");
        vm.prank(owner);
        escrow.setAppealReviewer(third);
        vm.prank(third);
        escrow.issueFinalRuling(id, 0, NONE, 0, RULE_HASH);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV2.State.Finalized));
    }

    function test_Final_ReplacedReviewerLosesPower() public {
        address newReviewer = makeAddr("newReviewer");
        vm.prank(owner);
        escrow.setAppealReviewer(newReviewer);
        vm.prank(reviewer);
        vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
        escrow.issueFinalRuling(id, 0, NONE, 0, RULE_HASH);
        vm.prank(newReviewer);
        escrow.issueFinalRuling(id, 0, NONE, 0, RULE_HASH);
    }

    function _expectFinalWrongState(uint256 eid, Sure2PEscrowV2.State st) internal {
        vm.prank(reviewer);
        vm.expectRevert(_invalidState(st));
        escrow.issueFinalRuling(eid, 0, NONE, 0, RULE_HASH);
    }

    function test_Final_RevertsWhenPreliminaryRulingNotAppealed() public {
        _expectFinalWrongState(_ruled(PRICE, 0, NONE, 0), Sure2PEscrowV2.State.PreliminaryRuling);
    }

    function test_Final_RevertsWhenDisputed() public {
        _expectFinalWrongState(_disputed(PRICE), Sure2PEscrowV2.State.Disputed);
    }

    function test_Final_RevertsWhenOverdue() public {
        _expectFinalWrongState(_overdue(PRICE), Sure2PEscrowV2.State.Overdue);
    }

    function test_Final_RevertsWhenActive() public {
        _expectFinalWrongState(_activeEscrow(PRICE), Sure2PEscrowV2.State.Active);
    }

    function test_Final_RevertsWhenAlreadyFinalized() public {
        _final(id, 0, NONE, 0);
        _expectFinalWrongState(id, Sure2PEscrowV2.State.Finalized);
    }

    function test_Final_RevertsOnUnknownEscrow() public {
        vm.prank(reviewer);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV2.UnknownEscrow.selector, 88));
        escrow.issueFinalRuling(88, 0, NONE, 0, RULE_HASH);
    }

    function test_Final_RevertsWhenRefundExceedsPrice() public {
        vm.prank(reviewer);
        vm.expectRevert(Sure2PEscrowV2.InvalidRuling.selector);
        escrow.issueFinalRuling(id, PRICE + 1, NONE, 0, RULE_HASH);
    }

    function test_Final_RevertsWhenPenaltyExceedsAtFaultDeposit() public {
        vm.prank(reviewer);
        vm.expectRevert(Sure2PEscrowV2.InvalidRuling.selector);
        escrow.issueFinalRuling(id, 0, BUYER, DEP + 1, RULE_HASH);
        vm.prank(reviewer);
        vm.expectRevert(Sure2PEscrowV2.InvalidRuling.selector);
        escrow.issueFinalRuling(id, 0, SELLER, DEP + 1, RULE_HASH);
    }

    function test_Final_RevertsWhenPenaltyWithFaultNone() public {
        vm.prank(reviewer);
        vm.expectRevert(Sure2PEscrowV2.InvalidRuling.selector);
        escrow.issueFinalRuling(id, 0, NONE, 1, RULE_HASH);
    }

    function test_Final_RevertsOnZeroReasonHash() public {
        vm.prank(reviewer);
        vm.expectRevert(Sure2PEscrowV2.ZeroCommitment.selector);
        escrow.issueFinalRuling(id, 0, NONE, 0, bytes32(0));
    }

    // ------------------------------------------------------------ anchorEvidence

    function _expectAnchor(uint256 eid, address who) internal {
        vm.expectEmit(true, true, false, true, address(escrow));
        emit EvidenceAnchored(eid, who, EVID, uint64(block.timestamp));
        vm.prank(who);
        escrow.anchorEvidence(eid, EVID);
    }

    function test_Evidence_PartiesAnchorAndEventEmitted_Appealed() public {
        _expectAnchor(id, buyer);
        _expectAnchor(id, seller);
    }

    function test_Evidence_AllowedInDisputed() public {
        uint256 d = _disputed(PRICE);
        _expectAnchor(d, buyer);
        _expectAnchor(d, seller);
    }

    function test_Evidence_AllowedInOverdue() public {
        uint256 o = _overdue(PRICE);
        _expectAnchor(o, seller);
    }

    function test_Evidence_AllowedInPreliminaryRuling() public {
        uint256 r = _ruled(PRICE, 0, NONE, 0);
        _expectAnchor(r, buyer);
        // still allowed at the final second of the appeal window
        vm.warp(escrow.getRuling(r).appealDeadline);
        _expectAnchor(r, seller);
    }

    function test_Evidence_DoesNotChangeState() public {
        uint256 d = _disputed(PRICE);
        _expectAnchor(d, buyer);
        assertEq(uint8(_state(d)), uint8(Sure2PEscrowV2.State.Disputed));
    }

    function test_Evidence_RevertsForNonParties() public {
        address[5] memory bad = [stranger, arbiter, reviewer, owner, penaltyW];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
            escrow.anchorEvidence(id, EVID);
        }
    }

    function test_Evidence_RevertsOnZeroHash() public {
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV2.ZeroCommitment.selector);
        escrow.anchorEvidence(id, bytes32(0));
    }

    function _expectAnchorWrongState(uint256 eid, Sure2PEscrowV2.State st) internal {
        vm.prank(buyer);
        vm.expectRevert(_invalidState(st));
        escrow.anchorEvidence(eid, EVID);
    }

    function test_Evidence_RevertsInFunding() public {
        _expectAnchorWrongState(_newEscrow(PRICE), Sure2PEscrowV2.State.Funding);
    }

    function test_Evidence_RevertsInActive() public {
        _expectAnchorWrongState(_activeEscrow(PRICE), Sure2PEscrowV2.State.Active);
    }

    function test_Evidence_RevertsInFinalized() public {
        _final(id, 0, NONE, 0);
        _expectAnchorWrongState(id, Sure2PEscrowV2.State.Finalized);
    }

    function test_Evidence_RevertsInExpiredUnfunded() public {
        uint256 e = _newEscrow(PRICE);
        skip(24 hours + 1);
        escrow.expireUnfunded(e);
        _expectAnchorWrongState(e, Sure2PEscrowV2.State.ExpiredUnfunded);
    }

    function test_Evidence_RevertsOnUnknownEscrow() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV2.UnknownEscrow.selector, 66));
        escrow.anchorEvidence(66, EVID);
    }
}
