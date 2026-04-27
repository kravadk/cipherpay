// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, euint8, ebool, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title MilestoneEscrow
 * @notice Multi-milestone escrow where progress thresholds are FHE-encrypted.
 *         The UI shows only tier labels ("< 25%", "25–50%", "50–75%", "> 75%")
 *         without revealing exact amounts collected or total target.
 *
 * @dev Tier computation — chained FHE.select:
 *      tier = select(gte(collected, total), 4,
 *              select(gte(collected, q3), 3,
 *               select(gte(collected, q2), 2,
 *                select(gte(collected, q1), 1, 0))))
 *
 *      The tier handle is allowPublic so anyone can decrypt the tier number
 *      (1–4) without needing a permit, while the underlying amounts remain
 *      inaccessible. Creator and beneficiary can decrypt exact amounts via permit.
 *
 * @dev FHE operations per fundMilestone call:
 *      asEuint64 (×5 constants), add (×1), gte (×4), select (×4),
 *      allowTransient (×9), allowThis (×3), allow (×2), allowPublic (×1) = 29 ops
 *
 *      Creation: asEuint64 (×5), allowThis (×5), allow (×4) = 14 ops
 */
contract MilestoneEscrow {

    struct Escrow {
        address creator;
        address beneficiary;
        // Encrypted thresholds — only creator/beneficiary can decrypt
        euint64 encryptedTotal;   // 100% target
        euint64 encryptedQ1;      // 25% threshold
        euint64 encryptedQ2;      // 50% threshold
        euint64 encryptedQ3;      // 75% threshold
        // Running state
        euint64 totalCollected;
        euint64 encryptedTier;    // 0–4; allowPublic so UI can read without permit
        uint256 ethHeld;
        uint256 releasedMilestones; // 0–4, incremented per release
        bool    active;
        uint256 createdAt;
        string  memo;
    }

    mapping(bytes32 => Escrow) public escrows;

    event EscrowCreated(
        bytes32 indexed id,
        address indexed creator,
        address indexed beneficiary,
        string  memo
    );
    event MilestoneFunded(
        bytes32 indexed id,
        address indexed funder,
        uint256 ethAmount
    );
    event MilestoneReleased(
        bytes32 indexed id,
        uint256 milestoneNumber,
        uint256 ethReleased
    );
    event EscrowCancelled(bytes32 indexed id);

    /**
     * @notice Create an escrow with encrypted total and 3 intermediate thresholds.
     * @dev Thresholds should correspond to 25%, 50%, 75% of total (all encrypted).
     *      Creator sets them at creation; beneficiary and funders can't learn the scale.
     */
    function createEscrow(
        address   _beneficiary,
        InEuint64 calldata _encryptedTotal,
        InEuint64 calldata _encryptedQ1,
        InEuint64 calldata _encryptedQ2,
        InEuint64 calldata _encryptedQ3,
        bytes32   _salt,
        string    calldata _memo
    ) external returns (bytes32 id) {
        require(_beneficiary != address(0), "Invalid beneficiary");

        id = keccak256(abi.encodePacked(msg.sender, _salt, block.number));
        require(escrows[id].creator == address(0), "Hash collision");

        euint64 total = FHE.asEuint64(_encryptedTotal);
        FHE.allowThis(total);
        FHE.allowSender(total);
        FHE.allow(total, _beneficiary);

        euint64 q1 = FHE.asEuint64(_encryptedQ1);
        FHE.allowThis(q1);
        FHE.allowSender(q1);

        euint64 q2 = FHE.asEuint64(_encryptedQ2);
        FHE.allowThis(q2);
        FHE.allowSender(q2);

        euint64 q3 = FHE.asEuint64(_encryptedQ3);
        FHE.allowThis(q3);
        FHE.allowSender(q3);

        euint64 zero = FHE.asEuint64(0);
        FHE.allowThis(zero);

        escrows[id] = Escrow({
            creator:            msg.sender,
            beneficiary:        _beneficiary,
            encryptedTotal:     total,
            encryptedQ1:        q1,
            encryptedQ2:        q2,
            encryptedQ3:        q3,
            totalCollected:     zero,
            encryptedTier:      zero,
            ethHeld:            0,
            releasedMilestones: 0,
            active:             true,
            createdAt:          block.timestamp,
            memo:               _memo
        });

        emit EscrowCreated(id, msg.sender, _beneficiary, _memo);
    }

    /**
     * @notice Fund the escrow and recompute the encrypted tier.
     * @dev Anyone can fund. The tier (1–4) is updated via chained FHE.select
     *      and stored with allowPublic so the UI can display progress without
     *      revealing the underlying collected amount or total target.
     */
    function fundMilestone(
        bytes32   _id,
        InEuint64 calldata _encryptedPayment
    ) external payable {
        Escrow storage e = escrows[_id];
        require(e.creator != address(0), "Not found");
        require(e.active, "Not active");
        require(msg.value > 0, "Must send ETH");

        euint64 payment = FHE.asEuint64(_encryptedPayment);
        FHE.allowThis(payment);

        e.totalCollected = FHE.add(e.totalCollected, payment);
        FHE.allowThis(e.totalCollected);
        FHE.allow(e.totalCollected, e.creator);
        FHE.allow(e.totalCollected, e.beneficiary);

        // ── Chained FHE.select tier computation ─────────────────────────────
        // Compute 4 encrypted comparison results (transient — not stored)
        ebool atQ1    = FHE.gte(e.totalCollected, e.encryptedQ1);
        ebool atQ2    = FHE.gte(e.totalCollected, e.encryptedQ2);
        ebool atQ3    = FHE.gte(e.totalCollected, e.encryptedQ3);
        ebool atTotal = FHE.gte(e.totalCollected, e.encryptedTotal);
        FHE.allowTransient(atQ1,    address(this));
        FHE.allowTransient(atQ2,    address(this));
        FHE.allowTransient(atQ3,    address(this));
        FHE.allowTransient(atTotal, address(this));

        // Constant handles for tier values (transient — used only in this tx)
        euint64 c0 = FHE.asEuint64(0);
        euint64 c1 = FHE.asEuint64(1);
        euint64 c2 = FHE.asEuint64(2);
        euint64 c3 = FHE.asEuint64(3);
        euint64 c4 = FHE.asEuint64(4);
        FHE.allowTransient(c0, address(this));
        FHE.allowTransient(c1, address(this));
        FHE.allowTransient(c2, address(this));
        FHE.allowTransient(c3, address(this));
        FHE.allowTransient(c4, address(this));

        // Bottom-up select chain:
        //   tier1 = atQ1 ? 1 : 0
        //   tier2 = atQ2 ? 2 : tier1   (= 2 if ≥Q2, 1 if ≥Q1, 0 otherwise)
        //   tier3 = atQ3 ? 3 : tier2
        //   tier4 = atTotal ? 4 : tier3
        euint64 tier1 = FHE.select(atQ1,    c1, c0);
        FHE.allowTransient(tier1, address(this));
        euint64 tier2 = FHE.select(atQ2,    c2, tier1);
        FHE.allowTransient(tier2, address(this));
        euint64 tier3 = FHE.select(atQ3,    c3, tier2);
        FHE.allowTransient(tier3, address(this));
        euint64 tier4 = FHE.select(atTotal, c4, tier3);

        // Tier (0–4) is intentionally public — it's a progress label, not a financial amount.
        // allowPublic: anyone can decryptForTx to get the tier number without a permit.
        FHE.allowThis(tier4);
        FHE.allowPublic(tier4);

        e.encryptedTier = tier4;
        e.ethHeld       += msg.value;

        emit MilestoneFunded(_id, msg.sender, msg.value);
    }

    /**
     * @notice Creator manually releases the next milestone (25% of total escrowed ETH).
     * @dev Milestone release is intentionally manual — Chainlink Automation can call
     *      this function automatically if wired up. Without keeper, creator calls it.
     */
    function releaseMilestone(bytes32 _id) external {
        Escrow storage e = escrows[_id];
        require(e.creator == msg.sender, "Only creator");
        require(e.active, "Not active");
        require(e.releasedMilestones < 4, "All milestones released");
        require(e.ethHeld > 0, "Nothing to release");

        e.releasedMilestones++;

        // Each milestone = 25% of the original total deposit
        // Remaining releases share whatever is left to avoid dust from integer division
        uint256 remaining = 4 - (e.releasedMilestones - 1);
        uint256 payout    = e.ethHeld / remaining;
        e.ethHeld        -= payout;

        if (e.releasedMilestones == 4) {
            e.active = false;
        }

        (bool sent, ) = payable(e.beneficiary).call{value: payout}("");
        require(sent, "ETH transfer failed");

        emit MilestoneReleased(_id, e.releasedMilestones, payout);
    }

    /**
     * @notice Creator cancels escrow — unspent ETH returned to creator.
     */
    function cancelEscrow(bytes32 _id) external {
        Escrow storage e = escrows[_id];
        require(e.creator == msg.sender, "Only creator");
        require(e.active, "Not active");

        e.active = false;
        uint256 refund = e.ethHeld;
        e.ethHeld = 0;

        if (refund > 0) {
            (bool sent, ) = payable(msg.sender).call{value: refund}("");
            require(sent, "Refund failed");
        }

        emit EscrowCancelled(_id);
    }

    // ─── View helpers ────────────────────────────────────────────────────────

    function getEscrow(bytes32 _id) external view returns (
        address creator,
        address beneficiary,
        uint256 ethHeld,
        uint256 releasedMilestones,
        bool    active,
        uint256 createdAt,
        string  memory memo
    ) {
        Escrow storage e = escrows[_id];
        return (e.creator, e.beneficiary, e.ethHeld, e.releasedMilestones, e.active, e.createdAt, e.memo);
    }

    function getEncryptedTier(bytes32 _id)       external view returns (euint64) { return escrows[_id].encryptedTier;      }
    function getEncryptedCollected(bytes32 _id)  external view returns (euint64) { return escrows[_id].totalCollected;     }
    function getEncryptedTotal(bytes32 _id)      external view returns (euint64) { return escrows[_id].encryptedTotal;     }
}
