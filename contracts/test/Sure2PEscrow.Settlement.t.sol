// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowBase} from "./Sure2PEscrow.Base.t.sol";
import {Sure2PEscrow} from "../Sure2PEscrow.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";
import {Sure2PSigUtils} from "./mocks/Sure2PSigUtils.sol";

/// @dev executeMutualSettlement coverage.
contract Sure2PEscrowSettlementTest is Sure2PEscrowBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _activeEscrow(PRICE);
    }

    function _exec(uint256 eid, Sure2PEscrow.Settlement memory s) internal {
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        escrow.executeMutualSettlement(eid, s, bs, ss);
    }

    function _assertSplit(uint256 eid, uint256 buyerCredit, uint256 sellerCredit) internal view {
        assertEq(escrow.claimable(eid, buyer), buyerCredit, "buyer credit");
        assertEq(escrow.claimable(eid, seller), sellerCredit, "seller credit");
        assertEq(buyerCredit + sellerCredit, 150e6, "conservation");
        assertEq(uint8(_state(eid)), uint8(Sure2PEscrow.State.Finalized));
    }

    // ------------------------------------------------------------ splits

    function test_Settlement_ZeroRefund() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 0);
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Sure2PEscrow.MutualSettlementExecuted(id, 0, 0);
        vm.prank(stranger); // permissionless relay
        escrow.executeMutualSettlement(id, s, bs, ss);
        _assertSplit(id, 25e6, 125e6);
        assertEq(_get(id).settlementNonce, 1);
    }

    function test_Settlement_PartialRefund() public {
        _exec(id, _settlement(id, 10e6));
        _assertSplit(id, 10e6 + 25e6, 90e6 + 25e6);
    }

    function test_Settlement_FullRefund() public {
        _exec(id, _settlement(id, 100e6));
        _assertSplit(id, 125e6, 25e6);
    }

    function test_Settlement_EmitsCreditsForBothParties() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Sure2PEscrow.CreditAssigned(id, buyer, 35e6);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Sure2PEscrow.CreditAssigned(id, seller, 115e6);
        _exec(id, s);
    }

    function test_Settlement_ClaimsPayExactAmountsAndEmptyEscrow() public {
        uint256 bBefore = usdc.balanceOf(buyer);
        uint256 sBefore = usdc.balanceOf(seller);
        _exec(id, _settlement(id, 10e6));
        assertEq(escrow.totalOutstanding(), 150e6, "settling moves nothing until claimed");
        vm.prank(buyer);
        escrow.claim(id);
        vm.prank(seller);
        escrow.claim(id);
        assertEq(usdc.balanceOf(buyer), bBefore + 35e6);
        assertEq(usdc.balanceOf(seller), sBefore + 115e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalOutstanding(), 0);
    }

    function test_Settlement_BothDepositsAlwaysFullyRefunded() public {
        uint256[4] memory refunds = [uint256(0), 1, 99e6 + 1, 100e6];
        for (uint256 i; i < refunds.length; ++i) {
            uint256 eid = _activeEscrow(PRICE);
            _exec(eid, _settlement(eid, refunds[i]));
            assertEq(escrow.claimable(eid, buyer), refunds[i] + 25e6);
            assertEq(escrow.claimable(eid, seller), PRICE - refunds[i] + 25e6);
        }
    }

    // ------------------------------------------------------------ valid source states

    function test_Settlement_ValidFromActive() public {
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Active));
        _exec(id, _settlement(id, 10e6));
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Finalized));
    }

    function test_Settlement_ValidFromActiveAfterBuyerAcceptance() public {
        _declare(id);
        _accept(id);
        _exec(id, _settlement(id, 100e6));
        _assertSplit(id, 125e6, 25e6);
    }

    function test_Settlement_ValidFromOverdue() public {
        vm.warp(_get(id).handoverDeadline + 1);
        escrow.flagOverdue(id);
        _exec(id, _settlement(id, 10e6));
        _assertSplit(id, 35e6, 115e6);
    }

    function test_Settlement_ValidFromEffectivelyOverdueUnflagged() public {
        vm.warp(_get(id).handoverDeadline + 1);
        _exec(id, _settlement(id, 10e6));
        _assertSplit(id, 35e6, 115e6);
    }

    function test_Settlement_ValidFromDisputed() public {
        _dispute(id);
        _exec(id, _settlement(id, 10e6));
        _assertSplit(id, 35e6, 115e6);
    }

    // ------------------------------------------------------------ invalid source states

    function test_Settlement_RevertsInFunding() public {
        uint256 fid = _newEscrow(PRICE);
        _fundBuyer(fid);
        Sure2PEscrow.Settlement memory s = _settlement(fid, 0);
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Funding));
        escrow.executeMutualSettlement(fid, s, bs, ss);
        assertEq(escrow.claimable(fid, buyer), 0);
    }

    function test_Settlement_RevertsInExpiredUnfunded() public {
        uint256 fid = _newEscrow(PRICE);
        _fundBuyer(fid);
        vm.warp(block.timestamp + 2 days);
        escrow.expireUnfunded(fid);
        Sure2PEscrow.Settlement memory s = _settlement(fid, 0);
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.ExpiredUnfunded));
        escrow.executeMutualSettlement(fid, s, bs, ss);
        assertEq(escrow.claimable(fid, buyer), 125e6, "refund credit unchanged");
    }

    function test_Settlement_RevertsUnknownEscrow() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 0);
        s.escrowId = 77;
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrow.UnknownEscrow.selector, 77));
        escrow.executeMutualSettlement(77, s, bs, ss);
    }

    function test_Settlement_CannotReplay() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        escrow.executeMutualSettlement(id, s, bs, ss);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Finalized));
        escrow.executeMutualSettlement(id, s, bs, ss);
        _assertSplit(id, 35e6, 115e6);
    }

    function test_Settlement_CannotOverwriteCompletedEscrow() public {
        _declare(id);
        _accept(id);
        escrow.finalizeMutualCompletion(id);
        Sure2PEscrow.Settlement memory s = _settlement(id, 100e6);
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Finalized));
        escrow.executeMutualSettlement(id, s, bs, ss);
        _assertSplit(id, 25e6, 125e6);
    }

    function test_Settlement_CannotOverwriteAfterClaims() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        escrow.executeMutualSettlement(id, s, bs, ss);
        vm.prank(buyer);
        escrow.claim(id);
        vm.prank(seller);
        escrow.claim(id);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Finalized));
        escrow.executeMutualSettlement(id, s, bs, ss);
        assertEq(escrow.claimable(id, buyer), 0);
        assertEq(escrow.claimable(id, seller), 0);
        assertEq(escrow.totalOutstanding(), 0);
    }

    function test_Completion_CannotFollowSettlement() public {
        _declare(id);
        _accept(id);
        _exec(id, _settlement(id, 0));
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Finalized));
        escrow.finalizeMutualCompletion(id);
    }

    // ------------------------------------------------------------ bad payloads

    function test_Settlement_RevertsWrongNonce() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        s.nonce = 1;
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        vm.expectRevert(Sure2PEscrow.InvalidSettlement.selector);
        escrow.executeMutualSettlement(id, s, bs, ss);
    }

    function test_Settlement_RevertsWrongEscrowIdField() public {
        uint256 id2 = _activeEscrow(PRICE);
        Sure2PEscrow.Settlement memory s = _settlement(id2, 10e6); // signed for id2
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        vm.expectRevert(Sure2PEscrow.InvalidSettlement.selector);
        escrow.executeMutualSettlement(id, s, bs, ss); // submitted against id
    }

    function test_Settlement_RevertsWrongAgreementHash() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        s.agreementHash = keccak256("other agreement");
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        vm.expectRevert(Sure2PEscrow.InvalidSettlement.selector);
        escrow.executeMutualSettlement(id, s, bs, ss);
    }

    function test_Settlement_RevertsAgreementHashOfAnotherEscrow() public {
        uint256 id2 = _activeEscrow(PRICE);
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        s.agreementHash = _get(id2).agreementHash;
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        vm.expectRevert(Sure2PEscrow.InvalidSettlement.selector);
        escrow.executeMutualSettlement(id, s, bs, ss);
    }

    function test_Settlement_RevertsRefundAbovePrice() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, PRICE + 1);
        (bytes memory bs, bytes memory ss) = _settleSigs(s); // properly signed
        vm.expectRevert(Sure2PEscrow.InvalidSettlement.selector);
        escrow.executeMutualSettlement(id, s, bs, ss);
    }

    function test_Settlement_DeadlineBoundary() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        vm.warp(s.deadline + 1);
        vm.expectRevert(Sure2PEscrow.DeadlinePassed.selector);
        escrow.executeMutualSettlement(id, s, bs, ss);
        vm.warp(s.deadline); // exactly at deadline is still valid
        escrow.executeMutualSettlement(id, s, bs, ss);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Finalized));
    }

    // ------------------------------------------------------------ signatures

    function test_Settlement_RevertsTamperedRefund() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        s.buyerPriceRefund = 20e6; // relayer inflates the buyer's refund
        vm.expectRevert(_badSig(buyer));
        escrow.executeMutualSettlement(id, s, bs, ss);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Active));
    }

    function test_Settlement_RevertsTamperedDeadline() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        s.deadline += 1 days;
        vm.expectRevert(_badSig(buyer));
        escrow.executeMutualSettlement(id, s, bs, ss);
    }

    function test_Settlement_RevertsWrongBuyerSigner() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        bytes memory bs = Sure2PSigUtils.signSettlement(address(escrow), s, otherPk);
        bytes memory ss = Sure2PSigUtils.signSettlement(address(escrow), s, sellerPk);
        vm.expectRevert(_badSig(buyer));
        escrow.executeMutualSettlement(id, s, bs, ss);
    }

    function test_Settlement_RevertsWrongSellerSigner() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        bytes memory bs = Sure2PSigUtils.signSettlement(address(escrow), s, buyerPk);
        bytes memory ss = Sure2PSigUtils.signSettlement(address(escrow), s, otherPk);
        vm.expectRevert(_badSig(seller));
        escrow.executeMutualSettlement(id, s, bs, ss);
    }

    function test_Settlement_RevertsOneSidedOrMissingSignature() public {
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        vm.expectRevert(_badSig(seller));
        escrow.executeMutualSettlement(id, s, bs, "");
        vm.expectRevert(_badSig(buyer));
        escrow.executeMutualSettlement(id, s, "", ss);
        vm.expectRevert(_badSig(buyer));
        escrow.executeMutualSettlement(id, s, ss, bs); // swapped
    }

    function test_Settlement_RevertsSignatureFromAnotherEscrowContract() public {
        Sure2PEscrow other2 = new Sure2PEscrow(address(usdc), ISure2PAccountRegistry(address(registry)));
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        bytes memory bs = Sure2PSigUtils.signSettlement(address(other2), s, buyerPk);
        bytes memory ss = Sure2PSigUtils.signSettlement(address(other2), s, sellerPk);
        vm.expectRevert(_badSig(buyer));
        escrow.executeMutualSettlement(id, s, bs, ss);
    }

    function test_Settlement_AgreementSignaturesAreNotSettlementSignatures() public {
        // The agreement signature domain/type must not authorise a settlement.
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        bytes32 d = Sure2PSigUtils.agreementDigest(address(escrow), _agreement(PRICE));
        bytes memory bs = Sure2PSigUtils.sign(buyerPk, d);
        bytes memory ss = Sure2PSigUtils.sign(sellerPk, d);
        vm.expectRevert(_badSig(buyer));
        escrow.executeMutualSettlement(id, s, bs, ss);
    }
}
