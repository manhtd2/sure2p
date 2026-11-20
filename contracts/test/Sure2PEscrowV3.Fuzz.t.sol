// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowV3} from "../Sure2PEscrowV3.sol";
import {Sure2PEscrowV3Base} from "./Sure2PEscrowV3.Base.t.sol";

/// @dev Fuzzing of the ruling arithmetic: conservation (S1), non-fault full refund (S2), fraud implies fault (S3).
contract Sure2PEscrowV3FuzzTest is Sure2PEscrowV3Base {
    struct Case {
        uint256 price;
        uint256 dep;
        uint256 pr;
        uint256 bdr;
        uint256 sdr;
        uint8 flags;
    }

    /// @dev Maps raw fuzz values to a VALID ruling for a price: non-fault sides get full deposit, fraud implies fault.
    function _mkCase(uint256 price, uint256 pr, uint256 bdr, uint256 sdr, uint8 raw)
        internal
        pure
        returns (Case memory c)
    {
        c.price = bound(price, 1, 1e13);
        c.dep = (c.price + 3) / 4;
        c.pr = bound(pr, 0, c.price);
        uint8 f = raw & (BF | SF);
        if (f & BF != 0 && raw & BFR != 0) f |= BFR;
        if (f & SF != 0 && raw & SFR != 0) f |= SFR;
        c.flags = f;
        c.bdr = f & BF != 0 ? bound(bdr, 0, c.dep) : c.dep;
        c.sdr = f & SF != 0 ? bound(sdr, 0, c.dep) : c.dep;
    }

    function _assertSplit(uint256 id, Case memory c) internal {
        uint256 total = c.price + 2 * c.dep;
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(b + s + p, total, "conservation");
        assertEq(p, (c.dep - c.bdr) + (c.dep - c.sdr), "penalty wallet gets exactly the unrefunded deposits");
        assertEq(b, c.pr + c.bdr, "buyer");
        assertEq(s, (c.price - c.pr) + c.sdr, "seller");
        if (c.flags & BF == 0) assertEq(b - c.pr, c.dep, "non-fault buyer full deposit");
        if (c.flags & SF == 0) assertEq(s - (c.price - c.pr), c.dep, "non-fault seller full deposit");
        assertEq(escrow.totalOutstanding(), total);

        if (b > 0) { vm.prank(buyer); escrow.claim(id); }
        if (s > 0) { vm.prank(seller); escrow.claim(id); }
        if (p > 0) { vm.prank(penaltyW); escrow.claim(id); }
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow drained exactly");
        assertEq(escrow.totalOutstanding(), 0);
    }

    function testFuzz_Conservation_PreliminaryPath(
        uint256 price, uint256 pr, uint256 bdr, uint256 sdr, uint8 raw, bool overdue
    ) public {
        Case memory c = _mkCase(price, pr, bdr, sdr, raw);
        uint256 id = overdue ? _overdue(c.price) : _disputed(c.price);
        _prelim(id, c.pr, c.bdr, c.sdr, c.flags);
        (uint256 b0, uint256 s0, uint256 p0) = _credits(id);
        assertEq(b0 + s0 + p0, 0, "no credits before finalization");
        _finalizeUnappealed(id);
        _assertSplit(id, c);
    }

    function testFuzz_Conservation_FinalPath(
        uint256 price, uint256 pr, uint256 bdr, uint256 sdr, uint8 raw,
        uint256 pr2, uint256 bdr2, uint256 sdr2, uint8 raw2, bool sellerAppeals
    ) public {
        Case memory c1 = _mkCase(price, pr, bdr, sdr, raw);
        Case memory c2 = _mkCase(price, pr2, bdr2, sdr2, raw2);
        uint256 id = _ruled(c1.price, c1.pr, c1.bdr, c1.sdr, c1.flags);
        _appeal(id, sellerAppeals ? seller : buyer);
        (uint256 b0, uint256 s0, uint256 p0) = _credits(id);
        assertEq(b0 + s0 + p0, 0, "no credits while appealed");
        _final(id, c2.pr, c2.bdr, c2.sdr, c2.flags);
        _assertSplit(id, c2); // final input wins
    }

    function testFuzz_Preview_EqualsFinalizedCredits(
        uint256 price, uint256 pr, uint256 bdr, uint256 sdr, uint8 raw
    ) public {
        Case memory c = _mkCase(price, pr, bdr, sdr, raw);
        uint256 id = _disputed(c.price);
        (uint256 pb, uint256 ps, uint256 pp) = escrow.previewRuling(id, _in(id, c.pr, c.bdr, c.sdr, c.flags));
        _prelim(id, c.pr, c.bdr, c.sdr, c.flags);
        _finalizeUnappealed(id);
        (uint256 b, uint256 s, uint256 p) = _credits(id);
        assertEq(pb, b);
        assertEq(ps, s);
        assertEq(pp, p);
        assertEq(pb + ps + pp, c.price + 2 * c.dep);
    }

    function testFuzz_NonFaultPartyMustGetFullDeposit(uint256 price, uint256 short, bool buyerSide) public {
        price = bound(price, 1, 1e13);
        uint256 dep = _dep(price);
        short = bound(short, 1, dep); // shortfall 1..dep
        uint256 id = _disputed(price);
        // the OTHER side is at fault and fully refunded, so only the non-fault side is invalid
        Sure2PEscrowV3.RulingInput memory r = buyerSide
            ? _in(id, 0, dep - short, dep, SF)
            : _in(id, 0, dep, dep - short, BF);
        vm.expectRevert(
            abi.encodeWithSelector(Sure2PEscrowV3.NonFaultPartyMustBeRefunded.selector, buyerSide, dep - short, dep)
        );
        escrow.previewRuling(id, r);
        vm.prank(arbiter);
        vm.expectRevert(
            abi.encodeWithSelector(Sure2PEscrowV3.NonFaultPartyMustBeRefunded.selector, buyerSide, dep - short, dep)
        );
        escrow.issuePreliminaryRuling(id, r);
    }

    function testFuzz_FraudWithoutFaultReverts(uint256 price, uint256 pr, bool buyerSide) public {
        price = bound(price, 1, 1e13);
        pr = bound(pr, 0, price);
        uint256 dep = _dep(price);
        uint256 id = _disputed(price);
        Sure2PEscrowV3.RulingInput memory r = _in(id, pr, dep, dep, buyerSide ? BFR : SFR);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.FraudRequiresFault.selector, buyerSide));
        escrow.previewRuling(id, r);
    }

    function testFuzz_RefundsAboveBoundsRevert(uint256 price, uint256 excess, uint8 which) public {
        price = bound(price, 1, 1e13);
        excess = bound(excess, 1, 1e18);
        uint256 dep = _dep(price);
        uint256 id = _disputed(price);
        Sure2PEscrowV3.RulingInput memory r;
        uint256 max;
        which = uint8(bound(which, 0, 2));
        if (which == 0) {
            r = _in(id, price + excess, dep, dep, 0);
            max = price;
        } else if (which == 1) {
            r = _in(id, 0, dep + excess, dep, BF);
            max = dep;
        } else {
            r = _in(id, 0, dep, dep + excess, SF);
            max = dep;
        }
        uint256 supplied = which == 0 ? price + excess : dep + excess;
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrowV3.RulingRefundTooLarge.selector, supplied, max));
        escrow.previewRuling(id, r);
    }

    function testFuzz_AppealWindowBoundary(uint256 early, uint256 late) public {
        early = bound(early, 0, APPEAL_WINDOW);
        late = bound(late, 1, 30 days);
        uint256 a = _ruledClean(PRICE, 0);
        uint256 b = _ruledClean(PRICE, 0);
        uint256 t0 = block.timestamp;

        // appeal at any second up to and including the deadline
        vm.warp(t0 + early);
        _appeal(a, buyer);
        assertEq(uint8(_state(a)), uint8(Sure2PEscrowV3.State.Appealed));

        // strictly after the deadline: appeal reverts, finalize succeeds
        vm.warp(t0 + APPEAL_WINDOW + late);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrowV3.DeadlinePassed.selector);
        escrow.appeal(b, REASON);
        escrow.finalizeRuling(b);
        assertEq(uint8(_state(b)), uint8(Sure2PEscrowV3.State.Finalized));
    }

    function testFuzz_FinalizeBeforeDeadlineReverts(uint256 dt) public {
        dt = bound(dt, 0, APPEAL_WINDOW);
        uint256 id = _ruledClean(PRICE, 0);
        vm.warp(block.timestamp + dt);
        vm.expectRevert(Sure2PEscrowV3.DeadlineNotPassed.selector);
        escrow.finalizeRuling(id);
    }
}
