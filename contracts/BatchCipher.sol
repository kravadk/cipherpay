// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title BatchCipher
 * @notice Private batch payroll and airdrop — creator sends N encrypted amounts
 *         to N recipients in one transaction. Each recipient's amount is hidden
 *         from all other recipients via per-row FHE ACL.
 *
 * @dev FHE operations:
 *      - asEuint64          per-row amount conversion
 *      - allowThis          contract can compute on amounts
 *      - allowSender        creator can decrypt all row amounts
 *      - allow(amount, r)   each recipient decrypts only their own row
 *
 *      Privacy model:
 *        - Recipient A cannot decrypt Recipient B's amount — FHE ACL enforces this
 *        - Creator can decrypt all rows (payroll audit capability)
 *        - ETH per row is stored in contract state (EVM storage technically readable,
 *          but not exposed via events or public reads outside creator/recipient)
 *        - No per-row events that expose amounts
 */
contract BatchCipher {

    struct BatchEntry {
        address recipient;
        euint64 encryptedAmount;
        bool    claimed;
        uint256 ethAmount;
    }

    struct Batch {
        address creator;
        uint256 createdAt;
        uint256 totalEntries;
        uint256 claimedCount;
        bool    cancelled;
        string  memo;
    }

    mapping(bytes32 => Batch)         public  batches;
    // Private entries — creator + individual recipient access only
    mapping(bytes32 => BatchEntry[])  private _entries;
    // 1-indexed: 0 = not in batch. Lets recipients find their slot without iteration.
    mapping(bytes32 => mapping(address => uint256)) public recipientIndex;

    event BatchCreated(
        bytes32 indexed batchId,
        address indexed creator,
        uint256 totalEntries,
        string  memo
    );
    event BatchEntryClaimed(
        bytes32 indexed batchId,
        address indexed recipient,
        uint256 index
    );
    event BatchCancelled(bytes32 indexed batchId);

    /**
     * @notice Create a batch — encrypt N amounts, fund with N ETH allocations.
     * @param _recipients      Recipient addresses (max 100)
     * @param _encryptedAmounts FHE-encrypted per-row amounts
     * @param _ethAmounts      Plaintext ETH per row (must sum to msg.value)
     * @param _salt            Entropy for batchId derivation
     * @param _memo            Batch description (e.g. "April Payroll")
     */
    function createBatch(
        address[]    calldata _recipients,
        InEuint64[]  calldata _encryptedAmounts,
        uint256[]    calldata _ethAmounts,
        bytes32      _salt,
        string       calldata _memo
    ) external payable returns (bytes32 batchId) {
        uint256 n = _recipients.length;
        require(n > 0 && n <= 100, "1-100 entries");
        require(_encryptedAmounts.length == n, "Amount length mismatch");
        require(_ethAmounts.length == n, "ETH length mismatch");

        uint256 totalEth;
        for (uint256 i; i < n; i++) {
            require(_recipients[i] != address(0), "Zero recipient");
            totalEth += _ethAmounts[i];
        }
        require(msg.value == totalEth, "ETH sum mismatch");

        batchId = keccak256(abi.encodePacked(msg.sender, _salt, block.number));
        require(batches[batchId].creator == address(0), "Hash collision");

        batches[batchId] = Batch({
            creator:      msg.sender,
            createdAt:    block.timestamp,
            totalEntries: n,
            claimedCount: 0,
            cancelled:    false,
            memo:         _memo
        });

        for (uint256 i; i < n; i++) {
            euint64 amount = FHE.asEuint64(_encryptedAmounts[i]);
            // Contract can compute on it (e.g. future analytics)
            FHE.allowThis(amount);
            // Creator can decrypt all rows for audit/payroll records
            FHE.allowSender(amount);
            // Each recipient can only decrypt their own row — other rows are inaccessible
            FHE.allow(amount, _recipients[i]);

            _entries[batchId].push(BatchEntry({
                recipient:       _recipients[i],
                encryptedAmount: amount,
                claimed:         false,
                ethAmount:       _ethAmounts[i]
            }));

            // 1-indexed so 0 means "not in batch"
            recipientIndex[batchId][_recipients[i]] = i + 1;
        }

        emit BatchCreated(batchId, msg.sender, n, _memo);
    }

    /**
     * @notice Recipient claims their ETH allocation.
     * @dev Caller must be a registered recipient. Each recipient can claim once.
     */
    function claimBatch(bytes32 _batchId) external {
        Batch storage batch = batches[_batchId];
        require(batch.creator != address(0), "Batch not found");
        require(!batch.cancelled, "Batch cancelled");

        uint256 idx1 = recipientIndex[_batchId][msg.sender];
        require(idx1 > 0, "Not a recipient");
        BatchEntry storage entry = _entries[_batchId][idx1 - 1];
        require(!entry.claimed, "Already claimed");
        require(entry.ethAmount > 0, "Nothing to claim");

        entry.claimed = true;
        batch.claimedCount++;

        (bool sent, ) = payable(msg.sender).call{value: entry.ethAmount}("");
        require(sent, "ETH transfer failed");

        emit BatchEntryClaimed(_batchId, msg.sender, idx1 - 1);
    }

    /**
     * @notice Creator cancels batch — all unclaimed ETH refunded to creator.
     */
    function cancelBatch(bytes32 _batchId) external {
        Batch storage batch = batches[_batchId];
        require(batch.creator == msg.sender, "Only creator");
        require(!batch.cancelled, "Already cancelled");

        batch.cancelled = true;

        uint256 refund;
        BatchEntry[] storage entries = _entries[_batchId];
        for (uint256 i; i < entries.length; i++) {
            if (!entries[i].claimed) {
                refund += entries[i].ethAmount;
            }
        }

        if (refund > 0) {
            (bool sent, ) = payable(msg.sender).call{value: refund}("");
            require(sent, "Refund failed");
        }

        emit BatchCancelled(_batchId);
    }

    // ─── View helpers ────────────────────────────────────────────────────────

    function getBatch(bytes32 _batchId) external view returns (
        address creator,
        uint256 createdAt,
        uint256 totalEntries,
        uint256 claimedCount,
        bool    cancelled,
        string  memory memo
    ) {
        Batch storage b = batches[_batchId];
        return (b.creator, b.createdAt, b.totalEntries, b.claimedCount, b.cancelled, b.memo);
    }

    function getEntryCount(bytes32 _batchId) external view returns (uint256) {
        return _entries[_batchId].length;
    }

    /**
     * @notice Read a single entry. Only creator or the entry's recipient may call.
     * @dev Encrypted amount handle is returned — caller needs a CoFHE permit to
     *      decrypt it. ACL enforced at the FHE layer (not just this require).
     */
    function getEntry(bytes32 _batchId, uint256 _index) external view returns (
        address  recipient,
        euint64  encryptedAmount,
        bool     claimed,
        uint256  ethAmount
    ) {
        BatchEntry storage entry = _entries[_batchId][_index];
        require(
            msg.sender == batches[_batchId].creator || msg.sender == entry.recipient,
            "Not authorized"
        );
        return (entry.recipient, entry.encryptedAmount, entry.claimed, entry.ethAmount);
    }

    /**
     * @notice Convenience: caller reads their own entry without knowing the index.
     */
    function getMyEntry(bytes32 _batchId) external view returns (
        euint64 encryptedAmount,
        bool    claimed,
        uint256 ethAmount
    ) {
        uint256 idx1 = recipientIndex[_batchId][msg.sender];
        require(idx1 > 0, "Not a recipient");
        BatchEntry storage entry = _entries[_batchId][idx1 - 1];
        return (entry.encryptedAmount, entry.claimed, entry.ethAmount);
    }

    /**
     * @notice Creator reads all entries (for payroll dashboard).
     * @dev Returns parallel arrays to avoid dynamic struct array return.
     */
    function getAllEntries(bytes32 _batchId) external view returns (
        address[] memory recipients,
        bool[]    memory claimed,
        uint256[] memory ethAmounts
    ) {
        require(batches[_batchId].creator == msg.sender, "Only creator");
        BatchEntry[] storage entries = _entries[_batchId];
        uint256 n = entries.length;
        recipients = new address[](n);
        claimed    = new bool[](n);
        ethAmounts = new uint256[](n);
        for (uint256 i; i < n; i++) {
            recipients[i] = entries[i].recipient;
            claimed[i]    = entries[i].claimed;
            ethAmounts[i] = entries[i].ethAmount;
        }
    }
}
