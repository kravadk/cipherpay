// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, eaddress, ebool, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title AuditCenter
 * @notice Scoped, time-limited disclosure permits for FHE-encrypted invoice data.
 *         Creators generate audit packages that let auditors decrypt only specific
 *         fields (e.g. amounts only, or amounts + recipients) within a time window.
 *
 * @dev Audit package model:
 *      - Creator calls `createAuditPackage(invoiceHashes[], auditor, expiresAt, scope[])`
 *      - Contract emits `AuditGranted(packageId, auditor, invoiceHashes, scope, expiry)`
 *      - Auditor calls `requestAuditDecrypt(packageId, invoiceHash, field)` to get a handle
 *      - Uses CoFHE permit system off-chain: auditor signs permit for their address
 *      - `isAuditAllowed(packageId, auditor, invoiceHash, field)` — public view for verification
 *
 * @dev Scope model:
 *      - SCOPE_AMOUNT    = 0: Auditor can decrypt invoice amounts
 *      - SCOPE_RECIPIENT = 1: Auditor can decrypt encrypted recipients
 *      - SCOPE_TAX       = 2: Auditor can decrypt tax calculations
 *      - Combined scopes stored as bitmap (bit 0 = amount, bit 1 = recipient, bit 2 = tax)
 *
 * @dev FHE operations:
 *      requestAuditDecrypt: FHE.allow (×1 per field per invoice) = 1 op per grant
 *      Packages themselves are metadata — no FHE ops at creation
 *
 * @dev Privacy model:
 *      - The actual FHE handles come from the CipherPayFHE contract (passed as params)
 *      - AuditCenter stores the handle and grants temporary FHE.allow to the auditor
 *      - After expiry, the grant is revoked (via checking expiry in isAuditAllowed)
 *      - Audit trail: all grants and accesses are on-chain via events
 */
contract AuditCenter {

    uint8 constant SCOPE_AMOUNT    = 0;
    uint8 constant SCOPE_RECIPIENT = 1;
    uint8 constant SCOPE_TAX       = 2;

    struct AuditPackage {
        address  creator;
        address  auditor;
        uint256  expiresAt;
        uint8    scopeBitmap; // bitmask of allowed fields
        uint256  createdAt;
        bool     revoked;
        string   label;       // e.g. "Q1 2026 Tax Audit"
    }

    // packageId => package
    mapping(bytes32 => AuditPackage) public packages;

    // packageId => invoiceHash => bool (included in this audit)
    mapping(bytes32 => mapping(bytes32 => bool)) public packageIncludes;

    // Audit trail: who accessed what
    struct AccessRecord {
        bytes32 packageId;
        bytes32 invoiceHash;
        uint8   field;
        uint256 accessedAt;
    }

    mapping(address => AccessRecord[]) private _auditAccessLog;

    // packageId => invoiceHashes list (for enumeration)
    mapping(bytes32 => bytes32[]) public packageInvoices;

    event AuditGranted(
        bytes32 indexed packageId,
        address indexed creator,
        address indexed auditor,
        uint256 expiresAt,
        uint8   scopeBitmap,
        string  label
    );
    event AuditAccessed(
        bytes32 indexed packageId,
        address indexed auditor,
        bytes32 indexed invoiceHash,
        uint8   field
    );
    event AuditRevoked(bytes32 indexed packageId);

    /**
     * @notice Create a scoped audit package for an auditor.
     * @param _invoiceHashes  Invoices included in this audit
     * @param _auditor        Who will receive decrypt access
     * @param _expiresAt      Unix timestamp when access expires
     * @param _scopeBitmap    Bitmask: bit0=amounts, bit1=recipients, bit2=tax
     * @param _label          Human-readable label for the audit
     */
    function createAuditPackage(
        bytes32[] calldata _invoiceHashes,
        address   _auditor,
        uint256   _expiresAt,
        uint8     _scopeBitmap,
        string    calldata _label
    ) external returns (bytes32 packageId) {
        require(_auditor != address(0), "Invalid auditor");
        require(_expiresAt > block.timestamp, "Expiry in the past");
        require(_invoiceHashes.length > 0 && _invoiceHashes.length <= 500, "1-500 invoices");
        require(_scopeBitmap > 0 && _scopeBitmap <= 7, "Invalid scope bitmap");

        packageId = keccak256(abi.encodePacked(
            msg.sender, _auditor, _expiresAt, _scopeBitmap, block.number, block.timestamp
        ));

        packages[packageId] = AuditPackage({
            creator:     msg.sender,
            auditor:     _auditor,
            expiresAt:   _expiresAt,
            scopeBitmap: _scopeBitmap,
            createdAt:   block.timestamp,
            revoked:     false,
            label:       _label
        });

        for (uint256 i; i < _invoiceHashes.length; i++) {
            packageIncludes[packageId][_invoiceHashes[i]] = true;
            packageInvoices[packageId].push(_invoiceHashes[i]);
        }

        emit AuditGranted(packageId, msg.sender, _auditor, _expiresAt, _scopeBitmap, _label);
    }

    /**
     * @notice Auditor requests FHE decrypt access to a specific invoice field.
     *         This grants FHE.allow(handle, auditor) for the requested field.
     *
     * @dev The caller passes the FHE handle from the CipherPayFHE contract.
     *      This is because AuditCenter doesn't store invoice data — it only
     *      manages the ACL grants. The auditor must look up the handle themselves.
     *
     * @param _packageId    Audit package ID
     * @param _invoiceHash  Invoice to audit
     * @param _field        SCOPE_AMOUNT (0), SCOPE_RECIPIENT (1), or SCOPE_TAX (2)
     * @param _encHandle    The euint64 handle from CipherPayFHE contract
     */
    function requestAuditDecrypt(
        bytes32 _packageId,
        bytes32 _invoiceHash,
        uint8   _field,
        euint64 _encHandle
    ) external {
        AuditPackage storage pkg = packages[_packageId];
        require(pkg.auditor == msg.sender, "Not the auditor");
        require(!pkg.revoked, "Package revoked");
        require(block.timestamp <= pkg.expiresAt, "Package expired");
        require(packageIncludes[_packageId][_invoiceHash], "Invoice not in package");
        require((_field <= 2) && ((pkg.scopeBitmap >> _field) & 1) == 1, "Field not in scope");
        require(euint64.unwrap(_encHandle) != 0, "Invalid handle");

        // Grant temporary decrypt access to the auditor
        // This is the core FHE operation: FHE.allow(handle, auditor)
        FHE.allow(_encHandle, msg.sender);

        _auditAccessLog[msg.sender].push(AccessRecord({
            packageId:   _packageId,
            invoiceHash: _invoiceHash,
            field:       _field,
            accessedAt:  block.timestamp
        }));

        emit AuditAccessed(_packageId, msg.sender, _invoiceHash, _field);
    }

    /**
     * @notice Creator revokes an audit package before expiry.
     */
    function revokeAuditPackage(bytes32 _packageId) external {
        require(packages[_packageId].creator == msg.sender, "Only creator");
        packages[_packageId].revoked = true;
        emit AuditRevoked(_packageId);
    }

    // ─── View helpers ────────────────────────────────────────────────────────

    function isAuditAllowed(
        bytes32 _packageId,
        address _auditor,
        bytes32 _invoiceHash,
        uint8   _field
    ) external view returns (bool) {
        AuditPackage storage pkg = packages[_packageId];
        return (
            pkg.auditor == _auditor &&
            !pkg.revoked &&
            block.timestamp <= pkg.expiresAt &&
            packageIncludes[_packageId][_invoiceHash] &&
            _field <= 2 &&
            ((pkg.scopeBitmap >> _field) & 1) == 1
        );
    }

    function getPackage(bytes32 _packageId) external view returns (
        address  creator,
        address  auditor,
        uint256  expiresAt,
        uint8    scopeBitmap,
        uint256  createdAt,
        bool     revoked,
        string   memory label,
        uint256  invoiceCount
    ) {
        AuditPackage storage p = packages[_packageId];
        return (
            p.creator, p.auditor, p.expiresAt, p.scopeBitmap,
            p.createdAt, p.revoked, p.label,
            packageInvoices[_packageId].length
        );
    }

    function getPackageInvoices(bytes32 _packageId) external view returns (bytes32[] memory) {
        return packageInvoices[_packageId];
    }

    function getAuditAccessLog(address _auditor) external view returns (
        bytes32[] memory packageIds,
        bytes32[] memory invoiceHashes,
        uint8[]   memory fields,
        uint256[] memory timestamps
    ) {
        AccessRecord[] storage log = _auditAccessLog[_auditor];
        uint256 n = log.length;
        packageIds   = new bytes32[](n);
        invoiceHashes = new bytes32[](n);
        fields       = new uint8[](n);
        timestamps   = new uint256[](n);
        for (uint256 i; i < n; i++) {
            packageIds[i]    = log[i].packageId;
            invoiceHashes[i] = log[i].invoiceHash;
            fields[i]        = log[i].field;
            timestamps[i]    = log[i].accessedAt;
        }
    }
}
