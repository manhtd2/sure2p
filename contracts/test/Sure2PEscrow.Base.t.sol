// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Sure2PEscrow} from "../Sure2PEscrow.sol";
import {Sure2PAccountRegistry} from "../Sure2PAccountRegistry.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Sure2PSigUtils} from "./mocks/Sure2PSigUtils.sol";

/// @dev Shared fixture. No test functions here: every category file inherits it.
abstract contract Sure2PEscrowBase is Test {
    uint256 internal constant T0 = 1_700_000_000;
    uint256 internal constant PRICE = 100e6;
    uint32 internal constant RESP = 2 days;
    uint32 internal constant INSPECT = 3 days;
    uint256 internal constant HANDOVER_OFFSET = 7 days;
    bytes32 internal constant MANIFEST = keccak256("manifest");
    bytes32 internal constant REASON = keccak256("reason");

    MockUSDC internal usdc;
    Sure2PAccountRegistry internal registry;
    Sure2PEscrow internal escrow;

    address internal admin = makeAddr("admin");
    address internal security = makeAddr("security");
    address internal stranger = makeAddr("stranger");
    address internal buyer;
    address internal seller;
    address internal buyer2;
    address internal other;
    uint256 internal buyerPk;
    uint256 internal sellerPk;
    uint256 internal buyer2Pk;
    uint256 internal otherPk;
    uint256 internal salt;

    function setUp() public virtual {
        vm.warp(T0);
        (buyer, buyerPk) = makeAddrAndKey("buyer");
        (seller, sellerPk) = makeAddrAndKey("seller");
        (buyer2, buyer2Pk) = makeAddrAndKey("buyer2");
        (other, otherPk) = makeAddrAndKey("other");

        usdc = new MockUSDC();
        registry = new Sure2PAccountRegistry(admin, security);
        escrow = new Sure2PEscrow(address(usdc), ISure2PAccountRegistry(address(registry)));

        address[4] memory users = [buyer, seller, buyer2, other];
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

    function _agreementFor(address token, uint256 price) internal returns (Sure2PEscrow.Agreement memory a) {
        ++salt;
        a.buyer = buyer;
        a.seller = seller;
        a.token = token;
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

    function _agreement(uint256 price) internal returns (Sure2PEscrow.Agreement memory) {
        return _agreementFor(address(usdc), price);
    }

    function _sigs(Sure2PEscrow esc, Sure2PEscrow.Agreement memory a, uint256 bPk, uint256 sPk)
        internal
        view
        returns (bytes memory, bytes memory)
    {
        bytes32 d = Sure2PSigUtils.agreementDigest(address(esc), a);
        return (Sure2PSigUtils.sign(bPk, d), Sure2PSigUtils.sign(sPk, d));
    }

    function _createOn(Sure2PEscrow esc, Sure2PEscrow.Agreement memory a) internal returns (uint256) {
        (bytes memory bs, bytes memory ss) = _sigs(esc, a, buyerPk, sellerPk);
        return esc.createEscrow(a, bs, ss);
    }

    function _create(Sure2PEscrow.Agreement memory a) internal returns (uint256) {
        return _createOn(escrow, a);
    }

    function _newEscrow(uint256 price) internal returns (uint256) {
        return _create(_agreement(price));
    }

    function _fundBuyer(uint256 id) internal {
        vm.prank(buyer);
        escrow.fundBuyer(id);
    }

    function _fundSeller(uint256 id) internal {
        vm.prank(seller);
        escrow.fundSeller(id);
    }

    function _activeEscrow(uint256 price) internal returns (uint256 id) {
        id = _newEscrow(price);
        _fundBuyer(id);
        _fundSeller(id);
    }

    function _declare(uint256 id) internal {
        vm.prank(seller);
        escrow.declareHandover(id, MANIFEST);
    }

    function _ack(uint256 id) internal {
        vm.prank(buyer);
        escrow.acknowledgeReceipt(id);
    }

    function _accept(uint256 id) internal {
        vm.prank(buyer);
        escrow.confirmBuyerAcceptance(id);
    }

    function _dispute(uint256 id) internal {
        vm.prank(buyer);
        escrow.openDispute(id, REASON);
    }

    function _get(uint256 id) internal view returns (Sure2PEscrow.Escrow memory) {
        return escrow.getEscrow(id);
    }

    function _state(uint256 id) internal view returns (Sure2PEscrow.State) {
        return escrow.getEscrow(id).state;
    }

    // ---------------------------------------------------------------- settlement helpers

    function _settlement(uint256 id, uint256 refund) internal view returns (Sure2PEscrow.Settlement memory s) {
        Sure2PEscrow.Escrow memory e = escrow.getEscrow(id);
        s.escrowId = id;
        s.buyerPriceRefund = refund;
        s.nonce = e.settlementNonce;
        s.deadline = uint64(block.timestamp + 1 days);
        s.agreementHash = e.agreementHash;
    }

    function _settleSigs(Sure2PEscrow.Settlement memory s) internal view returns (bytes memory, bytes memory) {
        bytes32 d = Sure2PSigUtils.settlementDigest(address(escrow), s);
        return (Sure2PSigUtils.sign(buyerPk, d), Sure2PSigUtils.sign(sellerPk, d));
    }

    function _settle(uint256 id, uint256 refund) internal {
        Sure2PEscrow.Settlement memory s = _settlement(id, refund);
        (bytes memory bs, bytes memory ss) = _settleSigs(s);
        escrow.executeMutualSettlement(id, s, bs, ss);
    }

    // ---------------------------------------------------------------- error helpers

    function _invalidState(Sure2PEscrow.State st) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Sure2PEscrow.InvalidState.selector, st);
    }

    function _badSig(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Sure2PEscrow.InvalidSignature.selector, who);
    }
}
