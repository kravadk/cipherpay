// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title  PayrollAnchor
 * @notice Publishes Merkle roots over sets of invoice / payroll-batch hashes so
 *         that an invoice can later be proven to have existed at a given time
 *         WITHOUT revealing its amount, recipient, or any other field.
 *
 *         Leaves are invoice hashes only (which are already public on-chain).
 *         The confidential data — amounts (`euint64`), recipients — never enters
 *         this contract. Anchoring a root is what makes an off-chain Merkle
 *         existence proof publicly checkable.
 *
 *         Pairs are hashed in sorted order, matching OpenZeppelin's
 *         `MerkleProof` and the client-side `src/lib/merkle.ts` implementation.
 */
contract PayrollAnchor {
    struct Anchor {
        bytes32 root;       // Merkle root over a set of invoice hashes
        uint64  timestamp;  // block timestamp when anchored
        uint32  leafCount;  // number of leaves in the tree
        address publisher;  // who anchored it
    }

    /// @notice All anchored roots, indexed by id.
    mapping(uint256 => Anchor) public anchors;

    /// @notice Total number of anchors published.
    uint256 public anchorCount;

    event RootAnchored(
        uint256 indexed id,
        bytes32 indexed root,
        uint32 leafCount,
        address indexed publisher
    );

    /**
     * @notice Anchor a Merkle root over a payroll batch / invoice set.
     * @param root      the Merkle root (sorted-pair keccak256)
     * @param leafCount number of invoice hashes in the tree
     * @return id       the anchor id, used later by {verify}
     */
    function anchorRoot(bytes32 root, uint32 leafCount) external returns (uint256 id) {
        require(root != bytes32(0), "PayrollAnchor: empty root");
        id = anchorCount++;
        anchors[id] = Anchor({
            root: root,
            timestamp: uint64(block.timestamp),
            leafCount: leafCount,
            publisher: msg.sender
        });
        emit RootAnchored(id, root, leafCount, msg.sender);
    }

    /**
     * @notice Verify that `leaf` belongs to the Merkle tree anchored at `id`.
     * @param id    the anchor id returned by {anchorRoot}
     * @param leaf  the invoice hash being proven
     * @param proof the sibling path produced off-chain
     * @return ok    true if the proof is valid for the anchored root
     */
    function verify(uint256 id, bytes32 leaf, bytes32[] calldata proof)
        external
        view
        returns (bool ok)
    {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            computed = computed <= sibling
                ? keccak256(abi.encodePacked(computed, sibling))
                : keccak256(abi.encodePacked(sibling, computed));
        }
        bytes32 root = anchors[id].root;
        return root != bytes32(0) && computed == root;
    }
}
