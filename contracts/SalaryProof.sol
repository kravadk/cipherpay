// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, ebool, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title SalaryProof
 * @notice Prove "income ≥ X" without revealing the actual income amount.
 *         Used for: credit scoring, DAO voting weight, rental applications,
 *         KYC-less income verification, DeFi collateral checks.
 *
 * @dev Proof flow (two-phase decrypt):
 *      1. Verifier calls `requestProof(subject, threshold)` — not the subject themselves,
 *         so the subject can't game the threshold.
 *         OR the subject calls `selfProveSalary(threshold)`.
 *      2. FHE.gte(subjectIncome, threshold) → ebool → FHE.allowPublic
 *      3. Off-chain: `decryptForTx(handle)` → (plaintext, signature)
 *      4. `publishProof(proofId, plaintext, signature)` → result stored on-chain
 *      5. `getProofResult(proofId)` — anyone can verify the boolean proof
 *
 * @dev The proof is a signed boolean: "income ≥ X: true" (or false).
 *      No amount, no recipient, no history is revealed. The threshold X is in the proof
 *      metadata so verifiers know what was proven. Only the income stays hidden.
 *
 * @dev FHE operations per proof:
 *      recordIncome: asEuint64 (×1), allowThis (×1), allowSender (×1) = 3 ops
 *      selfProveSalary: asEuint64 (×1), allowTransient (×1), gte (×1), allowThis (×1),
 *                       allowPublic (×1) = 5 ops
 *      publishProof: publishDecryptResult (×1) = 1 op
 *      Total: 9 ops per proof (plus 3 for initial recordIncome)
 */
contract SalaryProof {

    struct IncomeRecord {
        euint64 encryptedIncome; // Hidden from all except the subject
        uint256 recordedAt;
        address subject;
    }

    struct Proof {
        address subject;
        address verifier;       // Who requested the proof (may be subject themselves)
        uint256 threshold;      // Public: what threshold was proven (in wei equivalent)
        string  thresholdLabel; // Human-readable: "≥ 50,000 USD/yr" etc.
        uint256 requestedAt;
        bool    resultReady;
        bool    result;         // true = income ≥ threshold
        ebool   encryptedResult; // Raw handle for FHE.publishDecryptResult
    }

    mapping(address => IncomeRecord) private _incomes;
    mapping(bytes32 => Proof)        public  proofs;
    // Proofs per subject, for UX
    mapping(address => bytes32[])    public  subjectProofs;

    event IncomeRecorded(address indexed subject, uint256 recordedAt);
    event ProofRequested(
        bytes32 indexed proofId,
        address indexed subject,
        address indexed verifier,
        uint256 threshold,
        string  thresholdLabel
    );
    event ProofPublished(bytes32 indexed proofId, bool result);

    /**
     * @notice Subject records their encrypted income. Only they can update it.
     * @dev The income is stored as euint64. The subject is the only one who can
     *      decrypt it (via FHE.allowSender). The contract holds the handle for
     *      FHE.gte comparisons.
     */
    function recordIncome(InEuint64 calldata _encryptedIncome) external {
        euint64 income = FHE.asEuint64(_encryptedIncome);
        FHE.allowThis(income);
        FHE.allowSender(income); // Only subject can decrypt their own income

        _incomes[msg.sender] = IncomeRecord({
            encryptedIncome: income,
            recordedAt:      block.timestamp,
            subject:         msg.sender
        });

        emit IncomeRecorded(msg.sender, block.timestamp);
    }

    /**
     * @notice Subject proves their own income against a threshold.
     *         The proof result (boolean) is made publicly decryptable.
     * @param _threshold  Plaintext threshold in wei — verifiers know what was proven
     * @param _label      Human-readable label: "income ≥ $50K/yr"
     * @return proofId    Unique ID for this proof instance
     */
    function selfProveSalary(
        uint256 _threshold,
        string calldata _label
    ) external returns (bytes32 proofId) {
        require(_threshold > 0, "Threshold must be > 0");
        IncomeRecord storage rec = _incomes[msg.sender];
        require(rec.subject == msg.sender, "No income recorded");

        proofId = keccak256(abi.encodePacked(msg.sender, _threshold, block.number, block.timestamp));

        // Encrypt the plaintext threshold for FHE comparison
        euint64 threshold = FHE.asEuint64(_threshold);
        FHE.allowTransient(threshold, address(this));

        // Core proof computation: is income >= threshold?
        ebool result = FHE.gte(rec.encryptedIncome, threshold);
        FHE.allowThis(result);
        // allowPublic: anyone can decryptForTx to verify the boolean
        FHE.allowPublic(result);

        proofs[proofId] = Proof({
            subject:         msg.sender,
            verifier:        msg.sender,
            threshold:       _threshold,
            thresholdLabel:  _label,
            requestedAt:     block.timestamp,
            resultReady:     false,
            result:          false,
            encryptedResult: result
        });

        subjectProofs[msg.sender].push(proofId);

        emit ProofRequested(proofId, msg.sender, msg.sender, _threshold, _label);
    }

    /**
     * @notice Third-party verifier requests a proof for a subject.
     *         Subject must have already recorded their income.
     * @dev Verifier picks the threshold — subject can't game it by knowing the value first.
     */
    function requestVerifierProof(
        address _subject,
        uint256 _threshold,
        string calldata _label
    ) external returns (bytes32 proofId) {
        require(_threshold > 0, "Threshold must be > 0");
        require(_subject != address(0), "Invalid subject");
        IncomeRecord storage rec = _incomes[_subject];
        require(rec.subject == _subject, "Subject has no income record");

        proofId = keccak256(abi.encodePacked(_subject, msg.sender, _threshold, block.number));

        euint64 threshold = FHE.asEuint64(_threshold);
        FHE.allowTransient(threshold, address(this));

        ebool result = FHE.gte(rec.encryptedIncome, threshold);
        FHE.allowThis(result);
        FHE.allowPublic(result);
        FHE.allow(result, msg.sender); // Verifier can also decrypt via permit

        proofs[proofId] = Proof({
            subject:         _subject,
            verifier:        msg.sender,
            threshold:       _threshold,
            thresholdLabel:  _label,
            requestedAt:     block.timestamp,
            resultReady:     false,
            result:          false,
            encryptedResult: result
        });

        subjectProofs[_subject].push(proofId);

        emit ProofRequested(proofId, _subject, msg.sender, _threshold, _label);
    }

    /**
     * @notice Phase 2 — publish the Threshold Network decryption result on-chain.
     *         After this, `getProofResult(proofId)` returns the plaintext boolean.
     * @param _plaintext  Plaintext bool from `decryptForTx`
     * @param _signature  Threshold Network signature from `decryptForTx`
     */
    function publishProof(
        bytes32  _proofId,
        bool     _plaintext,
        bytes    calldata _signature
    ) external {
        Proof storage p = proofs[_proofId];
        require(p.subject != address(0), "Proof not found");
        require(!p.resultReady, "Already published");

        FHE.publishDecryptResult(p.encryptedResult, _plaintext, _signature);

        p.resultReady = true;
        p.result      = _plaintext;

        emit ProofPublished(_proofId, _plaintext);
    }

    // ─── View helpers ────────────────────────────────────────────────────────

    function getProof(bytes32 _proofId) external view returns (
        address subject,
        address verifier,
        uint256 threshold,
        string  memory thresholdLabel,
        uint256 requestedAt,
        bool    resultReady,
        bool    result
    ) {
        Proof storage p = proofs[_proofId];
        return (
            p.subject, p.verifier, p.threshold, p.thresholdLabel,
            p.requestedAt, p.resultReady, p.result
        );
    }

    function getEncryptedProofResult(bytes32 _proofId) external view returns (ebool) {
        return proofs[_proofId].encryptedResult;
    }

    function getSubjectProofs(address _subject) external view returns (bytes32[] memory) {
        return subjectProofs[_subject];
    }

    function hasIncomeRecord(address _subject) external view returns (bool) {
        return _incomes[_subject].subject == _subject;
    }

    function getIncomeRecordedAt(address _subject) external view returns (uint256) {
        return _incomes[_subject].recordedAt;
    }

    function getEncryptedIncome(address _subject) external view returns (euint64) {
        require(msg.sender == _subject, "Only subject");
        return _incomes[_subject].encryptedIncome;
    }
}
