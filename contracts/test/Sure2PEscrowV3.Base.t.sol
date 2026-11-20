// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Sure2PEscrowV3} from "../Sure2PEscrowV3.sol";
import {Sure2PAccountRegistry} from "../Sure2PAccountRegistry.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Sure2PEscrowV3SigUtils} from "./mocks/Sure2PEscrowV3SigUtils.sol";

/// @dev Shared V3 fixture. No test functions: every category file inherits it.
abstract contract Sure2PEscrowV3Base is Test {
    uint256 internal constant T0 = 1_700_000_000;
    uint256 internal constant PRICE = 100e6;
    uint32 internal constant RESP = 2 days;
    uint32 internal constant INSPECT = 3 days;
    uint256 internal constant HANDOVER_OFFSET = 7 days;
    uint256 internal constant APPEAL_WINDOW = 72 hours;
    bytes32 internal constant REASON = keccak256("reason");
    bytes32 internal constant RULE_HASH = keccak256("ruling-reasoning");
    bytes32 internal constant EVID_ROOT = keccak256("evidence-root");

    // fault / fraud flag bits
    uint8 internal constant BF = 1; // buyer at fault
    uint8 internal constant SF = 2; // seller at fault
    uint8 internal constant BFR = 4; // buyer fraud
    uint8 internal constant SFR = 8; // seller fraud

    MockUSDC internal usdc;
    Sure2PAccountRegistry internal registry;
    Sure2PEscrowV3 internal escrow;

    address internal admin = makeAddr("admin");
    address internal security = makeAddr("security");
    address internal owner = makeAddr("owner");
    address internal arbiter = makeAddr("arbiter");
    address internal reviewer = makeAddr("reviewer");
    address internal penaltyW = makeAddr("penaltyWallet");
    address internal stranger = makeAddr("stranger");
    address internal buyer;
    address internal seller;
    uint256 internal buyerPk;
    uint256 internal sellerPk;
    uint256 internal salt;

    function setUp() public virtual {
        vm.warp(T0);
        (buyer, buyerPk) = makeAddrAndKey("buyer");
        (seller, sellerPk) = makeAddrAndKey("seller");

        usdc = new MockUSDC();
        registry = new Sure2PAccountRegistry(admin, security);
        escrow = new Sure2PEscrowV3(
            address(usdc), ISure2PAccountRegistry(address(registry)), penaltyW, owner, arbiter, reviewer
        );

        address[2] memory users = [buyer, seller];
        for (uint256 i; i < users.length; ++i) {
            usdc.mint(users[i], 1e30);
            vm.prank(users[i]);
            usdc.approve(address(escrow), type(uint256).max);
        }
    }

    // ---------------------------------------------------------------- agreement helpers

    function _dep(uint256 price) internal pure returns (uint256) {
        return (price + 3) / 4;
    }

    function _agreementFor(address b, address s, uint256 price)
        internal
        returns (Sure2PEscrowV3.Agreement memory a)
    {
        ++salt;
        a.buyer = b;
        a.seller = s;
        a.token = address(usdc);
        a.price = price;
        a.buyerDeposit = _dep(price);
        a.sellerDeposit = _dep(price);
        a.agreementHash = keccak256(abi.encode("agreement", salt));
        a.policyHash = keccak256("policy");
        a.agreementNonce = salt;
        a.handoverDeadline = uint64(block.timestamp + HANDOVER_OFFSET);
        a.buyerResponseSeconds = RESP;
        a.inspectionSeconds = INSPECT;
        a.signDeadline = uint64(block.timestamp + 1 days);
    }

    function _create(Sure2PEscrowV3.Agreement memory a) internal returns (uint256) {
        bytes32 d = Sure2PEscrowV3SigUtils.agreementDigest(address(escrow), a);
        return escrow.createEscrow(a, Sure2PEscrowV3SigUtils.sign(buyerPk, d), Sure2PEscrowV3SigUtils.sign(sellerPk, d));
    }

    function _newEscrow(uint256 price) internal returns (uint256) {
        return _create(_agreementFor(buyer, seller, price));
    }

    function _activeEscrow(uint256 price) internal returns (uint256 id) {
        id = _newEscrow(price);
        vm.prank(buyer);
        escrow.fundBuyer(id);
        vm.prank(seller);
        escrow.fundSeller(id);
    }

    /// @dev Active -> Disputed.
    function _disputed(uint256 price) internal returns (uint256 id) {
        id = _activeEscrow(price);
        vm.prank(buyer);
        escrow.openDispute(id, REASON);
    }

    /// @dev Active -> Overdue (seller never declared handover).
    function _overdue(uint256 price) internal returns (uint256 id) {
        id = _activeEscrow(price);
        vm.warp(block.timestamp + HANDOVER_OFFSET + 1);
        escrow.flagOverdue(id);
    }

    // ---------------------------------------------------------------- ruling helpers

    /// @dev Builds a RulingInput bound to the escrow's agreement hash. flags: BF|SF|BFR|SFR.
    function _in(uint256 id, uint256 pr, uint256 bdr, uint256 sdr, uint8 flags)
        internal
        view
        returns (Sure2PEscrowV3.RulingInput memory r)
    {
        r.agreementHash = escrow.getEscrow(id).agreementHash;
        r.buyerPriceRefund = pr;
        r.buyerDepositRefund = bdr;
        r.sellerDepositRefund = sdr;
        r.buyerAtFault = flags & BF != 0;
        r.sellerAtFault = flags & SF != 0;
        r.buyerFraud = flags & BFR != 0;
        r.sellerFraud = flags & SFR != 0;
        r.reasonHash = RULE_HASH;
        r.evidenceRoot = EVID_ROOT;
    }

    /// @dev Valid "nobody at fault" input: price refund `pr`, both deposits fully refunded.
    function _clean(uint256 id, uint256 pr) internal view returns (Sure2PEscrowV3.RulingInput memory) {
        Sure2PEscrowV3.Escrow memory e = escrow.getEscrow(id);
        return _in(id, pr, e.buyerDeposit, e.sellerDeposit, 0);
    }

    function _prelimIn(uint256 id, Sure2PEscrowV3.RulingInput memory r) internal {
        vm.prank(arbiter);
        escrow.issuePreliminaryRuling(id, r);
    }

    function _prelim(uint256 id, uint256 pr, uint256 bdr, uint256 sdr, uint8 flags) internal {
        _prelimIn(id, _in(id, pr, bdr, sdr, flags));
    }

    /// @dev Disputed escrow with a preliminary ruling issued.
    function _ruled(uint256 price, uint256 pr, uint256 bdr, uint256 sdr, uint8 flags) internal returns (uint256 id) {
        id = _disputed(price);
        _prelim(id, pr, bdr, sdr, flags);
    }

    /// @dev Disputed escrow with a clean (no-fault) preliminary ruling.
    function _ruledClean(uint256 price, uint256 pr) internal returns (uint256 id) {
        id = _disputed(price);
        _prelimIn(id, _clean(id, pr));
    }

    function _appeal(uint256 id, address who) internal {
        vm.prank(who);
        escrow.appeal(id, REASON);
    }

    function _finalIn(uint256 id, Sure2PEscrowV3.RulingInput memory r) internal {
        vm.prank(reviewer);
        escrow.issueFinalRuling(id, r);
    }

    function _final(uint256 id, uint256 pr, uint256 bdr, uint256 sdr, uint8 flags) internal {
        _finalIn(id, _in(id, pr, bdr, sdr, flags));
    }

    function _finalizeUnappealed(uint256 id) internal {
        skip(APPEAL_WINDOW + 1);
        escrow.finalizeRuling(id);
    }

    function _state(uint256 id) internal view returns (Sure2PEscrowV3.State) {
        return escrow.getEscrow(id).state;
    }

    function _credits(uint256 id) internal view returns (uint256 b, uint256 s, uint256 p) {
        b = escrow.claimable(id, buyer);
        s = escrow.claimable(id, seller);
        p = escrow.claimable(id, penaltyW);
    }

    // ---------------------------------------------------------------- settlement helpers

    function _settle(uint256 id, uint256 refund) internal {
        Sure2PEscrowV3.Escrow memory e = escrow.getEscrow(id);
        Sure2PEscrowV3.Settlement memory s = Sure2PEscrowV3.Settlement({
            escrowId: id,
            buyerPriceRefund: refund,
            nonce: e.settlementNonce,
            deadline: uint64(block.timestamp + 1 days),
            agreementHash: e.agreementHash
        });
        bytes memory bs = Sure2PEscrowV3SigUtils.signSettlement(address(escrow), s, buyerPk);
        bytes memory ss = Sure2PEscrowV3SigUtils.signSettlement(address(escrow), s, sellerPk);
        escrow.executeMutualSettlement(id, s, bs, ss);
    }

    // ---------------------------------------------------------------- error helpers

    function _invalidState(Sure2PEscrowV3.State st) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Sure2PEscrowV3.InvalidState.selector, st);
    }
}
