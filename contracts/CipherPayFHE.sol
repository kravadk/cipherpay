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
    uint8 constant TYPE_STANDARD = 0;
    uint8 constant TYPE_MULTIPAY = 1;
    uint8 constant TYPE_RECURRING = 2;
    uint8 constant TYPE_VESTING = 3;

    uint8 constant STATUS_OPEN = 0;
    uint8 constant STATUS_SETTLED = 1;
    uint8 constant STATUS_CANCELLED = 2;

    struct Invoice {
        address creator;
        address recipient;
        eaddress encryptedRecipient;
        bool hasRecipient;
        uint8 invoiceType;
        uint8 status;
        euint64 encryptedAmount;
        euint64 totalCollected;
        uint256 deadline;
        uint256 createdAt;
        uint256 createdBlock;
        uint256 unlockBlock;
        string memo;
        uint256 payerCount;
    }

    struct BreakdownItem {
        string label;
        euint64 encryptedPrice;
    }

    mapping(bytes32 => Invoice) public invoices;
    mapping(address => bytes32[]) public userInvoices;
    mapping(address => bytes32[]) public paidInvoices;
    mapping(bytes32 => mapping(address => bool)) public hasPaid;
    mapping(bytes32 => ebool) private _paidCheckResults;
    mapping(bytes32 => BreakdownItem[]) private _breakdowns;
    mapping(bytes32 => uint256) public breakdownCount;
    mapping(bytes32 => uint256) private _ethHeld;
    mapping(bytes32 => address[]) private _payers;
    mapping(bytes32 => mapping(address => uint256)) private _payerEth;

    euint64 public platformVolume;
    euint32 public platformInvoiceCount;
    bool private _platformInitialized;

    mapping(bytes32 => euint64) public invoiceTax;

    event InvoiceCreated(
        bytes32 indexed invoiceHash, address indexed creator,
        uint8 invoiceType, bool hasRecipient,
        uint256 deadline, uint256 unlockBlock, string memo
    );
    event InvoicePaid(bytes32 indexed invoiceHash, address indexed payer);
    event InvoiceSettled(bytes32 indexed invoiceHash);
    event InvoiceCancelled(bytes32 indexed invoiceHash);

    function createInvoice(
        InEuint64 calldata _encryptedAmount,
        InEaddress calldata _encryptedRecipient,
        address _recipient,
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

        euint64 amount = FHE.asEuint64(_encryptedAmount);
        FHE.allowThis(amount);
        FHE.allowSender(amount);
        FHE.allowTransient(amount, address(this));

        eaddress encRecipient = FHE.asEaddress(_encryptedRecipient);
        FHE.allowThis(encRecipient);
        FHE.allowSender(encRecipient);

        euint64 zero = FHE.asEuint64(0);
        FHE.allowThis(zero);
        FHE.allowTransient(zero, address(this));

        invoices[invoiceHash] = Invoice({
            creator: msg.sender,
            recipient: _recipient,
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

        _ensurePlatformInit();
        platformInvoiceCount = FHE.add(platformInvoiceCount, FHE.asEuint32(1));
        FHE.allowThis(platformInvoiceCount);
        FHE.allowGlobal(platformInvoiceCount);

        emit InvoiceCreated(invoiceHash, msg.sender, _invoiceType, _hasRecipient, _deadline, _unlockBlock, _memo);
        return invoiceHash;
    }

    /**
     * @notice Pay an invoice — send ETH + encrypted payment proof.
     *         ETH held in escrow, transferred to creator on auto-settle.
     */
    function payInvoice(
        bytes32 _invoiceHash,
        InEuint64 calldata _encryptedPayment
    ) external payable {
        require(msg.value > 0, "Must send ETH");

        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(inv.status == STATUS_OPEN, "Not open");

        if (inv.hasRecipient) {
            require(msg.sender == inv.recipient, "Not authorized payer");
        }
        if (inv.deadline > 0) {
            require(block.timestamp <= inv.deadline, "Deadline passed");
        }
        if (inv.invoiceType == TYPE_VESTING) {
            require(block.number >= inv.unlockBlock, "Still locked");
        }

        euint64 payment = FHE.asEuint64(_encryptedPayment);
        FHE.allowThis(payment);

        euint64 remaining = FHE.sub(inv.encryptedAmount, inv.totalCollected);
        FHE.allowTransient(remaining, address(this));

        euint64 actualPayment = FHE.min(remaining, payment);
        FHE.allowTransient(actualPayment, address(this));

        inv.totalCollected = FHE.add(inv.totalCollected, actualPayment);
        FHE.allowThis(inv.totalCollected);
        FHE.allowSender(inv.totalCollected);
        FHE.allow(inv.totalCollected, inv.creator);

        _ensurePlatformInit();
        platformVolume = FHE.add(platformVolume, actualPayment);
        FHE.allowThis(platformVolume);
        FHE.allowGlobal(platformVolume);

        ebool isPaidInFull = FHE.gte(inv.totalCollected, inv.encryptedAmount);
        FHE.allowThis(isPaidInFull);
        FHE.decrypt(isPaidInFull);

        if (!hasPaid[_invoiceHash][msg.sender]) {
            hasPaid[_invoiceHash][msg.sender] = true;
            paidInvoices[msg.sender].push(_invoiceHash);
            _payers[_invoiceHash].push(msg.sender);
            inv.payerCount++;
        }

        // Track ETH per invoice and per payer
        _ethHeld[_invoiceHash] += msg.value;
        _payerEth[_invoiceHash][msg.sender] += msg.value;

        // Auto-settle: transfer escrowed ETH to creator
        if (inv.invoiceType != TYPE_MULTIPAY) {
            inv.status = STATUS_SETTLED;
            uint256 payout = _ethHeld[_invoiceHash];
            _ethHeld[_invoiceHash] = 0;
            (bool sent, ) = payable(inv.creator).call{value: payout}("");
            require(sent, "ETH transfer failed");
            emit InvoiceSettled(_invoiceHash);
        }

        emit InvoicePaid(_invoiceHash, msg.sender);
    }

    function settleInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator == msg.sender, "Only creator");
        require(inv.status == STATUS_OPEN, "Not open");
        require(inv.invoiceType == TYPE_MULTIPAY, "Not multipay");

        inv.status = STATUS_SETTLED;
        uint256 payout = _ethHeld[_invoiceHash];
        if (payout > 0) {
            _ethHeld[_invoiceHash] = 0;
            (bool sent, ) = payable(inv.creator).call{value: payout}("");
            require(sent, "ETH transfer failed");
        }
        emit InvoiceSettled(_invoiceHash);
    }

    function cancelInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator == msg.sender, "Only creator");
        require(inv.status == STATUS_OPEN, "Not open");

        inv.status = STATUS_CANCELLED;

        // Refund all payers
        address[] storage payers = _payers[_invoiceHash];
        for (uint256 i = 0; i < payers.length; i++) {
            uint256 paid = _payerEth[_invoiceHash][payers[i]];
            if (paid > 0) {
                _payerEth[_invoiceHash][payers[i]] = 0;
                (bool sent, ) = payable(payers[i]).call{value: paid}("");
                require(sent, "Refund failed");
            }
        }
        _ethHeld[_invoiceHash] = 0;

        emit InvoiceCancelled(_invoiceHash);
    }

    receive() external payable {}

    function addBreakdownItem(bytes32 _invoiceHash, string calldata _label, InEuint64 calldata _encryptedPrice) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator == msg.sender, "Only creator");
        require(inv.status == STATUS_OPEN, "Not open");
        require(_breakdowns[_invoiceHash].length < 20, "Max 20 items");

        euint64 price = FHE.asEuint64(_encryptedPrice);
        FHE.allowThis(price);
        FHE.allowSender(price);

        _breakdowns[_invoiceHash].push(BreakdownItem({ label: _label, encryptedPrice: price }));
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

    function getInvoice(bytes32 _invoiceHash) external view returns (
        address creator, address recipient, bool hasRecipient, uint8 invoiceType, uint8 status,
        uint256 deadline, uint256 createdAt, uint256 createdBlock, uint256 unlockBlock
    ) {
        Invoice storage inv = invoices[_invoiceHash];
        return (inv.creator, inv.recipient, inv.hasRecipient, inv.invoiceType, inv.status,
                inv.deadline, inv.createdAt, inv.createdBlock, inv.unlockBlock);
    }

    function getEncryptedRecipient(bytes32 _invoiceHash) external view returns (eaddress) { return invoices[_invoiceHash].encryptedRecipient; }
    function getEncryptedAmount(bytes32 _invoiceHash) external view returns (euint64) { return invoices[_invoiceHash].encryptedAmount; }
    function getEncryptedCollected(bytes32 _invoiceHash) external view returns (euint64) { return invoices[_invoiceHash].totalCollected; }
    function getInvoiceMemo(bytes32 _invoiceHash) external view returns (string memory) { return invoices[_invoiceHash].memo; }
    function getPayerCount(bytes32 _invoiceHash) external view returns (uint256) { return invoices[_invoiceHash].payerCount; }
    function getUserInvoices(address _user) external view returns (bytes32[] memory) { return userInvoices[_user]; }
    function getPaidInvoices(address _user) external view returns (bytes32[] memory) { return paidInvoices[_user]; }
    function checkHasPaid(bytes32 _invoiceHash, address _payer) external view returns (bool) { return hasPaid[_invoiceHash][_payer]; }

    function requestFullyPaidCheck(bytes32 _invoiceHash) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        ebool isPaidInFull = FHE.gte(inv.totalCollected, inv.encryptedAmount);
        FHE.allowThis(isPaidInFull);
        _paidCheckResults[_invoiceHash] = isPaidInFull;
        FHE.decrypt(isPaidInFull);
    }

    function getFullyPaidResult(bytes32 _invoiceHash) external view returns (bool isPaid, bool decrypted) {
        ebool result = _paidCheckResults[_invoiceHash];
        (bool value, bool isReady) = FHE.getDecryptResultSafe(result);
        return (value, isReady);
    }

    function setInvoiceTax(bytes32 _invoiceHash, uint64 _taxBps) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator == msg.sender, "Only creator");
        require(_taxBps <= 5000, "Tax cannot exceed 50%");
        euint64 taxRate = FHE.asEuint64(_taxBps);
        FHE.allowThis(taxRate);
        euint64 taxAmount = FHE.div(FHE.mul(inv.encryptedAmount, taxRate), FHE.asEuint64(10000));
        FHE.allowThis(taxAmount);
        FHE.allowSender(taxAmount);
        invoiceTax[_invoiceHash] = taxAmount;
    }

    function getEncryptedTax(bytes32 _invoiceHash) external view returns (euint64) { return invoiceTax[_invoiceHash]; }

    function generateEncryptedNonce() external returns (euint64) {
        euint64 nonce = FHE.randomEuint64();
        FHE.allowThis(nonce);
        FHE.allowSender(nonce);
        return nonce;
    }

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

    function getPlatformVolume() external view returns (euint64) { return platformVolume; }
    function getPlatformInvoiceCount() external view returns (euint32) { return platformInvoiceCount; }
}
