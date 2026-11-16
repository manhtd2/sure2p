// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ISure2PAccountRegistry} from "./interfaces/ISure2PAccountRegistry.sol";

/// @notice USDC-only bilateral escrow. Deadlines escalate, but never release locked funds.
/// @dev Amounts are USDC base units (6 decimals). No administrator or alternate payout recipient.
contract Sure2PEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 public constant FUNDING_WINDOW = 24 hours;
    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 30 days;
    bytes32 public constant AGREEMENT_TYPEHASH = keccak256(
        "Agreement(address buyer,address seller,address token,uint256 price,uint256 buyerDeposit,uint256 sellerDeposit,bytes32 agreementHash,bytes32 policyHash,uint256 agreementNonce,uint64 handoverDeadline,uint32 buyerResponseSeconds,uint32 inspectionSeconds,uint64 signDeadline)"
    );
    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(uint256 escrowId,uint256 buyerPriceRefund,uint256 nonce,uint64 deadline,bytes32 agreementHash)"
    );

    IERC20 public immutable usdc;
    ISure2PAccountRegistry public immutable registry;

    enum State { None, Funding, Active, Overdue, Disputed, PreliminaryRuling, Appealed, Finalized, ExpiredUnfunded }

    struct Agreement {
        address buyer;
        address seller;
        address token;
        uint256 price;
        uint256 buyerDeposit;
        uint256 sellerDeposit;
        bytes32 agreementHash;
        bytes32 policyHash;
        uint256 agreementNonce;
        uint64 handoverDeadline;
        uint32 buyerResponseSeconds;
        uint32 inspectionSeconds;
        uint64 signDeadline;
    }

    struct Settlement {
        uint256 escrowId;
        uint256 buyerPriceRefund;
        uint256 nonce;
        uint64 deadline;
        bytes32 agreementHash;
    }

    struct Escrow {
        address buyer;
        address seller;
        uint256 price;
        uint256 buyerDeposit;
        uint256 sellerDeposit;
        bytes32 agreementHash;
        bytes32 policyHash;
        uint64 createdAt;
        uint64 fundingDeadline;
        uint64 handoverDeadline;
        uint32 buyerResponseSeconds;
        uint32 inspectionSeconds;
        bool buyerFunded;
        bool sellerFunded;
        uint64 activatedAt;
        bool sellerHandoverDeclared;
        uint64 sellerDeclaredAt;
        bytes32 handoverManifestHash;
        bool buyerReceiptAcknowledged;
        uint64 buyerAcknowledgedAt;
        bool buyerAccepted;
        uint64 buyerAcceptedAt;
        State state;
        address disputeOpenedBy;
        bytes32 disputeReasonCommitment;
        uint256 settlementNonce;
    }

    mapping(uint256 escrowId => Escrow) private _escrows;
    mapping(bytes32 agreementHash => bool) public usedAgreementHashes;
    mapping(address buyer => mapping(uint256 nonce => bool)) public usedAgreementNonces;
    mapping(uint256 escrowId => mapping(address account => uint256)) public credits;
    uint256 public escrowCount;
    /// @notice Sum of all funded but unclaimed USDC, including locked funds and credits.
    uint256 public totalOutstanding;

    error InvalidConfiguration();
    error UnknownEscrow(uint256 escrowId);
    error InvalidState(State actual);
    error Unauthorized();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error InvalidParties();
    error IneligibleParty();
    error InvalidToken();
    error InvalidPrice();
    error InvalidDeposit();
    error ZeroCommitment();
    error AgreementHashUsed();
    error AgreementNonceUsed();
    error InvalidDuration();
    error InvalidHandoverDeadline();
    error InvalidSignature(address signer);
    error AlreadyFunded();
    error UnexpectedTransferAmount();
    error AlreadyDeclared();
    error HandoverNotDeclared();
    error AlreadyAcknowledged();
    error AlreadyAccepted();
    error EffectivelyOverdue();
    error NotOverdue();
    error AcceptanceRequired();
    error InvalidSettlement();
    error NoCredit();
    error ConservationViolation();

    event EscrowCreated(
        uint256 indexed escrowId, address indexed buyer, address indexed seller,
        bytes32 agreementHash, bytes32 policyHash, uint256 price,
        uint256 buyerDeposit, uint256 sellerDeposit, uint64 fundingDeadline,
        uint64 handoverDeadline, uint32 buyerResponseSeconds, uint32 inspectionSeconds
    );
    event BuyerFunded(uint256 indexed escrowId, uint256 amount);
    event SellerFunded(uint256 indexed escrowId, uint256 amount);
    event EscrowActivated(uint256 indexed escrowId, uint64 activatedAt);
    event EscrowExpired(uint256 indexed escrowId);
    event HandoverDeclared(uint256 indexed escrowId, bytes32 manifestHash, uint64 sellerDeclaredAt);
    event ReceiptAcknowledged(uint256 indexed escrowId, uint64 buyerAcknowledgedAt);
    event BuyerAcceptanceConfirmed(uint256 indexed escrowId, uint64 buyerAcceptedAt);
    event OverdueFlagged(uint256 indexed escrowId, uint8 trigger);
    event MutualCompletionFinalized(uint256 indexed escrowId);
    event DisputeOpened(uint256 indexed escrowId, address indexed openedBy, bytes32 reasonCommitment);
    event MutualSettlementExecuted(uint256 indexed escrowId, uint256 buyerPriceRefund, uint256 nonce);
    event CreditAssigned(uint256 indexed escrowId, address indexed account, uint256 amount);
    event Claimed(uint256 indexed escrowId, address indexed account, uint256 amount);

    /// @notice Binds this escrow permanently to the configured USDC and eligibility registry.
    /// @dev Deployment must supply the genuine Arc Testnet USDC address, not an arbitrary six-decimal token.
    constructor(address usdc_, ISure2PAccountRegistry registry_) EIP712("Sure2PEscrow", "1") {
        if (usdc_.code.length == 0 || address(registry_).code.length == 0) revert InvalidConfiguration();
        if (IERC20Metadata(usdc_).decimals() != 6) revert InvalidConfiguration();
        usdc = IERC20(usdc_);
        registry = registry_;
    }

    /// @notice Creates an unfunded escrow authorized by both parties; anyone may relay it.
    function createEscrow(Agreement calldata a, bytes calldata buyerSig, bytes calldata sellerSig)
        external nonReentrant returns (uint256 escrowId)
    {
        if (block.timestamp > a.signDeadline) revert DeadlinePassed();
        if (a.buyer == address(0) || a.seller == address(0) || a.buyer == a.seller) revert InvalidParties();
        if (!registry.isEligible(a.buyer) || !registry.isEligible(a.seller)) revert IneligibleParty();
        if (a.token != address(usdc)) revert InvalidToken();
        if (a.price == 0) revert InvalidPrice();
        uint256 deposit = (a.price + 3) / 4;
        if (a.buyerDeposit != deposit || a.sellerDeposit != deposit) revert InvalidDeposit();
        if (a.agreementHash == bytes32(0) || a.policyHash == bytes32(0)) revert ZeroCommitment();
        if (usedAgreementHashes[a.agreementHash]) revert AgreementHashUsed();
        if (usedAgreementNonces[a.buyer][a.agreementNonce]) revert AgreementNonceUsed();
        if (a.buyerResponseSeconds < MIN_DURATION || a.buyerResponseSeconds > MAX_DURATION
            || a.inspectionSeconds < MIN_DURATION || a.inspectionSeconds > MAX_DURATION) revert InvalidDuration();
        uint64 fundingDeadline = (block.timestamp + FUNDING_WINDOW).toUint64();
        if (a.handoverDeadline <= fundingDeadline) revert InvalidHandoverDeadline();
        bytes32 digest = hashAgreement(a);
        _checkSignatures(a.buyer, a.seller, digest, buyerSig, sellerSig);

        usedAgreementHashes[a.agreementHash] = true;
        usedAgreementNonces[a.buyer][a.agreementNonce] = true;
        escrowId = ++escrowCount;
        Escrow storage e = _escrows[escrowId];
        e.buyer = a.buyer;
        e.seller = a.seller;
        e.price = a.price;
        e.buyerDeposit = a.buyerDeposit;
        e.sellerDeposit = a.sellerDeposit;
        e.agreementHash = a.agreementHash;
        e.policyHash = a.policyHash;
        e.createdAt = block.timestamp.toUint64();
        e.fundingDeadline = fundingDeadline;
        e.handoverDeadline = a.handoverDeadline;
        e.buyerResponseSeconds = a.buyerResponseSeconds;
        e.inspectionSeconds = a.inspectionSeconds;
        e.state = State.Funding;
        _emitCreated(escrowId, e);
    }

    /// @notice Pulls the buyer's complete price plus deposit in one exact transfer.
    function fundBuyer(uint256 id) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.buyer) revert Unauthorized();
        _requireFunding(e);
        if (e.buyerFunded) revert AlreadyFunded();
        uint256 amount = e.price + e.buyerDeposit;
        e.buyerFunded = true;
        totalOutstanding += amount;
        _pullExact(msg.sender, amount);
        emit BuyerFunded(id, amount);
        _activateIfFunded(id, e);
    }

    /// @notice Pulls the seller's complete deposit in one exact transfer.
    function fundSeller(uint256 id) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.seller) revert Unauthorized();
        _requireFunding(e);
        if (e.sellerFunded) revert AlreadyFunded();
        uint256 amount = e.sellerDeposit;
        e.sellerFunded = true;
        totalOutstanding += amount;
        _pullExact(msg.sender, amount);
        emit SellerFunded(id, amount);
        _activateIfFunded(id, e);
    }

    /// @notice Expires an incompletely funded escrow after its deadline, refunding actual contributions.
    function expireUnfunded(uint256 id) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        _requireState(e, State.Funding);
        if (block.timestamp <= e.fundingDeadline) revert DeadlineNotPassed();
        e.state = State.ExpiredUnfunded;
        if (e.buyerFunded) _credit(id, e.buyer, e.price + e.buyerDeposit);
        if (e.sellerFunded) _credit(id, e.seller, e.sellerDeposit);
        emit EscrowExpired(id);
    }

    /// @notice Records the seller's declaration only; does not start buyer inspection.
    function declareHandover(uint256 id, bytes32 manifestHash) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.seller) revert Unauthorized();
        _requireTimelyActive(e);
        if (e.sellerHandoverDeclared) revert AlreadyDeclared();
        if (manifestHash == bytes32(0)) revert ZeroCommitment();
        e.sellerHandoverDeclared = true;
        e.sellerDeclaredAt = block.timestamp.toUint64();
        e.handoverManifestHash = manifestHash;
        emit HandoverDeclared(id, manifestHash, e.sellerDeclaredAt);
    }

    /// @notice Records buyer receipt and starts the inspection window.
    function acknowledgeReceipt(uint256 id) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.buyer) revert Unauthorized();
        _requireTimelyActive(e);
        if (!e.sellerHandoverDeclared) revert HandoverNotDeclared();
        if (e.buyerReceiptAcknowledged) revert AlreadyAcknowledged();
        _acknowledge(id, e);
    }

    /// @notice Records buyer acceptance, also acknowledging receipt if necessary.
    function confirmBuyerAcceptance(uint256 id) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.buyer) revert Unauthorized();
        _requireTimelyActive(e);
        if (!e.sellerHandoverDeclared) revert HandoverNotDeclared();
        if (e.buyerAccepted) revert AlreadyAccepted();
        if (!e.buyerReceiptAcknowledged) _acknowledge(id, e);
        e.buyerAccepted = true;
        e.buyerAcceptedAt = block.timestamp.toUint64();
        emit BuyerAcceptanceConfirmed(id, e.buyerAcceptedAt);
    }

    /// @notice Escalates a missed deadline without deciding delivery or releasing funds.
    function flagOverdue(uint256 id) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        _requireState(e, State.Active);
        uint8 trigger = _overdueTrigger(e);
        if (trigger == 0) revert NotOverdue();
        e.state = State.Overdue;
        emit OverdueFlagged(id, trigger);
    }

    /// @notice Assigns completion credits only after timely seller declaration and buyer acceptance.
    function finalizeMutualCompletion(uint256 id) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        _requireTimelyActive(e);
        if (!e.sellerHandoverDeclared) revert HandoverNotDeclared();
        if (!e.buyerAccepted) revert AcceptanceRequired();
        _finalizeCredits(id, e, e.buyerDeposit, e.price + e.sellerDeposit);
        emit MutualCompletionFinalized(id);
    }

    /// @notice Opens the escrow's sole dispute, with no forfeiture or payout.
    function openDispute(uint256 id, bytes32 reasonCommitment) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.buyer && msg.sender != e.seller) revert Unauthorized();
        if (e.state != State.Active && e.state != State.Overdue) revert InvalidState(e.state);
        // Once the Buyer has accepted, the Seller's completion entitlement is established
        // and can no longer be blocked by a dispute.
        if (e.buyerAccepted) revert AlreadyAccepted();
        if (reasonCommitment == bytes32(0)) revert ZeroCommitment();
        e.state = State.Disputed;
        e.disputeOpenedBy = msg.sender;
        e.disputeReasonCommitment = reasonCommitment;
        emit DisputeOpened(id, msg.sender, reasonCommitment);
    }

    /// @notice Executes a jointly signed price split, always refunding both deposits in full.
    function executeMutualSettlement(uint256 id, Settlement calldata s, bytes calldata buyerSig, bytes calldata sellerSig)
        external nonReentrant
    {
        Escrow storage e = _getEscrow(id);
        if (e.state != State.Active && e.state != State.Overdue && e.state != State.Disputed) revert InvalidState(e.state);
        if (block.timestamp > s.deadline) revert DeadlinePassed();
        if (s.escrowId != id || s.nonce != e.settlementNonce || s.agreementHash != e.agreementHash
            || s.buyerPriceRefund > e.price) revert InvalidSettlement();
        _checkSignatures(e.buyer, e.seller, hashSettlement(s), buyerSig, sellerSig);
        ++e.settlementNonce;
        _finalizeCredits(id, e, s.buyerPriceRefund + e.buyerDeposit, (e.price - s.buyerPriceRefund) + e.sellerDeposit);
        emit MutualSettlementExecuted(id, s.buyerPriceRefund, s.nonce);
    }

    /// @notice Withdraws only the caller's own assigned credits to that same wallet.
    function claim(uint256 id) external nonReentrant {
        uint256 amount = credits[id][msg.sender];
        if (amount == 0) revert NoCredit();
        credits[id][msg.sender] = 0;
        totalOutstanding -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Claimed(id, msg.sender, amount);
    }

    /// @notice Returns the complete stored escrow; nonexistent IDs revert.
    function getEscrow(uint256 id) external view returns (Escrow memory) {
        return _getEscrow(id);
    }

    /// @notice Returns assigned, currently withdrawable credits for this account only.
    function claimable(uint256 id, address account) external view returns (uint256) {
        return credits[id][account];
    }

    /// @notice Returns whether an Active or Overdue escrow currently has a missed deadline.
    function effectiveOverdue(uint256 id) external view returns (bool) {
        return _overdueTrigger(_getEscrow(id)) != 0;
    }

    /// @notice Returns 0 for none, 1 for handover, 2 for receipt response, or 3 for inspection.
    function overdueTrigger(uint256 id) external view returns (uint8) {
        return _overdueTrigger(_getEscrow(id));
    }

    /// @notice Returns the chain- and contract-bound EIP-712 domain separator.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Returns the EIP-712 digest signed by both parties for an agreement.
    function hashAgreement(Agreement calldata a) public view returns (bytes32) {
        // Agreement is entirely static: encoding this tuple equals encoding its fields in order.
        return _hashTypedDataV4(keccak256(abi.encode(AGREEMENT_TYPEHASH, a)));
    }

    /// @notice Returns the EIP-712 digest signed by both parties for a settlement.
    function hashSettlement(Settlement calldata s) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(SETTLEMENT_TYPEHASH, s)));
    }

    function _getEscrow(uint256 id) internal view returns (Escrow storage e) {
        e = _escrows[id];
        if (e.state == State.None) revert UnknownEscrow(id);
    }

    function _requireState(Escrow storage e, State expected) internal view {
        if (e.state != expected) revert InvalidState(e.state);
    }

    function _requireFunding(Escrow storage e) internal view {
        _requireState(e, State.Funding);
        if (block.timestamp > e.fundingDeadline) revert DeadlinePassed();
    }

    function _requireTimelyActive(Escrow storage e) internal view {
        _requireState(e, State.Active);
        if (_overdueTrigger(e) != 0) revert EffectivelyOverdue();
    }

    function _pullExact(address from, uint256 amount) internal {
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(from, address(this), amount);
        uint256 afterBalance = usdc.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) revert UnexpectedTransferAmount();
    }

    function _activateIfFunded(uint256 id, Escrow storage e) internal {
        if (e.buyerFunded && e.sellerFunded) {
            e.state = State.Active;
            e.activatedAt = block.timestamp.toUint64();
            emit EscrowActivated(id, e.activatedAt);
        }
    }

    function _acknowledge(uint256 id, Escrow storage e) internal {
        e.buyerReceiptAcknowledged = true;
        e.buyerAcknowledgedAt = block.timestamp.toUint64();
        emit ReceiptAcknowledged(id, e.buyerAcknowledgedAt);
    }

    function _overdueTrigger(Escrow storage e) internal view returns (uint8) {
        if (e.state != State.Active && e.state != State.Overdue) return 0;
        if (!e.sellerHandoverDeclared && block.timestamp > e.handoverDeadline) return 1;
        if (e.sellerHandoverDeclared && !e.buyerReceiptAcknowledged
            && block.timestamp > uint256(e.sellerDeclaredAt) + e.buyerResponseSeconds) return 2;
        if (e.buyerReceiptAcknowledged && !e.buyerAccepted
            && block.timestamp > uint256(e.buyerAcknowledgedAt) + e.inspectionSeconds) return 3;
        return 0;
    }

    function _checkSignatures(address buyer, address seller, bytes32 digest, bytes calldata buyerSig, bytes calldata sellerSig)
        internal view
    {
        if (!SignatureChecker.isValidSignatureNow(buyer, digest, buyerSig)) revert InvalidSignature(buyer);
        if (!SignatureChecker.isValidSignatureNow(seller, digest, sellerSig)) revert InvalidSignature(seller);
    }

    function _finalizeCredits(uint256 id, Escrow storage e, uint256 buyerAmount, uint256 sellerAmount) internal {
        if (!e.buyerFunded || !e.sellerFunded
            || buyerAmount + sellerAmount != e.price + e.buyerDeposit + e.sellerDeposit) revert ConservationViolation();
        e.state = State.Finalized;
        _credit(id, e.buyer, buyerAmount);
        _credit(id, e.seller, sellerAmount);
    }

    function _credit(uint256 id, address account, uint256 amount) internal {
        credits[id][account] += amount;
        emit CreditAssigned(id, account, amount);
    }

    function _emitCreated(uint256 id, Escrow storage e) internal {
        emit EscrowCreated(id, e.buyer, e.seller, e.agreementHash, e.policyHash, e.price,
            e.buyerDeposit, e.sellerDeposit, e.fundingDeadline, e.handoverDeadline,
            e.buyerResponseSeconds, e.inspectionSeconds);
    }
}
