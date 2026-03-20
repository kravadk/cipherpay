// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * CipherPaySimple v2 — MVP with full Multi Pay support.
 * Stores amount as uint256 (will be replaced with euint64 when CoFHE infra is confirmed).
 */
contract CipherPaySimple {
    struct Invoice {
        address creator;
        address recipient;
        uint8   invoiceType;    // 0=standard, 1=multipay, 2=recurring, 3=vesting, 4=batch
        uint8   status;         // 0=open, 1=settled, 2=cancelled
        uint256 amount;
        uint256 collected;      // amount collected so far (multipay)
        uint256 deadline;
        uint256 createdAt;
        uint256 createdBlock;
        uint256 unlockBlock;
        uint256 payerCount;
        string  memo;           // stored on-chain (frequency info for recurring, notes, etc.)
    }

    mapping(bytes32 => Invoice) private _invoices;
    mapping(address => bytes32[]) private _userInvoices;
    mapping(address => bytes32[]) private _payerInvoices; // invoices where user has paid
    mapping(bytes32 => mapping(address => uint256)) public paymentAmounts;
    mapping(bytes32 => address[]) private _payers;

    event InvoiceCreated(
        bytes32 indexed invoiceHash,
        address indexed creator,
        uint8   invoiceType,
        address recipient,
        uint256 amount,
        uint256 deadline,
        uint256 unlockBlock,
        string  memo
    );
    event InvoicePaid(bytes32 indexed invoiceHash, address indexed payer, uint256 amount, uint256 totalCollected);
    event InvoiceSettled(bytes32 indexed invoiceHash);
    event InvoiceCancelled(bytes32 indexed invoiceHash);

    function createInvoice(
        uint256   _amount,
        address   _recipient,
        uint8     _invoiceType,
        uint256   _deadline,
        uint256   _unlockBlock,
        bytes32   _salt,
        string calldata _memo
    ) external returns (bytes32) {
        bytes32 invoiceHash = keccak256(
            abi.encodePacked(_salt, msg.sender, block.number, block.timestamp)
        );

        require(_invoices[invoiceHash].creator == address(0), "Hash collision");
        require(_invoiceType <= 4, "Invalid invoice type");
        require(_amount > 0, "Amount must be > 0");
        if (_deadline > 0) {
            require(_deadline > block.timestamp, "Deadline must be in future");
        }

        _invoices[invoiceHash] = Invoice({
            creator:     msg.sender,
            recipient:   _recipient,
            invoiceType: _invoiceType,
            status:      0,
            amount:      _amount,
            collected:   0,
            deadline:    _deadline,
            createdAt:   block.timestamp,
            createdBlock: block.number,
            unlockBlock: _unlockBlock,
            payerCount:  0,
            memo:        _memo
        });

        _userInvoices[msg.sender].push(invoiceHash);

        emit InvoiceCreated(invoiceHash, msg.sender, _invoiceType, _recipient, _amount, _deadline, _unlockBlock, _memo);
        return invoiceHash;
    }

    function payInvoice(bytes32 _invoiceHash, uint256 _paymentAmount) external {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(inv.status == 0, "Invoice not open");
        require(_paymentAmount > 0, "Payment must be > 0");

        if (inv.deadline > 0) {
            require(block.timestamp <= inv.deadline, "Deadline passed");
        }
        if (inv.unlockBlock > 0) {
            require(block.number >= inv.unlockBlock, "Still locked");
        }
        if (inv.recipient != address(0)) {
            require(msg.sender == inv.recipient, "Not authorized");
        }

        // Track payment
        if (paymentAmounts[_invoiceHash][msg.sender] == 0) {
            _payers[_invoiceHash].push(msg.sender);
            _payerInvoices[msg.sender].push(_invoiceHash);
            inv.payerCount++;
        }
        paymentAmounts[_invoiceHash][msg.sender] += _paymentAmount;
        inv.collected += _paymentAmount;

        emit InvoicePaid(_invoiceHash, msg.sender, _paymentAmount, inv.collected);

        // Auto-settle for non-multipay when full amount is reached
        if (inv.invoiceType != 1) {
            if (inv.collected >= inv.amount) {
                inv.status = 1; // settled
                emit InvoiceSettled(_invoiceHash);
            }
        }
    }

    // Pay full remaining amount (for standard/vesting/recurring)
    function payInvoiceFull(bytes32 _invoiceHash) external {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(inv.status == 0, "Invoice not open");

        if (inv.deadline > 0) require(block.timestamp <= inv.deadline, "Deadline passed");
        if (inv.unlockBlock > 0) require(block.number >= inv.unlockBlock, "Still locked");
        if (inv.recipient != address(0)) require(msg.sender == inv.recipient, "Not authorized");

        uint256 remaining = inv.amount > inv.collected ? inv.amount - inv.collected : inv.amount;
        require(remaining > 0, "Already fully paid");

        if (paymentAmounts[_invoiceHash][msg.sender] == 0) {
            _payers[_invoiceHash].push(msg.sender);
            _payerInvoices[msg.sender].push(_invoiceHash);
            inv.payerCount++;
        }
        paymentAmounts[_invoiceHash][msg.sender] += remaining;
        inv.collected += remaining;

        emit InvoicePaid(_invoiceHash, msg.sender, remaining, inv.collected);

        if (inv.invoiceType != 1 && inv.collected >= inv.amount) {
            inv.status = 1;
            emit InvoiceSettled(_invoiceHash);
        }
    }

    function settleInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(msg.sender == inv.creator, "Not creator");
        require(inv.status == 0, "Not open");
        require(inv.invoiceType == 1, "Not multipay");
        inv.status = 1;
        emit InvoiceSettled(_invoiceHash);
    }

    function cancelInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(msg.sender == inv.creator, "Not creator");
        require(inv.status == 0, "Not open");
        inv.status = 2;
        emit InvoiceCancelled(_invoiceHash);
    }

    // ── View Functions ─────────────────────────────────────

    function getInvoice(bytes32 _invoiceHash) external view returns (
        address creator, address recipient, uint8 invoiceType, uint8 status,
        uint256 deadline, uint256 createdAt, uint256 createdBlock, uint256 unlockBlock
    ) {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        return (inv.creator, inv.recipient, inv.invoiceType, inv.status,
                inv.deadline, inv.createdAt, inv.createdBlock, inv.unlockBlock);
    }

    function getInvoiceMemo(bytes32 _invoiceHash) external view returns (string memory) {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        return inv.memo;
    }

    function getInvoiceAmount(bytes32 _invoiceHash) external view returns (uint256) {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        return inv.amount;
    }

    function getInvoiceCollected(bytes32 _invoiceHash) external view returns (uint256 collected, uint256 target, uint256 payerCount) {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        return (inv.collected, inv.amount, inv.payerCount);
    }

    function getPayerAmount(bytes32 _invoiceHash, address _payer) external view returns (uint256) {
        return paymentAmounts[_invoiceHash][_payer];
    }

    function getInvoicePayers(bytes32 _invoiceHash) external view returns (address[] memory) {
        return _payers[_invoiceHash];
    }

    function getUserInvoices(address _user) external view returns (bytes32[] memory) {
        return _userInvoices[_user];
    }

    function getPaidInvoices(address _user) external view returns (bytes32[] memory) {
        return _payerInvoices[_user];
    }

    function getInvoiceCount(address _user) external view returns (uint256) {
        return _userInvoices[_user].length;
    }

    function hasPaid(bytes32 _invoiceHash, address _payer) external view returns (bool) {
        return paymentAmounts[_invoiceHash][_payer] > 0;
    }
}
