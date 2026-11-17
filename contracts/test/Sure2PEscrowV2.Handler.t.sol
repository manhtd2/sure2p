// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Sure2PEscrowV2} from "../Sure2PEscrowV2.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Sure2PEscrowV2SigUtils} from "./mocks/Sure2PEscrowV2SigUtils.sol";

/// @dev Bounded action surface for the V2 invariant fuzzer, including ruling / appeal / role-swap actions.
/// Every action is try/catch wrapped so ghosts move only on successful calls. No test functions here.
contract Sure2PEscrowV2Handler is Test {
    Sure2PEscrowV2 public immutable escrow;
    MockUSDC public immutable usdc;
    address public immutable owner;
    address public immutable penaltyW;

    address[4] public actors;
    address[3] public cands;
    mapping(address => uint256) public pkOf;
    uint256 public salt;

    uint256 public ghostIn;
    uint256 public ghostOut;
    uint256 public donated;

    mapping(uint256 => uint256) public appealCount;
    mapping(uint256 => uint256) public claimedTotal;
    mapping(uint256 => uint256) public claimedPenalty;
    uint256 public conflictFinals;
    uint256 public conflictPrelims;

    uint256 public nCreated;
    uint256 public nFunded;
    uint256 public nDisputed;
    uint256 public nFlagged;
    uint256 public nPrelim;
    uint256 public nAppeals;
    uint256 public nFinalizedUnappealed;
    uint256 public nFinalRulings;
    uint256 public nSettled;
    uint256 public nClaims;
    uint256 public nRoleSwaps;
    uint256 public nEvidence;

    constructor(Sure2PEscrowV2 escrow_, MockUSDC usdc_, address owner_, address penaltyW_) {
        escrow = escrow_;
        usdc = usdc_;
        owner = owner_;
        penaltyW = penaltyW_;
        for (uint256 i; i < 4; ++i) {
            (address a, uint256 pk) = makeAddrAndKey(string(abi.encodePacked("hactor", vm.toString(i))));
            actors[i] = a;
            pkOf[a] = pk;
            usdc_.mint(a, 1e15);
            vm.prank(a);
            usdc_.approve(address(escrow_), type(uint256).max);
        }
        for (uint256 i; i < 3; ++i) {
            cands[i] = makeAddr(string(abi.encodePacked("cand", vm.toString(i))));
        }
    }

    // ------------------------------------------------------------ internals

    function _pick(uint256 seed) internal view returns (uint256 id) {
        uint256 n = escrow.escrowCount();
        if (n == 0) return 0;
        uint256 span = n < 3 ? n : 3;
        id = n - bound(seed, 0, span - 1);
    }

    function _validRuling(uint256 id, uint256 refund, uint256 faultRaw, uint256 penalty)
        internal
        view
        returns (uint256, Sure2PEscrowV2.Fault, uint256)
    {
        Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
        Sure2PEscrowV2.Fault f = Sure2PEscrowV2.Fault(bound(faultRaw, 0, 2));
        uint256 p = f == Sure2PEscrowV2.Fault.None ? 0 : bound(penalty, 0, e.buyerDeposit);
        return (bound(refund, 0, e.price), f, p);
    }

    function _claimFor(uint256 id, address a) internal {
        uint256 amount = escrow.claimable(id, a);
        vm.prank(a);
        try escrow.claim(id) {
            ghostOut += amount;
            claimedTotal[id] += amount;
            if (a == penaltyW) claimedPenalty[id] += amount;
            ++nClaims;
        } catch {}
    }

    function _fund(uint256 id, Sure2PEscrowV2.Escrow memory e) internal {
        if (!e.buyerFunded) {
            vm.prank(e.buyer);
            try escrow.fundBuyer(id) {
                ghostIn += e.price + e.buyerDeposit;
                ++nFunded;
            } catch {}
        } else if (!e.sellerFunded) {
            vm.prank(e.seller);
            try escrow.fundSeller(id) {
                ghostIn += e.sellerDeposit;
                ++nFunded;
            } catch {}
        }
    }

    function _doPrelim(uint256 id, uint256 seed) internal {
        (uint256 refund, Sure2PEscrowV2.Fault f, uint256 p) = _validRuling(id, seed, seed >> 8, seed >> 16);
        address arb = escrow.arbiter();
        vm.prank(arb);
        try escrow.issuePreliminaryRuling(id, refund, f, p, keccak256(abi.encode("r", seed))) {
            Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
            if (arb == e.buyer || arb == e.seller) ++conflictPrelims;
            ++nPrelim;
        } catch {}
    }

    function _doFinal(uint256 id, uint256 seed) internal {
        (uint256 refund, Sure2PEscrowV2.Fault f, uint256 p) = _validRuling(id, seed >> 3, seed >> 11, seed >> 19);
        address rev = escrow.appealReviewer();
        address issuer = escrow.getRuling(id).issuedBy;
        vm.prank(rev);
        try escrow.issueFinalRuling(id, refund, f, p, keccak256(abi.encode("f", seed))) {
            // S3: reviewer must never be the preliminary issuer nor a party
            Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
            if (issuer == rev || rev == e.buyer || rev == e.seller) ++conflictFinals;
            ++nFinalRulings;
        } catch {}
    }

    // ------------------------------------------------------------ actions

    function create(uint256 bi, uint256 offset, uint256 price, uint256 extra) external {
        _create(bi, offset, price, extra);
    }

    function _create(uint256 bi, uint256 offset, uint256 price, uint256 extra) internal {
        bi = bound(bi, 0, 3);
        address b = actors[bi];
        address s = actors[(bi + 1 + bound(offset, 0, 2)) % 4];
        price = bound(price, 1, 1000e6);
        uint256 dep = (price + 3) / 4;
        ++salt;

        Sure2PEscrowV2.Agreement memory a;
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
        bytes memory bs = Sure2PEscrowV2SigUtils.signAgreement(esc, a, pkOf[b]);
        bytes memory ss = Sure2PEscrowV2SigUtils.signAgreement(esc, a, pkOf[s]);
        try escrow.createEscrow(a, bs, ss) {
            ++nCreated;
        } catch {}
    }

    /// @dev Greedy driver: advances one of the 3 newest escrows by its next legitimate step.
    function progress(uint256 seed) external {
        _progress(seed);
    }

    function progressB(uint256 seed) external {
        _progress(seed);
    }

    function progressC(uint256 seed) external {
        _progress(seed);
    }

    function _progress(uint256 seed) internal {
        uint256 id = _pick(seed);
        if (id == 0) {
            _create(seed, seed >> 8, seed >> 16, seed >> 24);
            return;
        }
        Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
        Sure2PEscrowV2.State st = e.state;
        if (st == Sure2PEscrowV2.State.Funding) {
            _fund(id, e);
        } else if (st == Sure2PEscrowV2.State.Active) {
            // mostly drive into a locked state so ruling paths are exercised
            if (seed % 5 == 0) {
                vm.prank(seed % 2 == 0 ? e.buyer : e.seller);
                try escrow.openDispute(id, keccak256(abi.encode("d", seed))) {
                    ++nDisputed;
                } catch {}
            } else {
                _warpAndFlag(id, e);
            }
        } else if (st == Sure2PEscrowV2.State.Overdue || st == Sure2PEscrowV2.State.Disputed) {
            _doPrelim(id, seed);
        } else if (st == Sure2PEscrowV2.State.PreliminaryRuling) {
            uint256 m = seed % 3;
            if (m == 0) {
                _appealAs(id, seed % 2 == 0);
            } else if (m == 1) {
                _finalizeUnappealed(id);
            }
        } else if (st == Sure2PEscrowV2.State.Appealed) {
            _doFinal(id, seed);
        } else if (st == Sure2PEscrowV2.State.Finalized || st == Sure2PEscrowV2.State.ExpiredUnfunded) {
            _claimFor(id, e.buyer);
            _claimFor(id, e.seller);
            _claimFor(id, penaltyW);
            if (seed % 2 == 0) _create(seed >> 3, seed >> 8, seed >> 16, seed >> 24);
        }
    }

    function _warpAndFlag(uint256 id, Sure2PEscrowV2.Escrow memory e) internal {
        if (!e.sellerHandoverDeclared && block.timestamp <= e.handoverDeadline) {
            vm.warp(uint256(e.handoverDeadline) + 1);
        }
        try escrow.flagOverdue(id) {
            ++nFlagged;
        } catch {}
    }

    function _appealAs(uint256 id, bool bySeller) internal {
        Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
        vm.prank(bySeller ? e.seller : e.buyer);
        try escrow.appeal(id, keccak256(abi.encode("a", id, block.timestamp))) {
            ++appealCount[id];
            ++nAppeals;
        } catch {}
    }

    function _finalizeUnappealed(uint256 id) internal {
        uint64 dl = escrow.getRuling(id).appealDeadline;
        if (block.timestamp <= dl) vm.warp(uint256(dl) + 1);
        try escrow.finalizeRuling(id) {
            ++nFinalizedUnappealed;
        } catch {}
    }

    function appeal(uint256 seed, bool bySeller) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        _appealAs(id, bySeller);
    }

    function prelim(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        _doPrelim(id, seed);
    }

    function finalRuling(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        _doFinal(id, seed);
    }

    function finalizeRuling(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        _finalizeUnappealed(id);
    }

    function dispute(uint256 seed, bool bySeller) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
        vm.prank(bySeller ? e.seller : e.buyer);
        try escrow.openDispute(id, keccak256(abi.encode("r", seed))) {
            ++nDisputed;
        } catch {}
    }

    function flag(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        _warpAndFlag(id, escrow.getEscrow(id));
    }

    function anchor(uint256 seed, bool bySeller) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
        vm.prank(bySeller ? e.seller : e.buyer);
        try escrow.anchorEvidence(id, keccak256(abi.encode("e", seed))) {
            ++nEvidence;
        } catch {}
    }

    function settle(uint256 seed, uint256 refund) external {
        if (seed % 3 != 0) return;
        uint256 id = _pick(seed >> 4);
        if (id == 0) return;
        Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
        Sure2PEscrowV2.Settlement memory st = Sure2PEscrowV2.Settlement({
            escrowId: id,
            buyerPriceRefund: bound(refund, 0, e.price),
            nonce: e.settlementNonce,
            deadline: uint64(block.timestamp + 1 days),
            agreementHash: e.agreementHash
        });
        bytes memory bs = Sure2PEscrowV2SigUtils.signSettlement(address(escrow), st, pkOf[e.buyer]);
        bytes memory ss = Sure2PEscrowV2SigUtils.signSettlement(address(escrow), st, pkOf[e.seller]);
        try escrow.executeMutualSettlement(id, st, bs, ss) {
            ++nSettled;
        } catch {}
    }

    function claim(uint256 seed, uint256 who) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        Sure2PEscrowV2.Escrow memory e = escrow.getEscrow(id);
        uint256 w = bound(who, 0, 2);
        _claimFor(id, w == 0 ? e.buyer : (w == 1 ? e.seller : penaltyW));
    }

    function swapArbiter(uint256 seed) external {
        address n = seed % 4 == 0 ? actors[(seed >> 2) % 4] : cands[(seed >> 2) % 3];
        vm.prank(owner);
        try escrow.setArbiter(n) {
            ++nRoleSwaps;
        } catch {}
    }

    function swapReviewer(uint256 seed) external {
        address n = seed % 4 == 0 ? actors[(seed >> 2) % 4] : cands[(seed >> 2) % 3];
        vm.prank(owner);
        try escrow.setAppealReviewer(n) {
            ++nRoleSwaps;
        } catch {}
    }

    function warp(uint256 dt) external {
        uint256 step = dt % 6 == 0 ? bound(dt / 6, 0, 5 days) : bound(dt, 0, 6 hours);
        vm.warp(block.timestamp + step);
    }

    function donate(uint256 amount) external {
        amount = bound(amount, 0, 1e9);
        usdc.mint(address(escrow), amount);
        donated += amount;
    }
}
