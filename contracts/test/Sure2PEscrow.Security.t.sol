// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Sure2PEscrowBase} from "./Sure2PEscrow.Base.t.sol";
import {Sure2PEscrow} from "../Sure2PEscrow.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";
import {Sure2PSigUtils} from "./mocks/Sure2PSigUtils.sol";
import {ReentrantToken, ReentrancyAttacker} from "./mocks/ReentrantToken.sol";

/// @dev Reentrancy via a hostile (ERC777-style hook) token and an ERC-1271 attacker wallet that is the seller.
contract Sure2PEscrowSecurityTest is Sure2PEscrowBase {
    ReentrantToken internal tok;
    Sure2PEscrow internal esc;
    ReentrancyAttacker internal atk;

    function setUp() public override {
        super.setUp();
        tok = new ReentrantToken();
        esc = new Sure2PEscrow(address(tok), ISure2PAccountRegistry(address(registry)));
        atk = new ReentrancyAttacker(address(esc), tok);
        tok.mint(address(atk), 1e12);
        tok.mint(buyer, 1e12);
        vm.prank(buyer);
        tok.approve(address(esc), type(uint256).max);
        tok.setHookEnabled(true);
    }

    // ------------------------------------------------------------ helpers

    function _atkEscrow(uint256 price) internal returns (uint256) {
        Sure2PEscrow.Agreement memory a = _agreementFor(address(tok), price);
        a.seller = address(atk);
        bytes memory bs = Sure2PSigUtils.signAgreement(address(esc), a, buyerPk);
        return esc.createEscrow(a, bs, hex"00"); // attacker's ERC-1271 accepts anything
    }

    function _atkActive(uint256 price) internal returns (uint256 eid) {
        eid = _atkEscrow(price);
        vm.prank(buyer);
        esc.fundBuyer(eid);
        atk.exec(abi.encodeCall(Sure2PEscrow.fundSeller, (eid)));
    }

    function _atkSettle(uint256 eid, uint256 refund) internal {
        Sure2PEscrow.Escrow memory e = esc.getEscrow(eid);
        Sure2PEscrow.Settlement memory s = Sure2PEscrow.Settlement({
            escrowId: eid,
            buyerPriceRefund: refund,
            nonce: e.settlementNonce,
            deadline: uint64(block.timestamp + 1 days),
            agreementHash: e.agreementHash
        });
        bytes memory bs = Sure2PSigUtils.signSettlement(address(esc), s, buyerPk);
        esc.executeMutualSettlement(eid, s, bs, hex"00");
    }

    function _assertReentrancyBlocked() internal view {
        assertTrue(atk.attempted(), "hook fired");
        assertFalse(atk.reentrySucceeded(), "re-entrant call must fail");
        assertEq(bytes4(atk.revertData()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    // ------------------------------------------------------------ claim

    function test_Reentrancy_ClaimSameIdIsBlockedAndPaidOnce() public {
        uint256 eid = _atkActive(PRICE);
        _atkSettle(eid, 0); // attacker (seller) credit = 125e6
        uint256 before = tok.balanceOf(address(atk));

        atk.arm(abi.encodeCall(Sure2PEscrow.claim, (eid)));
        atk.exec(abi.encodeCall(Sure2PEscrow.claim, (eid)));

        _assertReentrancyBlocked();
        assertEq(tok.balanceOf(address(atk)) - before, 125e6, "paid exactly once");
        assertEq(esc.claimable(eid, address(atk)), 0);
        assertEq(esc.totalOutstanding(), 25e6, "only buyer's credit left");
        assertEq(tok.balanceOf(address(esc)), 25e6);
    }

    function test_Reentrancy_ClaimOtherEscrowIsBlocked() public {
        uint256 e1 = _atkActive(PRICE);
        uint256 e2 = _atkActive(PRICE);
        _atkSettle(e1, 0);
        _atkSettle(e2, 0);

        atk.arm(abi.encodeCall(Sure2PEscrow.claim, (e2))); // drain a sibling escrow mid-claim
        atk.exec(abi.encodeCall(Sure2PEscrow.claim, (e1)));

        _assertReentrancyBlocked();
        assertEq(esc.claimable(e1, address(atk)), 0);
        assertEq(esc.claimable(e2, address(atk)), 125e6, "sibling credit untouched");
        atk.exec(abi.encodeCall(Sure2PEscrow.claim, (e2))); // armed one-shot already spent
        assertEq(esc.claimable(e2, address(atk)), 0);
        assertEq(esc.totalOutstanding(), 50e6);
        assertEq(tok.balanceOf(address(esc)), 50e6);
    }

    function test_Reentrancy_ClaimCannotStartSettlementOrDispute() public {
        uint256 e1 = _atkActive(PRICE);
        uint256 e2 = _atkActive(PRICE);
        _atkSettle(e1, 0);

        atk.arm(abi.encodeCall(Sure2PEscrow.openDispute, (e2, REASON)));
        atk.exec(abi.encodeCall(Sure2PEscrow.claim, (e1)));
        _assertReentrancyBlocked();
        assertEq(uint8(esc.getEscrow(e2).state), uint8(Sure2PEscrow.State.Active));
    }

    // ------------------------------------------------------------ fund

    function test_Reentrancy_FundSellerBlockedAndAccountedOnce() public {
        uint256 eid = _atkEscrow(PRICE);
        atk.arm(abi.encodeCall(Sure2PEscrow.fundSeller, (eid)));
        atk.exec(abi.encodeCall(Sure2PEscrow.fundSeller, (eid)));

        _assertReentrancyBlocked();
        assertTrue(esc.getEscrow(eid).sellerFunded);
        assertEq(tok.balanceOf(address(esc)), 25e6);
        assertEq(esc.totalOutstanding(), 25e6);
    }

    function test_Reentrancy_FundCannotReachClaimOrExpire() public {
        uint256 e1 = _atkActive(PRICE);
        _atkSettle(e1, 0);
        uint256 e2 = _atkEscrow(PRICE);

        atk.arm(abi.encodeCall(Sure2PEscrow.claim, (e1))); // try to claim while funding e2
        atk.exec(abi.encodeCall(Sure2PEscrow.fundSeller, (e2)));
        _assertReentrancyBlocked();
        assertEq(esc.claimable(e1, address(atk)), 125e6, "claim did not run mid-funding");
        assertTrue(esc.getEscrow(e2).sellerFunded);
    }

    function test_Reentrancy_FundBuyerHookCannotDoubleFund() public {
        // hostile ERC-1271 BUYER: pulls from a contract buyer, hook tries to fund again
        Sure2PEscrow.Agreement memory a = _agreementFor(address(tok), PRICE);
        a.buyer = address(atk);
        bytes memory ss = Sure2PSigUtils.signAgreement(address(esc), a, sellerPk);
        uint256 eid = esc.createEscrow(a, hex"00", ss);

        atk.arm(abi.encodeCall(Sure2PEscrow.fundBuyer, (eid)));
        atk.exec(abi.encodeCall(Sure2PEscrow.fundBuyer, (eid)));
        _assertReentrancyBlocked();
        assertEq(tok.balanceOf(address(esc)), 125e6);
        assertEq(esc.totalOutstanding(), 125e6);
    }

    // ------------------------------------------------------------ no admin / alternate recipient surface

    function test_Claim_OnlyPaysCaller() public {
        uint256 eid = _atkActive(PRICE);
        _atkSettle(eid, 10e6);
        uint256 buyerBefore = tok.balanceOf(buyer);
        vm.prank(stranger);
        vm.expectRevert(Sure2PEscrow.NoCredit.selector);
        esc.claim(eid);
        vm.prank(buyer);
        esc.claim(eid);
        assertEq(tok.balanceOf(buyer) - buyerBefore, 35e6);
    }
}
