// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * CipherPaySimple v3 — Real ETH transfers.
 * Payer sends ETH → contract holds it → creator receives on settle/auto-settle.
 */
contract CipherPaySimple {
    struct Invoice {
        address creator;
        address recipient;
        uint8   invoiceType;    // 0=standard, 1=multipay, 2=recurring, 3=vesting, 4=batch
        uint8   status;         // 0=open, 1=settled, 2=cancelled, 3=paused
        uint256 amount;
        uint256 collected;
        uint256 deadline;
        uint256 createdAt;
        uint256 createdBlock;
        uint256 unlockBlock;
        uint256 payerCount;
        string  memo;
    }

    mapping(bytes32 => Invoice) private _invoices;
    mapping(address => bytes32[]) private _userInvoices;
    mapping(address => bytes32[]) private _payerInvoices;
    mapping(bytes32 => mapping(address => uint256)) public paymentAmounts;
    mapping(bytes32 => address[]) private _payers;

    event InvoiceCreated(
        bytes32 indexed invoiceHash, address indexed creator,
        uint8 invoiceType, address recipient, uint256 amount,
        uint256 deadline, uint256 unlockBlock, string memo
    );
    event InvoicePaid(bytes32 indexed invoiceHash, address indexed payer, uint256 amount, uint256 totalCollected);
    event InvoiceSettled(bytes32 indexed invoiceHash);
    event InvoiceCancelled(bytes32 indexed invoiceHash);

    /**
     * @notice Create an invoice. For vesting (type=3): creator sends ETH upfront as escrow.
     * Recipient claims after unlock block. For other types: no ETH needed at creation.
     */
    function createInvoice(
        uint256 _amount, address _recipient, uint8 _invoiceType,
        uint256 _deadline, uint256 _unlockBlock, bytes32 _salt, string calldata _memo
    ) external payable returns (bytes32) {
        bytes32 invoiceHash = keccak256(abi.encodePacked(_salt, msg.sender, block.number, block.timestamp));
        require(_invoices[invoiceHash].creator == address(0), "Hash collision");
        require(_invoiceType <= 4, "Invalid type");
        require(_amount > 0, "Amount must be > 0");
        if (_deadline > 0) require(_deadline > block.timestamp, "Deadline in past");

        // Vesting: creator must send ETH upfront as escrow
        if (_invoiceType == 3) {
            require(_recipient != address(0), "Vesting requires recipient");
            require(msg.value == _amount, "Vesting: must send exact amount as escrow");
            require(_unlockBlock > block.number, "Unlock block must be in future");
        }

        _invoices[invoiceHash] = Invoice({
            creator: msg.sender, recipient: _recipient, invoiceType: _invoiceType,
            status: 0, amount: _amount,
            collected: _invoiceType == 3 ? _amount : 0, // vesting: already funded
            deadline: _deadline, createdAt: block.timestamp, createdBlock: block.number,
            unlockBlock: _unlockBlock, payerCount: 0, memo: _memo
        });
        _userInvoices[msg.sender].push(invoiceHash);
        emit InvoiceCreated(invoiceHash, msg.sender, _invoiceType, _recipient, _amount, _deadline, _unlockBlock, _memo);
        return invoiceHash;
    }

    /**
     * @notice Claim vesting funds — only recipient, only after unlock block.
     */
    function claimVesting(bytes32 _invoiceHash) external {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(inv.invoiceType == 3, "Not vesting");
        require(inv.status == 0, "Not open");
        require(msg.sender == inv.recipient, "Only recipient can claim");
        require(block.number >= inv.unlockBlock, "Still locked");

        inv.status = 1;
        (bool sent, ) = payable(inv.recipient).call{value: inv.amount}("");
        require(sent, "ETH transfer failed");
        emit InvoiceSettled(_invoiceHash);
    }

    /**
     * @notice Pay an invoice — send real ETH. msg.value must match _paymentAmount.
     * For standard/vesting/recurring: ETH goes directly to creator on auto-settle.
     * For multipay: ETH held on contract until creator calls settleInvoice().
     */
    function payInvoice(bytes32 _invoiceHash, uint256 _paymentAmount) external payable {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(inv.status == 0, "Not open");
        require(inv.invoiceType != 3, "Vesting: use claimVesting instead");
        require(_paymentAmount > 0, "Amount must be > 0");
        require(msg.value == _paymentAmount, "ETH sent must match payment amount");
        if (inv.deadline > 0) require(block.timestamp <= inv.deadline, "Deadline passed");
        if (inv.unlockBlock > 0) require(block.number >= inv.unlockBlock, "Still locked");
        if (inv.recipient != address(0)) require(msg.sender == inv.recipient, "Not authorized");

        if (paymentAmounts[_invoiceHash][msg.sender] == 0) {
            _payers[_invoiceHash].push(msg.sender);
            _payerInvoices[msg.sender].push(_invoiceHash);
            inv.payerCount++;
        }
        paymentAmounts[_invoiceHash][msg.sender] += _paymentAmount;
        inv.collected += _paymentAmount;

        emit InvoicePaid(_invoiceHash, msg.sender, _paymentAmount, inv.collected);

        // Auto-settle for non-multipay when full amount reached
        if (inv.invoiceType != 1 && inv.collected >= inv.amount) {
            inv.status = 1;
            // Transfer all collected ETH to creator
            (bool sent, ) = payable(inv.creator).call{value: inv.collected}("");
            require(sent, "ETH transfer failed");
            emit InvoiceSettled(_invoiceHash);
        }
    }

    /**
     * @notice Pay full remaining amount
     */
    function payInvoiceFull(bytes32 _invoiceHash) external payable {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(inv.status == 0, "Not open");
        if (inv.deadline > 0) require(block.timestamp <= inv.deadline, "Deadline passed");
        if (inv.unlockBlock > 0) require(block.number >= inv.unlockBlock, "Still locked");
        if (inv.recipient != address(0)) require(msg.sender == inv.recipient, "Not authorized");

        uint256 remaining = inv.amount > inv.collected ? inv.amount - inv.collected : inv.amount;
        require(remaining > 0, "Already paid");
        require(msg.value == remaining, "ETH sent must match remaining amount");

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
            (bool sent, ) = payable(inv.creator).call{value: inv.collected}("");
            require(sent, "ETH transfer failed");
            emit InvoiceSettled(_invoiceHash);
        }
    }

    /**
     * @notice Settle multipay — transfers all collected ETH to creator
     */
    function settleInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(msg.sender == inv.creator, "Not creator");
        require(inv.status == 0, "Not open");
        require(inv.invoiceType == 1, "Not multipay");
        require(inv.collected > 0, "Nothing collected");

        inv.status = 1;
        // Transfer collected ETH to creator
        (bool sent, ) = payable(inv.creator).call{value: inv.collected}("");
        require(sent, "ETH transfer failed");
        emit InvoiceSettled(_invoiceHash);
    }

    /**
     * @notice Cancel — refunds all collected ETH to payers
     */
    function cancelInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(msg.sender == inv.creator, "Not creator");
        require(inv.status == 0 || inv.status == 3, "Not open or paused");

        inv.status = 2;

        // Refund all payers
        address[] memory payers = _payers[_invoiceHash];
        for (uint i = 0; i < payers.length; i++) {
            uint256 paid = paymentAmounts[_invoiceHash][payers[i]];
            if (paid > 0) {
                paymentAmounts[_invoiceHash][payers[i]] = 0;
                (bool sent, ) = payable(payers[i]).call{value: paid}("");
                // Don't revert if refund fails — just skip
                if (!sent) continue;
            }
        }

        emit InvoiceCancelled(_invoiceHash);
    }

    /**
     * @notice Pause an open invoice — temporarily blocks payments
     */
    function pauseInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(msg.sender == inv.creator, "Not creator");
        require(inv.status == 0, "Not open");
        inv.status = 3;
    }

    /**
     * @notice Resume a paused invoice — re-enables payments
     */
    function resumeInvoice(bytes32 _invoiceHash) external {
        Invoice storage inv = _invoices[_invoiceHash];
        require(inv.creator != address(0), "Invoice not found");
        require(msg.sender == inv.creator, "Not creator");
        require(inv.status == 3, "Not paused");
        inv.status = 0;
    }

    // ── View Functions ─────────────────────────────────────

    function getInvoice(bytes32 _invoiceHash) external view returns (
        address creator, address recipient, uint8 invoiceType, uint8 status,
        uint256 deadline, uint256 createdAt, uint256 createdBlock, uint256 unlockBlock
    ) {
        Invoice storage inv = _invoices[_invoiceHash];
        return (inv.creator, inv.recipient, inv.invoiceType, inv.status,
                inv.deadline, inv.createdAt, inv.createdBlock, inv.unlockBlock);
    }

    function getInvoiceMemo(bytes32 _invoiceHash) external view returns (string memory) {
        return _invoices[_invoiceHash].memo;
    }

    function getInvoiceAmount(bytes32 _invoiceHash) external view returns (uint256) {
        return _invoices[_invoiceHash].amount;
    }

    function getInvoiceCollected(bytes32 _invoiceHash) external view returns (uint256 collected, uint256 target, uint256 payerCount) {
        Invoice storage inv = _invoices[_invoiceHash];
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

    // Allow contract to receive ETH
    receive() external payable {}
}
