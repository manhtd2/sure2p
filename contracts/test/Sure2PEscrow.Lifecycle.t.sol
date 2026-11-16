// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowBase} from "./Sure2PEscrow.Base.t.sol";
import {Sure2PEscrow} from "../Sure2PEscrow.sol";

/// @dev declare / acknowledge / accept / complete / claim.
contract Sure2PEscrowLifecycleTest is Sure2PEscrowBase {
    uint256 internal id;
    uint256 internal handoverDl;

    function setUp() public override {
        super.setUp();
        id = _activeEscrow(PRICE);
        handoverDl = _get(id).handoverDeadline;
    }

    // ------------------------------------------------------------ declareHandover

    function test_Declare_RecordsOnlyAndPaysNothing() public {
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Sure2PEscrow.HandoverDeclared(id, MANIFEST, uint64(T0));
        _declare(id);

        Sure2PEscrow.Escrow memory e = _get(id);
        assertTrue(e.sellerHandoverDeclared);
        assertEq(e.sellerDeclaredAt, T0);
        assertEq(e.handoverManifestHash, MANIFEST);
        assertFalse(e.buyerReceiptAcknowledged);
        assertEq(e.buyerAcknowledgedAt, 0, "inspection window not started");
        assertFalse(e.buyerAccepted);
        assertEq(uint8(e.state), uint8(Sure2PEscrow.State.Active));
        assertEq(escrow.claimable(id, seller), 0);
        assertEq(escrow.claimable(id, buyer), 0);
        assertEq(usdc.balanceOf(address(escrow)), 150e6);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.NoCredit.selector);
        escrow.claim(id);
    }

    function test_Declare_DoesNotStartInspectionWindow() public {
        _declare(id);
        // far beyond inspectionSeconds (3d) but the receipt-response window (2d) is what ticks
        vm.warp(T0 + RESP);
        assertEq(escrow.overdueTrigger(id), 0);
        vm.warp(T0 + RESP + 1);
        assertEq(escrow.overdueTrigger(id), 2, "trigger b (response), never c (inspection)");
    }

    function test_Declare_RevertsNonSeller() public {
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.Unauthorized.selector);
        escrow.declareHandover(id, MANIFEST);
        vm.prank(stranger);
        vm.expectRevert(Sure2PEscrow.Unauthorized.selector);
        escrow.declareHandover(id, MANIFEST);
    }

    function test_Declare_RevertsZeroManifestAndDouble() public {
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.ZeroCommitment.selector);
        escrow.declareHandover(id, bytes32(0));
        _declare(id);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.AlreadyDeclared.selector);
        escrow.declareHandover(id, MANIFEST);
    }

    function test_Declare_RevertsWhenNotActive() public {
        uint256 fid = _newEscrow(PRICE);
        vm.prank(seller);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Funding));
        escrow.declareHandover(fid, MANIFEST);
    }

    function test_Declare_AllowedAtHandoverDeadlineRevertsAfter() public {
        vm.warp(handoverDl);
        _declare(id);

        uint256 id2 = _activeEscrow(PRICE);
        vm.warp(_get(id2).handoverDeadline + 1);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.EffectivelyOverdue.selector);
        escrow.declareHandover(id2, MANIFEST);
    }

    // ------------------------------------------------------------ acknowledgeReceipt

    function test_Acknowledge_StartsInspectionWindow() public {
        _declare(id);
        skip(1 hours);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Sure2PEscrow.ReceiptAcknowledged(id, uint64(T0 + 1 hours));
        _ack(id);

        Sure2PEscrow.Escrow memory e = _get(id);
        assertTrue(e.buyerReceiptAcknowledged);
        assertEq(e.buyerAcknowledgedAt, T0 + 1 hours);
        assertFalse(e.buyerAccepted);
        assertEq(escrow.overdueTrigger(id), 0);
        vm.warp(T0 + 1 hours + INSPECT);
        assertEq(escrow.overdueTrigger(id), 0);
        vm.warp(T0 + 1 hours + INSPECT + 1);
        assertEq(escrow.overdueTrigger(id), 3);
    }

    function test_Acknowledge_RevertsWithoutDeclaration() public {
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.HandoverNotDeclared.selector);
        escrow.acknowledgeReceipt(id);
    }

    function test_Acknowledge_RevertsNonBuyerAndDouble() public {
        _declare(id);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.Unauthorized.selector);
        escrow.acknowledgeReceipt(id);
        _ack(id);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.AlreadyAcknowledged.selector);
        escrow.acknowledgeReceipt(id);
    }

    function test_Acknowledge_BoundaryOfResponseWindow() public {
        _declare(id);
        vm.warp(T0 + RESP); // exactly at boundary: still timely
        _ack(id);

        uint256 id2 = _activeEscrow(PRICE);
        _declare(id2);
        vm.warp(block.timestamp + RESP + 1);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.EffectivelyOverdue.selector);
        escrow.acknowledgeReceipt(id2);
    }

    // ------------------------------------------------------------ confirmBuyerAcceptance

    function test_Accept_WithoutPriorAckAtomicallyAcknowledges() public {
        _declare(id);
        skip(5 hours);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Sure2PEscrow.ReceiptAcknowledged(id, uint64(T0 + 5 hours));
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Sure2PEscrow.BuyerAcceptanceConfirmed(id, uint64(T0 + 5 hours));
        _accept(id);

        Sure2PEscrow.Escrow memory e = _get(id);
        assertTrue(e.buyerReceiptAcknowledged);
        assertEq(e.buyerAcknowledgedAt, T0 + 5 hours);
        assertTrue(e.buyerAccepted);
        assertEq(e.buyerAcceptedAt, T0 + 5 hours);
    }

    function test_Accept_AfterAckKeepsOriginalAckTime() public {
        _declare(id);
        _ack(id);
        skip(1 days);
        _accept(id);
        Sure2PEscrow.Escrow memory e = _get(id);
        assertEq(e.buyerAcknowledgedAt, T0);
        assertEq(e.buyerAcceptedAt, T0 + 1 days);
    }

    function test_Accept_RevertsWithoutDeclaration() public {
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.HandoverNotDeclared.selector);
        escrow.confirmBuyerAcceptance(id);
    }

    function test_Accept_RevertsNonBuyerAndDouble() public {
        _declare(id);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.Unauthorized.selector);
        escrow.confirmBuyerAcceptance(id);
        _accept(id);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.AlreadyAccepted.selector);
        escrow.confirmBuyerAcceptance(id);
    }

    function test_Accept_RevertsAfterInspectionWindow() public {
        _declare(id);
        _ack(id);
        vm.warp(T0 + INSPECT); // exact boundary still ok
        uint256 snap = vm.snapshotState();
        _accept(id);
        vm.revertToState(snap);
        vm.warp(T0 + INSPECT + 1);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.EffectivelyOverdue.selector);
        escrow.confirmBuyerAcceptance(id);
    }

    // ------------------------------------------------------------ finalizeMutualCompletion + claim

    function test_Finalize_RevertsBeforeDeclareOrAccept() public {
        vm.expectRevert(Sure2PEscrow.HandoverNotDeclared.selector);
        escrow.finalizeMutualCompletion(id);
        _declare(id);
        vm.expectRevert(Sure2PEscrow.AcceptanceRequired.selector);
        escrow.finalizeMutualCompletion(id);
        _ack(id);
        vm.expectRevert(Sure2PEscrow.AcceptanceRequired.selector);
        escrow.finalizeMutualCompletion(id);
    }

    function test_Finalize_EarlyCompletionAssignsExactCredits() public {
        _declare(id);
        _accept(id); // no waiting: early completion
        vm.expectEmit(true, false, false, false, address(escrow));
        emit Sure2PEscrow.MutualCompletionFinalized(id);
        vm.prank(stranger); // permissionless
        escrow.finalizeMutualCompletion(id);

        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Finalized));
        assertEq(escrow.claimable(id, seller), 125e6, "price + sellerDeposit");
        assertEq(escrow.claimable(id, buyer), 25e6, "buyerDeposit");
        assertEq(escrow.totalOutstanding(), 150e6, "credits still outstanding until claimed");
        assertEq(usdc.balanceOf(address(escrow)), 150e6);
    }

    function test_Claim_EachWalletOnceAndConservesFunds() public {
        // balances here are measured AFTER setUp already funded `id` (150e6 locked)
        uint256 bBefore = usdc.balanceOf(buyer);
        uint256 sBefore = usdc.balanceOf(seller);
        _declare(id);
        _accept(id);
        escrow.finalizeMutualCompletion(id);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit Sure2PEscrow.Claimed(id, seller, 125e6);
        vm.prank(seller);
        escrow.claim(id);
        assertEq(escrow.totalOutstanding(), 25e6);

        vm.prank(buyer);
        escrow.claim(id);
        assertEq(escrow.totalOutstanding(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        // seller earned the price + own deposit back; buyer got only its deposit back
        assertEq(usdc.balanceOf(seller), sBefore + 125e6);
        assertEq(usdc.balanceOf(buyer), bBefore + 25e6);
        assertEq(escrow.claimable(id, seller), 0);
        assertEq(escrow.claimable(id, buyer), 0);
    }

    function test_Claim_RevertsDoubleAndNonBeneficiary() public {
        _declare(id);
        _accept(id);
        escrow.finalizeMutualCompletion(id);

        vm.prank(stranger);
        vm.expectRevert(Sure2PEscrow.NoCredit.selector);
        escrow.claim(id);

        vm.prank(seller);
        escrow.claim(id);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.NoCredit.selector);
        escrow.claim(id);
        // seller's claim did not touch buyer's credit
        assertEq(escrow.claimable(id, buyer), 25e6);
        vm.prank(buyer);
        escrow.claim(id);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.NoCredit.selector);
        escrow.claim(id);
    }

    function test_Claim_RevertsBeforeFinalizeAndWrongEscrow() public {
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.NoCredit.selector);
        escrow.claim(id);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.NoCredit.selector);
        escrow.claim(12345);
    }

    function test_Finalize_RevertsSecondTime() public {
        _declare(id);
        _accept(id);
        escrow.finalizeMutualCompletion(id);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Finalized));
        escrow.finalizeMutualCompletion(id);
        assertEq(escrow.claimable(id, seller), 125e6, "no double credit");
    }

    function test_Finalize_StillWorksLongAfterAcceptance() public {
        _declare(id);
        _accept(id);
        skip(365 days); // acceptance fixes entitlement; silence afterwards cannot block it
        assertFalse(escrow.effectiveOverdue(id));
        escrow.finalizeMutualCompletion(id);
        assertEq(escrow.claimable(id, seller), 125e6);
    }

    function test_Finalize_TinyPriceExactCredits() public {
        uint256 tid = _activeEscrow(5); // deposit 2
        vm.prank(seller);
        escrow.declareHandover(tid, MANIFEST);
        _accept(tid);
        escrow.finalizeMutualCompletion(tid);
        assertEq(escrow.claimable(tid, seller), 7);
        assertEq(escrow.claimable(tid, buyer), 2);
    }

    // ------------------------------------------------------------ banned wallets after creation

    function test_Banned_CannotCreateButCanFundFinalizeAndClaimExisting() public {
        uint256 fid = _newEscrow(PRICE);
        vm.startPrank(security);
        registry.setBanned(buyer, true);
        registry.setBanned(seller, true);
        vm.stopPrank();

        // a NEW escrow is refused
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        vm.expectRevert(Sure2PEscrow.IneligibleParty.selector);
        escrow.createEscrow(a, bs, ss);

        // the existing one proceeds end to end
        _fundBuyer(fid);
        _fundSeller(fid);
        assertEq(uint8(_state(fid)), uint8(Sure2PEscrow.State.Active));
        _declare(fid);
        _accept(fid);
        escrow.finalizeMutualCompletion(fid);
        vm.prank(seller);
        escrow.claim(fid);
        vm.prank(buyer);
        escrow.claim(fid);
        // only setUp's still-locked escrow `id` (150e6) remains
        assertEq(usdc.balanceOf(address(escrow)), 150e6);
        assertEq(escrow.totalOutstanding(), 150e6);
    }

    function test_Banned_BannedPartyStillCanDisputeAndSettle() public {
        vm.prank(security);
        registry.setBanned(seller, true);
        _dispute(id);
        _settle(id, 10e6);
        vm.prank(seller);
        escrow.claim(id);
        assertEq(escrow.claimable(id, seller), 0);
    }
}
