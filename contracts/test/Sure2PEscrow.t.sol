// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sure2PEscrowBase} from "./Sure2PEscrow.Base.t.sol";
import {Sure2PEscrow} from "../Sure2PEscrow.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";
import {Sure2PSigUtils} from "./mocks/Sure2PSigUtils.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Constructor + createEscrow coverage.
contract Sure2PEscrowCreateTest is Sure2PEscrowBase {
    // ------------------------------------------------------------ constructor

    function test_Constructor_BindsTokenAndRegistry() public view {
        assertEq(address(escrow.usdc()), address(usdc));
        assertEq(address(escrow.registry()), address(registry));
        assertEq(escrow.escrowCount(), 0);
        assertEq(escrow.totalOutstanding(), 0);
    }

    function test_Constructor_RevertsTokenWithoutCode() public {
        vm.expectRevert(Sure2PEscrow.InvalidConfiguration.selector);
        new Sure2PEscrow(address(0x1234), ISure2PAccountRegistry(address(registry)));
    }

    function test_Constructor_RevertsRegistryWithoutCode() public {
        vm.expectRevert(Sure2PEscrow.InvalidConfiguration.selector);
        new Sure2PEscrow(address(usdc), ISure2PAccountRegistry(address(0x1234)));
    }

    function test_Constructor_RevertsNon6Decimals() public {
        MockUSDC t = new MockUSDC();
        t.setDecimals(18);
        vm.expectRevert(Sure2PEscrow.InvalidConfiguration.selector);
        new Sure2PEscrow(address(t), ISure2PAccountRegistry(address(registry)));
        t.setDecimals(0);
        vm.expectRevert(Sure2PEscrow.InvalidConfiguration.selector);
        new Sure2PEscrow(address(t), ISure2PAccountRegistry(address(registry)));
    }

    function test_Constructor_RevertsTokenWithoutDecimals() public {
        // registry has code but no decimals() -> the metadata call reverts
        vm.expectRevert();
        new Sure2PEscrow(address(registry), ISure2PAccountRegistry(address(registry)));
    }

    // ------------------------------------------------------------ digests

    function test_Digests_MatchIndependentEip712() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        assertEq(escrow.domainSeparator(), Sure2PSigUtils.domainSeparator(address(escrow)));
        assertEq(escrow.hashAgreement(a), Sure2PSigUtils.agreementDigest(address(escrow), a));
        uint256 id = _activeEscrow(PRICE);
        Sure2PEscrow.Settlement memory s = _settlement(id, 10e6);
        assertEq(escrow.hashSettlement(s), Sure2PSigUtils.settlementDigest(address(escrow), s));
    }

    // ------------------------------------------------------------ happy path

    function test_CreateEscrow_StoresAgreementAndEmits() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit Sure2PEscrow.EscrowCreated(
            1, buyer, seller, a.agreementHash, a.policyHash, PRICE, 25e6, 25e6,
            uint64(T0 + 24 hours), a.handoverDeadline, RESP, INSPECT
        );
        vm.prank(stranger); // anyone may relay
        uint256 id = escrow.createEscrow(a, bs, ss);

        assertEq(id, 1);
        assertEq(escrow.escrowCount(), 1);
        Sure2PEscrow.Escrow memory e = _get(id);
        assertEq(e.buyer, buyer);
        assertEq(e.seller, seller);
        assertEq(e.price, PRICE);
        assertEq(e.buyerDeposit, 25e6);
        assertEq(e.sellerDeposit, 25e6);
        assertEq(e.agreementHash, a.agreementHash);
        assertEq(e.policyHash, a.policyHash);
        assertEq(e.createdAt, T0);
        assertEq(e.fundingDeadline, T0 + 24 hours);
        assertEq(e.handoverDeadline, a.handoverDeadline);
        assertEq(e.buyerResponseSeconds, RESP);
        assertEq(e.inspectionSeconds, INSPECT);
        assertEq(uint8(e.state), uint8(Sure2PEscrow.State.Funding));
        assertFalse(e.buyerFunded);
        assertFalse(e.sellerFunded);
        assertTrue(escrow.usedAgreementHashes(a.agreementHash));
        assertTrue(escrow.usedAgreementNonces(buyer, a.agreementNonce));
        assertEq(escrow.totalOutstanding(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_CreateEscrow_IdsIncrement() public {
        assertEq(_newEscrow(PRICE), 1);
        assertEq(_newEscrow(PRICE), 2);
        assertEq(escrow.escrowCount(), 2);
    }

    // ------------------------------------------------------------ signatures

    function test_CreateEscrow_RevertsMissingBuyerSig() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        vm.expectRevert(_badSig(buyer));
        escrow.createEscrow(a, "", ss);
    }

    function test_CreateEscrow_RevertsMissingSellerSig() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs,) = _sigs(escrow, a, buyerPk, sellerPk);
        vm.expectRevert(_badSig(seller));
        escrow.createEscrow(a, bs, "");
    }

    function test_CreateEscrow_RevertsBothSigsMissing() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        vm.expectRevert(_badSig(buyer));
        escrow.createEscrow(a, "", "");
    }

    function test_CreateEscrow_RevertsWrongBuyerSigner() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, otherPk, sellerPk);
        vm.expectRevert(_badSig(buyer));
        escrow.createEscrow(a, bs, ss);
    }

    function test_CreateEscrow_RevertsWrongSellerSigner() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, otherPk);
        vm.expectRevert(_badSig(seller));
        escrow.createEscrow(a, bs, ss);
    }

    function test_CreateEscrow_RevertsSwappedSigs() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        vm.expectRevert(_badSig(buyer));
        escrow.createEscrow(a, ss, bs);
    }

    function test_CreateEscrow_RevertsGarbageSig() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs,) = _sigs(escrow, a, buyerPk, sellerPk);
        vm.expectRevert(_badSig(seller));
        escrow.createEscrow(a, bs, hex"deadbeef");
    }

    function test_CreateEscrow_RevertsSignedTermsTampered() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        a.policyHash = keccak256("different policy"); // relayer alters a term after signing
        vm.expectRevert(_badSig(buyer));
        escrow.createEscrow(a, bs, ss);
    }

    function test_CreateEscrow_RevertsSignatureForOtherEscrowDomain() public {
        Sure2PEscrow other2 = new Sure2PEscrow(address(usdc), ISure2PAccountRegistry(address(registry)));
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs, bytes memory ss) = _sigs(other2, a, buyerPk, sellerPk);
        vm.expectRevert(_badSig(buyer));
        escrow.createEscrow(a, bs, ss);
    }

    // ------------------------------------------------------------ replay

    function test_CreateEscrow_RevertsReplayedSignedAgreement() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        escrow.createEscrow(a, bs, ss);
        vm.expectRevert(Sure2PEscrow.AgreementHashUsed.selector);
        escrow.createEscrow(a, bs, ss);
    }

    function test_CreateEscrow_RevertsAgreementHashReuseWithFreshNonce() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        _create(a);
        a.agreementNonce = 999;
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        vm.expectRevert(Sure2PEscrow.AgreementHashUsed.selector);
        escrow.createEscrow(a, bs, ss);
    }

    function test_CreateEscrow_RevertsAgreementHashReuseAcrossBuyers() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        _create(a);
        a.buyer = buyer2; // hash uniqueness is global
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyer2Pk, sellerPk);
        vm.expectRevert(Sure2PEscrow.AgreementHashUsed.selector);
        escrow.createEscrow(a, bs, ss);
    }

    function test_CreateEscrow_RevertsBuyerNonceReuse() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        _create(a);
        Sure2PEscrow.Agreement memory b = _agreement(PRICE);
        b.agreementNonce = a.agreementNonce; // new hash, same buyer + nonce
        (bytes memory bs, bytes memory ss) = _sigs(escrow, b, buyerPk, sellerPk);
        vm.expectRevert(Sure2PEscrow.AgreementNonceUsed.selector);
        escrow.createEscrow(b, bs, ss);
    }

    function test_CreateEscrow_NonceIsPerBuyer() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        _create(a);
        Sure2PEscrow.Agreement memory b = _agreement(PRICE);
        b.buyer = buyer2;
        b.agreementNonce = a.agreementNonce; // same nonce, different buyer -> allowed
        (bytes memory bs, bytes memory ss) = _sigs(escrow, b, buyer2Pk, sellerPk);
        uint256 id = escrow.createEscrow(b, bs, ss);
        assertEq(id, 2);
        assertTrue(escrow.usedAgreementNonces(buyer2, a.agreementNonce));
    }

    // ------------------------------------------------------------ deadlines / token / price

    function test_CreateEscrow_SignDeadlineBoundary() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        vm.warp(a.signDeadline); // exactly at the deadline is still valid
        assertEq(_create(a), 1);

        Sure2PEscrow.Agreement memory b = _agreement(PRICE);
        b.signDeadline = uint64(block.timestamp);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, b, buyerPk, sellerPk);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(Sure2PEscrow.DeadlinePassed.selector);
        escrow.createEscrow(b, bs, ss);
    }

    function test_CreateEscrow_RevertsWrongToken() public {
        MockUSDC fake = new MockUSDC();
        Sure2PEscrow.Agreement memory a = _agreementFor(address(fake), PRICE);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        vm.expectRevert(Sure2PEscrow.InvalidToken.selector);
        escrow.createEscrow(a, bs, ss);

        a.token = address(0);
        vm.expectRevert(Sure2PEscrow.InvalidToken.selector);
        escrow.createEscrow(a, bs, ss);
    }

    function test_CreateEscrow_RevertsZeroPrice() public {
        Sure2PEscrow.Agreement memory a = _agreement(0);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        vm.expectRevert(Sure2PEscrow.InvalidPrice.selector);
        escrow.createEscrow(a, bs, ss);
    }

    function test_CreateEscrow_TinyPricesCreateWithCeilDeposits() public {
        uint256[7] memory prices = [uint256(1), 2, 3, 4, 5, 100e6, 100e6 + 1];
        uint256[7] memory deps = [uint256(1), 1, 1, 1, 2, 25e6, 25e6 + 1];
        for (uint256 i; i < prices.length; ++i) {
            uint256 id = _newEscrow(prices[i]);
            Sure2PEscrow.Escrow memory e = _get(id);
            assertEq(e.price, prices[i]);
            assertEq(e.buyerDeposit, deps[i], "buyer deposit");
            assertEq(e.sellerDeposit, deps[i], "seller deposit");
        }
    }

    function test_CreateEscrow_RevertsDepositOffByOneAtBoundaries() public {
        uint256[7] memory prices = [uint256(1), 2, 3, 4, 5, 100e6, 100e6 + 1];
        uint256[7] memory deps = [uint256(1), 1, 1, 1, 2, 25e6, 25e6 + 1];
        for (uint256 i; i < prices.length; ++i) {
            Sure2PEscrow.Agreement memory a = _agreement(prices[i]);
            (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);

            a.buyerDeposit = deps[i] - 1; // floor-style deposit
            a.sellerDeposit = deps[i];
            vm.expectRevert(Sure2PEscrow.InvalidDeposit.selector);
            escrow.createEscrow(a, bs, ss);

            a.buyerDeposit = deps[i];
            a.sellerDeposit = deps[i] + 1;
            vm.expectRevert(Sure2PEscrow.InvalidDeposit.selector);
            escrow.createEscrow(a, bs, ss);

            a.buyerDeposit = deps[i] + 1;
            a.sellerDeposit = deps[i] + 1;
            vm.expectRevert(Sure2PEscrow.InvalidDeposit.selector);
            escrow.createEscrow(a, bs, ss);
        }
    }

    function test_CreateEscrow_RevertsZeroDeposit() public {
        Sure2PEscrow.Agreement memory a = _agreement(1);
        a.buyerDeposit = 0;
        a.sellerDeposit = 0;
        vm.expectRevert(Sure2PEscrow.InvalidDeposit.selector);
        escrow.createEscrow(a, "", "");
    }

    function test_CreateEscrow_RevertsZeroCommitments() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        a.agreementHash = bytes32(0);
        vm.expectRevert(Sure2PEscrow.ZeroCommitment.selector);
        escrow.createEscrow(a, "", "");

        a = _agreement(PRICE);
        a.policyHash = bytes32(0);
        vm.expectRevert(Sure2PEscrow.ZeroCommitment.selector);
        escrow.createEscrow(a, "", "");
    }

    // ------------------------------------------------------------ parties / registry

    function test_CreateEscrow_RevertsSameBuyerAndSeller() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        a.seller = buyer;
        vm.expectRevert(Sure2PEscrow.InvalidParties.selector);
        escrow.createEscrow(a, "", "");
    }

    function test_CreateEscrow_RevertsZeroAddressParties() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        a.buyer = address(0);
        vm.expectRevert(Sure2PEscrow.InvalidParties.selector);
        escrow.createEscrow(a, "", "");

        a = _agreement(PRICE);
        a.seller = address(0);
        vm.expectRevert(Sure2PEscrow.InvalidParties.selector);
        escrow.createEscrow(a, "", "");
    }

    function test_CreateEscrow_RevertsBannedBuyer() public {
        vm.prank(security);
        registry.setBanned(buyer, true);
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        vm.expectRevert(Sure2PEscrow.IneligibleParty.selector);
        escrow.createEscrow(a, bs, ss);
    }

    function test_CreateEscrow_RevertsBannedSeller() public {
        vm.prank(security);
        registry.setBanned(seller, true);
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        (bytes memory bs, bytes memory ss) = _sigs(escrow, a, buyerPk, sellerPk);
        vm.expectRevert(Sure2PEscrow.IneligibleParty.selector);
        escrow.createEscrow(a, bs, ss);
    }

    function test_CreateEscrow_UnbannedWalletCanCreateAgain() public {
        vm.startPrank(security);
        registry.setBanned(buyer, true);
        registry.setBanned(buyer, false);
        vm.stopPrank();
        assertEq(_newEscrow(PRICE), 1);
    }

    // ------------------------------------------------------------ handover deadline / durations

    function test_CreateEscrow_HandoverMustExceedFundingWindow() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        uint64 fundingDeadline = uint64(block.timestamp + 24 hours);

        uint64[4] memory bad = [uint64(0), uint64(block.timestamp), fundingDeadline - 1, fundingDeadline];
        for (uint256 i; i < bad.length; ++i) {
            a.handoverDeadline = bad[i];
            vm.expectRevert(Sure2PEscrow.InvalidHandoverDeadline.selector);
            escrow.createEscrow(a, "", "");
        }

        a.handoverDeadline = fundingDeadline + 1; // smallest valid value
        uint256 id = _create(a);
        assertEq(_get(id).handoverDeadline, fundingDeadline + 1);
    }

    function test_CreateEscrow_ResponseSecondsBounds() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        a.buyerResponseSeconds = 1 hours - 1;
        vm.expectRevert(Sure2PEscrow.InvalidDuration.selector);
        escrow.createEscrow(a, "", "");
        a.buyerResponseSeconds = 30 days + 1;
        vm.expectRevert(Sure2PEscrow.InvalidDuration.selector);
        escrow.createEscrow(a, "", "");
        a.buyerResponseSeconds = 0;
        vm.expectRevert(Sure2PEscrow.InvalidDuration.selector);
        escrow.createEscrow(a, "", "");

        a.buyerResponseSeconds = 1 hours;
        assertEq(_get(_create(a)).buyerResponseSeconds, 1 hours);
        Sure2PEscrow.Agreement memory b = _agreement(PRICE);
        b.buyerResponseSeconds = 30 days;
        assertEq(_get(_create(b)).buyerResponseSeconds, 30 days);
    }

    function test_CreateEscrow_InspectionSecondsBounds() public {
        Sure2PEscrow.Agreement memory a = _agreement(PRICE);
        a.inspectionSeconds = 1 hours - 1;
        vm.expectRevert(Sure2PEscrow.InvalidDuration.selector);
        escrow.createEscrow(a, "", "");
        a.inspectionSeconds = 30 days + 1;
        vm.expectRevert(Sure2PEscrow.InvalidDuration.selector);
        escrow.createEscrow(a, "", "");
        a.inspectionSeconds = 0;
        vm.expectRevert(Sure2PEscrow.InvalidDuration.selector);
        escrow.createEscrow(a, "", "");

        a.inspectionSeconds = 1 hours;
        assertEq(_get(_create(a)).inspectionSeconds, 1 hours);
        Sure2PEscrow.Agreement memory b = _agreement(PRICE);
        b.inspectionSeconds = 30 days;
        assertEq(_get(_create(b)).inspectionSeconds, 30 days);
    }

    function test_GetEscrow_RevertsUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrow.UnknownEscrow.selector, 7));
        escrow.getEscrow(7);
    }
}
