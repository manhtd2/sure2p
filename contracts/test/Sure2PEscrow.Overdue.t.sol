// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowBase} from "./Sure2PEscrow.Base.t.sol";
import {Sure2PEscrow} from "../Sure2PEscrow.sol";

/// @dev Overdue triggers, flagOverdue, no auto-release, and the dispute lock.
contract Sure2PEscrowOverdueTest is Sure2PEscrowBase {
    uint256 internal id;
    uint256 internal handoverDl;

    function setUp() public override {
        super.setUp();
        id = _activeEscrow(PRICE);
        handoverDl = _get(id).handoverDeadline;
    }

    // ------------------------------------------------------------ trigger (a): handover missed

    function test_TriggerA_StrictBoundary() public {
        vm.warp(handoverDl);
        assertEq(escrow.overdueTrigger(id), 0);
        assertFalse(escrow.effectiveOverdue(id));
        vm.expectRevert(Sure2PEscrow.NotOverdue.selector);
        escrow.flagOverdue(id);

        vm.warp(handoverDl + 1);
        assertEq(escrow.overdueTrigger(id), 1);
        assertTrue(escrow.effectiveOverdue(id));
    }

    function test_TriggerA_FlagOverduePermissionless() public {
        vm.warp(handoverDl + 1);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Sure2PEscrow.OverdueFlagged(id, 1);
        vm.prank(stranger);
        escrow.flagOverdue(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Overdue));
    }

    function test_TriggerA_ClearedByTimelyDeclaration() public {
        vm.warp(handoverDl);
        _declare(id);
        vm.warp(handoverDl + 1);
        assertEq(escrow.overdueTrigger(id), 0, "declared in time: (a) no longer applies");
    }

    // ------------------------------------------------------------ trigger (b): buyer response missed

    function test_TriggerB_StrictBoundary() public {
        _declare(id);
        vm.warp(T0 + RESP);
        assertEq(escrow.overdueTrigger(id), 0);
        vm.expectRevert(Sure2PEscrow.NotOverdue.selector);
        escrow.flagOverdue(id);

        vm.warp(T0 + RESP + 1);
        assertEq(escrow.overdueTrigger(id), 2);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Sure2PEscrow.OverdueFlagged(id, 2);
        vm.prank(stranger);
        escrow.flagOverdue(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Overdue));
    }

    function test_TriggerB_MeasuredFromDeclarationTime() public {
        skip(1 days);
        _declare(id);
        vm.warp(T0 + 1 days + RESP);
        assertEq(escrow.overdueTrigger(id), 0);
        vm.warp(T0 + 1 days + RESP + 1);
        assertEq(escrow.overdueTrigger(id), 2);
    }

    // ------------------------------------------------------------ trigger (c): inspection missed

    function test_TriggerC_StrictBoundary() public {
        _declare(id);
        _ack(id);
        vm.warp(T0 + INSPECT);
        assertEq(escrow.overdueTrigger(id), 0);
        vm.expectRevert(Sure2PEscrow.NotOverdue.selector);
        escrow.flagOverdue(id);

        vm.warp(T0 + INSPECT + 1);
        assertEq(escrow.overdueTrigger(id), 3);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Sure2PEscrow.OverdueFlagged(id, 3);
        vm.prank(stranger);
        escrow.flagOverdue(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Overdue));
    }

    function test_Trigger_NoneAfterAcceptance() public {
        _declare(id);
        _accept(id);
        vm.warp(T0 + 400 days);
        assertEq(escrow.overdueTrigger(id), 0);
        vm.expectRevert(Sure2PEscrow.NotOverdue.selector);
        escrow.flagOverdue(id);
    }

    // ------------------------------------------------------------ flagOverdue state rules

    function test_FlagOverdue_OnlyOnceAndOnlyFromActive() public {
        vm.warp(handoverDl + 1);
        escrow.flagOverdue(id);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Overdue));
        escrow.flagOverdue(id);

        uint256 fid = _newEscrow(PRICE);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Funding));
        escrow.flagOverdue(fid);
    }

    function test_EffectiveOverdueIsFalseOutsideActiveOrOverdue() public {
        uint256 fid = _newEscrow(PRICE);
        vm.warp(block.timestamp + 365 days);
        assertEq(escrow.overdueTrigger(fid), 0);
        assertFalse(escrow.effectiveOverdue(fid));
    }

    // ------------------------------------------------------------ effective overdue blocks without a flag

    function test_FinalizeBlockedByTriggerA_WithoutFlag() public {
        vm.warp(handoverDl + 1);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Active), "never flagged");
        vm.expectRevert(Sure2PEscrow.EffectivelyOverdue.selector);
        escrow.finalizeMutualCompletion(id);
    }

    function test_FinalizeBlockedByTriggerB_WithoutFlag() public {
        _declare(id);
        vm.warp(T0 + RESP + 1);
        vm.expectRevert(Sure2PEscrow.EffectivelyOverdue.selector);
        escrow.finalizeMutualCompletion(id);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.EffectivelyOverdue.selector);
        escrow.confirmBuyerAcceptance(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Active));
    }

    function test_FinalizeBlockedByTriggerC_WithoutFlag() public {
        _declare(id);
        _ack(id);
        vm.warp(T0 + INSPECT + 1);
        vm.expectRevert(Sure2PEscrow.EffectivelyOverdue.selector);
        escrow.finalizeMutualCompletion(id);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.EffectivelyOverdue.selector);
        escrow.confirmBuyerAcceptance(id);
    }

    function test_FinalizeAfterFlag_RevertsInvalidStateOverdue() public {
        _declare(id);
        _ack(id);
        vm.warp(T0 + INSPECT + 1);
        escrow.flagOverdue(id);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Overdue));
        escrow.finalizeMutualCompletion(id);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Overdue));
        escrow.confirmBuyerAcceptance(id);
    }

    function test_Overdue_StateBlocksFurtherProgressSteps() public {
        _declare(id);
        vm.warp(T0 + RESP + 1);
        escrow.flagOverdue(id);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Overdue));
        escrow.acknowledgeReceipt(id);
        vm.prank(seller);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Overdue));
        escrow.declareHandover(id, MANIFEST);
    }

    // ------------------------------------------------------------ no auto-release on silence

    function test_NoAutoRelease_SilenceNeverMovesFunds() public {
        _declare(id);
        vm.warp(T0 + 3650 days);
        assertEq(escrow.claimable(id, seller), 0);
        assertEq(escrow.claimable(id, buyer), 0);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Active));
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.NoCredit.selector);
        escrow.claim(id);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.NoCredit.selector);
        escrow.claim(id);

        escrow.flagOverdue(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Overdue));
        assertEq(escrow.claimable(id, seller), 0, "flagging releases nothing");
        assertEq(escrow.claimable(id, buyer), 0);
        assertEq(usdc.balanceOf(address(escrow)), 150e6);
        assertEq(escrow.totalOutstanding(), 150e6);
    }

    function test_Overdue_CanStillDisputeAndSettle() public {
        vm.warp(handoverDl + 1);
        escrow.flagOverdue(id);
        _dispute(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Disputed));

        uint256 id2 = _activeEscrow(PRICE);
        vm.warp(_get(id2).handoverDeadline + 1);
        escrow.flagOverdue(id2);
        _settle(id2, 0);
        assertEq(uint8(_state(id2)), uint8(Sure2PEscrow.State.Finalized));
    }

    // ------------------------------------------------------------ openDispute

    function test_Dispute_ByBuyerLocksFunds() public {
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Sure2PEscrow.DisputeOpened(id, buyer, REASON);
        _dispute(id);

        Sure2PEscrow.Escrow memory e = _get(id);
        assertEq(uint8(e.state), uint8(Sure2PEscrow.State.Disputed));
        assertEq(e.disputeOpenedBy, buyer);
        assertEq(e.disputeReasonCommitment, REASON);
        assertEq(usdc.balanceOf(address(escrow)), 150e6);
        assertEq(escrow.claimable(id, buyer), 0);
        assertEq(escrow.claimable(id, seller), 0);
    }

    function test_Dispute_BySellerAllowed() public {
        vm.prank(seller);
        escrow.openDispute(id, REASON);
        assertEq(_get(id).disputeOpenedBy, seller);
    }

    function test_Dispute_AllowedWhileActiveAndEffectivelyOverdue() public {
        vm.warp(handoverDl + 1);
        _dispute(id); // state still Active, never flagged
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Disputed));
    }

    function test_Dispute_RevertsNonParty() public {
        vm.prank(stranger);
        vm.expectRevert(Sure2PEscrow.Unauthorized.selector);
        escrow.openDispute(id, REASON);
    }

    function test_Dispute_RevertsZeroReason() public {
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.ZeroCommitment.selector);
        escrow.openDispute(id, bytes32(0));
    }

    function test_Dispute_OnlyOneDispute() public {
        _dispute(id);
        vm.prank(seller);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Disputed));
        escrow.openDispute(id, keccak256("again"));
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Disputed));
        escrow.openDispute(id, keccak256("again"));
        assertEq(_get(id).disputeReasonCommitment, REASON, "original commitment kept");
    }

    function test_Dispute_RevertsInFundingAndFinalized() public {
        uint256 fid = _newEscrow(PRICE);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Funding));
        escrow.openDispute(fid, REASON);

        uint256 id2 = _activeEscrow(PRICE);
        _settle(id2, 0);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Finalized));
        escrow.openDispute(id2, REASON);
    }

    function test_Dispute_RevertsInExpired() public {
        uint256 fid = _newEscrow(PRICE);
        vm.warp(block.timestamp + 2 days);
        escrow.expireUnfunded(fid);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.ExpiredUnfunded));
        escrow.openDispute(fid, REASON);
    }

    function test_Dispute_RejectedAfterBuyerAccepted() public {
        _declare(id);
        _accept(id);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.AlreadyAccepted.selector);
        escrow.openDispute(id, REASON);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.AlreadyAccepted.selector);
        escrow.openDispute(id, REASON);
        // the seller's completion entitlement is intact
        escrow.finalizeMutualCompletion(id);
        assertEq(escrow.claimable(id, seller), 125e6);
    }

    function test_Dispute_LocksEveryProgressPath() public {
        _declare(id);
        _dispute(id);
        Sure2PEscrow.State d = Sure2PEscrow.State.Disputed;

        vm.prank(buyer);
        vm.expectRevert(_invalidState(d));
        escrow.acknowledgeReceipt(id);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(d));
        escrow.confirmBuyerAcceptance(id);
        vm.expectRevert(_invalidState(d));
        escrow.finalizeMutualCompletion(id);
        vm.expectRevert(_invalidState(d));
        escrow.flagOverdue(id);
        vm.expectRevert(_invalidState(d));
        escrow.expireUnfunded(id);
        vm.prank(seller);
        vm.expectRevert(_invalidState(d));
        escrow.declareHandover(id, MANIFEST);

        vm.warp(T0 + 3650 days);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.NoCredit.selector);
        escrow.claim(id);
        assertEq(usdc.balanceOf(address(escrow)), 150e6);
        assertEq(escrow.totalOutstanding(), 150e6);
    }
}
