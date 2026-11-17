// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowV2} from "../Sure2PEscrowV2.sol";
import {Sure2PEscrowV2Base} from "./Sure2PEscrowV2.Base.t.sol";

/// @dev End-to-end flows: worked example, claims, mutual settlement mid-case, role replacement, conservation fuzz.
contract Sure2PEscrowV2FlowTest is Sure2PEscrowV2Base {
    event Claimed(uint256 indexed escrowId, address indexed account, uint256 amount);
    event MutualSettlementExecuted(uint256 indexed escrowId, uint256 buyerPriceRefund, uint256 nonce);

    Sure2PEscrowV2.Fault internal constant NONE = Sure2PEscrowV2.Fault.None;
    Sure2PEscrowV2.Fault internal constant BUYER = Sure2PEscrowV2.Fault.Buyer;
    Sure2PEscrowV2.Fault internal constant SELLER = Sure2PEscrowV2.Fault.Seller;

    // ------------------------------------------------------------ worked example (design section 24)

    function test_WorkedExample_100USDC() public {
        uint256 id = _disputed(100e6);
        assertEq(_dep(100e6), 25e6);
        _prelim(id, 100e6, SELLER, 25e6);
        skip(APPEAL_WINDOW + 1);
        escrow.finalizeRuling(id);

        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, 125e6, "buyer");
        assertEq(s, 0, "seller");
        assertEq(p, 25e6, "penalty wallet");
        assertEq(b + s + p, 150e6);
        assertEq(escrow.claimable(id, stranger), 0);
    }

    function test_WorkedExample_ClaimsPayOutExactly() public {
        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 id = _disputed(100e6);
        _prelim(id, 100e6, SELLER, 25e6);
        skip(APPEAL_WINDOW + 1);
        escrow.finalizeRuling(id);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit Claimed(id, buyer, 125e6);
        vm.prank(buyer);
        escrow.claim(id);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Claimed(id, penaltyW, 25e6);
        vm.prank(penaltyW);
        escrow.claim(id);

        assertEq(usdc.balanceOf(penaltyW), 25e6);
        // buyer paid 125 in, got 125 back
        assertEq(usdc.balanceOf(buyer), buyerBefore);
        // seller has nothing to claim
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV2.NoCredit.selector);
        escrow.claim(id);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalOutstanding(), 0);
    }

    // ------------------------------------------------------------ claim by penalty wallet

    function test_PenaltyWallet_ClaimOncePerEscrowOnly() public {
        uint256 id = _ruled(PRICE, 0, BUYER, 10e6);
        skip(APPEAL_WINDOW + 1);
        escrow.finalizeRuling(id);

        vm.prank(penaltyW);
        escrow.claim(id);
        assertEq(usdc.balanceOf(penaltyW), 10e6);
        vm.prank(penaltyW);
        vm.expectRevert(Sure2PEscrowV2.NoCredit.selector);
        escrow.claim(id);
        assertEq(escrow.claimable(id, penaltyW), 0);
    }

    function test_PenaltyWallet_NoCreditWhenPenaltyZero() public {
        uint256 id = _ruled(PRICE, 50e6, SELLER, 0);
        skip(APPEAL_WINDOW + 1);
        escrow.finalizeRuling(id);
        assertEq(escrow.claimable(id, penaltyW), 0);
        vm.prank(penaltyW);
        vm.expectRevert(Sure2PEscrowV2.NoCredit.selector);
        escrow.claim(id);
    }

    function test_PenaltyWallet_CannotClaimOthersCredit() public {
        uint256 id = _ruled(PRICE, 50e6, SELLER, 10e6);
        skip(APPEAL_WINDOW + 1);
        escrow.finalizeRuling(id);
        // buyer's credit is not claimable by the penalty wallet or anyone else, and goes only to the buyer
        vm.prank(stranger);
        vm.expectRevert(Sure2PEscrowV2.NoCredit.selector);
        escrow.claim(id);
        uint256 before = usdc.balanceOf(buyer);
        vm.prank(buyer);
        escrow.claim(id);
        assertEq(usdc.balanceOf(buyer) - before, 75e6);
    }

    function test_PenaltyWallet_NoClaimBeforeFinalization() public {
        uint256 id = _ruled(PRICE, 0, SELLER, 10e6);
        vm.prank(penaltyW);
        vm.expectRevert(Sure2PEscrowV2.NoCredit.selector);
        escrow.claim(id);
    }

    function test_PenaltyWallet_ReceivesFromFinalRulingToo() public {
        uint256 id = _ruled(PRICE, 0, NONE, 0);
        _appeal(id, buyer);
        _final(id, 0, SELLER, 20e6);
        assertEq(escrow.claimable(id, penaltyW), 20e6);
    }

    // ------------------------------------------------------------ mutual settlement mid-case

    function test_MutualSettlement_DuringPreliminaryRuling() public {
        uint256 id = _ruled(PRICE, 100e6, SELLER, 25e6);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit MutualSettlementExecuted(id, 30e6, 0);
        _settle(id, 30e6);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV2.State.Finalized));
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, 30e6 + 25e6);
        assertEq(s, 70e6 + 25e6);
        assertEq(p, 0, "ruling penalty must not apply to a mutual settlement");

        // ruling can no longer be finalized or appealed
        skip(APPEAL_WINDOW + 1);
        vm.expectRevert(_invalidState(Sure2PEscrowV2.State.Finalized));
        escrow.finalizeRuling(id);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrowV2.State.Finalized));
        escrow.appeal(id, REASON);
    }

    function test_MutualSettlement_DuringAppealed() public {
        uint256 id = _ruled(PRICE, 100e6, SELLER, 25e6);
        _appeal(id, seller);
        _settle(id, 50e6);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV2.State.Finalized));
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, 75e6);
        assertEq(s, 75e6);
        assertEq(p, 0);
        vm.prank(reviewer);
        vm.expectRevert(_invalidState(Sure2PEscrowV2.State.Finalized));
        escrow.issueFinalRuling(id, 0, NONE, 0, RULE_HASH);
    }

    function test_MutualSettlement_AfterAppealDeadlineButBeforeFinalize() public {
        uint256 id = _ruled(PRICE, 100e6, SELLER, 25e6);
        skip(APPEAL_WINDOW + 10);
        _settle(id, 0);
        (uint256 b, uint256 s,) = _credits(id);
        assertEq(b, 25e6);
        assertEq(s, 125e6);
    }

    // ------------------------------------------------------------ owner replacing arbiter mid-case

    function test_ReplaceArbiter_NewArbiterRulesDisputedCase() public {
        uint256 id = _disputed(PRICE);
        address newArbiter = makeAddr("newArbiter");
        vm.prank(owner);
        escrow.setArbiter(newArbiter);

        vm.prank(arbiter);
        vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
        escrow.issuePreliminaryRuling(id, 0, NONE, 0, RULE_HASH);

        vm.prank(newArbiter);
        escrow.issuePreliminaryRuling(id, 20e6, BUYER, 5e6, RULE_HASH);
        assertEq(escrow.getRuling(id).issuedBy, newArbiter);
    }

    function test_ReplaceArbiter_ExistingRulingKeepsOriginalIssuerAndFinalizes() public {
        uint256 id = _ruled(PRICE, 20e6, BUYER, 5e6);
        address newArbiter = makeAddr("newArbiter");
        vm.prank(owner);
        escrow.setArbiter(newArbiter);

        assertEq(escrow.getRuling(id).issuedBy, arbiter);
        // new arbiter cannot re-rule a PreliminaryRuling case
        vm.prank(newArbiter);
        vm.expectRevert(_invalidState(Sure2PEscrowV2.State.PreliminaryRuling));
        escrow.issuePreliminaryRuling(id, 0, NONE, 0, RULE_HASH);

        skip(APPEAL_WINDOW + 1);
        escrow.finalizeRuling(id);
        assertEq(escrow.claimable(id, penaltyW), 5e6);
    }

    function test_ReplaceArbiter_OwnerCannotRuleOrMoveFunds() public {
        uint256 id = _disputed(PRICE);
        vm.prank(owner);
        vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
        escrow.issuePreliminaryRuling(id, 0, NONE, 0, RULE_HASH);
        vm.prank(owner);
        vm.expectRevert(Sure2PEscrowV2.NoCredit.selector);
        escrow.claim(id);
    }

    function test_ReplaceArbiter_ReplacedWithOverdueCase() public {
        uint256 id = _overdue(PRICE);
        address newArbiter = makeAddr("newArbiter");
        vm.prank(owner);
        escrow.setArbiter(newArbiter);
        vm.prank(newArbiter);
        escrow.issuePreliminaryRuling(id, 0, SELLER, 25e6, RULE_HASH);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV2.State.PreliminaryRuling));
    }

    // ------------------------------------------------------------ conservation fuzz

    function testFuzz_Conservation_PreliminaryPath(
        uint256 price, uint256 refund, uint8 faultRaw, uint256 penalty, bool overdue, bool useSeller
    ) public {
        price = bound(price, 1, 1e13);
        Sure2PEscrowV2.Fault f = Sure2PEscrowV2.Fault(bound(faultRaw, 0, 2));
        refund = bound(refund, 0, price);
        uint256 dep = _dep(price);
        penalty = f == NONE ? 0 : bound(penalty, 0, dep);
        // keep the fuzzed fault consistent for seller/buyer choice
        if (useSeller && f == BUYER) f = SELLER;

        uint256 id = overdue ? _overdue(price) : _disputed(price);
        uint256 total = price + 2 * dep;
        _prelim(id, refund, f, penalty);
        skip(APPEAL_WINDOW + 1);
        escrow.finalizeRuling(id);
        _assertConserved(id, total, refund, f, penalty, dep);
    }

    function testFuzz_Conservation_FinalPath(
        uint256 price, uint256 refund, uint8 faultRaw, uint256 penalty, uint256 refund2, uint8 fault2Raw, uint256 penalty2
    ) public {
        price = bound(price, 1, 1e13);
        uint256 dep = _dep(price);
        Sure2PEscrowV2.Fault f = Sure2PEscrowV2.Fault(bound(faultRaw, 0, 2));
        refund = bound(refund, 0, price);
        penalty = f == NONE ? 0 : bound(penalty, 0, dep);
        uint256 id = _ruled(price, refund, f, penalty);
        _appeal(id, faultRaw % 2 == 0 ? buyer : seller);

        Sure2PEscrowV2.Fault f2 = Sure2PEscrowV2.Fault(bound(fault2Raw, 0, 2));
        refund2 = bound(refund2, 0, price);
        penalty2 = f2 == NONE ? 0 : bound(penalty2, 0, dep);
        _final(id, refund2, f2, penalty2);
        _assertConserved(id, price + 2 * dep, refund2, f2, penalty2, dep);
    }

    function _assertConserved(
        uint256 id, uint256 total, uint256 refund, Sure2PEscrowV2.Fault f, uint256 penalty, uint256 dep
    ) internal {
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b + s + p, total, "credits == price + deposits");
        assertEq(p, penalty, "penalty wallet gets exactly the penalty");
        assertEq(b, refund + dep - (f == BUYER ? penalty : 0), "buyer share");
        assertEq(s, (total - 2 * dep - refund) + dep - (f == SELLER ? penalty : 0), "seller share");
        assertEq(escrow.totalOutstanding(), total);

        // everyone claims, contract is left with exactly nothing
        uint256 pwBefore = usdc.balanceOf(penaltyW);
        if (b > 0) { vm.prank(buyer); escrow.claim(id); }
        if (s > 0) { vm.prank(seller); escrow.claim(id); }
        if (p > 0) { vm.prank(penaltyW); escrow.claim(id); }
        assertEq(usdc.balanceOf(penaltyW) - pwBefore, penalty);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalOutstanding(), 0);
    }
}
