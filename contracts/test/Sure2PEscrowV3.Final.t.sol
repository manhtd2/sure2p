// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowV3} from "../Sure2PEscrowV3.sol";
import {Sure2PEscrowV3Base} from "./Sure2PEscrowV3.Base.t.sol";

/// @dev issueFinalRuling, fraudConfirmed, mutual settlement mid-case, role replacement, anchorEvidence.
contract Sure2PEscrowV3FinalTest is Sure2PEscrowV3Base {
    event FinalRulingIssued(
        uint256 indexed id, address indexed issuedBy, uint256 buyerPriceRefund,
        uint256 buyerDepositRefund, uint256 sellerDepositRefund,
        bool buyerAtFault, bool sellerAtFault, bool buyerFraud, bool sellerFraud,
        bytes32 reasonHash, bytes32 evidenceRoot
    );
    event RulingFinalized(uint256 indexed id, bool byAppeal);
    event CreditAssigned(uint256 indexed escrowId, address indexed account, uint256 amount);
    event EvidenceAnchored(uint256 indexed id, address indexed by, bytes32 evidenceHash, uint64 at);
    event MutualSettlementExecuted(uint256 indexed escrowId, uint256 buyerPriceRefund, uint256 nonce);

    uint256 internal constant DEP = 25e6;

    /// @dev Disputed -> prelim (seller fault, fraud) -> appealed by buyer.
    function _appealedCase() internal returns (uint256 id) {
        id = _ruled(PRICE, 0, DEP, 0, SF | SFR);
        _appeal(id, buyer);
    }

    function _revFinal(uint256 id, address who, Sure2PEscrowV3.RulingInput memory r, bytes memory err) internal {
        vm.prank(who);
        vm.expectRevert(err);
        escrow.issueFinalRuling(id, r);
    }

    // ------------------------------------------------------------ issueFinalRuling happy path

    function test_Final_WritesOutcomeByAppealAndOverridesPreliminary() public {
        uint256 id = _appealedCase();
        _final(id, 60e6, 10e6, DEP, BF);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Finalized));

        Sure2PEscrowV3.Outcome memory o = escrow.outcomeOf(id);
        assertEq(o.decidedBy, reviewer);
        assertEq(o.decidedAt, uint64(block.timestamp));
        assertTrue(o.byAppeal);
        assertEq(o.input.buyerPriceRefund, 60e6);
        assertEq(o.input.buyerDepositRefund, 10e6);
        assertEq(o.input.sellerDepositRefund, DEP);
        assertTrue(o.input.buyerAtFault);
        assertFalse(o.input.sellerAtFault);
        assertFalse(o.input.sellerFraud);

        // credits follow the FINAL input, not the preliminary one
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, 70e6);
        assertEq(s, 40e6 + DEP);
        assertEq(p, 15e6);
        assertEq(b + s + p, PRICE + 2 * DEP);

        // preliminary record is preserved
        Sure2PEscrowV3.Ruling memory r = escrow.getRuling(id);
        assertEq(r.issuedBy, arbiter);
        assertTrue(r.input.sellerFraud);
        assertTrue(r.appealed);
    }

    function test_Final_EmitsEvents() public {
        uint256 id = _appealedCase();
        Sure2PEscrowV3.RulingInput memory in_ = _in(id, 20e6, DEP, 15e6, SF);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CreditAssigned(id, buyer, 45e6);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CreditAssigned(id, seller, 95e6);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CreditAssigned(id, penaltyW, 10e6);
        // event order in contract: credits first (inside _finalizeRulingCredits), then FinalRulingIssued, then RulingFinalized
        vm.expectEmit(true, true, false, true, address(escrow));
        emit FinalRulingIssued(id, reviewer, 20e6, DEP, 15e6, false, true, false, false, RULE_HASH, EVID_ROOT);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit RulingFinalized(id, true);
        _finalIn(id, in_);
    }

    function test_Final_AllowedAfterAppealDeadlineHasPassed() public {
        uint256 id = _ruledClean(PRICE, 0);
        uint64 dl = escrow.getRuling(id).appealDeadline;
        vm.warp(dl);
        _appeal(id, buyer);
        skip(30 days);
        _finalIn(id, _clean(id, PRICE));
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Finalized));
    }

    function test_Final_ClaimsPayOutExactly() public {
        uint256 id = _appealedCase();
        _final(id, 20e6, DEP, 15e6, SF);
        uint256 bb = usdc.balanceOf(buyer);
        uint256 sb = usdc.balanceOf(seller);
        vm.prank(buyer);
        escrow.claim(id);
        vm.prank(seller);
        escrow.claim(id);
        vm.prank(penaltyW);
        escrow.claim(id);
        assertEq(usdc.balanceOf(buyer) - bb, 45e6);
        assertEq(usdc.balanceOf(seller) - sb, 95e6);
        assertEq(usdc.balanceOf(penaltyW), 10e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // ------------------------------------------------------------ issueFinalRuling access control

    function test_Final_RevertsForNonReviewer() public {
        uint256 id = _appealedCase();
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        address[5] memory who = [stranger, arbiter, owner, buyer, seller];
        for (uint256 i; i < who.length; ++i) {
            _revFinal(id, who[i], r, abi.encodeWithSelector(Sure2PEscrowV3.Unauthorized.selector));
        }
    }

    function test_Final_PreliminaryIssuerCannotReviewEvenAfterRoleSwap() public {
        uint256 id = _appealedCase(); // prelim issued by `arbiter`
        // owner swaps: new arbiter, and the OLD arbiter becomes appeal reviewer
        vm.startPrank(owner);
        escrow.setArbiter(makeAddr("newArbiter"));
        escrow.setAppealReviewer(arbiter);
        vm.stopPrank();
        assertEq(escrow.appealReviewer(), arbiter);
        assertEq(escrow.getRuling(id).issuedBy, arbiter);

        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        _revFinal(id, arbiter, r, abi.encodeWithSelector(Sure2PEscrowV3.Unauthorized.selector));
        // the replaced reviewer has no authority either
        _revFinal(id, reviewer, r, abi.encodeWithSelector(Sure2PEscrowV3.Unauthorized.selector));
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Appealed));

        // owner can fix the deadlock by installing another reviewer
        address r2 = makeAddr("reviewer2");
        vm.prank(owner);
        escrow.setAppealReviewer(r2);
        vm.prank(r2);
        escrow.issueFinalRuling(id, r);
        assertEq(escrow.outcomeOf(id).decidedBy, r2);
    }

    function test_Final_ReplacedReviewerLosesAuthorityNewReviewerRules() public {
        uint256 id = _appealedCase();
        address r2 = makeAddr("reviewer2");
        vm.prank(owner);
        escrow.setAppealReviewer(r2);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        _revFinal(id, reviewer, r, abi.encodeWithSelector(Sure2PEscrowV3.Unauthorized.selector));
        vm.prank(r2);
        escrow.issueFinalRuling(id, r);
        assertEq(escrow.outcomeOf(id).decidedBy, r2);
    }

    function test_Final_ReviewerWhoIsAPartyCannotRule() public {
        uint256 id = _appealedCase();
        vm.prank(owner);
        escrow.setAppealReviewer(buyer);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        _revFinal(id, buyer, r, abi.encodeWithSelector(Sure2PEscrowV3.Unauthorized.selector));

        vm.prank(owner);
        escrow.setAppealReviewer(seller);
        _revFinal(id, seller, r, abi.encodeWithSelector(Sure2PEscrowV3.Unauthorized.selector));
    }

    function test_Final_RevertsInWrongState() public {
        // Disputed (never ruled)
        uint256 disputed = _disputed(PRICE);
        Sure2PEscrowV3.RulingInput memory r = _clean(disputed, 0);
        _revFinal(disputed, reviewer, r, _invalidState(Sure2PEscrowV3.State.Disputed));

        // PreliminaryRuling (not yet appealed)
        uint256 prelim = _ruledClean(PRICE, 0);
        r = _clean(prelim, 0);
        _revFinal(prelim, reviewer, r, _invalidState(Sure2PEscrowV3.State.PreliminaryRuling));

        // Finalized
        _finalizeUnappealed(prelim);
        _revFinal(prelim, reviewer, r, _invalidState(Sure2PEscrowV3.State.Finalized));

        // Active
        uint256 active = _activeEscrow(PRICE);
        r = _clean(active, 0);
        _revFinal(active, reviewer, r, _invalidState(Sure2PEscrowV3.State.Active));
    }

    function test_Final_CannotRuleTwice() public {
        uint256 id = _appealedCase();
        _final(id, 0, DEP, DEP, 0);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        _revFinal(id, reviewer, r, _invalidState(Sure2PEscrowV3.State.Finalized));
    }

    // ------------------------------------------------------------ issueFinalRuling validation

    function test_Final_ValidationReverts() public {
        uint256 id = _appealedCase();
        uint256 other = _disputed(PRICE);
        Sure2PEscrowV3.RulingInput memory r = _clean(other, 0);
        _revFinal(
            id, reviewer, r,
            abi.encodeWithSelector(
                Sure2PEscrowV3.RulingAgreementMismatch.selector, escrow.getEscrow(id).agreementHash, r.agreementHash
            )
        );
        _revFinal(
            id, reviewer, _in(id, PRICE + 1, DEP, DEP, 0),
            abi.encodeWithSelector(Sure2PEscrowV3.RulingRefundTooLarge.selector, PRICE + 1, PRICE)
        );
        _revFinal(
            id, reviewer, _in(id, 0, DEP + 1, DEP, BF),
            abi.encodeWithSelector(Sure2PEscrowV3.RulingRefundTooLarge.selector, DEP + 1, DEP)
        );
        _revFinal(
            id, reviewer, _in(id, 0, DEP, DEP + 1, SF),
            abi.encodeWithSelector(Sure2PEscrowV3.RulingRefundTooLarge.selector, DEP + 1, DEP)
        );
        _revFinal(
            id, reviewer, _in(id, 0, 1, DEP, SF),
            abi.encodeWithSelector(Sure2PEscrowV3.NonFaultPartyMustBeRefunded.selector, true, 1, DEP)
        );
        _revFinal(
            id, reviewer, _in(id, 0, DEP, 1, BF),
            abi.encodeWithSelector(Sure2PEscrowV3.NonFaultPartyMustBeRefunded.selector, false, 1, DEP)
        );
        _revFinal(
            id, reviewer, _in(id, 0, DEP, DEP, BFR),
            abi.encodeWithSelector(Sure2PEscrowV3.FraudRequiresFault.selector, true)
        );
        _revFinal(
            id, reviewer, _in(id, 0, DEP, DEP, SFR),
            abi.encodeWithSelector(Sure2PEscrowV3.FraudRequiresFault.selector, false)
        );
        r = _clean(id, 0);
        r.reasonHash = bytes32(0);
        _revFinal(id, reviewer, r, abi.encodeWithSelector(Sure2PEscrowV3.ZeroCommitment.selector));
        r = _clean(id, 0);
        r.evidenceRoot = bytes32(0);
        _revFinal(id, reviewer, r, abi.encodeWithSelector(Sure2PEscrowV3.ZeroCommitment.selector));
        // still appealed; nothing credited
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Appealed));
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b + s + p, 0);
    }

    // ------------------------------------------------------------ fraudConfirmed

    function test_Fraud_FalseBeforeFinalization() public {
        uint256 id = _disputed(PRICE);
        (bool bf, bool sf) = escrow.fraudConfirmed(id);
        assertFalse(bf || sf, "disputed");
        _prelim(id, 0, DEP, 0, SF | SFR);
        (bf, sf) = escrow.fraudConfirmed(id);
        assertFalse(bf || sf, "preliminary");
        _appeal(id, buyer);
        (bf, sf) = escrow.fraudConfirmed(id);
        assertFalse(bf || sf, "appealed");
    }

    function test_Fraud_FalseAfterMutualSettlementEvenWithFraudPrelim() public {
        uint256 id = _ruled(PRICE, 0, 0, 0, BF | SF | BFR | SFR);
        _settle(id, 40e6);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Finalized));
        (bool bf, bool sf) = escrow.fraudConfirmed(id);
        assertFalse(bf || sf);
        assertEq(escrow.outcomeOf(id).decidedBy, address(0));
    }

    function test_Fraud_FalseAfterMutualCompletion() public {
        uint256 id = _activeEscrow(PRICE);
        vm.prank(seller);
        escrow.declareHandover(id, keccak256("manifest"));
        vm.prank(buyer);
        escrow.confirmBuyerAcceptance(id);
        escrow.finalizeMutualCompletion(id);
        (bool bf, bool sf) = escrow.fraudConfirmed(id);
        assertFalse(bf || sf);
    }

    function test_Fraud_TrueFromFinalRulingWithRightFlags() public {
        uint256 id = _appealedCase();
        _final(id, 0, 0, DEP, BF | BFR);
        (bool bf, bool sf) = escrow.fraudConfirmed(id);
        assertTrue(bf);
        assertFalse(sf);
    }

    function test_Fraud_BothFlagsFromFinalRuling() public {
        uint256 id = _appealedCase();
        _final(id, 0, 0, 0, BF | SF | BFR | SFR);
        (bool bf, bool sf) = escrow.fraudConfirmed(id);
        assertTrue(bf);
        assertTrue(sf);
    }

    function test_Fraud_FinalRulingOverridesPreliminaryFraud() public {
        uint256 id = _appealedCase(); // prelim flagged seller fraud
        _final(id, 0, DEP, 10e6, SF); // reviewer: fault but not fraud
        (bool bf, bool sf) = escrow.fraudConfirmed(id);
        assertFalse(bf);
        assertFalse(sf, "final ruling cleared the fraud flag");
    }

    function test_Fraud_FinalRulingCanAddFraudNotInPreliminary() public {
        uint256 id = _ruledClean(PRICE, 0);
        _appeal(id, seller);
        _final(id, 0, DEP, 0, SF | SFR);
        (bool bf, bool sf) = escrow.fraudConfirmed(id);
        assertFalse(bf);
        assertTrue(sf);
    }

    /// @dev Design 8.5: an unappealed preliminary ruling becomes the effective outcome once finalized,
    /// so its flags are what fraudConfirmed reports.
    function test_Fraud_UnappealedPreliminaryBecomesEffectiveAfterFinalize() public {
        uint256 id = _ruled(PRICE, 0, DEP, 0, SF | SFR);
        _finalizeUnappealed(id);
        (bool bf, bool sf) = escrow.fraudConfirmed(id);
        assertFalse(bf);
        assertTrue(sf);
    }

    function test_Fraud_FalseWhenFinalRulingHasNoFraudFlag() public {
        uint256 id = _ruled(PRICE, 0, 0, 0, BF | SF);
        _finalizeUnappealed(id);
        (bool bf, bool sf) = escrow.fraudConfirmed(id);
        assertFalse(bf || sf);
    }

    function test_Fraud_RevertsOnUnknownEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.UnknownEscrow.selector, 9));
        escrow.fraudConfirmed(9);
    }

    // ------------------------------------------------------------ mutual settlement mid-case

    function test_Settlement_DuringPreliminaryRuling_PenaltyZeroDepositsRefunded() public {
        uint256 id = _ruled(PRICE, 100e6, 0, 0, BF | SF);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit MutualSettlementExecuted(id, 30e6, 0);
        _settle(id, 30e6);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Finalized));
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, 30e6 + DEP);
        assertEq(s, 70e6 + DEP);
        assertEq(p, 0, "ruling penalty must not apply to a mutual settlement");

        skip(APPEAL_WINDOW + 1);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Finalized));
        escrow.finalizeRuling(id);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Finalized));
        escrow.appeal(id, REASON);
    }

    function test_Settlement_DuringAppealed_PenaltyZeroDepositsRefunded() public {
        uint256 id = _ruled(PRICE, 0, 0, 0, BF | SF);
        _appeal(id, seller);
        _settle(id, 50e6);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Finalized));
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, 50e6 + DEP);
        assertEq(s, 50e6 + DEP);
        assertEq(p, 0);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        _revFinal(id, reviewer, r, _invalidState(Sure2PEscrowV3.State.Finalized));
    }

    function test_Settlement_AfterDeadlineButBeforeFinalize() public {
        uint256 id = _ruled(PRICE, 0, 0, 0, BF | SF);
        skip(APPEAL_WINDOW + 10);
        _settle(id, 0);
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, DEP);
        assertEq(s, PRICE + DEP);
        assertEq(p, 0);
    }

    // ------------------------------------------------------------ owner replacing arbiter mid-case

    function test_ReplaceArbiter_NewArbiterRulesDisputedCase() public {
        uint256 id = _disputed(PRICE);
        address newArbiter = makeAddr("newArbiter");
        vm.prank(owner);
        escrow.setArbiter(newArbiter);

        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        vm.prank(arbiter);
        vm.expectRevert(Sure2PEscrowV3.Unauthorized.selector);
        escrow.issuePreliminaryRuling(id, r);

        vm.prank(newArbiter);
        escrow.issuePreliminaryRuling(id, r);
        assertEq(escrow.getRuling(id).issuedBy, newArbiter);
    }

    function test_ReplaceArbiter_ExistingRulingKeepsIssuerAndFinalizes() public {
        uint256 id = _ruled(PRICE, 20e6, 10e6, DEP, BF);
        address newArbiter = makeAddr("newArbiter");
        vm.prank(owner);
        escrow.setArbiter(newArbiter);
        assertEq(escrow.getRuling(id).issuedBy, arbiter);

        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        vm.prank(newArbiter);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.PreliminaryRuling));
        escrow.issuePreliminaryRuling(id, r);

        _finalizeUnappealed(id);
        assertEq(escrow.claimable(id, penaltyW), 15e6);
    }

    function test_ReplaceArbiter_OwnerCannotRuleOrMoveFunds() public {
        uint256 id = _disputed(PRICE);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        vm.prank(owner);
        vm.expectRevert(Sure2PEscrowV3.Unauthorized.selector);
        escrow.issuePreliminaryRuling(id, r);
        vm.prank(owner);
        vm.expectRevert(Sure2PEscrowV3.NoCredit.selector);
        escrow.claim(id);
    }

    function test_ReplaceArbiter_OverdueCase() public {
        uint256 id = _overdue(PRICE);
        address newArbiter = makeAddr("newArbiter");
        vm.prank(owner);
        escrow.setArbiter(newArbiter);
        Sure2PEscrowV3.RulingInput memory r = _in(id, 0, DEP, 0, SF);
        vm.prank(newArbiter);
        escrow.issuePreliminaryRuling(id, r);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.PreliminaryRuling));
    }

    // ------------------------------------------------------------ anchorEvidence

    function test_Anchor_PartiesInEveryOpenState() public {
        bytes32 h = keccak256("evidence");
        // Overdue
        uint256 id = _overdue(PRICE);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit EvidenceAnchored(id, buyer, h, uint64(block.timestamp));
        vm.prank(buyer);
        escrow.anchorEvidence(id, h);
        vm.prank(seller);
        escrow.anchorEvidence(id, h);
        // Disputed
        uint256 d = _disputed(PRICE);
        vm.prank(seller);
        escrow.anchorEvidence(d, h);
        // PreliminaryRuling
        _prelimIn(d, _clean(d, 0));
        vm.prank(buyer);
        escrow.anchorEvidence(d, h);
        // Appealed
        _appeal(d, buyer);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit EvidenceAnchored(d, seller, h, uint64(block.timestamp));
        vm.prank(seller);
        escrow.anchorEvidence(d, h);
    }

    function test_Anchor_RevertsForNonPartyZeroHashAndClosedStates() public {
        bytes32 h = keccak256("evidence");
        uint256 d = _disputed(PRICE);
        address[4] memory who = [stranger, arbiter, reviewer, owner];
        for (uint256 i; i < who.length; ++i) {
            vm.prank(who[i]);
            vm.expectRevert(Sure2PEscrowV3.Unauthorized.selector);
            escrow.anchorEvidence(d, h);
        }
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV3.ZeroCommitment.selector);
        escrow.anchorEvidence(d, bytes32(0));

        uint256 active = _activeEscrow(PRICE);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Active));
        escrow.anchorEvidence(active, h);

        _prelimIn(d, _clean(d, 0));
        _finalizeUnappealed(d);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Finalized));
        escrow.anchorEvidence(d, h);
    }
}
