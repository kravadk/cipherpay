// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title PaymentProof
 * @notice On-chain payment receipts with encrypted amounts
 * @dev Auto-issued when invoice is paid. Both payer and creator get proof.
 *      Proof includes encrypted amount — only parties can decrypt via permit.
 */
contract PaymentProof {
    struct Proof {
        bytes32 invoiceHash;
        address payer;
        address creator;
        euint64 encryptedAmount;
        uint256 timestamp;
        uint256 blockNumber;
        bytes32 proofHash;       // unique proof identifier
    }

    mapping(bytes32 => Proof) public proofs;              // proofHash -> proof
    mapping(address => bytes32[]) public userProofs;       // address -> proof hashes (both payer and creator)
    mapping(bytes32 => bytes32[]) public invoiceProofs;    // invoiceHash -> proof hashes

    uint256 public totalProofs;

    address public invoiceContract;  // only invoice contract can issue proofs

    event ProofIssued(
        bytes32 indexed proofHash,
        bytes32 indexed invoiceHash,
        address indexed payer,
        address creator,
        uint256 timestamp
    );

    modifier onlyInvoiceContract() {
        require(msg.sender == invoiceContract, "Only invoice contract");
        _;
    }

    constructor(address _invoiceContract) {
        invoiceContract = _invoiceContract;
    }

    /**
     * @notice Issue a payment proof — called by invoice contract on payment
     */
    function issueProof(
        bytes32 _invoiceHash,
        address _payer,
        address _creator,
        InEuint64 calldata _encryptedAmount
    ) external onlyInvoiceContract returns (bytes32) {
        bytes32 proofHash = keccak256(abi.encodePacked(
            _invoiceHash, _payer, block.number, block.timestamp, totalProofs
        ));

        euint64 amount = FHE.asEuint64(_encryptedAmount);
        FHE.allowThis(amount);
        FHE.allow(amount, _payer);
        FHE.allow(amount, _creator);

        proofs[proofHash] = Proof({
            invoiceHash: _invoiceHash,
            payer: _payer,
            creator: _creator,
            encryptedAmount: amount,
            timestamp: block.timestamp,
            blockNumber: block.number,
            proofHash: proofHash
        });

        userProofs[_payer].push(proofHash);
        userProofs[_creator].push(proofHash);
        invoiceProofs[_invoiceHash].push(proofHash);
        totalProofs++;

        emit ProofIssued(proofHash, _invoiceHash, _payer, _creator, block.timestamp);
        return proofHash;
    }

    // View functions

    function getProof(bytes32 _proofHash) external view returns (
        bytes32 invoiceHash, address payer, address creator,
        uint256 timestamp, uint256 blockNumber
    ) {
        Proof storage p = proofs[_proofHash];
        return (p.invoiceHash, p.payer, p.creator, p.timestamp, p.blockNumber);
    }

    function getProofEncryptedAmount(bytes32 _proofHash) external view returns (euint64) {
        return proofs[_proofHash].encryptedAmount;
    }

    function getUserProofs(address _user) external view returns (bytes32[] memory) {
        return userProofs[_user];
    }

    function getInvoiceProofs(bytes32 _invoiceHash) external view returns (bytes32[] memory) {
        return invoiceProofs[_invoiceHash];
    }
}
