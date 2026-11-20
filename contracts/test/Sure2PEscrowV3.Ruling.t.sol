// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowV3} from "../Sure2PEscrowV3.sol";
import {Sure2PEscrowV3Base} from "./Sure2PEscrowV3.Base.t.sol";

/// @dev Preliminary ruling: payout matrix, validation reverts, preview, worked example, access control.
contract Sure2PEscrowV3RulingTest is Sure2PEscrowV3Base {
    event PreliminaryRulingIssued(
        uint256 indexed id, address indexed issuedBy, uint256 buyerPriceRefund,
        uint256 buyerDepositRefund, uint256 sellerDepositRefund,
        bool buyerAtFault, bool sellerAtFault, bool buyerFraud, bool sellerFraud,
        bytes32 reasonHash, bytes32 evidenceRoot, uint64 appealDeadline
    );
    event Claimed(uint256 indexed escrowId, address indexed account, uint256 amount);

    uint256 internal constant DEP = 25e6;

    function _rev(uint256 id, Sure2PEscrowV3.RulingInput memory r, bytes memory err) internal {
        vm.prank(arbiter);
        vm.expectRevert(err);
        escrow.issuePreliminaryRuling(id, r);
    }

    // ------------------------------------------------------------ matrix driver

    /// @dev Runs refunds {0, mid, full} for every faulty side (non-fault side must be full) and checks payouts.
    function _runMatrix(bool overdue, uint8 flags) internal {
        uint256[3] memory prs = [uint256(0), 37e6, PRICE];
        uint256[3] memory deps = [uint256(0), 10e6, DEP];
        for (uint256 i; i < 3; ++i) {
            for (uint256 j; j < 3; ++j) {
                if (flags & BF == 0 && j != 2) continue;
                for (uint256 k; k < 3; ++k) {
                    if (flags & SF == 0 && k != 2) continue;
                    _runOne(overdue, prs[i], deps[j], deps[k], flags);
                }
            }
        }
    }

    function _runOne(bool overdue, uint256 pr, uint256 bdr, uint256 sdr, uint8 flags) internal {
        uint256 id = overdue ? _overdue(PRICE) : _disputed(PRICE);
        uint256 total = PRICE + 2 * DEP;
        uint256 balBefore = usdc.balanceOf(address(escrow));
        _prelim(id, pr, bdr, sdr, flags);

        // S5: no credits, no movement until finalization
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.PreliminaryRuling));
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b + s + p, 0, "credit before finalization");
        assertEq(usdc.balanceOf(address(escrow)), balBefore);
        (bool bfr, bool sfr) = escrow.fraudConfirmed(id);
        assertFalse(bfr || sfr, "fraud confirmed before finalization");
        assertEq(escrow.outcomeOf(id).decidedBy, address(0));

        _finalizeUnappealed(id);
        (b, s, p) = _credits(id);
        assertEq(b, pr + bdr, "buyer");
        assertEq(s, (PRICE - pr) + sdr, "seller");
        assertEq(p, (DEP - bdr) + (DEP - sdr), "penalty wallet");
        assertEq(b + s + p, total, "conservation");
        assertEq(escrow.claimable(id, owner), 0);
        assertEq(escrow.claimable(id, arbiter), 0);
    }

    // Disputed
    function test_Matrix_Disputed_NoFault() public { _runMatrix(false, 0); }
    function test_Matrix_Disputed_BuyerFault() public { _runMatrix(false, BF); }
    function test_Matrix_Disputed_SellerFault() public { _runMatrix(false, SF); }
    function test_Matrix_Disputed_BothFault() public { _runMatrix(false, BF | SF); }
    function test_Matrix_Disputed_BuyerFraud() public { _runMatrix(false, BF | BFR); }
    function test_Matrix_Disputed_SellerFraud() public { _runMatrix(false, SF | SFR); }
    function test_Matrix_Disputed_BothFraud() public { _runMatrix(false, BF | SF | BFR | SFR); }
    // Overdue
    function test_Matrix_Overdue_NoFault() public { _runMatrix(true, 0); }
    function test_Matrix_Overdue_BuyerFault() public { _runMatrix(true, BF); }
    function test_Matrix_Overdue_SellerFault() public { _runMatrix(true, SF); }
    function test_Matrix_Overdue_BothFault() public { _runMatrix(true, BF | SF); }
    function test_Matrix_Overdue_SellerFraudBuyerFault() public { _runMatrix(true, BF | SF | SFR); }

    function test_BothDepositsPenalised_PenaltyWalletGetsBoth() public {
        uint256 id = _ruled(PRICE, 50e6, 0, 0, BF | SF);
        _finalizeUnappealed(id);
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, 50e6);
        assertEq(s, 50e6);
        assertEq(p, 2 * DEP);
        vm.prank(penaltyW);
        escrow.claim(id);
        assertEq(usdc.balanceOf(penaltyW), 2 * DEP);
    }

    // ------------------------------------------------------------ stored state + event

    function test_Prelim_StoresRulingAndEmits() public {
        uint256 id = _disputed(PRICE);
        Sure2PEscrowV3.RulingInput memory r = _in(id, 20e6, 25e6, 15e6, SF);
        uint64 dl = uint64(block.timestamp + APPEAL_WINDOW);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit PreliminaryRulingIssued(id, arbiter, 20e6, 25e6, 15e6, false, true, false, false, RULE_HASH, EVID_ROOT, dl);
        _prelimIn(id, r);

        Sure2PEscrowV3.Ruling memory st = escrow.getRuling(id);
        assertEq(st.issuedBy, arbiter);
        assertEq(st.issuedAt, uint64(block.timestamp));
        assertEq(st.appealDeadline, dl);
        assertEq(st.input.agreementHash, r.agreementHash);
        assertEq(st.input.buyerPriceRefund, 20e6);
        assertEq(st.input.buyerDepositRefund, 25e6);
        assertEq(st.input.sellerDepositRefund, 15e6);
        assertFalse(st.input.buyerAtFault);
        assertTrue(st.input.sellerAtFault);
        assertEq(st.input.reasonHash, RULE_HASH);
        assertEq(st.input.evidenceRoot, EVID_ROOT);
        assertFalse(st.appealed);
        assertTrue(escrow.appealOpen(id));
        assertEq(escrow.totalOutstanding(), PRICE + 2 * DEP);
    }

    // ------------------------------------------------------------ worked example (spec 2.4)

    function test_WorkedExample_Preview() public {
        uint256 id = _disputed(PRICE);
        (uint256 b, uint256 s, uint256 p) = escrow.previewRuling(id, _in(id, 20e6, 25e6, 15e6, SF));
        assertEq(b, 45e6);
        assertEq(s, 95e6);
        assertEq(p, 10e6);
        assertEq(b + s + p, 150e6);
    }

    function test_WorkedExample_FinalizeAndClaims() public {
        uint256 id = _ruled(PRICE, 20e6, 25e6, 15e6, SF);
        _finalizeUnappealed(id);
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, 45e6, "buyer");
        assertEq(s, 95e6, "seller");
        assertEq(p, 10e6, "penalty wallet");
        assertEq(b + s + p, 150e6);

        uint256 bb = usdc.balanceOf(buyer);
        uint256 sb = usdc.balanceOf(seller);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Claimed(id, buyer, 45e6);
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
        assertEq(escrow.totalOutstanding(), 0);
    }

    // ------------------------------------------------------------ previewRuling

    function test_Preview_MatchesFinalizedCredits() public {
        uint256 id = _disputed(PRICE);
        Sure2PEscrowV3.RulingInput memory r = _in(id, 33e6, 5e6, 7e6, BF | SF);
        (uint256 pb, uint256 ps, uint256 pp) = escrow.previewRuling(id, r);
        _prelimIn(id, r);
        _finalizeUnappealed(id);
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(pb, b);
        assertEq(ps, s);
        assertEq(pp, p);
    }

    function test_Preview_DoesNotChangeState() public {
        uint256 id = _disputed(PRICE);
        escrow.previewRuling(id, _in(id, 20e6, 25e6, 15e6, SF));
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Disputed));
        assertEq(escrow.getRuling(id).issuedBy, address(0));
    }

    function test_Preview_RevertsOnUnknownEscrow() public {
        Sure2PEscrowV3.RulingInput memory r;
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.UnknownEscrow.selector, 99));
        escrow.previewRuling(99, r);
    }

    function test_Preview_RevertsOnInvalidInputs() public {
        uint256 id = _disputed(PRICE);
        Sure2PEscrowV3.RulingInput memory r = _in(id, 0, DEP, DEP, 0);
        r.agreementHash = bytes32(uint256(1));
        vm.expectRevert();
        escrow.previewRuling(id, r);
        r = _in(id, PRICE + 1, DEP, DEP, 0);
        vm.expectRevert();
        escrow.previewRuling(id, r);
        r = _in(id, 0, DEP - 1, DEP, 0);
        vm.expectRevert();
        escrow.previewRuling(id, r);
        r = _in(id, 0, DEP, DEP, BFR);
        vm.expectRevert();
        escrow.previewRuling(id, r);
        r = _in(id, 0, DEP, DEP, 0);
        r.reasonHash = bytes32(0);
        vm.expectRevert();
        escrow.previewRuling(id, r);
        r = _in(id, 0, DEP, DEP, 0);
        r.evidenceRoot = bytes32(0);
        vm.expectRevert();
        escrow.previewRuling(id, r);
    }

    // ------------------------------------------------------------ validation reverts

    function test_Revert_AgreementHashMismatch() public {
        uint256 id = _disputed(PRICE);
        uint256 other = _disputed(PRICE);
        Sure2PEscrowV3.RulingInput memory r = _clean(other, 0); // signed for escrow B
        bytes32 expected = escrow.getEscrow(id).agreementHash;
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.RulingAgreementMismatch.selector, expected, r.agreementHash));
        escrow.issuePreliminaryRuling(id, r);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Disputed));
    }

    function test_Revert_PriceRefundAbovePrice() public {
        uint256 id = _disputed(PRICE);
        _rev(id, _in(id, PRICE + 1, DEP, DEP, 0), abi.encodeWithSelector(Sure2PEscrowV3.RulingRefundTooLarge.selector, PRICE + 1, PRICE));
    }

    function test_Revert_BuyerDepositRefundAboveDeposit() public {
        uint256 id = _disputed(PRICE);
        _rev(id, _in(id, 0, DEP + 1, DEP, BF), abi.encodeWithSelector(Sure2PEscrowV3.RulingRefundTooLarge.selector, DEP + 1, DEP));
    }

    function test_Revert_SellerDepositRefundAboveDeposit() public {
        uint256 id = _disputed(PRICE);
        _rev(id, _in(id, 0, DEP, DEP + 1, SF), abi.encodeWithSelector(Sure2PEscrowV3.RulingRefundTooLarge.selector, DEP + 1, DEP));
    }

    function test_Revert_NonFaultBuyerNotFullyRefunded() public {
        uint256 id = _disputed(PRICE);
        _rev(id, _in(id, 0, DEP - 1, DEP, SF), abi.encodeWithSelector(Sure2PEscrowV3.NonFaultPartyMustBeRefunded.selector, true, DEP - 1, DEP));
    }

    function test_Revert_NonFaultSellerNotFullyRefunded() public {
        uint256 id = _disputed(PRICE);
        _rev(id, _in(id, 0, 0, 0, BF), abi.encodeWithSelector(Sure2PEscrowV3.NonFaultPartyMustBeRefunded.selector, false, 0, DEP));
    }

    function test_Revert_BuyerFraudWithoutFault() public {
        uint256 id = _disputed(PRICE);
        _rev(id, _in(id, 0, DEP, DEP, BFR), abi.encodeWithSelector(Sure2PEscrowV3.FraudRequiresFault.selector, true));
    }

    function test_Revert_SellerFraudWithoutFault() public {
        uint256 id = _disputed(PRICE);
        _rev(id, _in(id, 0, DEP, DEP, SFR), abi.encodeWithSelector(Sure2PEscrowV3.FraudRequiresFault.selector, false));
    }

    function test_Revert_FraudOnWrongSide() public {
        uint256 id = _disputed(PRICE);
        // seller at fault but buyer fraud flagged
        _rev(id, _in(id, 0, DEP, 0, SF | BFR), abi.encodeWithSelector(Sure2PEscrowV3.FraudRequiresFault.selector, true));
    }

    function test_Revert_ZeroReasonHash() public {
        uint256 id = _disputed(PRICE);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        r.reasonHash = bytes32(0);
        vm.prank(arbiter);
        vm.expectRevert(Sure2PEscrowV3.ZeroCommitment.selector);
        escrow.issuePreliminaryRuling(id, r);
    }

    function test_Revert_ZeroEvidenceRoot() public {
        uint256 id = _disputed(PRICE);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        r.evidenceRoot = bytes32(0);
        vm.prank(arbiter);
        vm.expectRevert(Sure2PEscrowV3.ZeroCommitment.selector);
        escrow.issuePreliminaryRuling(id, r);
    }

    function test_Revert_InvalidRulingLeavesNoState() public {
        uint256 id = _disputed(PRICE);
        _rev(
            id, _in(id, PRICE + 1, DEP, DEP, 0),
            abi.encodeWithSelector(Sure2PEscrowV3.RulingRefundTooLarge.selector, PRICE + 1, PRICE)
        );
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Disputed));
        assertEq(escrow.getRuling(id).issuedBy, address(0));
        // a valid ruling still works afterwards
        _prelimIn(id, _clean(id, 0));
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.PreliminaryRuling));
    }

    // ------------------------------------------------------------ access control + state

    function test_Revert_CallerNotArbiter() public {
        uint256 id = _disputed(PRICE);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        address[4] memory callers = [stranger, reviewer, owner, buyer];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(Sure2PEscrowV3.Unauthorized.selector);
            escrow.issuePreliminaryRuling(id, r);
        }
    }

    function test_Revert_ArbiterIsParty() public {
        uint256 id = _disputed(PRICE);
        vm.prank(owner);
        escrow.setArbiter(buyer);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV3.Unauthorized.selector);
        escrow.issuePreliminaryRuling(id, r);

        vm.prank(owner);
        escrow.setArbiter(seller);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV3.Unauthorized.selector);
        escrow.issuePreliminaryRuling(id, r);
    }

    function test_Revert_UnknownEscrow() public {
        Sure2PEscrowV3.RulingInput memory r;
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.UnknownEscrow.selector, 42));
        escrow.issuePreliminaryRuling(42, r);
    }

    function test_Revert_WrongState_Funding() public {
        uint256 id = _newEscrow(PRICE);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        vm.prank(arbiter);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Funding));
        escrow.issuePreliminaryRuling(id, r);
    }

    function test_Revert_WrongState_Active() public {
        uint256 id = _activeEscrow(PRICE);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        vm.prank(arbiter);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Active));
        escrow.issuePreliminaryRuling(id, r);
    }

    function test_Revert_WrongState_PreliminaryRuling() public {
        uint256 id = _ruledClean(PRICE, 0);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        vm.prank(arbiter);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.PreliminaryRuling));
        escrow.issuePreliminaryRuling(id, r);
    }

    function test_Revert_WrongState_Appealed() public {
        uint256 id = _ruledClean(PRICE, 0);
        _appeal(id, buyer);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        vm.prank(arbiter);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Appealed));
        escrow.issuePreliminaryRuling(id, r);
    }

    function test_Revert_WrongState_Finalized() public {
        uint256 id = _ruledClean(PRICE, 0);
        _finalizeUnappealed(id);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        vm.prank(arbiter);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Finalized));
        escrow.issuePreliminaryRuling(id, r);
    }

    function test_Revert_WrongState_ExpiredUnfunded() public {
        uint256 id = _newEscrow(PRICE);
        skip(25 hours);
        escrow.expireUnfunded(id);
        Sure2PEscrowV3.RulingInput memory r = _clean(id, 0);
        vm.prank(arbiter);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.ExpiredUnfunded));
        escrow.issuePreliminaryRuling(id, r);
    }
}
