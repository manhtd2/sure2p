// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowV2} from "../Sure2PEscrowV2.sol";
import {Sure2PEscrowV2Base} from "./Sure2PEscrowV2.Base.t.sol";

/// @dev issuePreliminaryRuling: happy paths (Overdue/Disputed x Fault x penalty) and revert paths.
contract Sure2PEscrowV2RulingTest is Sure2PEscrowV2Base {
    event PreliminaryRulingIssued(
        uint256 indexed id, address indexed issuedBy, uint256 buyerPriceRefund,
        Sure2PEscrowV2.Fault fault, uint256 penalty, bytes32 reasonHash, uint64 appealDeadline
    );

    uint256 internal constant DEP = 25e6;
    uint256 internal constant REFUND = 40e6;

    function _escrowIn(bool overdue) internal returns (uint256) {
        return overdue ? _overdue(PRICE) : _disputed(PRICE);
    }

    /// @dev Issue + verify stored ruling, then finalize after the window and verify credit split.
    function _happy(bool overdue, Sure2PEscrowV2.Fault f, uint256 penalty) internal {
        uint256 outBefore = escrow.totalOutstanding();
        uint256 id = _escrowIn(overdue);
        uint64 deadline = uint64(block.timestamp + APPEAL_WINDOW);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit PreliminaryRulingIssued(id, arbiter, REFUND, f, penalty, RULE_HASH, deadline);
        _prelim(id, REFUND, f, penalty);

        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV2.State.PreliminaryRuling));
        Sure2PEscrowV2.Ruling memory r = escrow.getRuling(id);
        assertEq(r.issuedBy, arbiter);
        assertEq(r.issuedAt, uint64(block.timestamp));
        assertEq(r.appealDeadline, deadline);
        assertEq(r.buyerPriceRefund, REFUND);
        assertEq(r.penalty, penalty);
        assertEq(uint8(r.fault), uint8(f));
        assertEq(r.reasonHash, RULE_HASH);
        assertFalse(r.appealed);

        // no credits and no funds moved yet
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b + s + p, 0);
        assertEq(escrow.totalOutstanding(), outBefore + PRICE + 2 * DEP);

        skip(APPEAL_WINDOW + 1);
        escrow.finalizeRuling(id);
        (b, s, p) = _credits(id);
        assertEq(b, REFUND + DEP - (f == Sure2PEscrowV2.Fault.Buyer ? penalty : 0), "buyer");
        assertEq(s, (PRICE - REFUND) + DEP - (f == Sure2PEscrowV2.Fault.Seller ? penalty : 0), "seller");
        assertEq(p, penalty, "penalty wallet");
        assertEq(b + s + p, PRICE + 2 * DEP, "conservation");
    }

    function _allPenalties(bool overdue, Sure2PEscrowV2.Fault f) internal {
        _happy(overdue, f, 0);
        _happy(overdue, f, DEP / 2);
        _happy(overdue, f, DEP);
    }

    // ------------------------------------------------------------ happy: Disputed

    function test_Prelim_Disputed_FaultNone() public {
        _happy(false, Sure2PEscrowV2.Fault.None, 0);
    }

    function test_Prelim_Disputed_FaultBuyer() public {
        _allPenalties(false, Sure2PEscrowV2.Fault.Buyer);
    }

    function test_Prelim_Disputed_FaultSeller() public {
        _allPenalties(false, Sure2PEscrowV2.Fault.Seller);
    }

    // ------------------------------------------------------------ happy: Overdue

    function test_Prelim_Overdue_FaultNone() public {
        _happy(true, Sure2PEscrowV2.Fault.None, 0);
    }

    function test_Prelim_Overdue_FaultBuyer() public {
        _allPenalties(true, Sure2PEscrowV2.Fault.Buyer);
    }

    function test_Prelim_Overdue_FaultSeller() public {
        _allPenalties(true, Sure2PEscrowV2.Fault.Seller);
    }

    function test_Prelim_RefundBoundaries() public {
        uint256 id = _disputed(PRICE);
        _prelim(id, 0, Sure2PEscrowV2.Fault.None, 0);
        id = _disputed(PRICE);
        _prelim(id, PRICE, Sure2PEscrowV2.Fault.None, 0);
        assertEq(escrow.getRuling(id).buyerPriceRefund, PRICE);
    }

    // ------------------------------------------------------------ reverts

    function test_Prelim_RevertsForNonArbiter() public {
        uint256 id = _disputed(PRICE);
        address[4] memory bad = [stranger, reviewer, owner, penaltyW];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
            escrow.issuePreliminaryRuling(id, 0, Sure2PEscrowV2.Fault.None, 0, RULE_HASH);
        }
    }

    function test_Prelim_RevertsForPartiesWhoAreNotArbiter() public {
        uint256 id = _disputed(PRICE);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
        escrow.issuePreliminaryRuling(id, 0, Sure2PEscrowV2.Fault.None, 0, RULE_HASH);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
        escrow.issuePreliminaryRuling(id, 0, Sure2PEscrowV2.Fault.None, 0, RULE_HASH);
    }

    function test_Prelim_RevertsWhenArbiterIsBuyer() public {
        uint256 id = _disputed(PRICE);
        vm.prank(owner);
        escrow.setArbiter(buyer);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
        escrow.issuePreliminaryRuling(id, 0, Sure2PEscrowV2.Fault.None, 0, RULE_HASH);
    }

    function test_Prelim_RevertsWhenArbiterIsSeller() public {
        uint256 id = _overdue(PRICE);
        vm.prank(owner);
        escrow.setArbiter(seller);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV2.Unauthorized.selector);
        escrow.issuePreliminaryRuling(id, 0, Sure2PEscrowV2.Fault.None, 0, RULE_HASH);
    }

    function test_Prelim_RevertsOnUnknownEscrow() public {
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV2.UnknownEscrow.selector, 99));
        escrow.issuePreliminaryRuling(99, 0, Sure2PEscrowV2.Fault.None, 0, RULE_HASH);
    }

    function _expectWrongState(uint256 id, Sure2PEscrowV2.State st) internal {
        vm.prank(arbiter);
        vm.expectRevert(_invalidState(st));
        escrow.issuePreliminaryRuling(id, 0, Sure2PEscrowV2.Fault.None, 0, RULE_HASH);
    }

    function test_Prelim_RevertsInFundingState() public {
        _expectWrongState(_newEscrow(PRICE), Sure2PEscrowV2.State.Funding);
    }

    function test_Prelim_RevertsInActiveState() public {
        _expectWrongState(_activeEscrow(PRICE), Sure2PEscrowV2.State.Active);
    }

    function test_Prelim_RevertsInExpiredUnfundedState() public {
        uint256 id = _newEscrow(PRICE);
        skip(24 hours + 1);
        escrow.expireUnfunded(id);
        _expectWrongState(id, Sure2PEscrowV2.State.ExpiredUnfunded);
    }

    function test_Prelim_RevertsWhenAlreadyPreliminaryRuling() public {
        uint256 id = _ruled(PRICE, 0, Sure2PEscrowV2.Fault.None, 0);
        _expectWrongState(id, Sure2PEscrowV2.State.PreliminaryRuling);
    }

    function test_Prelim_RevertsWhenAppealed() public {
        uint256 id = _ruled(PRICE, 0, Sure2PEscrowV2.Fault.None, 0);
        _appeal(id, buyer);
        _expectWrongState(id, Sure2PEscrowV2.State.Appealed);
    }

    function test_Prelim_RevertsWhenFinalized() public {
        uint256 id = _disputed(PRICE);
        _settle(id, 50e6);
        _expectWrongState(id, Sure2PEscrowV2.State.Finalized);
    }

    function test_Prelim_RevertsWhenRefundExceedsPrice() public {
        uint256 id = _disputed(PRICE);
        vm.prank(arbiter);
        vm.expectRevert(Sure2PEscrowV2.InvalidRuling.selector);
        escrow.issuePreliminaryRuling(id, PRICE + 1, Sure2PEscrowV2.Fault.None, 0, RULE_HASH);
    }

    function test_Prelim_RevertsWhenPenaltyExceedsBuyerDeposit() public {
        uint256 id = _disputed(PRICE);
        vm.prank(arbiter);
        vm.expectRevert(Sure2PEscrowV2.InvalidRuling.selector);
        escrow.issuePreliminaryRuling(id, 0, Sure2PEscrowV2.Fault.Buyer, DEP + 1, RULE_HASH);
    }

    function test_Prelim_RevertsWhenPenaltyExceedsSellerDeposit() public {
        uint256 id = _disputed(PRICE);
        vm.prank(arbiter);
        vm.expectRevert(Sure2PEscrowV2.InvalidRuling.selector);
        escrow.issuePreliminaryRuling(id, 0, Sure2PEscrowV2.Fault.Seller, DEP + 1, RULE_HASH);
    }

    function test_Prelim_RevertsWhenPenaltyWithFaultNone() public {
        uint256 id = _disputed(PRICE);
        vm.prank(arbiter);
        vm.expectRevert(Sure2PEscrowV2.InvalidRuling.selector);
        escrow.issuePreliminaryRuling(id, 0, Sure2PEscrowV2.Fault.None, 1, RULE_HASH);
    }

    function test_Prelim_RevertsOnZeroReasonHash() public {
        uint256 id = _disputed(PRICE);
        vm.prank(arbiter);
        vm.expectRevert(Sure2PEscrowV2.ZeroCommitment.selector);
        escrow.issuePreliminaryRuling(id, 0, Sure2PEscrowV2.Fault.None, 0, bytes32(0));
    }

    function test_Prelim_FailedCallLeavesStateUnchanged() public {
        uint256 id = _disputed(PRICE);
        vm.prank(arbiter);
        vm.expectRevert(Sure2PEscrowV2.InvalidRuling.selector);
        escrow.issuePreliminaryRuling(id, PRICE + 1, Sure2PEscrowV2.Fault.None, 0, RULE_HASH);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV2.State.Disputed));
        assertEq(escrow.getRuling(id).issuedAt, 0);
    }

    function test_Prelim_NonDeductedDepositWithOddPrice() public {
        // price not divisible by 4: deposit rounds up; penalty bound is the rounded deposit.
        uint256 price = 101;
        uint256 dep = _dep(price);
        assertEq(dep, 26);
        uint256 id = _disputed(price);
        vm.prank(arbiter);
        vm.expectRevert(Sure2PEscrowV2.InvalidRuling.selector);
        escrow.issuePreliminaryRuling(id, 0, Sure2PEscrowV2.Fault.Seller, dep + 1, RULE_HASH);
        _prelim(id, 1, Sure2PEscrowV2.Fault.Seller, dep);
        skip(APPEAL_WINDOW + 1);
        escrow.finalizeRuling(id);
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b, 1 + dep);
        assertEq(s, 100);
        assertEq(p, dep);
        assertEq(b + s + p, price + 2 * dep);
    }
}
