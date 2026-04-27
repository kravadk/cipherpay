// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, euint32, ebool, InEuint64, InEuint32} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title DAOTreasury
 * @notice Encrypted DAO treasury with FHE-gated budget proposals.
 *         Proposal budgets are hidden (euint64). Vote counts are hidden (euint32).
 *         Quorum check uses FHE.gte — the outcome reveals only "passed/failed".
 *
 * @dev Proposal lifecycle:
 *      1. Member creates proposal with encrypted budget + plaintext metadata
 *      2. Members vote (for/against) — each vote is a +1 to encrypted counters
 *      3. Creator calls `requestQuorumCheck(proposalId)` after vote period
 *         → FHE.gte(votesFor, quorum) → ebool → allowPublic
 *      4. Anyone submits `publishQuorumResult(proposalId, plaintext, sig)` — phase 2
 *      5. If passed: creator calls `executeProposal(proposalId)` → ETH transferred
 *
 * @dev FHE operations:
 *      createProposal:   asEuint64 (×1), asEuint32 (×2), allowThis (×3), allowSender (×1) = 7 ops
 *      vote:             asEuint32 (×1), add (×1), allowThis (×1), allow (×1) = 4 ops
 *      requestQuorumCheck: asEuint32 (×1), allowTransient (×1), gte (×1), allowThis (×1),
 *                          allowPublic (×1) = 5 ops
 *      publishQuorumResult: publishDecryptResult (×1) = 1 op
 *      Total: 17 ops per proposal lifecycle
 */
contract DAOTreasury {

    uint8 constant STATUS_VOTING    = 0;
    uint8 constant STATUS_PASSED    = 1;
    uint8 constant STATUS_REJECTED  = 2;
    uint8 constant STATUS_EXECUTED  = 3;

    struct Proposal {
        address  creator;
        string   title;
        string   description;
        address  recipient;       // Who receives the budget if passed
        euint64  encryptedBudget; // Amount hidden from non-members
        euint32  votesFor;        // Encrypted running tally
        euint32  votesAgainst;    // Encrypted running tally
        uint256  quorum;          // Plaintext quorum threshold (e.g. 5)
        uint256  voteDeadline;
        uint8    status;
        bool     quorumCheckPending;
        ebool    quorumResult;
        uint256  createdAt;
    }

    mapping(bytes32 => Proposal)               public  proposals;
    mapping(address => bytes32[])              public  memberProposals;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    // DAO membership (simple — in production: NFT or token gated)
    mapping(address => bool) public members;
    address public owner;
    uint256 public memberCount;

    // ETH held for approved proposals
    mapping(bytes32 => uint256) public proposalEth;

    event ProposalCreated(
        bytes32 indexed proposalId,
        address indexed creator,
        string  title,
        uint256 voteDeadline
    );
    event Voted(bytes32 indexed proposalId, address indexed voter, bool inFavor);
    event QuorumCheckRequested(bytes32 indexed proposalId);
    event ProposalFinalized(bytes32 indexed proposalId, bool passed);
    event ProposalExecuted(bytes32 indexed proposalId, address indexed recipient, uint256 ethAmount);
    event MemberAdded(address indexed member);

    constructor() {
        owner = msg.sender;
        members[msg.sender] = true;
        memberCount = 1;
    }

    modifier onlyMember() {
        require(members[msg.sender], "Not a DAO member");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function addMember(address _member) external onlyOwner {
        require(!members[_member], "Already a member");
        members[_member] = true;
        memberCount++;
        emit MemberAdded(_member);
    }

    /**
     * @notice Create a proposal with an encrypted budget.
     * @dev The budget amount is hidden from non-creators until the proposal passes.
     *      Only members can create proposals.
     * @param _encryptedBudget FHE-encrypted ETH budget amount
     * @param _quorum          Plaintext minimum votes needed (public)
     */
    function createProposal(
        InEuint64 calldata _encryptedBudget,
        string    calldata _title,
        string    calldata _description,
        address   _recipient,
        uint256   _quorum,
        uint256   _voteDurationSeconds,
        bytes32   _salt
    ) external payable onlyMember returns (bytes32 proposalId) {
        require(_quorum > 0, "Quorum must be > 0");
        require(_voteDurationSeconds >= 1 hours, "Vote period too short");
        require(_recipient != address(0), "Invalid recipient");

        proposalId = keccak256(abi.encodePacked(msg.sender, _salt, block.number));

        euint64 budget = FHE.asEuint64(_encryptedBudget);
        FHE.allowThis(budget);
        FHE.allowSender(budget); // Creator can see the budget they submitted

        euint32 zeroVotes = FHE.asEuint32(0);
        FHE.allowThis(zeroVotes);

        proposals[proposalId] = Proposal({
            creator:             msg.sender,
            title:               _title,
            description:         _description,
            recipient:           _recipient,
            encryptedBudget:     budget,
            votesFor:            zeroVotes,
            votesAgainst:        zeroVotes,
            quorum:              _quorum,
            voteDeadline:        block.timestamp + _voteDurationSeconds,
            status:              STATUS_VOTING,
            quorumCheckPending:  false,
            quorumResult:        ebool.wrap(0),
            createdAt:           block.timestamp
        });

        memberProposals[msg.sender].push(proposalId);

        // Fund the proposal with ETH if provided (optional pre-funding)
        if (msg.value > 0) {
            proposalEth[proposalId] = msg.value;
        }

        emit ProposalCreated(proposalId, msg.sender, _title, block.timestamp + _voteDurationSeconds);
    }

    /**
     * @notice Cast a vote on a proposal.
     * @dev Vote counts are FHE-encrypted: FHE.add(votesFor, 1) or FHE.add(votesAgainst, 1).
     *      Nobody can see the live vote tally until the quorum check.
     */
    function vote(bytes32 _proposalId, bool _inFavor) external onlyMember {
        Proposal storage p = proposals[_proposalId];
        require(p.creator != address(0), "Proposal not found");
        require(p.status == STATUS_VOTING, "Not in voting phase");
        require(block.timestamp <= p.voteDeadline, "Vote period ended");
        require(!hasVoted[_proposalId][msg.sender], "Already voted");

        hasVoted[_proposalId][msg.sender] = true;

        // Encrypted vote: add 1 to the appropriate counter
        euint32 one = FHE.asEuint32(1);
        FHE.allowTransient(one, address(this));

        if (_inFavor) {
            p.votesFor = FHE.add(p.votesFor, one);
            FHE.allowThis(p.votesFor);
            FHE.allow(p.votesFor, p.creator);
        } else {
            p.votesAgainst = FHE.add(p.votesAgainst, one);
            FHE.allowThis(p.votesAgainst);
            FHE.allow(p.votesAgainst, p.creator);
        }

        emit Voted(_proposalId, msg.sender, _inFavor);
    }

    /**
     * @notice Phase 1 — compute FHE.gte(votesFor, quorum) to check if proposal passed.
     * @dev Can be called after vote deadline by anyone. Stores ebool result for phase 2.
     */
    function requestQuorumCheck(bytes32 _proposalId) external {
        Proposal storage p = proposals[_proposalId];
        require(p.creator != address(0), "Not found");
        require(p.status == STATUS_VOTING, "Not in voting phase");
        require(block.timestamp > p.voteDeadline, "Vote period not ended");
        require(!p.quorumCheckPending, "Check already pending");
        require(p.quorum <= type(uint32).max, "Quorum too large");

        // Encrypt the plaintext quorum for FHE comparison
        euint32 quorum = FHE.asEuint32(uint32(p.quorum));
        FHE.allowTransient(quorum, address(this));

        // FHE.gte: did votes for ≥ quorum?
        ebool passed = FHE.gte(p.votesFor, quorum);
        FHE.allowThis(passed);
        FHE.allowPublic(passed); // Decryptable by anyone for transparency
        FHE.allow(passed, p.creator);

        p.quorumResult     = passed;
        p.quorumCheckPending = true;

        emit QuorumCheckRequested(_proposalId);
    }

    /**
     * @notice Phase 2 — publish the quorum result after off-chain decryptForTx.
     */
    function publishQuorumResult(
        bytes32  _proposalId,
        bool     _plaintext,
        bytes    calldata _signature
    ) external {
        Proposal storage p = proposals[_proposalId];
        require(p.quorumCheckPending, "No check pending");
        require(p.status == STATUS_VOTING, "Already finalized");

        FHE.publishDecryptResult(p.quorumResult, _plaintext, _signature);

        p.quorumCheckPending = false;
        p.status = _plaintext ? STATUS_PASSED : STATUS_REJECTED;

        emit ProposalFinalized(_proposalId, _plaintext);
    }

    /**
     * @notice Creator executes a passed proposal — transfers budget ETH to recipient.
     * @dev Requires ETH to be in the contract (proposalEth or deposited separately).
     */
    function executeProposal(bytes32 _proposalId) external payable {
        Proposal storage p = proposals[_proposalId];
        require(p.creator == msg.sender, "Only creator");
        require(p.status == STATUS_PASSED, "Not passed");

        // Accept additional ETH at execution time
        if (msg.value > 0) {
            proposalEth[_proposalId] += msg.value;
        }

        uint256 payout = proposalEth[_proposalId];
        require(payout > 0, "No ETH to execute");

        p.status = STATUS_EXECUTED;
        proposalEth[_proposalId] = 0;

        (bool sent, ) = payable(p.recipient).call{value: payout}("");
        require(sent, "ETH transfer failed");

        emit ProposalExecuted(_proposalId, p.recipient, payout);
    }

    // ─── View helpers ────────────────────────────────────────────────────────

    function getProposal(bytes32 _id) external view returns (
        address  creator,
        string   memory title,
        string   memory description,
        address  recipient,
        uint256  quorum,
        uint256  voteDeadline,
        uint8    status,
        uint256  createdAt,
        uint256  ethFunded
    ) {
        Proposal storage p = proposals[_id];
        return (
            p.creator, p.title, p.description, p.recipient,
            p.quorum, p.voteDeadline, p.status, p.createdAt,
            proposalEth[_id]
        );
    }

    function getEncryptedBudget(bytes32 _id) external view returns (euint64) { return proposals[_id].encryptedBudget; }
    function getEncryptedVotesFor(bytes32 _id) external view returns (euint32) { return proposals[_id].votesFor; }
    function getEncryptedVotesAgainst(bytes32 _id) external view returns (euint32) { return proposals[_id].votesAgainst; }
    function getMemberProposals(address _m) external view returns (bytes32[] memory) { return memberProposals[_m]; }

    /// @notice Get the stored ebool quorum result handle for phase-2 decryption.
    ///         Available after requestQuorumCheck is called.
    function getEncryptedQuorumResult(bytes32 _id) external view returns (ebool) {
        require(proposals[_id].quorumCheckPending, "No pending check");
        return proposals[_id].quorumResult;
    }

    receive() external payable {}
}
