// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, euint8, ebool, InEuint64, InEuint8} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title RecurringScheduler
 * @notice FHE-encrypted recurring payment schedule. The frequency label
 *         (daily / weekly / biweekly / monthly) is stored as euint8 — nobody
 *         can see the payment cadence on Etherscan. The next-due block is stored
 *         as euint64 — nobody can predict when the next payment will trigger.
 *
 * @dev Payment trigger flow (Chainlink Automation compatible):
 *      1. Any address calls `triggerPayment(id)`
 *         → FHE.gte(currentBlock, encryptedNextDue) → ebool isDue
 *         → FHE.allowPublic(isDue) so claimant can decryptForTx
 *      2. Claimant off-chain: `cofheClient.decryptForTx(isDueHandle).execute()`
 *      3. Claimant calls `publishPaymentResult(id, plaintext, signature)`
 *         → FHE.publishDecryptResult validates threshold-network signature
 *         → if isDue: transfer ethPerPeriod to beneficiary, advance encryptedNextDue
 *
 *      Chainlink Automation integration:
 *        checkUpkeep: return upkeepNeeded=true always (FHE.gte is the actual check)
 *        performUpkeep: calls triggerPayment(id) then handles phase 2 via off-chain bot
 *
 * @dev FHE operations per schedule:
 *      Create: asEuint8 (×1), asEuint64 (×2), allowThis (×3), allowSender (×3),
 *              allow (×2) = 11 ops
 *      Trigger: asEuint64 (×1), allowTransient (×1), gte (×1), allowThis (×1),
 *               allowPublic (×1) = 5 ops
 *      Publish + advance: publishDecryptResult (×1), add (×1), allowThis (×1),
 *                         allowSender (×1), allow (×1) = 5 ops
 *      Total per period: 21 ops (plus 11 creation) = 21N + 11 for N periods
 */
contract RecurringScheduler {

    // Frequency labels (stored encrypted as euint8 — the label is hidden)
    uint8 constant FREQ_DAILY    = 0;
    uint8 constant FREQ_WEEKLY   = 1;
    uint8 constant FREQ_BIWEEKLY = 2;
    uint8 constant FREQ_MONTHLY  = 3;

    struct Schedule {
        address creator;
        address beneficiary;
        euint8  encryptedFrequency; // semantic label — hidden
        euint64 encryptedNextDue;   // next due block — hidden
        euint64 encryptedAmount;    // per-period amount — hidden
        uint256 blockInterval;      // plaintext interval in blocks (computable from freq)
        uint256 ethPerPeriod;
        uint256 totalPeriods;
        uint256 claimedPeriods;
        uint256 ethEscrowed;
        bool    active;
        uint256 createdAt;
        string  memo;
    }

    mapping(bytes32 => Schedule) public schedules;
    // Stored isDue handle for phase-2 verification
    mapping(bytes32 => ebool) private _isDueResult;
    // Tracks who called triggerPayment to verify phase-2 caller
    mapping(bytes32 => address) private _triggerCaller;

    event ScheduleCreated(
        bytes32 indexed id,
        address indexed creator,
        address indexed beneficiary,
        uint256 totalPeriods,
        string  memo
    );
    event PaymentTriggered(bytes32 indexed id);
    event PaymentExecuted(
        bytes32 indexed id,
        uint256 periodsClaimedSoFar,
        uint256 ethPaid
    );
    event ScheduleCompleted(bytes32 indexed id);
    event ScheduleCancelled(bytes32 indexed id);

    /**
     * @notice Create a recurring payment schedule.
     * @param _beneficiary          Receives ETH each period
     * @param _encryptedFrequency   Encrypted frequency label (FREQ_DAILY etc.)
     * @param _encryptedAmount      Encrypted per-period display amount
     * @param _totalPeriods         Number of payment periods
     * @param _blockInterval        Plaintext block count between payments
     *                              (must match encrypted frequency semantically)
     * @param _salt                 Entropy for id derivation
     */
    function createSchedule(
        address   _beneficiary,
        InEuint8  calldata _encryptedFrequency,
        InEuint64 calldata _encryptedAmount,
        uint256   _totalPeriods,
        uint256   _blockInterval,
        bytes32   _salt,
        string    calldata _memo
    ) external payable returns (bytes32 id) {
        require(_beneficiary != address(0), "Invalid beneficiary");
        require(_totalPeriods > 0, "At least 1 period");
        require(_blockInterval >= 100, "Interval too short"); // ~14 min min
        require(msg.value > 0, "Must fund schedule");

        uint256 ethPerPeriod = msg.value / _totalPeriods;
        require(ethPerPeriod > 0, "ETH per period too small");

        id = keccak256(abi.encodePacked(msg.sender, _salt, block.number));
        require(schedules[id].creator == address(0), "Hash collision");

        // Encrypted frequency — nobody sees the cadence label
        euint8 freq = FHE.asEuint8(_encryptedFrequency);
        FHE.allowThis(freq);
        FHE.allowSender(freq);
        FHE.allow(freq, _beneficiary);

        // Encrypted per-period amount
        euint64 amount = FHE.asEuint64(_encryptedAmount);
        FHE.allowThis(amount);
        FHE.allowSender(amount);
        FHE.allow(amount, _beneficiary);

        // First due block stored encrypted — observer can't predict when payment fires
        uint256 firstDue = block.number + _blockInterval;
        euint64 nextDue  = FHE.asEuint64(uint64(firstDue));
        FHE.allowThis(nextDue);
        FHE.allowSender(nextDue);
        FHE.allow(nextDue, _beneficiary);

        schedules[id] = Schedule({
            creator:            msg.sender,
            beneficiary:        _beneficiary,
            encryptedFrequency: freq,
            encryptedNextDue:   nextDue,
            encryptedAmount:    amount,
            blockInterval:      _blockInterval,
            ethPerPeriod:       ethPerPeriod,
            totalPeriods:       _totalPeriods,
            claimedPeriods:     0,
            ethEscrowed:        msg.value,
            active:             true,
            createdAt:          block.timestamp,
            memo:               _memo
        });

        emit ScheduleCreated(id, msg.sender, _beneficiary, _totalPeriods, _memo);
    }

    /**
     * @notice Phase 1 — check if next payment is due without revealing when.
     * @dev Chainlink Automation calls this via performUpkeep. Manual callers
     *      must follow up with publishPaymentResult.
     *
     *      FHE.gte(currentBlock, encryptedNextDue):
     *        - currentBlock is public, but nextDue is encrypted
     *        - The result (isDue) is encrypted; only allowPublic enables decryptForTx
     *        - Etherscan sees only that triggerPayment was called — not the due block
     */
    function triggerPayment(bytes32 _id) external {
        Schedule storage sched = schedules[_id];
        require(sched.creator != address(0), "Not found");
        require(sched.active, "Not active");
        require(sched.claimedPeriods < sched.totalPeriods, "All periods claimed");

        euint64 currentBlock = FHE.asEuint64(uint64(block.number));
        FHE.allowTransient(currentBlock, address(this));

        // Core FHE clock: is the payment due this block?
        ebool isDue = FHE.gte(currentBlock, sched.encryptedNextDue);
        FHE.allowThis(isDue);
        // allowPublic so the caller can decryptForTx without a permit
        FHE.allowPublic(isDue);

        _isDueResult[_id]   = isDue;
        _triggerCaller[_id] = msg.sender;

        emit PaymentTriggered(_id);
    }

    /**
     * @notice Phase 2 — submit threshold-network proof that payment is due.
     * @dev After triggerPayment: off-chain `decryptForTx(isDueHandle).execute()`
     *      returns (plaintext, signature). Submit here to execute payment.
     */
    function publishPaymentResult(
        bytes32  _id,
        bool     _plaintext,
        bytes    calldata _signature
    ) external {
        Schedule storage sched = schedules[_id];
        require(sched.active, "Not active");
        require(sched.claimedPeriods < sched.totalPeriods, "All periods claimed");

        ebool result = _isDueResult[_id];
        require(ebool.unwrap(result) != 0, "No trigger pending");

        // Validate threshold-network signature — reverts if forged
        FHE.publishDecryptResult(result, _plaintext, _signature);

        // Clear trigger state
        _isDueResult[_id]   = ebool.wrap(0);
        _triggerCaller[_id] = address(0);

        if (!_plaintext) {
            // Payment not yet due — nothing to do
            return;
        }

        _executePayment(_id);
    }

    function _executePayment(bytes32 _id) internal {
        Schedule storage sched = schedules[_id];
        require(sched.ethEscrowed >= sched.ethPerPeriod, "Insufficient escrow");

        sched.claimedPeriods++;
        sched.ethEscrowed -= sched.ethPerPeriod;

        // Advance the encrypted next-due block by one interval
        // FHE.add(nextDue, blockInterval) keeps the next due block encrypted
        euint64 interval = FHE.asEuint64(uint64(sched.blockInterval));
        FHE.allowTransient(interval, address(this));

        euint64 newNextDue = FHE.add(sched.encryptedNextDue, interval);
        FHE.allowThis(newNextDue);
        FHE.allowSender(newNextDue);
        FHE.allow(newNextDue, sched.beneficiary);
        sched.encryptedNextDue = newNextDue;

        uint256 payout = sched.ethPerPeriod;

        if (sched.claimedPeriods == sched.totalPeriods) {
            // Last period — send any remaining dust too
            payout    = payout + sched.ethEscrowed;
            sched.ethEscrowed = 0;
            sched.active      = false;
            emit ScheduleCompleted(_id);
        }

        (bool sent, ) = payable(sched.beneficiary).call{value: payout}("");
        require(sent, "Payment failed");

        emit PaymentExecuted(_id, sched.claimedPeriods, payout);
    }

    /**
     * @notice Creator cancels schedule — remaining escrowed ETH refunded.
     */
    function cancelSchedule(bytes32 _id) external {
        Schedule storage sched = schedules[_id];
        require(sched.creator == msg.sender, "Only creator");
        require(sched.active, "Not active");

        sched.active = false;
        uint256 refund = sched.ethEscrowed;
        sched.ethEscrowed = 0;

        if (refund > 0) {
            (bool sent, ) = payable(msg.sender).call{value: refund}("");
            require(sent, "Refund failed");
        }

        emit ScheduleCancelled(_id);
    }

    // ─── View helpers ────────────────────────────────────────────────────────

    function getSchedule(bytes32 _id) external view returns (
        address creator,
        address beneficiary,
        uint256 totalPeriods,
        uint256 claimedPeriods,
        uint256 ethPerPeriod,
        uint256 ethEscrowed,
        bool    active,
        uint256 createdAt,
        string  memory memo
    ) {
        Schedule storage s = schedules[_id];
        return (
            s.creator, s.beneficiary, s.totalPeriods, s.claimedPeriods,
            s.ethPerPeriod, s.ethEscrowed, s.active, s.createdAt, s.memo
        );
    }

    function getEncryptedFrequency(bytes32 _id) external view returns (euint8)  { return schedules[_id].encryptedFrequency; }
    function getEncryptedNextDue(bytes32 _id)   external view returns (euint64) { return schedules[_id].encryptedNextDue;   }
    function getEncryptedAmount(bytes32 _id)    external view returns (euint64) { return schedules[_id].encryptedAmount;    }

    /// @notice Get the stored isDue ebool handle for phase-2 decryption.
    ///         Available after triggerPayment is called.
    function getIsDueResult(bytes32 _id) external view returns (ebool) {
        require(ebool.unwrap(_isDueResult[_id]) != 0, "No pending trigger");
        return _isDueResult[_id];
    }
}
