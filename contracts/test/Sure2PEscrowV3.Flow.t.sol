// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowV3} from "../Sure2PEscrowV3.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";
import {Sure2PEscrowV3Base} from "./Sure2PEscrowV3.Base.t.sol";
import {Sure2PEscrowV3SigUtils} from "./mocks/Sure2PEscrowV3SigUtils.sol";
import {FeeOnTransferToken} from "./mocks/FeeOnTransferToken.sol";

/// @dev Compact regression set: create, fund, expire, handover, acknowledge, accept, overdue, dispute, claim.
contract Sure2PEscrowV3FlowTest is Sure2PEscrowV3Base {
    event BuyerFunded(uint256 indexed escrowId, uint256 amount);
    event SellerFunded(uint256 indexed escrowId, uint256 amount);
    event EscrowActivated(uint256 indexed escrowId, uint64 activatedAt);
    event EscrowExpired(uint256 indexed escrowId);
    event OverdueFlagged(uint256 indexed escrowId, uint8 trigger);
    event DisputeOpened(uint256 indexed escrowId, address indexed openedBy, bytes32 reasonCommitment);
    event Claimed(uint256 indexed escrowId, address indexed account, uint256 amount);

    uint256 internal constant DEP = 25e6;
    bytes32 internal constant MANIFEST = keccak256("manifest");

    // ------------------------------------------------------------ createEscrow

    function test_Create_StoresEscrow() public {
        uint256 id = _newEscrow(PRICE);
        Sure2PEscrowV3.Escrow memory e = escrow.getEscrow(id);
        assertEq(e.buyer, buyer);
        assertEq(e.seller, seller);
        assertEq(e.price, PRICE);
        assertEq(e.buyerDeposit, DEP);
        assertEq(e.sellerDeposit, DEP);
        assertEq(e.fundingDeadline, uint64(block.timestamp + 24 hours));
        assertEq(uint8(e.state), uint8(Sure2PEscrowV3.State.Funding));
        assertEq(escrow.escrowCount(), 1);
    }

    function test_Create_DepositRoundsUp() public {
        uint256 id = _newEscrow(101);
        assertEq(escrow.getEscrow(id).buyerDeposit, 26);
    }

    function test_Create_RevertsOnWrongDepositZeroPriceTokenAndSig() public {
        Sure2PEscrowV3.Agreement memory a = _agreementFor(buyer, seller, PRICE);
        a.buyerDeposit = DEP + 1;
        vm.expectRevert(Sure2PEscrowV3.InvalidDeposit.selector);
        escrow.createEscrow(a, "", "");

        a = _agreementFor(buyer, seller, PRICE);
        a.price = 0;
        vm.expectRevert(Sure2PEscrowV3.InvalidPrice.selector);
        escrow.createEscrow(a, "", "");

        a = _agreementFor(buyer, seller, PRICE);
        a.token = address(0xdead);
        vm.expectRevert(Sure2PEscrowV3.InvalidToken.selector);
        escrow.createEscrow(a, "", "");

        a = _agreementFor(buyer, seller, PRICE);
        bytes32 d = Sure2PEscrowV3SigUtils.agreementDigest(address(escrow), a);
        bytes memory good = Sure2PEscrowV3SigUtils.sign(buyerPk, d);
        bytes memory bad = Sure2PEscrowV3SigUtils.sign(buyerPk, keccak256("other")); // wrong digest
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.InvalidSignature.selector, seller));
        escrow.createEscrow(a, good, bad);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.InvalidSignature.selector, buyer));
        escrow.createEscrow(a, bad, good);
    }

    function test_Create_RevertsOnSameBuyerSeller_ZeroAddress_Ineligible_Expired() public {
        Sure2PEscrowV3.Agreement memory a = _agreementFor(buyer, buyer, PRICE);
        vm.expectRevert(Sure2PEscrowV3.InvalidParties.selector);
        escrow.createEscrow(a, "", "");

        a = _agreementFor(address(0), seller, PRICE);
        vm.expectRevert(Sure2PEscrowV3.InvalidParties.selector);
        escrow.createEscrow(a, "", "");

        vm.prank(security);
        registry.setBanned(buyer, true);
        a = _agreementFor(buyer, seller, PRICE);
        vm.expectRevert(Sure2PEscrowV3.IneligibleParty.selector);
        escrow.createEscrow(a, "", "");
        vm.prank(security);
        registry.setBanned(buyer, false);

        a = _agreementFor(buyer, seller, PRICE);
        skip(2 days);
        vm.expectRevert(Sure2PEscrowV3.DeadlinePassed.selector);
        escrow.createEscrow(a, "", "");
    }

    function test_Create_ReplayProtection() public {
        Sure2PEscrowV3.Agreement memory a = _agreementFor(buyer, seller, PRICE);
        _create(a);
        bytes32 d = Sure2PEscrowV3SigUtils.agreementDigest(address(escrow), a);
        bytes memory bs = Sure2PEscrowV3SigUtils.sign(buyerPk, d);
        bytes memory ss = Sure2PEscrowV3SigUtils.sign(sellerPk, d);
        vm.expectRevert(Sure2PEscrowV3.AgreementHashUsed.selector);
        escrow.createEscrow(a, bs, ss);

        // same nonce, new hash
        Sure2PEscrowV3.Agreement memory b = _agreementFor(buyer, seller, PRICE);
        b.agreementNonce = a.agreementNonce;
        vm.expectRevert(Sure2PEscrowV3.AgreementNonceUsed.selector);
        escrow.createEscrow(b, "", "");
    }

    function test_Create_SignaturesFromV2DomainDoNotReplay() public {
        // A signature over a domain with version "2" must not validate against V3.
        Sure2PEscrowV3.Agreement memory a = _agreementFor(buyer, seller, PRICE);
        bytes32 v2Domain = keccak256(
            abi.encode(
                Sure2PEscrowV3SigUtils.DOMAIN_TYPEHASH, keccak256("Sure2PEscrow"), keccak256("2"),
                block.chainid, address(escrow)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                Sure2PEscrowV3SigUtils.AGREEMENT_TYPEHASH, a.buyer, a.seller, a.token, a.price, a.buyerDeposit,
                a.sellerDeposit, a.agreementHash, a.policyHash, a.agreementNonce, a.handoverDeadline,
                a.buyerResponseSeconds, a.inspectionSeconds, a.signDeadline
            )
        );
        bytes32 d2 = keccak256(abi.encodePacked("\x19\x01", v2Domain, structHash));
        bytes memory bs = Sure2PEscrowV3SigUtils.sign(buyerPk, d2);
        bytes memory ss = Sure2PEscrowV3SigUtils.sign(sellerPk, d2);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.InvalidSignature.selector, buyer));
        escrow.createEscrow(a, bs, ss);
    }

    function test_Create_HashAgreementMatchesIndependentDigest() public {
        Sure2PEscrowV3.Agreement memory a = _agreementFor(buyer, seller, PRICE);
        assertEq(escrow.hashAgreement(a), Sure2PEscrowV3SigUtils.agreementDigest(address(escrow), a));
    }

    // ------------------------------------------------------------ funding

    function test_Fund_BuyerSellerActivate() public {
        uint256 id = _newEscrow(PRICE);
        uint256 bb = usdc.balanceOf(buyer);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit BuyerFunded(id, PRICE + DEP);
        vm.prank(buyer);
        escrow.fundBuyer(id);
        assertEq(bb - usdc.balanceOf(buyer), PRICE + DEP);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Funding));

        vm.expectEmit(true, false, false, true, address(escrow));
        emit SellerFunded(id, DEP);
        vm.prank(seller);
        escrow.fundSeller(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Active));
        assertEq(escrow.totalOutstanding(), PRICE + 2 * DEP);
        assertEq(usdc.balanceOf(address(escrow)), PRICE + 2 * DEP);
    }

    function test_Fund_Reverts() public {
        uint256 id = _newEscrow(PRICE);
        vm.prank(stranger);
        vm.expectRevert(Sure2PEscrowV3.Unauthorized.selector);
        escrow.fundBuyer(id);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV3.Unauthorized.selector);
        escrow.fundSeller(id);

        vm.prank(buyer);
        escrow.fundBuyer(id);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV3.AlreadyFunded.selector);
        escrow.fundBuyer(id);

        skip(24 hours + 1);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV3.DeadlinePassed.selector);
        escrow.fundSeller(id);
    }

    function test_Fund_FeeOnTransferTokenRejected() public {
        FeeOnTransferToken fee = new FeeOnTransferToken(100);
        Sure2PEscrowV3 feeEscrow = new Sure2PEscrowV3(
            address(fee), ISure2PAccountRegistry(address(registry)), penaltyW, owner, arbiter, reviewer
        );
        escrow = feeEscrow;
        Sure2PEscrowV3.Agreement memory a = _agreementFor(buyer, seller, PRICE);
        a.token = address(fee);
        uint256 id = _create(a);
        fee.mint(buyer, 1e12);
        vm.startPrank(buyer);
        fee.approve(address(feeEscrow), type(uint256).max);
        vm.expectRevert();
        feeEscrow.fundBuyer(id);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ expire

    function test_Expire_RefundsActualContributions() public {
        uint256 id = _newEscrow(PRICE);
        vm.prank(buyer);
        escrow.fundBuyer(id);
        vm.expectRevert(Sure2PEscrowV3.DeadlineNotPassed.selector);
        escrow.expireUnfunded(id);

        skip(24 hours + 1);
        vm.expectEmit(true, false, false, false, address(escrow));
        emit EscrowExpired(id);
        escrow.expireUnfunded(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.ExpiredUnfunded));
        assertEq(escrow.claimable(id, buyer), PRICE + DEP);
        assertEq(escrow.claimable(id, seller), 0);

        vm.prank(buyer);
        escrow.claim(id);
        assertEq(escrow.totalOutstanding(), 0);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.ExpiredUnfunded));
        escrow.expireUnfunded(id);
    }

    // ------------------------------------------------------------ handover / acknowledge / accept

    function test_Handover_DeclareAckAcceptComplete() public {
        uint256 id = _activeEscrow(PRICE);
        vm.prank(seller);
        escrow.declareHandover(id, MANIFEST);
        vm.prank(buyer);
        escrow.acknowledgeReceipt(id);
        vm.prank(buyer);
        escrow.confirmBuyerAcceptance(id);
        escrow.finalizeMutualCompletion(id);

        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Finalized));
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, DEP);
        assertEq(s, PRICE + DEP);
        assertEq(p, 0);
    }

    function test_Handover_AcceptanceImpliesAcknowledgement() public {
        uint256 id = _activeEscrow(PRICE);
        vm.prank(seller);
        escrow.declareHandover(id, MANIFEST);
        vm.prank(buyer);
        escrow.confirmBuyerAcceptance(id);
        Sure2PEscrowV3.Escrow memory e = escrow.getEscrow(id);
        assertTrue(e.buyerReceiptAcknowledged);
        assertTrue(e.buyerAccepted);
    }

    function test_Handover_Reverts() public {
        uint256 id = _activeEscrow(PRICE);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV3.Unauthorized.selector);
        escrow.declareHandover(id, MANIFEST);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV3.ZeroCommitment.selector);
        escrow.declareHandover(id, bytes32(0));
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV3.HandoverNotDeclared.selector);
        escrow.acknowledgeReceipt(id);
        vm.expectRevert(Sure2PEscrowV3.HandoverNotDeclared.selector);
        escrow.finalizeMutualCompletion(id);

        vm.prank(seller);
        escrow.declareHandover(id, MANIFEST);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV3.AlreadyDeclared.selector);
        escrow.declareHandover(id, MANIFEST);
        vm.expectRevert(Sure2PEscrowV3.AcceptanceRequired.selector);
        escrow.finalizeMutualCompletion(id);

        vm.startPrank(buyer);
        escrow.acknowledgeReceipt(id);
        vm.expectRevert(Sure2PEscrowV3.AlreadyAcknowledged.selector);
        escrow.acknowledgeReceipt(id);
        escrow.confirmBuyerAcceptance(id);
        vm.expectRevert(Sure2PEscrowV3.AlreadyAccepted.selector);
        escrow.confirmBuyerAcceptance(id);
        vm.stopPrank();
    }

    function test_Handover_RevertsWhenEffectivelyOverdue() public {
        uint256 id = _activeEscrow(PRICE);
        skip(HANDOVER_OFFSET + 1);
        assertTrue(escrow.effectiveOverdue(id));
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV3.EffectivelyOverdue.selector);
        escrow.declareHandover(id, MANIFEST);
    }

    // ------------------------------------------------------------ overdue

    function test_Overdue_Trigger1_Handover() public {
        uint256 id = _activeEscrow(PRICE);
        vm.expectRevert(Sure2PEscrowV3.NotOverdue.selector);
        escrow.flagOverdue(id);
        skip(HANDOVER_OFFSET + 1);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit OverdueFlagged(id, 1);
        escrow.flagOverdue(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Overdue));
    }

    function test_Overdue_Trigger2_BuyerResponse() public {
        uint256 id = _activeEscrow(PRICE);
        vm.prank(seller);
        escrow.declareHandover(id, MANIFEST);
        skip(uint256(RESP) + 1);
        assertEq(escrow.overdueTrigger(id), 2);
        escrow.flagOverdue(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Overdue));
    }

    function test_Overdue_Trigger3_Inspection() public {
        uint256 id = _activeEscrow(PRICE);
        vm.prank(seller);
        escrow.declareHandover(id, MANIFEST);
        vm.prank(buyer);
        escrow.acknowledgeReceipt(id);
        skip(uint256(INSPECT) + 1);
        assertEq(escrow.overdueTrigger(id), 3);
        escrow.flagOverdue(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Overdue));
    }

    // ------------------------------------------------------------ dispute

    function test_Dispute_FromActiveAndOverdue() public {
        uint256 id = _activeEscrow(PRICE);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit DisputeOpened(id, seller, REASON);
        vm.prank(seller);
        escrow.openDispute(id, REASON);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Disputed));
        assertEq(escrow.getEscrow(id).disputeOpenedBy, seller);

        uint256 od = _overdue(PRICE);
        vm.prank(buyer);
        escrow.openDispute(od, REASON);
        assertEq(uint8(_state(od)), uint8(Sure2PEscrowV3.State.Disputed));
    }

    function test_Dispute_Reverts() public {
        uint256 id = _activeEscrow(PRICE);
        vm.prank(stranger);
        vm.expectRevert(Sure2PEscrowV3.Unauthorized.selector);
        escrow.openDispute(id, REASON);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV3.ZeroCommitment.selector);
        escrow.openDispute(id, bytes32(0));

        vm.prank(seller);
        escrow.declareHandover(id, MANIFEST);
        vm.prank(buyer);
        escrow.confirmBuyerAcceptance(id);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV3.AlreadyAccepted.selector);
        escrow.openDispute(id, REASON);

        uint256 funding = _newEscrow(PRICE);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Funding));
        escrow.openDispute(funding, REASON);

        uint256 d = _disputed(PRICE);
        vm.prank(seller);
        vm.expectRevert(_invalidState(Sure2PEscrowV3.State.Disputed));
        escrow.openDispute(d, REASON);
    }

    // ------------------------------------------------------------ claim

    function test_Claim_OnlyOwnCreditOnceAndTracksOutstanding() public {
        uint256 id = _ruledClean(PRICE, 30e6);
        _finalizeUnappealed(id);
        vm.prank(stranger);
        vm.expectRevert(Sure2PEscrowV3.NoCredit.selector);
        escrow.claim(id);

        uint256 bb = usdc.balanceOf(buyer);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Claimed(id, buyer, 30e6 + DEP);
        vm.prank(buyer);
        escrow.claim(id);
        assertEq(usdc.balanceOf(buyer) - bb, 30e6 + DEP);
        assertEq(escrow.totalOutstanding(), 70e6 + DEP);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV3.NoCredit.selector);
        escrow.claim(id);

        vm.prank(seller);
        escrow.claim(id);
        assertEq(escrow.totalOutstanding(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Claim_NothingBeforeFinalization() public {
        uint256 id = _ruledClean(PRICE, 30e6);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV3.NoCredit.selector);
        escrow.claim(id);
    }

    function test_Views_RevertOnUnknownEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.UnknownEscrow.selector, 1));
        escrow.getEscrow(1);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.UnknownEscrow.selector, 1));
        escrow.getRuling(1);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.UnknownEscrow.selector, 1));
        escrow.outcomeOf(1);
    }
}
