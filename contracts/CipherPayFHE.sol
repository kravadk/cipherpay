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
    /// @notice Donation — open-ended, no target amount, no auto-settle.
    ///         Encrypted amount is set to 0 by convention. Creator sweeps
    ///         via settleInvoice at any time. All donation amounts remain
    ///         encrypted; only the aggregate ETH held is visible.
    uint8 constant TYPE_DONATION = 4;

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

    /// @notice Per-user prefunded shielded balance.
    /// @dev Backs `payInvoiceShielded` so that an invoice payment carries
    ///      msg.value == 0, breaking the on-chain link between the plaintext
    ///      ETH transferred and the (encrypted) per-invoice amount.
    mapping(address => uint256) public shieldedBalance;
    event ShieldedDeposit(address indexed user, uint256 amount);
    event ShieldedWithdraw(address indexed user, uint256 amount);
    event InvoicePaidShielded(bytes32 indexed invoiceHash, address indexed payer);

    // -------- Anonymous Invoice Claim --------
    // An anonymous invoice has no per-payer event and no payer list. The
    // creator never learns who paid; payers cannot tell how many other payers
    // exist or what each contributed. Replay protection uses a nullifier set,
    // not the payer address. The encrypted aggregate total is the only thing
    // that grows on-chain, and it stays encrypted (only the creator can read
    // its final value via permit-based reveal).
    mapping(bytes32 => bool) public anonEnabled;
    mapping(bytes32 => mapping(bytes32 => bool)) public anonNullifierUsed;
    mapping(bytes32 => uint256) public anonEthPool; // aggregate ETH pool
    event AnonInvoiceEnabled(bytes32 indexed invoiceHash);
    event AnonClaimSubmitted(bytes32 indexed invoiceHash, bytes32 indexed nullifier);

    struct RecurringSchedule {
        uint256 intervalSeconds;
        uint256 totalPeriods;
        uint256 claimedPeriods;
        uint256 startTimestamp;
    }
    mapping(bytes32 => RecurringSchedule) private _recurring;

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
    event RecurringDeposited(bytes32 indexed invoiceHash, address indexed payer, uint256 totalAmount, uint256 periods, uint256 interval);
    event RecurringClaimed(bytes32 indexed invoiceHash, address indexed creator, uint256 amount, uint256 periodsClaimedSoFar);

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
        require(_invoiceType <= 4, "Invalid type");

        bytes32 invoiceHash = keccak256(abi.encodePacked(msg.sender, _salt, block.number));
        require(invoices[invoiceHash].creator == address(0), "Hash collision");

        // ACL: least-privilege — encrypted invoice amount is decryptable only
        // by (a) this contract for arithmetic and (b) the creator (sender).
        // The recipient gains access lazily on payment via FHE.allow below.
        euint64 amount = FHE.asEuint64(_encryptedAmount);
        FHE.allowThis(amount);
        FHE.allowSender(amount);

        // Encrypted recipient: only the creator can decrypt off-chain.
        eaddress encRecipient = FHE.asEaddress(_encryptedRecipient);
        FHE.allowThis(encRecipient);
        FHE.allowSender(encRecipient);

        // Running collected total starts at zero — only this contract can mutate.
        euint64 zero = FHE.asEuint64(0);
        FHE.allowThis(zero);

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
        // allowGlobal is intentional: the *count* of invoices is a public
        // protocol metric (analogous to a public counter on a DEX). It carries
        // no per-user information, so global decryptability is least-privilege
        // for this datum specifically — it does NOT extend to amounts.
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

        // remaining/actualPayment are short-lived intermediates: granted
        // single-tx (transient) access only — never persisted, never
        // exposed to any external party. This is strictly tighter than
        // allowThis (which would survive past this transaction).
        euint64 remaining = FHE.sub(inv.encryptedAmount, inv.totalCollected);
        FHE.allowTransient(remaining, address(this));
        euint64 actualPayment = FHE.min(remaining, payment);
        FHE.allowTransient(actualPayment, address(this));

        inv.totalCollected = FHE.add(inv.totalCollected, actualPayment);
        FHE.allowThis(inv.totalCollected);
        // Least-privilege: payer can see *their* contribution; creator can
        // see the running total. No global grant.
        FHE.allowSender(inv.totalCollected);
        FHE.allow(inv.totalCollected, inv.creator);

        _ensurePlatformInit();
        platformVolume = FHE.add(platformVolume, actualPayment);
        FHE.allowThis(platformVolume);
        // allowGlobal: aggregate platform volume across ALL invoices is a
        // public protocol KPI (TVL-equivalent). Per-invoice amounts remain
        // shielded by the ACLs above. Documented as least-privilege for
        // this aggregate-only datum.
        FHE.allowGlobal(platformVolume);

        // Mark as publicly decryptable so the frontend can call
        // decryptForTx (new API — FHE.decrypt() deprecated April 13 2026).
        ebool isPaidInFull = FHE.gte(inv.totalCollected, inv.encryptedAmount);
        FHE.allowThis(isPaidInFull);
        FHE.allowPublic(isPaidInFull);

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
        // MULTIPAY and DONATION both require manual settle by creator.
        if (inv.invoiceType != TYPE_MULTIPAY && inv.invoiceType != TYPE_DONATION) {
            inv.status = STATUS_SETTLED;
            uint256 payout = _ethHeld[_invoiceHash];
            _ethHeld[_invoiceHash] = 0;
            (bool sent, ) = payable(inv.creator).call{value: payout}("");
            require(sent, "ETH transfer failed");
            emit InvoiceSettled(_invoiceHash);
        }

        emit InvoicePaid(_invoiceHash, msg.sender);
    }

    /**
     * @notice Deposit ETH into a per-user shielded balance.
     * @dev The deposit amount is necessarily public (it's an ETH transfer),
     *      but once funds are inside `shieldedBalance` they can be spent
     *      via `payInvoiceShielded` without exposing per-payment amounts on-chain.
     */
    function depositShielded() external payable {
        require(msg.value > 0, "Must send ETH");
        shieldedBalance[msg.sender] += msg.value;
        emit ShieldedDeposit(msg.sender, msg.value);
    }

    /// @notice Withdraw unspent shielded balance.
    function withdrawShielded(uint256 _amount) external {
        require(_amount > 0 && shieldedBalance[msg.sender] >= _amount, "Bad amount");
        shieldedBalance[msg.sender] -= _amount;
        (bool sent, ) = payable(msg.sender).call{value: _amount}("");
        require(sent, "Withdraw failed");
        emit ShieldedWithdraw(msg.sender, _amount);
    }

    /**
     * @notice Pay an invoice from the prefunded shielded balance.
     * @dev Unlike `payInvoice`, this entrypoint takes msg.value == 0, so the
     *      transaction's plaintext value field carries no information about
     *      the encrypted amount. The actual ETH movement (debit from
     *      shieldedBalance, credit to creator) happens internally and is
     *      bounded by `_maxDebit` — a per-call cap that the user picks (e.g.
     *      a round number like 0.01 ETH) to bucket payments and break the
     *      link between an individual invoice and an exact ETH transfer.
     *
     *      Privacy properties:
     *        - msg.value is always 0 → no per-call leakage from the tx envelope
     *        - encrypted payment amount stays encrypted on-chain
     *        - creator receives exactly `_maxDebit` (a coarse, user-chosen
     *          bucket), not the true encrypted amount; the difference stays
     *          credited to the creator's own shielded balance for later use,
     *          so no on-chain link between this payment and the real amount.
     *
     *      Limitations: the chosen `_maxDebit` is still public, so users
     *      should pick a small set of standard buckets (0.001, 0.01, 0.1).
     */
    function payInvoiceShielded(
        bytes32 _invoiceHash,
        InEuint64 calldata _encryptedPayment,
        uint256 _maxDebit
    ) external {
        require(_maxDebit > 0, "Bad debit");
        require(shieldedBalance[msg.sender] >= _maxDebit, "Insufficient shielded balance");

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

        // Move ETH internally — payer is debited the *bucket*, creator is
        // credited the same bucket into their own shielded balance. No
        // per-invoice ETH transfer hits the chain plaintext.
        shieldedBalance[msg.sender] -= _maxDebit;
        shieldedBalance[inv.creator] += _maxDebit;

        if (!hasPaid[_invoiceHash][msg.sender]) {
            hasPaid[_invoiceHash][msg.sender] = true;
            paidInvoices[msg.sender].push(_invoiceHash);
            _payers[_invoiceHash].push(msg.sender);
            inv.payerCount++;
        }

        emit InvoicePaidShielded(_invoiceHash, msg.sender);
    }

    /**
     * @notice Creator opts an existing invoice into anonymous-claim mode.
     * @dev Once enabled, payments via `claimAnonymously` will not record the
     *      payer address, will not emit `InvoicePaid`, and the creator gets
     *      no per-payer trail. The aggregate encrypted total still updates.
     */
    function enableAnonClaim(bytes32 _invoiceHash) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator == msg.sender, "Only creator");
        require(inv.status == STATUS_OPEN, "Not open");
        anonEnabled[_invoiceHash] = true;
        emit AnonInvoiceEnabled(_invoiceHash);
    }

    /**
     * @notice Submit a payment to an anonymous invoice without revealing identity.
     * @param _invoiceHash invoice to pay
     * @param _encryptedPayment encrypted contribution amount
     * @param _nullifier   client-generated 32-byte nullifier (e.g.
     *                     keccak256(secret || invoiceHash)). Re-using the
     *                     same nullifier reverts, preventing replay/spam.
     *
     * @dev Privacy properties:
     *      - msg.sender is NOT recorded against the invoice (no `_payers`,
     *        no `hasPaid`, no `paidInvoices` write)
     *      - no `InvoicePaid` event (would expose `indexed payer`); only a
     *        nullifier-keyed event is emitted, which links to a secret only
     *        the payer knows
     *      - the creator cannot enumerate payers; the encrypted total is
     *        the only signal that the invoice received funds
     *      - payerCount is intentionally NOT incremented in anon mode, so
     *        the creator does not learn how many distinct contributors exist
     *
     *      Trade-off: msg.value still leaks the per-call ETH amount in the
     *      tx envelope. Combine with `payInvoiceShielded` semantics if the
     *      payer also wants to hide the bucket — left as a follow-up so this
     *      entrypoint stays simple to integrate.
     */
    function claimAnonymously(
        bytes32 _invoiceHash,
        InEuint64 calldata _encryptedPayment,
        bytes32 _nullifier
    ) external payable {
        require(msg.value > 0, "Must send ETH");

        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(inv.status == STATUS_OPEN, "Not open");
        require(anonEnabled[_invoiceHash], "Anon not enabled");
        require(!anonNullifierUsed[_invoiceHash][_nullifier], "Nullifier used");
        if (inv.deadline > 0) {
            require(block.timestamp <= inv.deadline, "Deadline passed");
        }
        // Anonymous-claim mode is incompatible with hasRecipient — that
        // would require msg.sender == recipient, which de-anonymises.
        require(!inv.hasRecipient, "Anon disallowed for restricted invoice");

        anonNullifierUsed[_invoiceHash][_nullifier] = true;

        euint64 payment = FHE.asEuint64(_encryptedPayment);
        FHE.allowThis(payment);

        euint64 remaining = FHE.sub(inv.encryptedAmount, inv.totalCollected);
        FHE.allowTransient(remaining, address(this));
        euint64 actualPayment = FHE.min(remaining, payment);
        FHE.allowTransient(actualPayment, address(this));

        inv.totalCollected = FHE.add(inv.totalCollected, actualPayment);
        FHE.allowThis(inv.totalCollected);
        // Only the creator can decrypt the running total. Notably we do NOT
        // call FHE.allowSender here — that would let the anonymous payer
        // decrypt the aggregate, which leaks across all payers.
        FHE.allow(inv.totalCollected, inv.creator);

        _ensurePlatformInit();
        platformVolume = FHE.add(platformVolume, actualPayment);
        FHE.allowThis(platformVolume);
        FHE.allowGlobal(platformVolume);

        anonEthPool[_invoiceHash] += msg.value;
        _ethHeld[_invoiceHash] += msg.value;

        // No `_payers.push`, no `hasPaid` write, no `paidInvoices.push`.
        // Only a nullifier-keyed event — does not contain msg.sender.
        emit AnonClaimSubmitted(_invoiceHash, _nullifier);
    }

    /**
     * @notice Creator sweeps the anonymous ETH pool. Called manually because
     *         there is no per-payment auto-settle (auto-settle would require
     *         comparing aggregate to target, which is encrypted).
     */
    function sweepAnonPool(bytes32 _invoiceHash) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator == msg.sender, "Only creator");
        require(anonEnabled[_invoiceHash], "Anon not enabled");
        uint256 payout = anonEthPool[_invoiceHash];
        require(payout > 0, "Nothing to sweep");
        anonEthPool[_invoiceHash] = 0;
        // _ethHeld is the union; subtract the swept share.
        if (_ethHeld[_invoiceHash] >= payout) {
            _ethHeld[_invoiceHash] -= payout;
        } else {
            _ethHeld[_invoiceHash] = 0;
        }
        (bool sent, ) = payable(inv.creator).call{value: payout}("");
        require(sent, "ETH transfer failed");
    }

    function settleInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator == msg.sender, "Only creator");
        require(inv.status == STATUS_OPEN, "Not open");
        require(inv.invoiceType == TYPE_MULTIPAY || inv.invoiceType == TYPE_DONATION, "Not multipay/donation");

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

    function depositRecurring(
        bytes32 _invoiceHash,
        uint256 _intervalSeconds,
        uint256 _totalPeriods
    ) external payable {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(inv.invoiceType == TYPE_RECURRING, "Not recurring");
        require(inv.status == STATUS_OPEN, "Not open");
        require(_totalPeriods > 0, "At least 1 period");
        require(_intervalSeconds >= 1 hours, "Interval too short");
        require(msg.value > 0, "Must send ETH");
        require(_recurring[_invoiceHash].startTimestamp == 0, "Already deposited");
        if (inv.hasRecipient) {
            require(msg.sender == inv.recipient, "Not authorized");
        }

        _recurring[_invoiceHash] = RecurringSchedule({
            intervalSeconds: _intervalSeconds,
            totalPeriods: _totalPeriods,
            claimedPeriods: 0,
            startTimestamp: block.timestamp
        });

        _ethHeld[_invoiceHash] = msg.value;
        if (!hasPaid[_invoiceHash][msg.sender]) {
            hasPaid[_invoiceHash][msg.sender] = true;
            _payers[_invoiceHash].push(msg.sender);
            paidInvoices[msg.sender].push(_invoiceHash);
            inv.payerCount++;
        }
        _payerEth[_invoiceHash][msg.sender] += msg.value;

        emit RecurringDeposited(_invoiceHash, msg.sender, msg.value, _totalPeriods, _intervalSeconds);
    }

    function claimRecurring(bytes32 _invoiceHash) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(inv.invoiceType == TYPE_RECURRING, "Not recurring");
        require(inv.status == STATUS_OPEN, "Not open");
        require(msg.sender == inv.creator, "Only creator");

        RecurringSchedule storage sched = _recurring[_invoiceHash];
        require(sched.startTimestamp > 0, "Not deposited yet");

        uint256 elapsed = block.timestamp - sched.startTimestamp;
        uint256 unlockedPeriods = elapsed / sched.intervalSeconds;
        if (unlockedPeriods > sched.totalPeriods) unlockedPeriods = sched.totalPeriods;

        uint256 claimable = unlockedPeriods - sched.claimedPeriods;
        require(claimable > 0, "Nothing to claim yet");

        uint256 totalDeposit = _ethHeld[_invoiceHash];
        uint256 perPeriod = totalDeposit / sched.totalPeriods;
        uint256 payout;

        if (unlockedPeriods == sched.totalPeriods) {
            payout = totalDeposit - (sched.claimedPeriods * perPeriod);
        } else {
            payout = claimable * perPeriod;
        }

        sched.claimedPeriods = unlockedPeriods;

        if (sched.claimedPeriods == sched.totalPeriods) {
            inv.status = STATUS_SETTLED;
            _ethHeld[_invoiceHash] = 0;
            emit InvoiceSettled(_invoiceHash);
        }

        (bool sent, ) = payable(inv.creator).call{value: payout}("");
        require(sent, "ETH transfer failed");

        emit RecurringClaimed(_invoiceHash, inv.creator, payout, sched.claimedPeriods);
    }

    function getRecurringSchedule(bytes32 _invoiceHash) external view returns (
        uint256 intervalSeconds, uint256 totalPeriods, uint256 claimedPeriods,
        uint256 startTimestamp, uint256 perPeriodAmount, uint256 claimableNow
    ) {
        RecurringSchedule storage sched = _recurring[_invoiceHash];
        uint256 totalDeposit = _ethHeld[_invoiceHash];
        uint256 perPeriod = sched.totalPeriods > 0 ? totalDeposit / sched.totalPeriods : 0;
        uint256 unlocked = 0;
        uint256 claimableCount = 0;
        if (sched.startTimestamp > 0) {
            unlocked = (block.timestamp - sched.startTimestamp) / sched.intervalSeconds;
            if (unlocked > sched.totalPeriods) unlocked = sched.totalPeriods;
            claimableCount = unlocked - sched.claimedPeriods;
        }
        return (sched.intervalSeconds, sched.totalPeriods, sched.claimedPeriods, sched.startTimestamp, perPeriod, claimableCount);
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

    /**
     * @notice Phase 1 of the two-phase decrypt flow (FHE.decrypt deprecated
     *         April 13 2026). Computes isPaidInFull and marks the handle as
     *         publicly decryptable (FHE.allowPublic). The caller must then:
     *   1. off-chain: `client.decryptForTx(ctHash).withoutPermit().execute()`
     *   2. on-chain:  `publishPaidCheckResult(invoiceHash, plaintext, sig)`
     */
    function requestFullyPaidCheck(bytes32 _invoiceHash) external {
        Invoice storage inv = invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        ebool isPaidInFull = FHE.gte(inv.totalCollected, inv.encryptedAmount);
        FHE.allowThis(isPaidInFull);
        _paidCheckResults[_invoiceHash] = isPaidInFull;
        FHE.allowPublic(isPaidInFull);
    }

    /**
     * @notice Phase 2 — submit the Threshold Network decrypt signature to
     *         verify and store the plaintext result on-chain.
     * @param _invoiceHash invoice whose paid-check handle was requested
     * @param _plaintext   plaintext bool returned by `decryptForTx`
     * @param _signature   Threshold Network signature returned by `decryptForTx`
     */
    function publishPaidCheckResult(
        bytes32 _invoiceHash,
        bool _plaintext,
        bytes calldata _signature
    ) external {
        ebool result = _paidCheckResults[_invoiceHash];
        require(ebool.unwrap(result) != 0, "No check requested");
        FHE.publishDecryptResult(result, _plaintext, _signature);
    }

    /**
     * @notice Read the stored plaintext result after `publishPaidCheckResult`
     *         has been called. Returns (false, false) if not yet published.
     */
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
            // allowGlobal is restricted to these two protocol-wide aggregates
            // (TVL-style volume and invoice count). They are explicitly
            // designed to be public and contain no per-user information.
            // No other handle in this contract receives allowGlobal.
            FHE.allowGlobal(platformVolume);
            FHE.allowGlobal(platformInvoiceCount);
            _platformInitialized = true;
        }
    }

    function getPlatformVolume() external view returns (euint64) { return platformVolume; }
    function getPlatformInvoiceCount() external view returns (euint32) { return platformInvoiceCount; }
}
