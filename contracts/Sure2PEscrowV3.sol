// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ISure2PAccountRegistry} from "./interfaces/ISure2PAccountRegistry.sol";

/// @notice USDC-only bilateral escrow with per-party deposit refunds, fault and fraud flags, and one shared appeal.
/// @dev Amounts are USDC base units (6 decimals); the EIP-712 domain version is 3.
///      Rulings bind the agreement, reason and evidence root. Only final rulings confirm fraud; no registry bans occur here.
///      The owner, arbiter and reviewer are distinct. The immutable penalty wallet may equal the owner, but not a judge.
///      Credits go only to the parties or penalty wallet; deadlines alone never release funds, and the owner cannot sweep them.
contract Sure2PEscrowV3 is EIP712, ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 public constant FUNDING_WINDOW = 24 hours;
    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 30 days;
    uint256 public constant APPEAL_WINDOW = 72 hours;
    bytes32 public constant AGREEMENT_TYPEHASH = keccak256(
        "Agreement(address buyer,address seller,address token,uint256 price,uint256 buyerDeposit,uint256 sellerDeposit,bytes32 agreementHash,bytes32 policyHash,uint256 agreementNonce,uint64 handoverDeadline,uint32 buyerResponseSeconds,uint32 inspectionSeconds,uint64 signDeadline)"
    );
    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(uint256 escrowId,uint256 buyerPriceRefund,uint256 nonce,uint64 deadline,bytes32 agreementHash)"
    );

    IERC20 public immutable usdc;
    ISure2PAccountRegistry public immutable registry;
    address public immutable penaltyWallet;
    address public arbiter;
    address public appealReviewer;

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

    /// @notice Agreement-bound ruling; each non-fault party must receive its full deposit.
    struct RulingInput {
        bytes32 agreementHash;
        uint256 buyerPriceRefund;
        uint256 buyerDepositRefund;
        uint256 sellerDepositRefund;
        bool buyerAtFault;
        bool sellerAtFault;
        bool buyerFraud;
        bool sellerFraud;
        bytes32 reasonHash;
        bytes32 evidenceRoot;
    }

    /// @notice Preliminary decision and the escrow's single shared appeal history.
    struct Ruling {
        address issuedBy;
        uint64 issuedAt;
        uint64 appealDeadline;
        RulingInput input;
        bool appealed;
        address appealedBy;
        uint64 appealedAt;
        bytes32 appealReasonHash;
    }

    /// @notice Effective ruling, stored only when a ruling finalizes the escrow.
    struct Outcome {
        address decidedBy;
        uint64 decidedAt;
        bool byAppeal;
        RulingInput input;
    }

    mapping(uint256 escrowId => Escrow) private _escrows;
    mapping(bytes32 agreementHash => bool) public usedAgreementHashes;
    mapping(address buyer => mapping(uint256 nonce => bool)) public usedAgreementNonces;
    mapping(uint256 escrowId => mapping(address account => uint256)) public credits;
    uint256 public escrowCount;
    /// @notice Sum of all funded but unclaimed USDC, including locked funds and credits.
    uint256 public totalOutstanding;
    mapping(uint256 escrowId => Ruling) private _rulings;
    mapping(uint256 escrowId => Outcome) private _outcomes;

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
    error UnexpectedTransferAmount(uint256 expected, uint256 balanceBefore, uint256 balanceAfter);
    error AlreadyDeclared();
    error HandoverNotDeclared();
    error AlreadyAcknowledged();
    error AlreadyAccepted();
    error EffectivelyOverdue();
    error NotOverdue();
    error AcceptanceRequired();
    error InvalidSettlement();
    error NoCredit();
    error ConservationViolation(uint256 expectedTotal, uint256 proposedTotal);
    error RulingAgreementMismatch(bytes32 expected, bytes32 supplied);
    error RulingRefundTooLarge(uint256 supplied, uint256 max);
    error NonFaultPartyMustBeRefunded(bool buyerSide, uint256 supplied, uint256 required);
    error FraudRequiresFault(bool buyerSide);
    error AlreadyAppealed();
    error OwnershipRenunciationDisabled();

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
    event PreliminaryRulingIssued(
        uint256 indexed id, address indexed issuedBy, uint256 buyerPriceRefund,
        uint256 buyerDepositRefund, uint256 sellerDepositRefund,
        bool buyerAtFault, bool sellerAtFault, bool buyerFraud, bool sellerFraud,
        bytes32 reasonHash, bytes32 evidenceRoot, uint64 appealDeadline
    );
    event RulingAppealed(uint256 indexed id, address indexed by, bytes32 reasonHash);
    event RulingFinalized(uint256 indexed id, bool byAppeal);
    event FinalRulingIssued(
        uint256 indexed id, address indexed issuedBy, uint256 buyerPriceRefund,
        uint256 buyerDepositRefund, uint256 sellerDepositRefund,
        bool buyerAtFault, bool sellerAtFault, bool buyerFraud, bool sellerFraud,
        bytes32 reasonHash, bytes32 evidenceRoot
    );
    event EvidenceAnchored(uint256 indexed id, address indexed by, bytes32 evidenceHash, uint64 at);
    event ArbiterChanged(address oldArbiter, address newArbiter);
    event AppealReviewerChanged(address oldReviewer, address newReviewer);

    /// @notice Binds USDC, the eligibility registry and penalty wallet, and initializes distinct owner and ruling roles.
    /// @dev Deployment must supply genuine Arc Testnet USDC. The penalty wallet may equal the owner, but not either judge.
    constructor(
        address usdc_, ISure2PAccountRegistry registry_, address penaltyWallet_,
        address owner_, address arbiter_, address appealReviewer_
    ) EIP712("Sure2PEscrow", "3") Ownable(owner_) {
        if (usdc_ == address(0) || address(registry_) == address(0) || penaltyWallet_ == address(0)
            || owner_ == address(0) || arbiter_ == address(0) || appealReviewer_ == address(0)) {
            revert InvalidConfiguration();
        }
        if (usdc_.code.length == 0 || address(registry_).code.length == 0) revert InvalidConfiguration();
        if (arbiter_ == appealReviewer_ || arbiter_ == owner_ || appealReviewer_ == owner_
            || penaltyWallet_ == arbiter_ || penaltyWallet_ == appealReviewer_) {
            revert InvalidConfiguration();
        }
        if (IERC20Metadata(usdc_).decimals() != 6) revert InvalidConfiguration();
        usdc = IERC20(usdc_);
        registry = registry_;
        penaltyWallet = penaltyWallet_;
        arbiter = arbiter_;
        appealReviewer = appealReviewer_;
    }

    /// @notice Replaces the arbiter without changing existing rulings or their original issuer.
    function setArbiter(address newArbiter) external onlyOwner {
        if (newArbiter == address(0) || newArbiter == appealReviewer || newArbiter == penaltyWallet
            || newArbiter == owner()) {
            revert InvalidConfiguration();
        }
        address oldArbiter = arbiter;
        arbiter = newArbiter;
        emit ArbiterChanged(oldArbiter, newArbiter);
    }

    /// @notice Replaces the appeal reviewer; the original preliminary issuer still cannot review that case.
    function setAppealReviewer(address newReviewer) external onlyOwner {
        if (newReviewer == address(0) || newReviewer == arbiter || newReviewer == penaltyWallet
            || newReviewer == owner()) {
            revert InvalidConfiguration();
        }
        address oldReviewer = appealReviewer;
        appealReviewer = newReviewer;
        emit AppealReviewerChanged(oldReviewer, newReviewer);
    }

    /// @notice Starts two-step ownership transfer to an address distinct from both judges; zero cancels it.
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == arbiter || newOwner == appealReviewer) revert InvalidConfiguration();
        super.transferOwnership(newOwner);
    }

    /// @notice Accepts ownership only if the pending owner is still distinct from both current judges.
    /// @dev Rechecks separation because a judge may have been replaced since the transfer began.
    function acceptOwnership() public override {
        if (msg.sender == arbiter || msg.sender == appealReviewer) revert InvalidConfiguration();
        super.acceptOwnership();
    }

    /// @notice Ownership cannot be renounced, so silent ruling roles remain replaceable.
    function renounceOwnership() public override onlyOwner {
        revert OwnershipRenunciationDisabled();
    }

    /// @notice Creates an unfunded escrow authorized by both parties; anyone may relay it.
    function createEscrow(Agreement calldata a, bytes calldata buyerSig, bytes calldata sellerSig)
        external nonReentrant returns (uint256 escrowId)
    {
        if (block.timestamp > a.signDeadline) revert DeadlinePassed();
        if (a.buyer == address(0) || a.seller == address(0) || a.buyer == a.seller) revert InvalidParties();
        if (_isReservedParty(a.buyer) || _isReservedParty(a.seller)) revert InvalidParties();
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
        _finalizeCredits(id, e, e.buyerDeposit, e.price + e.sellerDeposit, 0);
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

    /// @notice Records an agreement-bound arbiter ruling without assigning credits or confirming fraud.
    function issuePreliminaryRuling(uint256 id, RulingInput calldata input) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != arbiter || msg.sender == e.buyer || msg.sender == e.seller) revert Unauthorized();
        if (e.state != State.Overdue && e.state != State.Disputed) revert InvalidState(e.state);
        _validateRuling(e, input);
        Ruling storage r = _rulings[id];
        r.issuedBy = msg.sender;
        r.issuedAt = block.timestamp.toUint64();
        r.appealDeadline = (block.timestamp + APPEAL_WINDOW).toUint64();
        r.input = input;
        e.state = State.PreliminaryRuling;
        _emitPreliminaryRuling(id, input, r.appealDeadline);
    }

    /// @notice Allows either party one appeal, including at the exact deadline second.
    function appeal(uint256 id, bytes32 reasonHash) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.buyer && msg.sender != e.seller) revert Unauthorized();
        _requireState(e, State.PreliminaryRuling);
        Ruling storage r = _rulings[id];
        if (r.appealed) revert AlreadyAppealed();
        if (block.timestamp > r.appealDeadline) revert DeadlinePassed();
        if (reasonHash == bytes32(0)) revert ZeroCommitment();
        r.appealed = true;
        r.appealedBy = msg.sender;
        r.appealedAt = block.timestamp.toUint64();
        r.appealReasonHash = reasonHash;
        e.state = State.Appealed;
        emit RulingAppealed(id, msg.sender, reasonHash);
    }

    /// @notice Finalizes an unappealed preliminary ruling strictly after its appeal deadline.
    /// @dev Stores the preliminary issuer and input as the effective outcome, then assigns the validated credits.
    function finalizeRuling(uint256 id) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        _requireState(e, State.PreliminaryRuling);
        Ruling storage r = _rulings[id];
        if (r.appealed) revert AlreadyAppealed();
        if (block.timestamp <= r.appealDeadline) revert DeadlineNotPassed();
        _finalizeRulingCredits(id, e, r.input, r.issuedBy, false);
        emit RulingFinalized(id, false);
    }

    /// @notice Decides an appealed case finally; the preliminary issuer and parties cannot review it.
    /// @dev Preserves the preliminary ruling and appeal history, and stores the effective decision in outcomeOf.
    function issueFinalRuling(uint256 id, RulingInput calldata input) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != appealReviewer || msg.sender == e.buyer || msg.sender == e.seller
            || msg.sender == _rulings[id].issuedBy) revert Unauthorized();
        _requireState(e, State.Appealed);
        _finalizeRulingCredits(id, e, input, msg.sender, true);
        _emitFinalRuling(id, input);
        emit RulingFinalized(id, true);
    }

    /// @notice Anchors a party's evidence hash and timestamp while a case is open; stores no evidence.
    function anchorEvidence(uint256 id, bytes32 evidenceHash) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.buyer && msg.sender != e.seller) revert Unauthorized();
        if (e.state != State.Overdue && e.state != State.Disputed
            && e.state != State.PreliminaryRuling && e.state != State.Appealed) revert InvalidState(e.state);
        if (evidenceHash == bytes32(0)) revert ZeroCommitment();
        emit EvidenceAnchored(id, msg.sender, evidenceHash, block.timestamp.toUint64());
    }

    /// @notice Executes a jointly signed price split, always refunding both deposits in full.
    function executeMutualSettlement(uint256 id, Settlement calldata s, bytes calldata buyerSig, bytes calldata sellerSig)
        external nonReentrant
    {
        Escrow storage e = _getEscrow(id);
        if (e.state != State.Active && e.state != State.Overdue && e.state != State.Disputed
            && e.state != State.PreliminaryRuling && e.state != State.Appealed) revert InvalidState(e.state);
        if (block.timestamp > s.deadline) revert DeadlinePassed();
        if (s.escrowId != id || s.nonce != e.settlementNonce || s.agreementHash != e.agreementHash
            || s.buyerPriceRefund > e.price) revert InvalidSettlement();
        _checkSignatures(e.buyer, e.seller, hashSettlement(s), buyerSig, sellerSig);
        ++e.settlementNonce;
        _finalizeCredits(id, e, s.buyerPriceRefund + e.buyerDeposit, (e.price - s.buyerPriceRefund) + e.sellerDeposit, 0);
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

    /// @notice Returns the preliminary ruling and appeal history, or zero fields before any ruling.
    /// @dev Nonexistent escrow IDs revert. Read outcomeOf for the effective final decision.
    function getRuling(uint256 id) external view returns (Ruling memory) {
        _getEscrow(id);
        return _rulings[id];
    }

    /// @notice Returns the effective ruling, or zero fields if no ruling finalized this escrow.
    /// @dev Mutual settlement and mutual completion do not create an outcome. Nonexistent IDs revert.
    function outcomeOf(uint256 id) external view returns (Outcome memory) {
        _getEscrow(id);
        return _outcomes[id];
    }

    /// @notice Returns confirmed fraud flags only for an escrow finalized through a ruling.
    /// @dev Returns false for both flags before finalization or after mutual settlement/completion; nonexistent IDs revert.
    function fraudConfirmed(uint256 id) external view returns (bool buyerFraud, bool sellerFraud) {
        Escrow storage e = _getEscrow(id);
        Outcome storage o = _outcomes[id];
        if (e.state != State.Finalized || o.decidedBy == address(0)) return (false, false);
        return (o.input.buyerFraud, o.input.sellerFraud);
    }

    /// @notice Validates a proposed ruling and returns buyer, seller and penalty wallet credits without changing state.
    /// @dev Uses the same validation as both ruling paths; nonexistent IDs and invalid inputs revert.
    function previewRuling(uint256 id, RulingInput calldata input)
        external view returns (uint256 buyerGets, uint256 sellerGets, uint256 penaltyGets)
    {
        return _validateRuling(_getEscrow(id), input);
    }

    /// @notice Returns whether either party can still appeal this preliminary ruling.
    function appealOpen(uint256 id) external view returns (bool) {
        Escrow storage e = _getEscrow(id);
        Ruling storage r = _rulings[id];
        return e.state == State.PreliminaryRuling && !r.appealed && block.timestamp <= r.appealDeadline;
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

    function _isReservedParty(address account) internal view returns (bool) {
        return account == owner() || account == arbiter || account == appealReviewer || account == penaltyWallet;
    }

    function _validateRuling(Escrow storage e, RulingInput memory input)
        internal view returns (uint256 buyerGets, uint256 sellerGets, uint256 penaltyGets)
    {
        if (input.agreementHash != e.agreementHash) revert RulingAgreementMismatch(e.agreementHash, input.agreementHash);
        if (input.reasonHash == bytes32(0) || input.evidenceRoot == bytes32(0)) revert ZeroCommitment();
        if (input.buyerPriceRefund > e.price) revert RulingRefundTooLarge(input.buyerPriceRefund, e.price);
        if (input.buyerDepositRefund > e.buyerDeposit) revert RulingRefundTooLarge(input.buyerDepositRefund, e.buyerDeposit);
        if (input.sellerDepositRefund > e.sellerDeposit) revert RulingRefundTooLarge(input.sellerDepositRefund, e.sellerDeposit);
        if (!input.buyerAtFault && input.buyerDepositRefund != e.buyerDeposit) {
            revert NonFaultPartyMustBeRefunded(true, input.buyerDepositRefund, e.buyerDeposit);
        }
        if (!input.sellerAtFault && input.sellerDepositRefund != e.sellerDeposit) {
            revert NonFaultPartyMustBeRefunded(false, input.sellerDepositRefund, e.sellerDeposit);
        }
        if (input.buyerFraud && !input.buyerAtFault) revert FraudRequiresFault(true);
        if (input.sellerFraud && !input.sellerAtFault) revert FraudRequiresFault(false);
        buyerGets = input.buyerPriceRefund + input.buyerDepositRefund;
        sellerGets = (e.price - input.buyerPriceRefund) + input.sellerDepositRefund;
        penaltyGets = (e.buyerDeposit - input.buyerDepositRefund) + (e.sellerDeposit - input.sellerDepositRefund);
        uint256 expectedTotal = e.price + e.buyerDeposit + e.sellerDeposit;
        uint256 proposedTotal = buyerGets + sellerGets + penaltyGets;
        if (proposedTotal != expectedTotal) revert ConservationViolation(expectedTotal, proposedTotal);
    }

    function _finalizeRulingCredits(
        uint256 id, Escrow storage e, RulingInput memory input, address decidedBy, bool byAppeal
    ) internal {
        (uint256 buyerGets, uint256 sellerGets, uint256 penaltyGets) = _validateRuling(e, input);
        Outcome storage o = _outcomes[id];
        o.decidedBy = decidedBy;
        o.decidedAt = block.timestamp.toUint64();
        o.byAppeal = byAppeal;
        o.input = input;
        _finalizeCredits(id, e, buyerGets, sellerGets, penaltyGets);
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
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            revert UnexpectedTransferAmount(amount, beforeBalance, afterBalance);
        }
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

    function _finalizeCredits(
        uint256 id, Escrow storage e, uint256 buyerAmount, uint256 sellerAmount, uint256 penaltyAmount
    ) internal {
        uint256 expectedTotal = e.price + e.buyerDeposit + e.sellerDeposit;
        uint256 proposedTotal = buyerAmount + sellerAmount + penaltyAmount;
        if (!e.buyerFunded || !e.sellerFunded || proposedTotal != expectedTotal) {
            revert ConservationViolation(expectedTotal, proposedTotal);
        }
        e.state = State.Finalized;
        if (buyerAmount > 0) _credit(id, e.buyer, buyerAmount);
        if (sellerAmount > 0) _credit(id, e.seller, sellerAmount);
        if (penaltyAmount > 0) _credit(id, penaltyWallet, penaltyAmount);
    }

    function _credit(uint256 id, address account, uint256 amount) internal {
        credits[id][account] += amount;
        emit CreditAssigned(id, account, amount);
    }

    function _emitPreliminaryRuling(uint256 id, RulingInput memory input, uint64 appealDeadline) internal {
        emit PreliminaryRulingIssued(id, msg.sender, input.buyerPriceRefund,
            input.buyerDepositRefund, input.sellerDepositRefund,
            input.buyerAtFault, input.sellerAtFault, input.buyerFraud, input.sellerFraud,
            input.reasonHash, input.evidenceRoot, appealDeadline);
    }

    function _emitFinalRuling(uint256 id, RulingInput memory input) internal {
        emit FinalRulingIssued(id, msg.sender, input.buyerPriceRefund,
            input.buyerDepositRefund, input.sellerDepositRefund,
            input.buyerAtFault, input.sellerAtFault, input.buyerFraud, input.sellerFraud,
            input.reasonHash, input.evidenceRoot);
    }

    function _emitCreated(uint256 id, Escrow storage e) internal {
        emit EscrowCreated(id, e.buyer, e.seller, e.agreementHash, e.policyHash, e.price,
            e.buyerDeposit, e.sellerDeposit, e.fundingDeadline, e.handoverDeadline,
            e.buyerResponseSeconds, e.inspectionSeconds);
    }
}
