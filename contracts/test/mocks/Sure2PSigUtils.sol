// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Vm} from "forge-std/Vm.sol";
import {Sure2PEscrow} from "../../Sure2PEscrow.sol";

/// @dev Independent EIP-712 implementation (does not call the escrow's hash functions) so tests
/// verify the contract's digests against the spec as well as using them.
library Sure2PSigUtils {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant AGREEMENT_TYPEHASH = keccak256(
        "Agreement(address buyer,address seller,address token,uint256 price,uint256 buyerDeposit,uint256 sellerDeposit,bytes32 agreementHash,bytes32 policyHash,uint256 agreementNonce,uint64 handoverDeadline,uint32 buyerResponseSeconds,uint32 inspectionSeconds,uint64 signDeadline)"
    );
    bytes32 internal constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(uint256 escrowId,uint256 buyerPriceRefund,uint256 nonce,uint64 deadline,bytes32 agreementHash)"
    );

    function domainSeparator(address escrow) internal view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("Sure2PEscrow"), keccak256("1"), block.chainid, escrow)
        );
    }

    function agreementDigest(address escrow, Sure2PEscrow.Agreement memory a) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                AGREEMENT_TYPEHASH,
                a.buyer,
                a.seller,
                a.token,
                a.price,
                a.buyerDeposit,
                a.sellerDeposit,
                a.agreementHash,
                a.policyHash,
                a.agreementNonce,
                a.handoverDeadline,
                a.buyerResponseSeconds,
                a.inspectionSeconds,
                a.signDeadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(escrow), structHash));
    }

    function settlementDigest(address escrow, Sure2PEscrow.Settlement memory s) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(SETTLEMENT_TYPEHASH, s.escrowId, s.buyerPriceRefund, s.nonce, s.deadline, s.agreementHash)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(escrow), structHash));
    }

    function sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function signAgreement(address escrow, Sure2PEscrow.Agreement memory a, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        return sign(pk, agreementDigest(escrow, a));
    }

    function signSettlement(address escrow, Sure2PEscrow.Settlement memory s, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        return sign(pk, settlementDigest(escrow, s));
    }
}
