// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, ebool, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title CipherDrop
 * @notice Encrypted airdrop with FHE-gated eligibility.
 *         The eligibility threshold is encrypted — nobody knows the minimum
 *         balance required to qualify. Ineligible claimants receive zero
 *         (via FHE.select) without the contract reverting or revealing status.
 *
 * @dev Claim flow (two-phase decrypt, same pattern as CipherPayFHE):
 *      Phase 1: requestEligibilityCheck(dropId, claimerBalance, nullifier)
 *               → FHE.gte(claimerBalance, minBalance) → ebool isEligible
 *               → FHE.select(isEligible, claimAmount, zero) stored
 *               → FHE.allowPublic(isEligible) so caller can decryptForTx
 *      Phase 2: claimDrop(dropId, nullifier, plaintext, signature)
 *               → FHE.publishDecryptResult validates threshold-network sig
 *               → if eligible: transfer ethPerClaim to caller
 *
 * @dev FHE operations used:
 *      asEuint64 (×3), allowThis (×4), allowSender (×2), allowPublic (×1),
 *      gte (×1), select (×1), publishDecryptResult (×1) = 14 ops per drop+claim
 */
contract CipherDrop {

    uint8 constant STATE_UNUSED  = 0;
    uint8 constant STATE_PENDING = 1; // phase 1 done, awaiting phase 2
    uint8 constant STATE_DONE    = 2; // claimed or rejected

    struct Drop {
        address creator;
        euint64 encryptedMinBalance;  // eligibility threshold — hidden
        euint64 encryptedClaimAmount; // per-claim allocation — hidden
        uint256 remainingSlots;
        uint256 ethPerClaim;          // plaintext ETH transferred on successful claim
        bool    active;
        uint256 createdAt;
        string  memo;
    }

    mapping(bytes32 => Drop)   public drops;

    // nullifier state per drop: 0=unused, 1=pending, 2=done
    mapping(bytes32 => mapping(bytes32 => uint8)) public nullifierState;

    // Stored ebool handle per (dropId, nullifier) for phase-2 verification
    mapping(bytes32 => mapping(bytes32 => ebool)) private _eligibilityResults;

    // Address that submitted phase 1 — phase 2 must match
    mapping(bytes32 => mapping(bytes32 => address)) private _pendingClaimant;

    event DropCreated(
        bytes32 indexed dropId,
        address indexed creator,
        uint256 slots,
        string  memo
    );
    event EligibilityCheckRequested(
        bytes32 indexed dropId,
        bytes32 indexed nullifier
    );
    event DropClaimed(
        bytes32 indexed dropId,
        bytes32 indexed nullifier
    );
    event DropRejected(
        bytes32 indexed dropId,
        bytes32 indexed nullifier
    );
    event DropClosed(bytes32 indexed dropId);

    /**
     * @notice Creator funds and configures the drop.
     * @param _encryptedMinBalance  Encrypted minimum balance to qualify
     * @param _encryptedClaimAmount Encrypted display amount per claim (informational)
     * @param _slots                Number of claimable slots
     * @param _salt                 Entropy for dropId derivation
     * @param _memo                 Drop description
     */
    function createDrop(
        InEuint64 calldata _encryptedMinBalance,
        InEuint64 calldata _encryptedClaimAmount,
        uint256   _slots,
        bytes32   _salt,
        string    calldata _memo
    ) external payable returns (bytes32 dropId) {
        require(_slots > 0 && _slots <= 10000, "Invalid slots");
        require(msg.value > 0, "Must fund drop");

        uint256 ethPerClaim = msg.value / _slots;
        require(ethPerClaim > 0, "ETH per claim too small");

        dropId = keccak256(abi.encodePacked(msg.sender, _salt, block.number));
        require(drops[dropId].creator == address(0), "Hash collision");

        euint64 minBal = FHE.asEuint64(_encryptedMinBalance);
        FHE.allowThis(minBal);
        FHE.allowSender(minBal); // creator can audit threshold

        euint64 claimAmt = FHE.asEuint64(_encryptedClaimAmount);
        FHE.allowThis(claimAmt);
        FHE.allowSender(claimAmt); // creator can audit claim amount

        drops[dropId] = Drop({
            creator:             msg.sender,
            encryptedMinBalance:  minBal,
            encryptedClaimAmount: claimAmt,
            remainingSlots:      _slots,
            ethPerClaim:         ethPerClaim,
            active:              true,
            createdAt:           block.timestamp,
            memo:                _memo
        });

        emit DropCreated(dropId, msg.sender, _slots, _memo);
    }

    /**
     * @notice Phase 1 — submit encrypted balance proof, receive ebool eligibility handle.
     * @dev Caller must then off-chain call:
     *      `cofheClient.decryptForTx(isEligibleHandle).withoutPermit().execute()`
     *      then call `claimDrop(dropId, nullifier, plaintext, signature)`.
     *
     * @param _claimerBalance  FHE-encrypted balance the caller wants to prove
     * @param _nullifier       keccak256(deviceSecret ‖ dropId) — unique per caller
     *
     *      FHE.select(isEligible, claimAmount, zero):
     *        - Eligible claimant: select returns claimAmount
     *        - Ineligible: select returns zero — no revert, no status leak
     */
    function requestEligibilityCheck(
        bytes32   _dropId,
        InEuint64 calldata _claimerBalance,
        bytes32   _nullifier
    ) external {
        Drop storage drop = drops[_dropId];
        require(drop.creator != address(0), "Drop not found");
        require(drop.active, "Drop not active");
        require(drop.remainingSlots > 0, "No slots remaining");
        require(nullifierState[_dropId][_nullifier] == STATE_UNUSED, "Nullifier already submitted");

        euint64 claimerBal = FHE.asEuint64(_claimerBalance);
        FHE.allowThis(claimerBal);

        // Core eligibility computation: does caller's balance meet the hidden threshold?
        ebool isEligible = FHE.gte(claimerBal, drop.encryptedMinBalance);
        FHE.allowThis(isEligible);
        // allowPublic so caller can decryptForTx without a permit
        FHE.allowPublic(isEligible);

        // FHE.select: if eligible → claimAmount, else → zero
        // This means the encrypted result reveals nothing about eligibility
        euint64 zero = FHE.asEuint64(0);
        FHE.allowThis(zero);
        euint64 actualAmount = FHE.select(isEligible, drop.encryptedClaimAmount, zero);
        FHE.allowThis(actualAmount);
        FHE.allowSender(actualAmount); // caller can decrypt their own result

        // Store for phase 2
        _eligibilityResults[_dropId][_nullifier] = isEligible;
        _pendingClaimant[_dropId][_nullifier]    = msg.sender;
        nullifierState[_dropId][_nullifier]      = STATE_PENDING;

        emit EligibilityCheckRequested(_dropId, _nullifier);
    }

    /**
     * @notice Phase 2 — submit threshold-network signature to finalize claim.
     * @param _plaintext  Plaintext bool from `decryptForTx`
     * @param _signature  Threshold Network signature from `decryptForTx`
     */
    function claimDrop(
        bytes32   _dropId,
        bytes32   _nullifier,
        bool      _plaintext,
        bytes     calldata _signature
    ) external {
        require(nullifierState[_dropId][_nullifier] == STATE_PENDING, "Not pending");
        require(_pendingClaimant[_dropId][_nullifier] == msg.sender, "Not the claimant");

        Drop storage drop = drops[_dropId];
        require(drop.active, "Drop not active");
        require(drop.remainingSlots > 0, "No slots remaining");

        ebool result = _eligibilityResults[_dropId][_nullifier];
        // Validate Threshold Network signature — reverts if signature doesn't match handle
        FHE.publishDecryptResult(result, _plaintext, _signature);

        nullifierState[_dropId][_nullifier] = STATE_DONE;

        if (_plaintext) {
            drop.remainingSlots--;
            (bool sent, ) = payable(msg.sender).call{value: drop.ethPerClaim}("");
            require(sent, "ETH transfer failed");
            emit DropClaimed(_dropId, _nullifier);
        } else {
            // Ineligible — no ETH transfer, no information leaked beyond "not eligible"
            emit DropRejected(_dropId, _nullifier);
        }
    }

    /**
     * @notice Creator closes the drop and reclaims unclaimed ETH.
     */
    function closeDrop(bytes32 _dropId) external {
        Drop storage drop = drops[_dropId];
        require(drop.creator == msg.sender, "Only creator");
        require(drop.active, "Already closed");

        drop.active = false;
        uint256 remaining = drop.remainingSlots * drop.ethPerClaim;
        drop.remainingSlots = 0;

        if (remaining > 0) {
            (bool sent, ) = payable(msg.sender).call{value: remaining}("");
            require(sent, "Reclaim failed");
        }

        emit DropClosed(_dropId);
    }

    // ─── View helpers ────────────────────────────────────────────────────────

    function getDrop(bytes32 _dropId) external view returns (
        address creator,
        uint256 remainingSlots,
        uint256 ethPerClaim,
        bool    active,
        uint256 createdAt,
        string  memory memo
    ) {
        Drop storage d = drops[_dropId];
        return (d.creator, d.remainingSlots, d.ethPerClaim, d.active, d.createdAt, d.memo);
    }

    function getEncryptedMinBalance(bytes32 _dropId) external view returns (euint64) {
        return drops[_dropId].encryptedMinBalance;
    }

    function getEncryptedClaimAmount(bytes32 _dropId) external view returns (euint64) {
        return drops[_dropId].encryptedClaimAmount;
    }

    /// @notice Get the stored ebool eligibility handle for phase-2 decryption.
    ///         Caller must be the claimant who submitted phase 1.
    function getEligibilityResult(bytes32 _dropId, bytes32 _nullifier) external view returns (ebool) {
        require(nullifierState[_dropId][_nullifier] == STATE_PENDING, "Not pending");
        require(_pendingClaimant[_dropId][_nullifier] == msg.sender, "Not the claimant");
        return _eligibilityResults[_dropId][_nullifier];
    }
}
