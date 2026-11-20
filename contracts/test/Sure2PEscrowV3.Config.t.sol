// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Sure2PEscrowV3} from "../Sure2PEscrowV3.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";
import {Sure2PEscrowV3Base} from "./Sure2PEscrowV3.Base.t.sol";

/// @dev Constructor validation, reserved-party rejection, role setters, ownership.
contract Sure2PEscrowV3ConfigTest is Sure2PEscrowV3Base {
    event ArbiterChanged(address oldArbiter, address newArbiter);
    event AppealReviewerChanged(address oldReviewer, address newReviewer);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    bytes4 internal immutable INVALID_CONFIG = Sure2PEscrowV3.InvalidConfiguration.selector;

    function _deploy(address u, address r, address p, address o, address a, address rv) internal returns (Sure2PEscrowV3) {
        return new Sure2PEscrowV3(u, ISure2PAccountRegistry(r), p, o, a, rv);
    }

    // ------------------------------------------------------------ constructor

    function test_Constructor_StoresConfig() public view {
        assertEq(address(escrow.usdc()), address(usdc));
        assertEq(address(escrow.registry()), address(registry));
        assertEq(escrow.penaltyWallet(), penaltyW);
        assertEq(escrow.owner(), owner);
        assertEq(escrow.arbiter(), arbiter);
        assertEq(escrow.appealReviewer(), reviewer);
        assertEq(escrow.pendingOwner(), address(0));
    }

    function test_Constructor_DomainVersionIs3() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Sure2PEscrow"),
                keccak256("3"),
                block.chainid,
                address(escrow)
            )
        );
        assertEq(escrow.domainSeparator(), expected);
    }

    function test_Constructor_RevertsOnZeroUsdc() public {
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(0), address(registry), penaltyW, owner, arbiter, reviewer);
    }

    function test_Constructor_RevertsOnZeroRegistry() public {
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(usdc), address(0), penaltyW, owner, arbiter, reviewer);
    }

    function test_Constructor_RevertsOnZeroPenaltyWallet() public {
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(usdc), address(registry), address(0), owner, arbiter, reviewer);
    }

    function test_Constructor_RevertsOnZeroOwner() public {
        // Ownable(address(0)) reverts inside the base constructor before the escrow's own check.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        _deploy(address(usdc), address(registry), penaltyW, address(0), arbiter, reviewer);
    }

    function test_Constructor_RevertsOnZeroArbiter() public {
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(usdc), address(registry), penaltyW, owner, address(0), reviewer);
    }

    function test_Constructor_RevertsOnZeroReviewer() public {
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(usdc), address(registry), penaltyW, owner, arbiter, address(0));
    }

    function test_Constructor_RevertsWhenUsdcHasNoCode() public {
        vm.expectRevert(INVALID_CONFIG);
        _deploy(makeAddr("eoa"), address(registry), penaltyW, owner, arbiter, reviewer);
    }

    function test_Constructor_RevertsWhenRegistryHasNoCode() public {
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(usdc), makeAddr("eoa"), penaltyW, owner, arbiter, reviewer);
    }

    function test_Constructor_RevertsWhenArbiterEqualsReviewer() public {
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(usdc), address(registry), penaltyW, owner, arbiter, arbiter);
    }

    function test_Constructor_RevertsWhenArbiterEqualsOwner() public {
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(usdc), address(registry), penaltyW, arbiter, arbiter, reviewer);
    }

    function test_Constructor_RevertsWhenReviewerEqualsOwner() public {
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(usdc), address(registry), penaltyW, reviewer, arbiter, reviewer);
    }

    function test_Constructor_RevertsWhenPenaltyWalletIsArbiter() public {
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(usdc), address(registry), arbiter, owner, arbiter, reviewer);
    }

    function test_Constructor_RevertsWhenPenaltyWalletIsReviewer() public {
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(usdc), address(registry), reviewer, owner, arbiter, reviewer);
    }

    function test_Constructor_AllowsPenaltyWalletEqualOwner() public {
        Sure2PEscrowV3 e = _deploy(address(usdc), address(registry), owner, owner, arbiter, reviewer);
        assertEq(e.penaltyWallet(), owner);
        assertEq(e.owner(), owner);
    }

    function test_Constructor_RevertsOnNon6Decimals() public {
        usdc.setDecimals(18);
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(usdc), address(registry), penaltyW, owner, arbiter, reviewer);
        usdc.setDecimals(0);
        vm.expectRevert(INVALID_CONFIG);
        _deploy(address(usdc), address(registry), penaltyW, owner, arbiter, reviewer);
    }

    function test_Constructor_AcceptsSixDecimals() public {
        usdc.setDecimals(6);
        Sure2PEscrowV3 e = _deploy(address(usdc), address(registry), penaltyW, owner, arbiter, reviewer);
        assertEq(address(e.usdc()), address(usdc));
    }

    // ------------------------------------------------------------ createEscrow reserved parties

    function _expectReservedRevert(address b, address s) internal {
        Sure2PEscrowV3.Agreement memory a = _agreementFor(b, s, PRICE);
        vm.expectRevert(Sure2PEscrowV3.InvalidParties.selector);
        escrow.createEscrow(a, "", "");
    }

    function test_CreateEscrow_RejectsOwnerAsBuyer() public {
        _expectReservedRevert(owner, seller);
    }

    function test_CreateEscrow_RejectsOwnerAsSeller() public {
        _expectReservedRevert(buyer, owner);
    }

    function test_CreateEscrow_RejectsArbiterAsBuyer() public {
        _expectReservedRevert(arbiter, seller);
    }

    function test_CreateEscrow_RejectsArbiterAsSeller() public {
        _expectReservedRevert(buyer, arbiter);
    }

    function test_CreateEscrow_RejectsReviewerAsBuyer() public {
        _expectReservedRevert(reviewer, seller);
    }

    function test_CreateEscrow_RejectsReviewerAsSeller() public {
        _expectReservedRevert(buyer, reviewer);
    }

    function test_CreateEscrow_RejectsPenaltyWalletAsBuyer() public {
        _expectReservedRevert(penaltyW, seller);
    }

    function test_CreateEscrow_RejectsPenaltyWalletAsSeller() public {
        _expectReservedRevert(buyer, penaltyW);
    }

    function test_CreateEscrow_RejectsOwnerWhenOwnerIsPenaltyWallet() public {
        Sure2PEscrowV3 e = _deploy(address(usdc), address(registry), owner, owner, arbiter, reviewer);
        Sure2PEscrowV3.Agreement memory a = _agreementFor(owner, seller, PRICE);
        vm.expectRevert(Sure2PEscrowV3.InvalidParties.selector);
        e.createEscrow(a, "", "");
    }

    function test_CreateEscrow_OrdinaryPartiesSucceed() public {
        uint256 id = _newEscrow(PRICE);
        assertEq(id, 1);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrowV3.State.Funding));
    }

    function test_CreateEscrow_RejectsPartyWhoBecameArbiterLater() public {
        vm.prank(owner);
        escrow.setArbiter(buyer);
        _expectReservedRevert(buyer, seller);
    }

    // ------------------------------------------------------------ setArbiter

    function test_SetArbiter_OwnerSucceedsAndEmits() public {
        address n = makeAddr("newArbiter");
        vm.expectEmit(false, false, false, true, address(escrow));
        emit ArbiterChanged(arbiter, n);
        vm.prank(owner);
        escrow.setArbiter(n);
        assertEq(escrow.arbiter(), n);
    }

    function test_SetArbiter_RevertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setArbiter(makeAddr("n"));
    }

    function test_SetArbiter_ArbiterAndReviewerCannotSelfSet() public {
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, arbiter));
        escrow.setArbiter(makeAddr("n"));
        vm.prank(reviewer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, reviewer));
        escrow.setArbiter(makeAddr("n"));
    }

    function test_SetArbiter_RevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(INVALID_CONFIG);
        escrow.setArbiter(address(0));
    }

    function test_SetArbiter_RevertsWhenEqualReviewer() public {
        vm.prank(owner);
        vm.expectRevert(INVALID_CONFIG);
        escrow.setArbiter(reviewer);
    }

    function test_SetArbiter_RevertsWhenEqualOwner() public {
        vm.prank(owner);
        vm.expectRevert(INVALID_CONFIG);
        escrow.setArbiter(owner);
    }

    function test_SetArbiter_RevertsWhenEqualPenaltyWallet() public {
        vm.prank(owner);
        vm.expectRevert(INVALID_CONFIG);
        escrow.setArbiter(penaltyW);
    }

    // ------------------------------------------------------------ setAppealReviewer

    function test_SetAppealReviewer_OwnerSucceedsAndEmits() public {
        address n = makeAddr("newReviewer");
        vm.expectEmit(false, false, false, true, address(escrow));
        emit AppealReviewerChanged(reviewer, n);
        vm.prank(owner);
        escrow.setAppealReviewer(n);
        assertEq(escrow.appealReviewer(), n);
    }

    function test_SetAppealReviewer_RevertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setAppealReviewer(makeAddr("n"));
    }

    function test_SetAppealReviewer_RevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(INVALID_CONFIG);
        escrow.setAppealReviewer(address(0));
    }

    function test_SetAppealReviewer_RevertsWhenEqualArbiter() public {
        vm.prank(owner);
        vm.expectRevert(INVALID_CONFIG);
        escrow.setAppealReviewer(arbiter);
    }

    function test_SetAppealReviewer_RevertsWhenEqualOwner() public {
        vm.prank(owner);
        vm.expectRevert(INVALID_CONFIG);
        escrow.setAppealReviewer(owner);
    }

    function test_SetAppealReviewer_RevertsWhenEqualPenaltyWallet() public {
        vm.prank(owner);
        vm.expectRevert(INVALID_CONFIG);
        escrow.setAppealReviewer(penaltyW);
    }

    // ------------------------------------------------------------ ownership (Ownable2Step)

    function test_Ownership_TwoStepTransfer() public {
        address newOwner = makeAddr("newOwner");
        vm.expectEmit(true, true, false, false, address(escrow));
        emit OwnershipTransferStarted(owner, newOwner);
        vm.prank(owner);
        escrow.transferOwnership(newOwner);
        assertEq(escrow.owner(), owner, "owner unchanged until accept");
        assertEq(escrow.pendingOwner(), newOwner);

        // pending owner has no power yet
        vm.prank(newOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner));
        escrow.setArbiter(makeAddr("x"));

        // a stranger cannot accept
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.acceptOwnership();

        vm.expectEmit(true, true, false, false, address(escrow));
        emit OwnershipTransferred(owner, newOwner);
        vm.prank(newOwner);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), newOwner);
        assertEq(escrow.pendingOwner(), address(0));

        // old owner lost power, new owner has it
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        escrow.setArbiter(makeAddr("x"));
        vm.prank(newOwner);
        escrow.setArbiter(makeAddr("x"));
    }

    function test_Ownership_OnlyOwnerCanStartTransfer() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.transferOwnership(stranger);
    }

    function test_Ownership_TransferToArbiterReverts() public {
        vm.prank(owner);
        vm.expectRevert(INVALID_CONFIG);
        escrow.transferOwnership(arbiter);
        assertEq(escrow.pendingOwner(), address(0));
    }

    function test_Ownership_TransferToReviewerReverts() public {
        vm.prank(owner);
        vm.expectRevert(INVALID_CONFIG);
        escrow.transferOwnership(reviewer);
        assertEq(escrow.pendingOwner(), address(0));
    }

    function test_Ownership_AcceptRevertsIfPendingOwnerBecameArbiter() public {
        address p = makeAddr("pending");
        vm.startPrank(owner);
        escrow.transferOwnership(p);
        escrow.setArbiter(p);
        vm.stopPrank();
        vm.prank(p);
        vm.expectRevert(INVALID_CONFIG);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), owner);
    }

    function test_Ownership_AcceptRevertsIfPendingOwnerBecameReviewer() public {
        address p = makeAddr("pending");
        vm.startPrank(owner);
        escrow.transferOwnership(p);
        escrow.setAppealReviewer(p);
        vm.stopPrank();
        vm.prank(p);
        vm.expectRevert(INVALID_CONFIG);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), owner);
    }

    function test_Ownership_TransferToPenaltyWalletAllowed() public {
        vm.prank(owner);
        escrow.transferOwnership(penaltyW);
        vm.prank(penaltyW);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), penaltyW);
        assertEq(escrow.penaltyWallet(), penaltyW);
    }

    function test_Ownership_TransferToZeroCancelsPending() public {
        address p = makeAddr("pending");
        vm.startPrank(owner);
        escrow.transferOwnership(p);
        escrow.transferOwnership(address(0));
        vm.stopPrank();
        assertEq(escrow.pendingOwner(), address(0));
        vm.prank(p);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, p));
        escrow.acceptOwnership();
    }

    function test_Ownership_NewOwnerCannotBeSetAsRoleHolder() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        escrow.transferOwnership(newOwner);
        vm.prank(newOwner);
        escrow.acceptOwnership();
        vm.prank(newOwner);
        vm.expectRevert(INVALID_CONFIG);
        escrow.setArbiter(newOwner);
    }

    function test_RenounceOwnership_RevertsForOwner() public {
        vm.prank(owner);
        vm.expectRevert(Sure2PEscrowV3.OwnershipRenunciationDisabled.selector);
        escrow.renounceOwnership();
        assertEq(escrow.owner(), owner);
    }

    function test_RenounceOwnership_RevertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.renounceOwnership();
    }
}
