// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Sure2PEscrowV2} from "../Sure2PEscrowV2.sol";
import {Sure2PAccountRegistry} from "../Sure2PAccountRegistry.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Sure2PEscrowV2SigUtils} from "./mocks/Sure2PEscrowV2SigUtils.sol";

/// @dev Shared V2 fixture. No test functions: every category file inherits it.
abstract contract Sure2PEscrowV2Base is Test {
    uint256 internal constant T0 = 1_700_000_000;
    uint256 internal constant PRICE = 100e6;
    uint32 internal constant RESP = 2 days;
    uint32 internal constant INSPECT = 3 days;
    uint256 internal constant HANDOVER_OFFSET = 7 days;
    uint256 internal constant APPEAL_WINDOW = 72 hours;
    bytes32 internal constant REASON = keccak256("reason");
    bytes32 internal constant RULE_HASH = keccak256("ruling-reasoning");

    MockUSDC internal usdc;
    Sure2PAccountRegistry internal registry;
    Sure2PEscrowV2 internal escrow;

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
        escrow = new Sure2PEscrowV2(
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
        returns (Sure2PEscrowV2.Agreement memory a)
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

    function _create(Sure2PEscrowV2.Agreement memory a) internal returns (uint256) {
        bytes32 d = Sure2PEscrowV2SigUtils.agreementDigest(address(escrow), a);
        return escrow.createEscrow(a, Sure2PEscrowV2SigUtils.sign(buyerPk, d), Sure2PEscrowV2SigUtils.sign(sellerPk, d));
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

    function _prelim(uint256 id, uint256 refund, Sure2PEscrowV2.Fault f, uint256 penalty) internal {
        vm.prank(arbiter);
        escrow.issuePreliminaryRuling(id, refund, f, penalty, RULE_HASH);
    }

    /// @dev Disputed escrow with a preliminary ruling issued.
    function _ruled(uint256 price, uint256 refund, Sure2PEscrowV2.Fault f, uint256 penalty)
        internal
        returns (uint256 id)
    {
        id = _disputed(price);
        _prelim(id, refund, f, penalty);
    }

    function _appeal(uint256 id, address who) internal {
        vm.prank(who);
        escrow.appeal(id, REASON);
    }

    function _final(uint256 id, uint256 refund, Sure2PEscrowV2.Fault f, uint256 penalty) internal {
        vm.prank(reviewer);
        escrow.issueFinalRuling(id, refund, f, penalty, RULE_HASH);
    }

    function _state(uint256 id) internal view returns (Sure2PEscrowV2.State) {
        return escrow.getEscrow(id).state;
    }

    function _credits(uint256 id) internal view returns (uint256 b, uint256 s, uint256 p) {
        b = escrow.claimable(id, buyer);
        s = escrow.claimable(id, seller);
        p = escrow.claimable(id, penaltyW);
    }

    // ---------------------------------------------------------------- settlement helpers

    function _settle(uint256 id, uint256 refund) internal {
        Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
        Sure2PEscrowV2.Settlement memory s = Sure2PEscrowV2.Settlement({
            escrowId: id,
            buyerPriceRefund: refund,
            nonce: e.settlementNonce,
            deadline: uint64(block.timestamp + 1 days),
            agreementHash: e.agreementHash
        });
        bytes memory bs = Sure2PEscrowV2SigUtils.signSettlement(address(escrow), s, buyerPk);
        bytes memory ss = Sure2PEscrowV2SigUtils.signSettlement(address(escrow), s, sellerPk);
        escrow.executeMutualSettlement(id, s, bs, ss);
    }

    // ---------------------------------------------------------------- error helpers

    function _invalidState(Sure2PEscrowV2.State st) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Sure2PEscrowV2.InvalidState.selector, st);
    }
}
