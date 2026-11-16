// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Sure2PEscrow} from "../Sure2PEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Sure2PSigUtils} from "./mocks/Sure2PSigUtils.sol";

/// @dev Bounded action surface for the invariant fuzzer. Every action is wrapped in try/catch so
/// ghost accounting only moves on calls that actually succeed. No test/invariant functions here.
contract Sure2PEscrowHandler is Test {
    Sure2PEscrow public immutable escrow;
    MockUSDC public immutable usdc;

    address[4] public actors;
    mapping(address => uint256) public pkOf;
    uint256 public salt;

    /// @notice Σ USDC successfully pulled in by funding.
    uint256 public ghostIn;
    /// @notice Σ USDC successfully paid out by claim.
    uint256 public ghostOut;
    uint256 public donated;

    // success counters (liveness evidence)
    uint256 public nCreated;
    uint256 public nFundBuyer;
    uint256 public nFundSeller;
    uint256 public nExpired;
    uint256 public nDeclared;
    uint256 public nAcked;
    uint256 public nAccepted;
    uint256 public nCompleted;
    uint256 public nFlagged;
    uint256 public nDisputed;
    uint256 public nSettled;
    uint256 public nClaims;

    constructor(Sure2PEscrow escrow_, MockUSDC usdc_) {
        escrow = escrow_;
        usdc = usdc_;
        for (uint256 i; i < 4; ++i) {
            (address a, uint256 pk) = makeAddrAndKey(string(abi.encodePacked("actor", vm.toString(i))));
            actors[i] = a;
            pkOf[a] = pk;
            usdc_.mint(a, 1e15);
            vm.prank(a);
            usdc_.approve(address(escrow_), type(uint256).max);
        }
    }

    // ------------------------------------------------------------ internals

    function _pick(uint256 seed) internal view returns (uint256 id) {
        uint256 n = escrow.escrowCount();
        if (n == 0) return 0;
        // bias toward the 3 most recent escrows so lifecycles actually progress
        uint256 span = n < 3 ? n : 3;
        id = n - bound(seed, 0, span - 1);
    }

    // ------------------------------------------------------------ actions

    function create(uint256 bi, uint256 offset, uint256 price, uint256 extra) external {
        if ((offset >> 8) % 3 != 0) return; // create less often than the progress actions
        bi = bound(bi, 0, 3);
        address b = actors[bi];
        address s = actors[(bi + 1 + bound(offset, 0, 2)) % 4];
        price = bound(price, 1, 1000e6);
        uint256 dep = (price + 3) / 4;
        ++salt;

        Sure2PEscrow.Agreement memory a;
        a.buyer = b;
        a.seller = s;
        a.token = address(usdc);
        a.price = price;
        a.buyerDeposit = dep;
        a.sellerDeposit = dep;
        a.agreementHash = keccak256(abi.encode("h", salt));
        a.policyHash = keccak256("policy");
        a.agreementNonce = salt;
        a.handoverDeadline = uint64(block.timestamp + 24 hours + 1 + bound(extra, 0, 10 days));
        a.buyerResponseSeconds = uint32(bound(extra >> 8, 1 hours, 5 days));
        a.inspectionSeconds = uint32(bound(extra >> 16, 1 hours, 5 days));
        a.signDeadline = uint64(block.timestamp + 1 days);

        address esc = address(escrow);
        bytes memory bs = Sure2PSigUtils.signAgreement(esc, a, pkOf[b]);
        bytes memory ss = Sure2PSigUtils.signAgreement(esc, a, pkOf[s]);
        try escrow.createEscrow(a, bs, ss) {
            ++nCreated;
        } catch {}
    }

    function fundBuyer(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        Sure2PEscrow.Escrow memory e = escrow.getEscrow(id);
        vm.prank(e.buyer);
        try escrow.fundBuyer(id) {
            ghostIn += e.price + e.buyerDeposit;
            ++nFundBuyer;
        } catch {}
    }

    function fundSeller(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        Sure2PEscrow.Escrow memory e = escrow.getEscrow(id);
        vm.prank(e.seller);
        try escrow.fundSeller(id) {
            ghostIn += e.sellerDeposit;
            ++nFundSeller;
        } catch {}
    }

    function expire(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        try escrow.expireUnfunded(id) {
            ++nExpired;
        } catch {}
    }

    function declare(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        vm.prank(escrow.getEscrow(id).seller);
        try escrow.declareHandover(id, keccak256(abi.encode("m", seed))) {
            ++nDeclared;
        } catch {}
    }

    function acknowledge(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        vm.prank(escrow.getEscrow(id).buyer);
        try escrow.acknowledgeReceipt(id) {
            ++nAcked;
        } catch {}
    }

    function accept(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        vm.prank(escrow.getEscrow(id).buyer);
        try escrow.confirmBuyerAcceptance(id) {
            ++nAccepted;
        } catch {}
    }

    function complete(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        try escrow.finalizeMutualCompletion(id) {
            ++nCompleted;
        } catch {}
    }

    function flag(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        try escrow.flagOverdue(id) {
            ++nFlagged;
        } catch {}
    }

    function dispute(uint256 seed, bool bySeller) external {
        if (seed % 8 != 0) return; // rare: a dispute freezes the happy path
        uint256 id = _pick(seed >> 4);
        if (id == 0) return;
        Sure2PEscrow.Escrow memory e = escrow.getEscrow(id);
        vm.prank(bySeller ? e.seller : e.buyer);
        try escrow.openDispute(id, keccak256(abi.encode("r", seed))) {
            ++nDisputed;
        } catch {}
    }

    function settle(uint256 seed, uint256 refund) external {
        if (seed % 6 != 0) return; // rare: settlement is terminal
        uint256 id = _pick(seed >> 4);
        if (id == 0) return;
        Sure2PEscrow.Escrow memory e = escrow.getEscrow(id);
        Sure2PEscrow.Settlement memory st = Sure2PEscrow.Settlement({
            escrowId: id,
            buyerPriceRefund: bound(refund, 0, e.price),
            nonce: e.settlementNonce,
            deadline: uint64(block.timestamp + 1 days),
            agreementHash: e.agreementHash
        });
        bytes memory bs = Sure2PSigUtils.signSettlement(address(escrow), st, pkOf[e.buyer]);
        bytes memory ss = Sure2PSigUtils.signSettlement(address(escrow), st, pkOf[e.seller]);
        try escrow.executeMutualSettlement(id, st, bs, ss) {
            ++nSettled;
        } catch {}
    }

    function claim(uint256 seed, uint256 who) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        address a = actors[bound(who, 0, 3)];
        uint256 amount = escrow.claimable(id, a);
        vm.prank(a);
        try escrow.claim(id) {
            ghostOut += amount;
            ++nClaims;
        } catch {}
    }

    /// @dev Greedy happy-path driver: advances one of the 3 newest escrows by its next legitimate step,
    /// so deep lifecycle states (declared / accepted / completed / claimed) are reached reliably.
    function progress(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        Sure2PEscrow.Escrow memory e = escrow.getEscrow(id);
        if (e.state == Sure2PEscrow.State.Funding) {
            if (!e.buyerFunded) {
                vm.prank(e.buyer);
                try escrow.fundBuyer(id) {
                    ghostIn += e.price + e.buyerDeposit;
                    ++nFundBuyer;
                } catch {}
            } else if (!e.sellerFunded) {
                vm.prank(e.seller);
                try escrow.fundSeller(id) {
                    ghostIn += e.sellerDeposit;
                    ++nFundSeller;
                } catch {}
            }
        } else if (e.state == Sure2PEscrow.State.Active) {
            if (!e.sellerHandoverDeclared) {
                vm.prank(e.seller);
                try escrow.declareHandover(id, keccak256(abi.encode("m", seed))) {
                    ++nDeclared;
                } catch {}
            } else if (!e.buyerReceiptAcknowledged && seed % 2 == 0) {
                vm.prank(e.buyer);
                try escrow.acknowledgeReceipt(id) {
                    ++nAcked;
                } catch {}
            } else if (!e.buyerAccepted) {
                vm.prank(e.buyer);
                try escrow.confirmBuyerAcceptance(id) {
                    ++nAccepted;
                } catch {}
            } else {
                try escrow.finalizeMutualCompletion(id) {
                    ++nCompleted;
                } catch {}
            }
        } else if (e.state == Sure2PEscrow.State.Finalized || e.state == Sure2PEscrow.State.ExpiredUnfunded) {
            _claimFor(id, e.buyer);
            _claimFor(id, e.seller);
        }
    }

    function _claimFor(uint256 id, address a) internal {
        uint256 amount = escrow.claimable(id, a);
        vm.prank(a);
        try escrow.claim(id) {
            ghostOut += amount;
            ++nClaims;
        } catch {}
    }

    function warp(uint256 dt) external {
        // mostly small steps, occasionally a multi-day jump (crosses deadlines / windows)
        uint256 step = dt % 6 == 0 ? bound(dt / 6, 0, 8 days) : bound(dt, 0, 6 hours);
        vm.warp(block.timestamp + step);
    }

    /// @dev Direct token donation: balance may exceed totalOutstanding but never fall below it.
    function donate(uint256 amount) external {
        amount = bound(amount, 0, 1e9);
        usdc.mint(address(escrow), amount);
        donated += amount;
    }
}
