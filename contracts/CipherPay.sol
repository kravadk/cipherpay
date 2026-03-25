// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract CipherPay {

    struct Invoice {
        address creator;
        address recipient;      // address(0) = anyone can pay
        uint8   invoiceType;    // 0=standard, 1=multipay, 2=recurring, 3=vesting, 4=batch
        uint8   status;         // 0=open, 1=settled, 2=cancelled
        euint64 encryptedAmount;
        uint256 deadline;       // 0 = no deadline
        uint256 createdAt;
        uint256 createdBlock;
        uint256 unlockBlock;    // vesting only, 0 = no lock
    }


    mapping(bytes32 => Invoice) private _invoices;
    mapping(address => bytes32[]) private _userInvoices;
    mapping(bytes32 => mapping(address => bool)) public payments;


    event InvoiceCreated(
        bytes32 indexed invoiceHash,
        address indexed creator,
        uint8   invoiceType,
        address recipient,
        uint256 deadline,
        uint256 unlockBlock
    );

    event InvoicePaid(
        bytes32 indexed invoiceHash,
        address indexed payer
    );

    event InvoiceSettled(bytes32 indexed invoiceHash);
    event InvoiceCancelled(bytes32 indexed invoiceHash);


    function createInvoice(
        InEuint64 memory _encryptedAmount,
        address   _recipient,
        uint8     _invoiceType,
        uint256   _deadline,
        uint256   _unlockBlock,
        bytes32   _salt
    ) external returns (bytes32) {
        // Generate unique hash
        bytes32 invoiceHash = keccak256(
            abi.encodePacked(_salt, msg.sender, block.number, block.timestamp)
        );

        // Ensure no collision
        require(_invoices[invoiceHash].creator == address(0), "Hash collision");

        // Validate type
        require(_invoiceType <= 4, "Invalid invoice type");

        // Validate deadline if set
        if (_deadline > 0) {
            require(_deadline > block.timestamp, "Deadline must be in future");
        }

        // Convert encrypted input to FHE type
        euint64 amount = FHE.asEuint64(_encryptedAmount);

        // ACL: contract keeps access for future operations
        FHE.allowThis(amount);

        // ACL: creator can read their own invoice amount
        FHE.allow(amount, msg.sender);

        // ACL: recipient can read the amount (if specified)
        if (_recipient != address(0)) {
            FHE.allow(amount, _recipient);
        }

        // Store invoice
        _invoices[invoiceHash] = Invoice({
            creator:         msg.sender,
            recipient:       _recipient,
            invoiceType:     _invoiceType,
            status:          0, // open
            encryptedAmount: amount,
            deadline:        _deadline,
            createdAt:       block.timestamp,
            createdBlock:    block.number,
            unlockBlock:     _unlockBlock
        });

        // Track user's invoices
        _userInvoices[msg.sender].push(invoiceHash);

        emit InvoiceCreated(
            invoiceHash,
            msg.sender,
            _invoiceType,
            _recipient,
            _deadline,
            _unlockBlock
        );

        return invoiceHash;
    }


    function payInvoice(
        bytes32   _invoiceHash,
        InEuint64 memory _encryptedPayment
    ) external {
        Invoice storage inv = _invoices[_invoiceHash];

        require(inv.creator != address(0), "Invoice not found");
        require(inv.status == 0, "Invoice not open");

        // Check deadline
        if (inv.deadline > 0) {
            require(block.timestamp <= inv.deadline, "Deadline passed");
        }

        // Check vesting lock
        if (inv.unlockBlock > 0) {
            require(block.number >= inv.unlockBlock, "Still locked");
        }

        // Check recipient restriction
        if (inv.recipient != address(0)) {
            require(msg.sender == inv.recipient, "Not authorized");
        }

        // Convert payment to FHE type
        euint64 payment = FHE.asEuint64(_encryptedPayment);
        FHE.allowThis(payment);

        // Record payment
        payments[_invoiceHash][msg.sender] = true;

        // Grant payer access to see the invoice amount
        FHE.allow(inv.encryptedAmount, msg.sender);

        // For standard, vesting: settle immediately
        // For multipay: creator settles manually
        if (inv.invoiceType != 1) {
            inv.status = 1; // settled
        }

        emit InvoicePaid(_invoiceHash, msg.sender);
    }


    function settleInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = _invoices[_invoiceHash];

        require(inv.creator != address(0), "Invoice not found");
        require(msg.sender == inv.creator, "Not creator");
        require(inv.status == 0, "Not open");
        require(inv.invoiceType == 1, "Not multipay");

        inv.status = 1; // settled
        emit InvoiceSettled(_invoiceHash);
    }


    function cancelInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = _invoices[_invoiceHash];

        require(inv.creator != address(0), "Invoice not found");
        require(msg.sender == inv.creator, "Not creator");
        require(inv.status == 0, "Not open");

        inv.status = 2; // cancelled
        emit InvoiceCancelled(_invoiceHash);
    }


    function getInvoice(bytes32 _invoiceHash) external view returns (
        address creator,
        address recipient,
        uint8   invoiceType,
        uint8   status,
        uint256 deadline,
        uint256 createdAt,
        uint256 createdBlock,
        uint256 unlockBlock
    ) {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");

        return (
            inv.creator,
            inv.recipient,
            inv.invoiceType,
            inv.status,
            inv.deadline,
            inv.createdAt,
            inv.createdBlock,
            inv.unlockBlock
        );
    }

    function getEncryptedAmount(bytes32 _invoiceHash) external view returns (euint64) {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");

        // Caller must have ACL access (set via FHE.allow in createInvoice/payInvoice)
        // The SDK will use permit + ACL to decrypt
        return inv.encryptedAmount;
    }

    function getUserInvoices(address _user) external view returns (bytes32[] memory) {
        return _userInvoices[_user];
    }

    function getInvoiceCount(address _user) external view returns (uint256) {
        return _userInvoices[_user].length;
    }

    function hasPaid(bytes32 _invoiceHash, address _payer) external view returns (bool) {
        return payments[_invoiceHash][_payer];
    }
}
