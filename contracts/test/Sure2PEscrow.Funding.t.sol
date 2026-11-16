// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Sure2PEscrowBase} from "./Sure2PEscrow.Base.t.sol";
import {Sure2PEscrow} from "../Sure2PEscrow.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";
import {FeeOnTransferToken} from "./mocks/FeeOnTransferToken.sol";

/// @dev fundBuyer / fundSeller / activation / expireUnfunded coverage.
contract Sure2PEscrowFundingTest is Sure2PEscrowBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _newEscrow(PRICE);
    }

    // ------------------------------------------------------------ exact amounts

    function test_FundBuyer_PullsPricePlusDeposit() public {
        uint256 before = usdc.balanceOf(buyer);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Sure2PEscrow.BuyerFunded(id, 125e6);
        _fundBuyer(id);

        assertEq(before - usdc.balanceOf(buyer), 125e6);
        assertEq(usdc.balanceOf(address(escrow)), 125e6);
        assertEq(escrow.totalOutstanding(), 125e6);
        assertTrue(_get(id).buyerFunded);
        assertFalse(_get(id).sellerFunded);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Funding), "not active yet");
    }

    function test_FundSeller_PullsDepositOnly() public {
        uint256 before = usdc.balanceOf(seller);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Sure2PEscrow.SellerFunded(id, 25e6);
        _fundSeller(id);

        assertEq(before - usdc.balanceOf(seller), 25e6);
        assertEq(usdc.balanceOf(address(escrow)), 25e6);
        assertEq(escrow.totalOutstanding(), 25e6);
        assertTrue(_get(id).sellerFunded);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Funding));
    }

    function test_Activation_BuyerThenSeller() public {
        _fundBuyer(id);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Sure2PEscrow.EscrowActivated(id, uint64(T0));
        _fundSeller(id);

        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Active));
        assertEq(_get(id).activatedAt, T0);
        assertEq(usdc.balanceOf(address(escrow)), 150e6);
        assertEq(escrow.totalOutstanding(), 150e6);
    }

    function test_Activation_SellerThenBuyer() public {
        _fundSeller(id);
        skip(1 hours);
        _fundBuyer(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Active));
        assertEq(_get(id).activatedAt, T0 + 1 hours);
        assertEq(usdc.balanceOf(address(escrow)), 150e6);
    }

    function test_Funding_TinyPriceAmounts() public {
        uint256 tid = _newEscrow(5); // deposit 2 => buyer pays 7, seller 2
        _fundBuyer(tid);
        assertEq(usdc.balanceOf(address(escrow)), 7);
        _fundSeller(tid);
        assertEq(usdc.balanceOf(address(escrow)), 9);
        assertEq(uint8(_state(tid)), uint8(Sure2PEscrow.State.Active));
    }

    // ------------------------------------------------------------ auth / state

    function test_Fund_RevertsWrongCaller() public {
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.Unauthorized.selector);
        escrow.fundBuyer(id);
        vm.prank(stranger);
        vm.expectRevert(Sure2PEscrow.Unauthorized.selector);
        escrow.fundBuyer(id);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.Unauthorized.selector);
        escrow.fundSeller(id);
        vm.prank(stranger);
        vm.expectRevert(Sure2PEscrow.Unauthorized.selector);
        escrow.fundSeller(id);
    }

    function test_Fund_RevertsUnknownEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrow.UnknownEscrow.selector, 99));
        escrow.fundBuyer(99);
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrow.UnknownEscrow.selector, 99));
        escrow.fundSeller(99);
    }

    function test_Fund_RevertsDoubleFund() public {
        _fundBuyer(id);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.AlreadyFunded.selector);
        escrow.fundBuyer(id);

        _fundSeller(id);
        // after activation the Funding-state guard fires first
        vm.prank(seller);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Active));
        escrow.fundSeller(id);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Active));
        escrow.fundBuyer(id);
        assertEq(usdc.balanceOf(address(escrow)), 150e6);
    }

    function test_Fund_RevertsSellerDoubleFundBeforeActivation() public {
        _fundSeller(id);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.AlreadyFunded.selector);
        escrow.fundSeller(id);
    }

    function test_Fund_RevertsInsufficientAllowance() public {
        vm.prank(buyer);
        usdc.approve(address(escrow), 125e6 - 1);
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(escrow), 125e6 - 1, 125e6)
        );
        escrow.fundBuyer(id);
        assertFalse(_get(id).buyerFunded);
        assertEq(escrow.totalOutstanding(), 0);

        vm.prank(seller);
        usdc.approve(address(escrow), 0);
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(escrow), 0, 25e6)
        );
        escrow.fundSeller(id);
        assertFalse(_get(id).sellerFunded);
    }

    function test_Fund_RevertsInsufficientBalance() public {
        uint256 bal = usdc.balanceOf(buyer);
        vm.prank(buyer);
        usdc.transfer(stranger, bal - (125e6 - 1));
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, buyer, 125e6 - 1, 125e6)
        );
        escrow.fundBuyer(id);
        assertFalse(_get(id).buyerFunded);
        assertEq(escrow.totalOutstanding(), 0);
    }

    // ------------------------------------------------------------ funding deadline

    function test_Fund_AllowedExactlyAtFundingDeadline() public {
        vm.warp(_get(id).fundingDeadline);
        _fundBuyer(id);
        _fundSeller(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Active));
    }

    function test_Fund_RevertsOneSecondAfterFundingDeadline() public {
        vm.warp(uint256(_get(id).fundingDeadline) + 1);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.DeadlinePassed.selector);
        escrow.fundBuyer(id);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.DeadlinePassed.selector);
        escrow.fundSeller(id);
        assertEq(escrow.totalOutstanding(), 0);
    }

    function test_Fund_SecondSideAfterDeadlineReverts() public {
        _fundBuyer(id);
        vm.warp(uint256(_get(id).fundingDeadline) + 1);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.DeadlinePassed.selector);
        escrow.fundSeller(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.Funding));
    }

    // ------------------------------------------------------------ fee-on-transfer

    function test_Fund_RejectsFeeOnTransferToken() public {
        FeeOnTransferToken fee = new FeeOnTransferToken(100); // 1%
        Sure2PEscrow esc = new Sure2PEscrow(address(fee), ISure2PAccountRegistry(address(registry)));
        address[2] memory users = [buyer, seller];
        for (uint256 i; i < 2; ++i) {
            fee.mint(users[i], 1_000e6);
            vm.prank(users[i]);
            fee.approve(address(esc), type(uint256).max);
        }
        uint256 fid = _createOn(esc, _agreementFor(address(fee), PRICE));

        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.UnexpectedTransferAmount.selector);
        esc.fundBuyer(fid);
        vm.prank(seller);
        vm.expectRevert(Sure2PEscrow.UnexpectedTransferAmount.selector);
        esc.fundSeller(fid);

        assertEq(fee.balanceOf(address(esc)), 0);
        assertEq(esc.totalOutstanding(), 0);
        assertFalse(esc.getEscrow(fid).buyerFunded);
        assertFalse(esc.getEscrow(fid).sellerFunded);
        assertEq(fee.balanceOf(buyer), 1_000e6, "reverted: no funds lost");
    }

    // ------------------------------------------------------------ expireUnfunded

    function test_Expire_NoneFunded() public {
        vm.warp(uint256(_get(id).fundingDeadline) + 1);
        vm.expectEmit(true, false, false, false, address(escrow));
        emit Sure2PEscrow.EscrowExpired(id);
        vm.prank(stranger); // permissionless
        escrow.expireUnfunded(id);

        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.ExpiredUnfunded));
        assertEq(escrow.claimable(id, buyer), 0);
        assertEq(escrow.claimable(id, seller), 0);
        assertEq(escrow.totalOutstanding(), 0);
        vm.prank(buyer);
        vm.expectRevert(Sure2PEscrow.NoCredit.selector);
        escrow.claim(id);
    }

    function test_Expire_BuyerOnlyRefundsFullAmountNoPenalty() public {
        uint256 bBefore = usdc.balanceOf(buyer);
        _fundBuyer(id);
        vm.warp(uint256(_get(id).fundingDeadline) + 1);
        escrow.expireUnfunded(id);

        assertEq(escrow.claimable(id, buyer), 125e6);
        assertEq(escrow.claimable(id, seller), 0);
        assertEq(escrow.totalOutstanding(), 125e6);
        vm.prank(buyer);
        escrow.claim(id);
        assertEq(usdc.balanceOf(buyer), bBefore, "buyer made whole");
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalOutstanding(), 0);
    }

    function test_Expire_SellerOnlyRefundsDepositNoPenalty() public {
        uint256 sBefore = usdc.balanceOf(seller);
        _fundSeller(id);
        vm.warp(uint256(_get(id).fundingDeadline) + 1);
        escrow.expireUnfunded(id);

        assertEq(escrow.claimable(id, seller), 25e6);
        assertEq(escrow.claimable(id, buyer), 0);
        vm.prank(seller);
        escrow.claim(id);
        assertEq(usdc.balanceOf(seller), sBefore);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalOutstanding(), 0);
    }

    function test_Expire_BothFundedIsActiveSoCannotExpire() public {
        _fundBuyer(id);
        _fundSeller(id);
        vm.warp(uint256(_get(id).fundingDeadline) + 10 days);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.Active));
        escrow.expireUnfunded(id);
        assertEq(escrow.claimable(id, buyer), 0);
        assertEq(escrow.claimable(id, seller), 0);
    }

    function test_Expire_OnlyStrictlyAfterDeadline() public {
        _fundBuyer(id);
        uint256 dl = _get(id).fundingDeadline;
        vm.warp(dl - 1);
        vm.expectRevert(Sure2PEscrow.DeadlineNotPassed.selector);
        escrow.expireUnfunded(id);
        vm.warp(dl);
        vm.expectRevert(Sure2PEscrow.DeadlineNotPassed.selector);
        escrow.expireUnfunded(id);
        vm.warp(dl + 1);
        escrow.expireUnfunded(id);
        assertEq(uint8(_state(id)), uint8(Sure2PEscrow.State.ExpiredUnfunded));
    }

    function test_Expire_CannotRepeatOrFundAfter() public {
        _fundSeller(id);
        vm.warp(uint256(_get(id).fundingDeadline) + 1);
        escrow.expireUnfunded(id);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.ExpiredUnfunded));
        escrow.expireUnfunded(id);
        vm.prank(buyer);
        vm.expectRevert(_invalidState(Sure2PEscrow.State.ExpiredUnfunded));
        escrow.fundBuyer(id);
        // credit is single-use: a second expiry cannot double-credit
        assertEq(escrow.claimable(id, seller), 25e6);
    }

    function test_Expire_RevertsUnknownEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(Sure2PEscrow.UnknownEscrow.selector, 42));
        escrow.expireUnfunded(42);
    }

    function test_Expire_CreditsEventsEmitted() public {
        _fundBuyer(id);
        vm.warp(uint256(_get(id).fundingDeadline) + 1);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Sure2PEscrow.CreditAssigned(id, buyer, 125e6);
        escrow.expireUnfunded(id);
    }
}
