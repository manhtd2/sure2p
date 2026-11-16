// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Sure2PAccountRegistry} from "../Sure2PAccountRegistry.sol";
import {ISure2PAccountRegistry} from "../interfaces/ISure2PAccountRegistry.sol";

contract Sure2PRegistryTest is Test {
    Sure2PAccountRegistry internal reg;
    address internal admin = makeAddr("admin");
    address internal security = makeAddr("security");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal stranger = makeAddr("stranger");

    bytes32 internal SECURITY_ROLE;
    bytes32 internal constant ADMIN_ROLE = 0x00;

    event WalletBanStatusChanged(address indexed wallet, bool banned);

    function setUp() public {
        reg = new Sure2PAccountRegistry(admin, security);
        SECURITY_ROLE = reg.SECURITY_ROLE();
    }

    function _unauthorized(address who, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role);
    }

    // ------------------------------------------------------------ constructor / roles

    function test_Constructor_AssignsSeparateRoles() public view {
        assertEq(SECURITY_ROLE, keccak256("SECURITY_ROLE"));
        assertTrue(reg.hasRole(ADMIN_ROLE, admin));
        assertTrue(reg.hasRole(SECURITY_ROLE, security));
        assertFalse(reg.hasRole(SECURITY_ROLE, admin), "admin is not implicitly security");
        assertFalse(reg.hasRole(ADMIN_ROLE, security), "security is not admin");
        assertFalse(reg.hasRole(ADMIN_ROLE, address(this)), "deployer holds nothing");
        assertFalse(reg.hasRole(SECURITY_ROLE, address(this)));
    }

    function test_Constructor_RevertsZeroAddresses() public {
        vm.expectRevert(Sure2PAccountRegistry.ZeroAddress.selector);
        new Sure2PAccountRegistry(address(0), security);
        vm.expectRevert(Sure2PAccountRegistry.ZeroAddress.selector);
        new Sure2PAccountRegistry(admin, address(0));
    }

    function test_Constructor_SameAddressMayHoldBothRoles() public {
        Sure2PAccountRegistry r = new Sure2PAccountRegistry(admin, admin);
        assertTrue(r.hasRole(ADMIN_ROLE, admin));
        assertTrue(r.hasRole(r.SECURITY_ROLE(), admin));
    }

    function test_RoleAdminOfSecurityIsDefaultAdmin() public view {
        assertEq(reg.getRoleAdmin(SECURITY_ROLE), ADMIN_ROLE);
    }

    function test_Admin_CanGrantAndRevokeSecurityRole() public {
        vm.expectEmit(true, true, true, false, address(reg));
        emit IAccessControl.RoleGranted(SECURITY_ROLE, alice, admin);
        vm.prank(admin);
        reg.grantRole(SECURITY_ROLE, alice);
        assertTrue(reg.hasRole(SECURITY_ROLE, alice));

        vm.prank(alice);
        reg.setBanned(bob, true);
        assertTrue(reg.banned(bob));

        vm.expectEmit(true, true, true, false, address(reg));
        emit IAccessControl.RoleRevoked(SECURITY_ROLE, alice, admin);
        vm.prank(admin);
        reg.revokeRole(SECURITY_ROLE, alice);
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice, SECURITY_ROLE));
        reg.setBanned(bob, false);
    }

    function test_NonAdmin_CannotGrantRoles() public {
        vm.prank(security);
        vm.expectRevert(_unauthorized(security, ADMIN_ROLE));
        reg.grantRole(SECURITY_ROLE, alice);
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger, ADMIN_ROLE));
        reg.grantRole(SECURITY_ROLE, stranger);
    }

    function test_Security_CanRenounceOwnRole() public {
        vm.prank(security);
        reg.renounceRole(SECURITY_ROLE, security);
        assertFalse(reg.hasRole(SECURITY_ROLE, security));
        vm.prank(security);
        vm.expectRevert(_unauthorized(security, SECURITY_ROLE));
        reg.setBanned(alice, true);
    }

    // ------------------------------------------------------------ setBanned

    function test_SetBanned_BansAndEmits() public {
        vm.expectEmit(true, false, false, true, address(reg));
        emit WalletBanStatusChanged(alice, true);
        vm.prank(security);
        reg.setBanned(alice, true);
        assertTrue(reg.banned(alice));
        assertFalse(reg.isEligible(alice));
        assertTrue(reg.isEligible(bob), "others unaffected");
    }

    function test_SetBanned_UnbanRestoresEligibility() public {
        vm.startPrank(security);
        reg.setBanned(alice, true);
        vm.expectEmit(true, false, false, true, address(reg));
        emit WalletBanStatusChanged(alice, false);
        reg.setBanned(alice, false);
        vm.stopPrank();
        assertFalse(reg.banned(alice));
        assertTrue(reg.isEligible(alice));
    }

    function test_SetBanned_IdempotentStillEmits() public {
        vm.startPrank(security);
        reg.setBanned(alice, true);
        vm.expectEmit(true, false, false, true, address(reg));
        emit WalletBanStatusChanged(alice, true);
        reg.setBanned(alice, true);
        vm.stopPrank();
        assertFalse(reg.isEligible(alice));
    }

    function test_SetBanned_RevertsWithoutSecurityRole() public {
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger, SECURITY_ROLE));
        reg.setBanned(alice, true);
        vm.prank(admin); // admin alone cannot ban
        vm.expectRevert(_unauthorized(admin, SECURITY_ROLE));
        reg.setBanned(alice, true);
        assertFalse(reg.banned(alice));
    }

    // ------------------------------------------------------------ setBannedBatch

    function test_SetBannedBatch_BansEachAndEmitsPerWallet() public {
        address[] memory ws = new address[](3);
        ws[0] = alice;
        ws[1] = bob;
        ws[2] = stranger;
        vm.expectEmit(true, false, false, true, address(reg));
        emit WalletBanStatusChanged(alice, true);
        vm.expectEmit(true, false, false, true, address(reg));
        emit WalletBanStatusChanged(bob, true);
        vm.expectEmit(true, false, false, true, address(reg));
        emit WalletBanStatusChanged(stranger, true);
        vm.prank(security);
        reg.setBannedBatch(ws, true);
        assertFalse(reg.isEligible(alice));
        assertFalse(reg.isEligible(bob));
        assertFalse(reg.isEligible(stranger));

        vm.prank(security);
        reg.setBannedBatch(ws, false);
        assertTrue(reg.isEligible(alice));
        assertTrue(reg.isEligible(bob));
        assertTrue(reg.isEligible(stranger));
    }

    function test_SetBannedBatch_EmptyIsNoop() public {
        address[] memory ws = new address[](0);
        vm.prank(security);
        reg.setBannedBatch(ws, true);
        assertTrue(reg.isEligible(alice));
    }

    function test_SetBannedBatch_RevertsWithoutSecurityRole() public {
        address[] memory ws = new address[](1);
        ws[0] = alice;
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger, SECURITY_ROLE));
        reg.setBannedBatch(ws, true);
        vm.prank(admin);
        vm.expectRevert(_unauthorized(admin, SECURITY_ROLE));
        reg.setBannedBatch(ws, true);
        assertTrue(reg.isEligible(alice));
    }

    // ------------------------------------------------------------ isEligible

    function test_IsEligible_ZeroAddressNeverEligible() public {
        assertFalse(reg.isEligible(address(0)));
        vm.prank(security);
        reg.setBanned(address(0), false);
        assertFalse(reg.isEligible(address(0)));
    }

    function test_IsEligible_DefaultTrueForFreshWallets() public view {
        assertTrue(reg.isEligible(alice));
        assertTrue(reg.isEligible(admin));
        assertTrue(reg.isEligible(security));
    }

    function test_ImplementsInterface() public view {
        assertTrue(ISure2PAccountRegistry(address(reg)).isEligible(alice));
    }

    function testFuzz_IsEligibleMirrorsBanStatus(address wallet, bool status) public {
        vm.prank(security);
        reg.setBanned(wallet, status);
        assertEq(reg.banned(wallet), status);
        assertEq(reg.isEligible(wallet), wallet != address(0) && !status);
    }

    function testFuzz_NonSecurityCannotBan(address caller, address wallet, bool status) public {
        vm.assume(caller != security);
        vm.prank(caller);
        vm.expectRevert(_unauthorized(caller, SECURITY_ROLE));
        reg.setBanned(wallet, status);
    }
}
