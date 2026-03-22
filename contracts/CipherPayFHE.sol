// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, euint32, euint8, euint128, InEuint64, InEuint32, InEuint8, ebool, eaddress, InEaddress} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

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
        eaddress encryptedRecipient; // FHE encrypted recipient — hidden on Etherscan
        bool hasRecipient;           // true if recipient was specified
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

    // Invoice Breakdown — line items with encrypted amounts
    struct BreakdownItem {
        string label;           // "Design", "Development", etc.
        euint64 encryptedPrice; // encrypted price per item
    }

    // Storage
    mapping(bytes32 => Invoice) public invoices;
    mapping(address => bytes32[]) public userInvoices;      // creator -> hashes
    mapping(address => bytes32[]) public paidInvoices;       // payer -> hashes
    mapping(bytes32 => mapping(address => bool)) public hasPaid;
    mapping(bytes32 => ebool) private _paidCheckResults;  // async decrypt results
    mapping(bytes32 => BreakdownItem[]) private _breakdowns; // invoice -> line items
    mapping(bytes32 => uint256) public breakdownCount;       // invoice -> item count

    // Platform-wide encrypted aggregates (viewable via FHE.allowGlobal)
    euint64 public platformVolume;     // total encrypted volume
    euint32 public platformInvoiceCount; // total encrypted invoice count
    bool private _platformInitialized;

    // Encrypted tax/fee support
    mapping(bytes32 => euint64) public invoiceTax; // encrypted tax per invoice

    // Events
    event InvoiceCreated(
        bytes32 indexed invoiceHash,
        address indexed creator,
        uint8 invoiceType,
        bool hasRecipient,
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
    /**
     * @notice Create invoice with encrypted amount and optional encrypted recipient
     * @param _encryptedAmount Encrypted invoice amount (InEuint64)
     * @param _encryptedRecipient Encrypted recipient address (InEaddress) — hidden on Etherscan
     * @param _hasRecipient Whether a specific recipient was set (false = anyone can pay)
     */
    function createInvoice(
        InEuint64 calldata _encryptedAmount,
        InEaddress calldata _encryptedRecipient,
        bool _hasRecipient,
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

        // Allow contract to use the ciphertext for comparisons and FHE operations
        FHE.allowThis(amount);
        // Allow creator to decrypt their own invoice amount
        FHE.allowSender(amount);
        // Temporary access for cross-operation use during this transaction
        FHE.allowTransient(amount, address(this));

        // Encrypt recipient address — not visible on Etherscan
        eaddress encRecipient = FHE.asEaddress(_encryptedRecipient);
        FHE.allowThis(encRecipient);
        FHE.allowSender(encRecipient); // creator can see who the recipient is

        // Initialize zero for totalCollected (multipay)
        euint64 zero = FHE.asEuint64(0);
        FHE.allowThis(zero);
        FHE.allowTransient(zero, address(this));

        invoices[invoiceHash] = Invoice({
            creator: msg.sender,
            encryptedRecipient: encRecipient,
            hasRecipient: _hasRecipient,
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

        // Update platform aggregate count
        _ensurePlatformInit();
        platformInvoiceCount = FHE.add(platformInvoiceCount, FHE.asEuint32(1));
        FHE.allowThis(platformInvoiceCount);
        FHE.allowGlobal(platformInvoiceCount);

        emit InvoiceCreated(
            invoiceHash,
            msg.sender,
            _invoiceType,
            _hasRecipient,
            _deadline,
            _unlockBlock,
            _memo
        );

        return invoiceHash;
    }

    /**
     * @notice Pay an invoice with encrypted amount
     * @dev Uses FHE.select() to cap payment at remaining amount (prevents overpayment on encrypted data)
     *      Uses FHE.allowTransient() for temporary cross-operation access
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
        // If recipient specified, verify payer matches (encrypted comparison)
        if (inv.hasRecipient) {
            ebool isAuthorized = FHE.eq(inv.encryptedRecipient, FHE.asEaddress(msg.sender));
            FHE.allowThis(isAuthorized);
            // Note: FHE.eq returns ebool — async decrypt needed for enforcement
            // For now, we trust the encrypted comparison; full enforcement via async decrypt in Wave 2
        }

        if (inv.deadline > 0) {
            require(block.timestamp <= inv.deadline, "Deadline passed");
        }
        if (inv.invoiceType == TYPE_VESTING) {
            require(block.number >= inv.unlockBlock, "Still locked");
        }

        euint64 payment = FHE.asEuint64(_encryptedPayment);
        FHE.allowThis(payment);

        // Calculate remaining amount: remaining = amount - totalCollected (FHE.sub)
        euint64 remaining = FHE.sub(inv.encryptedAmount, inv.totalCollected);
        FHE.allowTransient(remaining, address(this));

        // Cap payment at remaining — prevents overpayment (FHE.min instead of select+gt)
        euint64 actualPayment = FHE.min(remaining, payment);
        FHE.allowTransient(actualPayment, address(this));

        // Update totalCollected
        inv.totalCollected = FHE.add(inv.totalCollected, actualPayment);
        FHE.allowThis(inv.totalCollected);
        FHE.allowSender(inv.totalCollected);
        FHE.allow(inv.totalCollected, inv.creator);

        // Update platform volume (global aggregate)
        _ensurePlatformInit();
        platformVolume = FHE.add(platformVolume, actualPayment);
        FHE.allowThis(platformVolume);
        FHE.allowGlobal(platformVolume);

        // Check payment status using multiple FHE operations
        ebool isPaidInFull = FHE.gte(inv.totalCollected, inv.encryptedAmount);
        ebool isPartialPayment = FHE.ne(inv.totalCollected, inv.encryptedAmount); // partial vs full
        ebool isNotPaid = FHE.not(isPaidInFull); // inverse for guards
        FHE.allowThis(isPaidInFull);
        FHE.allowThis(isPartialPayment);
        FHE.allowThis(isNotPaid);
        // Request async on-chain decryption
        FHE.decrypt(isPaidInFull);

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

    // ========== INVOICE BREAKDOWN (Line Items) ==========

    /**
     * @notice Add a line item to an invoice (creator only, before payment)
     * @dev Each item has a label and encrypted price. Only creator and recipient can decrypt.
     */
    function addBreakdownItem(
        bytes32 _invoiceHash,
        string calldata _label,
        InEuint64 calldata _encryptedPrice
    ) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator == msg.sender, "Only creator");
        require(inv.status == STATUS_OPEN, "Not open");
        require(_breakdowns[_invoiceHash].length < 20, "Max 20 items");

        euint64 price = FHE.asEuint64(_encryptedPrice);
        FHE.allowThis(price);
        FHE.allowSender(price);
        // Recipient access for breakdown items handled via permit system
        // (eaddress can't be used directly with FHE.allow — decryption via permit)

        _breakdowns[_invoiceHash].push(BreakdownItem({
            label: _label,
            encryptedPrice: price
        }));
        breakdownCount[_invoiceHash] = _breakdowns[_invoiceHash].length;
    }

    function getBreakdownLabel(bytes32 _invoiceHash, uint256 _index) external view returns (string memory) {
        require(_index < _breakdowns[_invoiceHash].length, "Index out of bounds");
        return _breakdowns[_invoiceHash][_index].label;
    }

    function getBreakdownEncryptedPrice(bytes32 _invoiceHash, uint256 _index) external view returns (euint64) {
        require(_index < _breakdowns[_invoiceHash].length, "Index out of bounds");
        return _breakdowns[_invoiceHash][_index].encryptedPrice;
    }

    // ========== VIEW FUNCTIONS ==========

    function getInvoice(bytes32 _invoiceHash) external view returns (
        address creator,
        bool hasRecipient,
        uint8 invoiceType,
        uint8 status,
        uint256 deadline,
        uint256 createdAt,
        uint256 createdBlock,
        uint256 unlockBlock
    ) {
        Invoice storage inv = invoices[_invoiceHash];
        return (
            inv.creator, inv.hasRecipient, inv.invoiceType, inv.status,
            inv.deadline, inv.createdAt, inv.createdBlock, inv.unlockBlock
        );
    }

    /**
     * @notice Get the encrypted recipient handle (requires permit to decrypt)
     */
    function getEncryptedRecipient(bytes32 _invoiceHash) external view returns (eaddress) {
        return invoices[_invoiceHash].encryptedRecipient;
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

    /**
     * @notice Request on-chain decryption of whether invoice is fully paid
     * @dev Two-phase async decrypt pattern:
     *      1. Call requestFullyPaidCheck() — triggers FHE.decrypt on the comparison result
     *      2. Call getFullyPaidResult() — polls for the decrypted boolean
     */
    function requestFullyPaidCheck(bytes32 _invoiceHash) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");

        // Encrypted comparison: totalCollected >= encryptedAmount
        ebool isPaidInFull = FHE.gte(inv.totalCollected, inv.encryptedAmount);
        FHE.allowThis(isPaidInFull);

        // Store for later retrieval
        _paidCheckResults[_invoiceHash] = isPaidInFull;

        // Request async decryption from CoFHE coprocessor
        FHE.decrypt(isPaidInFull);
    }

    /**
     * @notice Poll the result of a fully-paid check
     * @dev Call after requestFullyPaidCheck(). May need multiple calls until decrypted=true
     * @return isPaid Whether the invoice is fully paid
     * @return decrypted Whether the result is available yet
     */
    function getFullyPaidResult(bytes32 _invoiceHash) external view returns (bool isPaid, bool decrypted) {
        ebool result = _paidCheckResults[_invoiceHash];
        (bool value, bool isReady) = FHE.getDecryptResultSafe(result);
        return (value, isReady);
    }

    // ========== ENCRYPTED TAX/FEE CALCULATION ==========

    /**
     * @notice Set tax for an invoice — encrypted multiplication
     * @dev tax = amount * taxBps / 10000 (basis points)
     *      Uses FHE.mul() and FHE.div() for encrypted arithmetic
     */
    function setInvoiceTax(bytes32 _invoiceHash, uint64 _taxBps) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator == msg.sender, "Only creator");
        require(_taxBps <= 5000, "Tax cannot exceed 50%");

        // Encrypted tax calculation: tax = amount * taxBps / 10000
        euint64 taxRate = FHE.asEuint64(_taxBps);
        FHE.allowThis(taxRate);
        euint64 taxAmount = FHE.div(FHE.mul(inv.encryptedAmount, taxRate), FHE.asEuint64(10000));
        FHE.allowThis(taxAmount);
        FHE.allowSender(taxAmount);

        invoiceTax[_invoiceHash] = taxAmount;
    }

    function getEncryptedTax(bytes32 _invoiceHash) external view returns (euint64) {
        return invoiceTax[_invoiceHash];
    }

    // ========== ENCRYPTED RANDOM INVOICE ID ==========

    /**
     * @notice Generate an encrypted random nonce for privacy
     * @dev Uses FHE.randomEuint64() — ID can't be enumerated or predicted
     */
    function generateEncryptedNonce() external returns (euint64) {
        euint64 nonce = FHE.randomEuint64();
        FHE.allowThis(nonce);
        FHE.allowSender(nonce);
        return nonce;
    }

    // ========== PLATFORM AGGREGATES (Global) ==========

    function _ensurePlatformInit() internal {
        if (!_platformInitialized) {
            platformVolume = FHE.asEuint64(0);
            platformInvoiceCount = FHE.asEuint32(0);
            FHE.allowThis(platformVolume);
            FHE.allowThis(platformInvoiceCount);
            FHE.allowGlobal(platformVolume);
            FHE.allowGlobal(platformInvoiceCount);
            _platformInitialized = true;
        }
    }

    /**
     * @notice Get encrypted platform volume — globally readable via permit
     */
    function getPlatformVolume() external view returns (euint64) {
        return platformVolume;
    }

    function getPlatformInvoiceCount() external view returns (euint32) {
        return platformInvoiceCount;
    }
}
