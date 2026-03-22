// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64, euint32} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title InvoiceMetrics
 * @notice Encrypted per-user payment analytics
 * @dev Tracks volume and counts without revealing individual amounts.
 *      Only the user themselves can decrypt their own metrics via permit.
 */
contract InvoiceMetrics {
    struct UserStats {
        euint64 totalSent;       // encrypted total ETH sent
        euint64 totalReceived;   // encrypted total ETH received
        euint32 invoicesCreated; // encrypted count created
        euint32 invoicesPaid;    // encrypted count paid
        bool initialized;
    }

    mapping(address => UserStats) private _stats;

    address public invoiceContract; // only invoice contract can update

    event MetricsUpdated(address indexed user);

    modifier onlyInvoiceContract() {
        require(msg.sender == invoiceContract, "Only invoice contract");
        _;
    }

    constructor(address _invoiceContract) {
        invoiceContract = _invoiceContract;
    }

    /**
     * @notice Initialize stats for a user (idempotent)
     */
    function _ensureInitialized(address _user) internal {
        if (!_stats[_user].initialized) {
            _stats[_user].totalSent = FHE.asEuint64(0);
            _stats[_user].totalReceived = FHE.asEuint64(0);
            _stats[_user].invoicesCreated = FHE.asEuint32(0);
            _stats[_user].invoicesPaid = FHE.asEuint32(0);
            FHE.allowThis(_stats[_user].totalSent);
            FHE.allowThis(_stats[_user].totalReceived);
            FHE.allowThis(_stats[_user].invoicesCreated);
            FHE.allowThis(_stats[_user].invoicesPaid);
            FHE.allow(_stats[_user].totalSent, _user);
            FHE.allow(_stats[_user].totalReceived, _user);
            FHE.allow(_stats[_user].invoicesCreated, _user);
            FHE.allow(_stats[_user].invoicesPaid, _user);
            _stats[_user].initialized = true;
        }
    }

    /**
     * @notice Record invoice creation — called by invoice contract
     */
    function onInvoiceCreated(address _creator, InEuint64 calldata _encryptedAmount) external onlyInvoiceContract {
        _ensureInitialized(_creator);
        // Increment created count
        _stats[_creator].invoicesCreated = FHE.add(_stats[_creator].invoicesCreated, FHE.asEuint32(1));
        FHE.allowThis(_stats[_creator].invoicesCreated);
        FHE.allow(_stats[_creator].invoicesCreated, _creator);

        emit MetricsUpdated(_creator);
    }

    /**
     * @notice Record payment — called by invoice contract
     */
    function onPaymentMade(
        address _payer,
        address _creator,
        InEuint64 calldata _encryptedAmount
    ) external onlyInvoiceContract {
        _ensureInitialized(_payer);
        _ensureInitialized(_creator);

        euint64 amount = FHE.asEuint64(_encryptedAmount);
        FHE.allowThis(amount);

        // Update payer stats
        _stats[_payer].totalSent = FHE.add(_stats[_payer].totalSent, amount);
        _stats[_payer].invoicesPaid = FHE.add(_stats[_payer].invoicesPaid, FHE.asEuint32(1));
        FHE.allowThis(_stats[_payer].totalSent);
        FHE.allowThis(_stats[_payer].invoicesPaid);
        FHE.allow(_stats[_payer].totalSent, _payer);
        FHE.allow(_stats[_payer].invoicesPaid, _payer);

        // Update creator stats
        _stats[_creator].totalReceived = FHE.add(_stats[_creator].totalReceived, amount);
        FHE.allowThis(_stats[_creator].totalReceived);
        FHE.allow(_stats[_creator].totalReceived, _creator);

        emit MetricsUpdated(_payer);
        emit MetricsUpdated(_creator);
    }

    // ========== View Functions (return encrypted handles, need permit to decrypt) ==========

    function getTotalSent(address _user) external view returns (euint64) {
        return _stats[_user].totalSent;
    }

    function getTotalReceived(address _user) external view returns (euint64) {
        return _stats[_user].totalReceived;
    }

    function getInvoicesCreated(address _user) external view returns (euint32) {
        return _stats[_user].invoicesCreated;
    }

    function getInvoicesPaid(address _user) external view returns (euint32) {
        return _stats[_user].invoicesPaid;
    }

    function isInitialized(address _user) external view returns (bool) {
        return _stats[_user].initialized;
    }
}
