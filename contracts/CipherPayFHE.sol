// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title CipherPayFHE
 * @notice Privacy-first invoice protocol using Fhenix FHE
 * @dev All amounts are encrypted on-chain using euint64
 *      Only authorized parties can decrypt via permits
 */
contract CipherPayFHE {
    // Invoice types
    uint8 constant TYPE_STANDARD = 0;
    uint8 constant TYPE_MULTIPAY = 1;
    uint8 constant TYPE_RECURRING = 2;
    uint8 constant TYPE_VESTING = 3;

    // Invoice statuses
    uint8 constant STATUS_OPEN = 0;
    uint8 constant STATUS_SETTLED = 1;
    uint8 constant STATUS_CANCELLED = 2;

    struct Invoice {
        address creator;
        address recipient;         // 0x0 = anyone can pay
        uint8 invoiceType;
        uint8 status;
        euint64 encryptedAmount;   // FHE encrypted amount
        euint64 totalCollected;    // FHE encrypted collected (for multipay)
        uint256 deadline;
        uint256 createdAt;
        uint256 createdBlock;
        uint256 unlockBlock;       // For vesting
        string memo;
        uint256 payerCount;
    }

    // Storage
    mapping(bytes32 => Invoice) public invoices;
    mapping(address => bytes32[]) public userInvoices;      // creator -> hashes
    mapping(address => bytes32[]) public paidInvoices;       // payer -> hashes
    mapping(bytes32 => mapping(address => bool)) public hasPaid;

    // Events
    event InvoiceCreated(
        bytes32 indexed invoiceHash,
        address indexed creator,
        uint8 invoiceType,
        address recipient,
        uint256 deadline,
        uint256 unlockBlock,
        string memo
    );

    event InvoicePaid(
        bytes32 indexed invoiceHash,
        address indexed payer
    );

    event InvoiceSettled(bytes32 indexed invoiceHash);
    event InvoiceCancelled(bytes32 indexed invoiceHash);

    /**
     * @notice Create an invoice with FHE-encrypted amount
     * @param _encryptedAmount The encrypted amount (InEuint64 from client SDK)
     * @param _recipient Who can pay (0x0 = anyone)
     * @param _invoiceType 0=standard, 1=multipay, 2=recurring, 3=vesting
     * @param _deadline Unix timestamp deadline (0 = no deadline)
     * @param _unlockBlock Block number for vesting unlock (0 = no lock)
     * @param _salt Random salt for unique hash
     * @param _memo Optional memo string
     */
    function createInvoice(
        InEuint64 calldata _encryptedAmount,
        address _recipient,
        uint8 _invoiceType,
        uint256 _deadline,
        uint256 _unlockBlock,
        bytes32 _salt,
        string calldata _memo
    ) external returns (bytes32) {
        require(_invoiceType <= 3, "Invalid type");

        bytes32 invoiceHash = keccak256(abi.encodePacked(msg.sender, _salt, block.number));

        require(invoices[invoiceHash].creator == address(0), "Hash collision");

        // Convert encrypted input to on-chain ciphertext
        euint64 amount = FHE.asEuint64(_encryptedAmount);

        // Allow contract to use the ciphertext for comparisons
        FHE.allowThis(amount);
        // Allow creator to decrypt their own invoice amount
        FHE.allowSender(amount);
        // If recipient specified, allow them too
        if (_recipient != address(0)) {
            FHE.allow(amount, _recipient);
        }

        // Initialize zero for totalCollected (multipay)
        euint64 zero = FHE.asEuint64(0);
        FHE.allowThis(zero);

        invoices[invoiceHash] = Invoice({
            creator: msg.sender,
            recipient: _recipient,
            invoiceType: _invoiceType,
            status: STATUS_OPEN,
            encryptedAmount: amount,
            totalCollected: zero,
            deadline: _deadline,
            createdAt: block.timestamp,
            createdBlock: block.number,
            unlockBlock: _unlockBlock,
            memo: _memo,
            payerCount: 0
        });

        userInvoices[msg.sender].push(invoiceHash);

        emit InvoiceCreated(
            invoiceHash,
            msg.sender,
            _invoiceType,
            _recipient,
            _deadline,
            _unlockBlock,
            _memo
        );

        return invoiceHash;
    }

    /**
     * @notice Pay an invoice with encrypted amount
     * @param _invoiceHash The invoice to pay
     * @param _encryptedPayment The encrypted payment amount
     */
    function payInvoice(
        bytes32 _invoiceHash,
        InEuint64 calldata _encryptedPayment
    ) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(inv.status == STATUS_OPEN, "Not open");
        require(inv.recipient == address(0) || inv.recipient == msg.sender, "Not authorized");

        if (inv.deadline > 0) {
            require(block.timestamp <= inv.deadline, "Deadline passed");
        }
        if (inv.invoiceType == TYPE_VESTING) {
            require(block.number >= inv.unlockBlock, "Still locked");
        }

        euint64 payment = FHE.asEuint64(_encryptedPayment);
        FHE.allowThis(payment);

        // Add payment to totalCollected (encrypted addition)
        inv.totalCollected = FHE.add(inv.totalCollected, payment);
        FHE.allowThis(inv.totalCollected);
        FHE.allowSender(inv.totalCollected);
        FHE.allow(inv.totalCollected, inv.creator);

        if (!hasPaid[_invoiceHash][msg.sender]) {
            hasPaid[_invoiceHash][msg.sender] = true;
            paidInvoices[msg.sender].push(_invoiceHash);
            inv.payerCount++;
        }

        // Auto-settle for standard/vesting/recurring (single payer)
        if (inv.invoiceType != TYPE_MULTIPAY) {
            inv.status = STATUS_SETTLED;
            emit InvoiceSettled(_invoiceHash);
        }

        emit InvoicePaid(_invoiceHash, msg.sender);
    }

    /**
     * @notice Settle a multi-pay invoice (creator only)
     */
    function settleInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator == msg.sender, "Only creator");
        require(inv.status == STATUS_OPEN, "Not open");
        require(inv.invoiceType == TYPE_MULTIPAY, "Not multipay");

        inv.status = STATUS_SETTLED;
        emit InvoiceSettled(_invoiceHash);
    }

    /**
     * @notice Cancel an open invoice (creator only)
     */
    function cancelInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator == msg.sender, "Only creator");
        require(inv.status == STATUS_OPEN, "Not open");

        inv.status = STATUS_CANCELLED;
        emit InvoiceCancelled(_invoiceHash);
    }

    // ========== VIEW FUNCTIONS ==========

    function getInvoice(bytes32 _invoiceHash) external view returns (
        address creator,
        address recipient,
        uint8 invoiceType,
        uint8 status,
        uint256 deadline,
        uint256 createdAt,
        uint256 createdBlock,
        uint256 unlockBlock
    ) {
        Invoice storage inv = invoices[_invoiceHash];
        return (
            inv.creator, inv.recipient, inv.invoiceType, inv.status,
            inv.deadline, inv.createdAt, inv.createdBlock, inv.unlockBlock
        );
    }

    /**
     * @notice Get the encrypted amount handle (requires permit to decrypt)
     */
    function getEncryptedAmount(bytes32 _invoiceHash) external view returns (euint64) {
        return invoices[_invoiceHash].encryptedAmount;
    }

    /**
     * @notice Get the encrypted collected amount handle (requires permit)
     */
    function getEncryptedCollected(bytes32 _invoiceHash) external view returns (euint64) {
        return invoices[_invoiceHash].totalCollected;
    }

    function getInvoiceMemo(bytes32 _invoiceHash) external view returns (string memory) {
        return invoices[_invoiceHash].memo;
    }

    function getPayerCount(bytes32 _invoiceHash) external view returns (uint256) {
        return invoices[_invoiceHash].payerCount;
    }

    function getUserInvoices(address _user) external view returns (bytes32[] memory) {
        return userInvoices[_user];
    }

    function getPaidInvoices(address _user) external view returns (bytes32[] memory) {
        return paidInvoices[_user];
    }

    function checkHasPaid(bytes32 _invoiceHash, address _payer) external view returns (bool) {
        return hasPaid[_invoiceHash][_payer];
    }
}
