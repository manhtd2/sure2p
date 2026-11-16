// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowBase} from "./Sure2PEscrow.Base.t.sol";
import {Sure2PEscrow} from "../Sure2PEscrow.sol";

/// @dev Fuzzing of price/deposit arithmetic, settlement split conservation and time boundaries.
contract Sure2PEscrowFuzzTest is Sure2PEscrowBase {
    uint256 internal constant MAX_PRICE = 1e24;

    function testFuzz_DepositIsCeilQuarterAndFundingIsExact(uint256 price) public {
        price = bound(price, 1, MAX_PRICE);
        uint256 id = _newEscrow(price);
        Sure2PEscrow.Escrow memory e = _get(id);
        uint256 dep = e.buyerDeposit;

        // ceil(price / 4): covers a quarter of the price, and no more than one unit above it
        assertGe(dep * 4, price);
        assertLt((dep - 1) * 4, price);
        assertEq(e.sellerDeposit, dep);
        assertGe(dep, 1);

        uint256 bBefore = usdc.balanceOf(buyer);
        uint256 sBefore = usdc.balanceOf(seller);
        _fundBuyer(id);
        _fundSeller(id);
        assertEq(bBefore - usdc.balanceOf(buyer), price + dep);
        assertEq(sBefore - usdc.balanceOf(seller), dep);
        assertEq(usdc.balanceOf(address(escrow)), price + 2 * dep);
        assertEq(escrow.totalOutstanding(), price + 2 * dep);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Active));
    }

    function testFuzz_AnyDepositOffTheFormulaReverts(uint256 price, uint256 bDep, uint256 sDep) public {
        price = bound(price, 1, MAX_PRICE);
        bDep = bound(bDep, 0, MAX_PRICE);
        sDep = bound(sDep, 0, MAX_PRICE);
        uint256 dep = _dep(price);
        vm.assume(bDep != dep || sDep != dep);

        Sure2PEscrow.Agreement memory a = _agreement(price);
        a.buyerDeposit = bDep;
        a.sellerDeposit = sDep;
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        vm.expectRevert(Sure2PEscrow.InvalidDeposit.selector);
        escrow.createEscrow(a, bs, ss);
    }

    function testFuzz_SettlementSplitConservation(uint256 price, uint256 refund) public {
        price = bound(price, 1, MAX_PRICE);
        refund = bound(refund, 0, price);
        uint256 dep = _dep(price);
        uint256 id = _activeEscrow(price);
        uint256 bBefore = usdc.balanceOf(buyer);
        uint256 sBefore = usdc.balanceOf(seller);

        _settle(id, refund);

        uint256 bCredit = escrow.claimable(id, buyer);
        uint256 sCredit = escrow.claimable(id, seller);
        assertEq(bCredit, refund + dep, "buyer: refund + full deposit");
        assertEq(sCredit, price - refund + dep, "seller: price remainder + full deposit");
        assertEq(bCredit + sCredit, price + 2 * dep, "conservation");

        vm.prank(buyer);
        escrow.claim(id);
        vm.prank(seller);
        escrow.claim(id);
        assertEq(usdc.balanceOf(buyer), bBefore + bCredit);
        assertEq(usdc.balanceOf(seller), sBefore + sCredit);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalOutstanding(), 0);
    }

    function testFuzz_SettlementRefundAbovePriceReverts(uint256 price, uint256 excess) public {
        price = bound(price, 1, MAX_PRICE);
        excess = bound(excess, 1, type(uint128).max);
        uint256 id = _activeEscrow(price);
        Sure2PEscrow.Settlement memory s = _settlement(id, price + excess);
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        vm.expectRevert(Sure2PEscrow.InvalidSettlement.selector);
        escrow.executeMutualSettlement(id, s, bs, ss);
    }

    function testFuzz_CompletionConservation(uint256 price, uint32 delay) public {
        price = bound(price, 1, MAX_PRICE);
        uint256 dep = _dep(price);
        uint256 id = _activeEscrow(price);
        _declare(id);
        skip(bound(delay, 0, RESP)); // accept within the response window
        _accept(id);
        skip(uint256(delay) * 1000); // later finalisation can never be blocked
        escrow.finalizeMutualCompletion(id);

        assertEq(escrow.claimable(id, seller), price + dep);
        assertEq(escrow.claimable(id, buyer), dep);
        assertEq(escrow.claimable(id, seller) + escrow.claimable(id, buyer), price + 2 * dep);
    }

    function testFuzz_ExpireRefundsExactContributions(uint256 price, bool buyerFunds, bool sellerFunds) public {
        price = bound(price, 1, MAX_PRICE);
        vm.assume(!(buyerFunds && sellerFunds)); // both funded => Active, covered elsewhere
        uint256 dep = _dep(price);
        uint256 id = _newEscrow(price);
        uint256 bBefore = usdc.balanceOf(buyer);
        uint256 sBefore = usdc.balanceOf(seller);
        if (buyerFunds) _fundBuyer(id);
        if (sellerFunds) _fundSeller(id);

        vm.warp(uint256(_get(id).fundingDeadline) + 1);
        escrow.expireUnfunded(id);

        assertEq(escrow.claimable(id, buyer), buyerFunds ? price + dep : 0);
        assertEq(escrow.claimable(id, seller), sellerFunds ? dep : 0);
        if (buyerFunds) {
            vm.prank(buyer);
            escrow.claim(id);
        }
        if (sellerFunds) {
            vm.prank(seller);
            escrow.claim(id);
        }
        assertEq(usdc.balanceOf(buyer), bBefore, "no penalty");
        assertEq(usdc.balanceOf(seller), sBefore, "no penalty");
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalOutstanding(), 0);
    }

    function testFuzz_HandoverDeadlineMustExceedFundingWindow(uint64 offset) public {
        offset = uint64(bound(offset, 0, 60 days));
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        a.handoverDeadline = uint64(block.timestamp) + offset;
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        if (offset <= 24 hours) {
            vm.expectRevert(Sure2PEscrow.InvalidHandoverDeadline.selector);
            escrow.createEscrow(a, bs, ss);
        } else {
            assertEq(escrow.createEscrow(a, bs, ss), 1);
        }
    }

    function testFuzz_DurationBounds(uint32 resp, uint32 insp) public {
        resp = uint32(bound(resp, 0, 31 days));
        insp = uint32(bound(insp, 0, 31 days));
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        a.buyerResponseSeconds = resp;
        a.inspectionSeconds = insp;
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        bool ok = resp >= 1 hours && resp <= 30 days && insp >= 1 hours && insp <= 30 days;
        if (!ok) vm.expectRevert(Sure2PEscrow.InvalidDuration.selector);
        escrow.createEscrow(a, bs, ss);
    }

    function testFuzz_TriggerAIsStrictlyGreaterThan(uint32 dt) public {
        uint256 id = _activeEscrow(PRICE);
        uint256 dl = _get(id).handoverDeadline;
        dt = uint32(bound(dt, 0, 100 days));
        vm.warp(dl - 3 days + dt);
        assertEq(escrow.overdueTrigger(id), block.timestamp > dl ? 1 : 0);
    }

    function testFuzz_NonBeneficiaryCannotClaim(address caller, uint256 refund) public {
        vm.assume(caller != buyer && caller != seller);
        refund = bound(refund, 0, PRICE);
        uint256 id = _activeEscrow(PRICE);
        _settle(id, refund);
        vm.prank(caller);
        vm.expectRevert(Sure2PEscrow.NoCredit.selector);
        escrow.claim(id);
    }

    function testFuzz_CreateRejectsAnyTamperedAgreementField(uint256 newPolicy) public {
        vm.assume(newPolicy != 0);
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        vm.assume(bytes32(newPolicy) != a.policyHash);
        a.policyHash = bytes32(newPolicy);
        vm.expectRevert(_badSig(buyer));
        escrow.createEscrow(a, bs, ss);
    }
}
