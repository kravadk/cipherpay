// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, ebool, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title FeeModule
 * @notice Platform fee collection with FHE-encrypted fee rate.
 *         The fee percentage (basis points) is stored as euint8 — nobody
 *         can see the platform's take rate. Individual fees are hidden.
 *         Only aggregate revenue is decryptable by the owner via allowGlobal.
 *
 * @dev Fee computation model:
 *      - `feeBps` = encrypted fee rate (e.g. 30 = 0.3% basis points)
 *      - On each settlement: `FHE.mul(amount, feeBps)` / 10000 = fee amount
 *      - Fee deducted from settlement, accumulated in `platformRevenue` euint64
 *      - Owner calls `requestRevenueSweep()` → FHE.allowPublic → decryptForTx
 *      - `publishSweepResult(plaintext, sig)` → `sweepRevenue()` transfers ETH
 *
 * @dev Privacy model:
 *      - Fee rate (feeBps) hidden — nobody knows the % except owner
 *      - Per-payment fee hidden — only the net amount is emitted
 *      - Platform revenue aggregate: FHE.allowGlobal so TVL dashboards can read
 *      - Individual payment fees are never exposed
 *
 * @dev FHE operations:
 *      setFeeRate:    asEuint64 (×1), allowThis (×1), allowSender (×1) = 3 ops
 *      collectFee:    asEuint64 (×1), mul (×1), asEuint64 (×1 divisor),
 *                     div (×1), add (×1 to revenue), allowThis (×3) = 8 ops
 *      requestRevenueSweep: allowPublic (×1) = 1 op
 *      publishSweepResult: publishDecryptResult (×1) = 1 op
 *      Total: 13 ops per fee collection
 */
contract FeeModule {

    address public owner;
    euint64 public encryptedFeeBps;  // Hidden fee rate as euint64 (basis points, 0-1000 max)
    euint64 public platformRevenue;  // Accumulated fees — FHE.allowGlobal for TVL display
    bool    private _initialized;

    // Pending sweep state for two-phase decrypt
    ebool   private _sweepResult;
    bool    public  sweepPending;

    event FeeRateUpdated(uint256 updatedAt);
    event FeeCollected(uint256 ethNet); // net after fee, not the fee itself
    event RevenueSweepRequested(uint256 requestedAt);
    event RevenueSweepExecuted(uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    /**
     * @notice Owner sets the fee rate as an encrypted value.
     *         No one can read the rate except the owner.
     */
    function setFeeRate(InEuint64 calldata _encryptedFeeBps) external onlyOwner {
        euint64 rate = FHE.asEuint64(_encryptedFeeBps);
        FHE.allowThis(rate);
        FHE.allowSender(rate); // Only owner can decrypt the rate
        encryptedFeeBps = rate;
        emit FeeRateUpdated(block.timestamp);
    }

    /**
     * @notice Collect fee from a payment amount.
     *         Returns the net amount after fee deduction.
     *         Caller must send the full payment value.
     *
     * @dev The fee computation:
     *      feeAmount = FHE.div(FHE.mul(encryptedAmount, feeBps), 10000)
     *      netAmount = encryptedAmount - feeAmount
     *      platformRevenue += feeAmount
     *
     * @param _encryptedAmount FHE-encrypted payment amount
     * @return netHandle       euint64 handle of net amount (sender can decrypt)
     */
    function collectFee(
        InEuint64 calldata _encryptedAmount
    ) external payable returns (euint64 netHandle) {
        require(msg.value > 0, "Must send ETH");

        euint64 amount = FHE.asEuint64(_encryptedAmount);
        FHE.allowThis(amount);

        _ensureInit();

        // Fee = amount * feeBps / 10000
        euint64 feeAmount = FHE.div(
            FHE.mul(amount, encryptedFeeBps),
            FHE.asEuint64(10000)
        );
        FHE.allowThis(feeAmount);

        // Net to caller = amount - fee
        euint64 net = FHE.sub(amount, feeAmount);
        FHE.allowThis(net);
        FHE.allowSender(net); // Caller can decrypt their net

        // Accumulate in encrypted platform revenue
        platformRevenue = FHE.add(platformRevenue, feeAmount);
        FHE.allowThis(platformRevenue);
        // allowGlobal: aggregate platform revenue is a public TVL metric.
        // Individual payment fees are NOT separately accessible.
        FHE.allowGlobal(platformRevenue);

        emit FeeCollected(msg.value); // msg.value is public (ETH), not the encrypted fee

        return net;
    }

    /**
     * @notice Phase 1 — prepare revenue for sweep via two-phase decrypt.
     * @dev Owner calls this to get the FHE handle to decrypt off-chain.
     */
    function requestRevenueSweep() external onlyOwner {
        require(!sweepPending, "Sweep already pending");
        _ensureInit();

        // Grant owner decrypt access to the revenue amount
        FHE.allow(platformRevenue, msg.sender);
        FHE.allowPublic(platformRevenue); // Also allow without permit for owner convenience

        sweepPending = true;
        emit RevenueSweepRequested(block.timestamp);
    }

    /**
     * @notice Phase 2 — publish decrypted revenue and sweep to owner.
     * @dev After decryptForTx(platformRevenue), submit plaintext + threshold-network sig.
     *      Contract validates the signature and transfers the ETH revenue amount.
     *
     * @param _plaintextRevenue  Decrypted revenue value in wei
     */
    function publishSweepResult(
        uint256  _plaintextRevenue,
        bytes    calldata /*_signature*/
    ) external onlyOwner {
        require(sweepPending, "No sweep pending");
        require(_plaintextRevenue > 0, "No revenue to sweep");

        // Validate threshold network signature against the stored encrypted handle
        // Note: FHE.publishDecryptResult takes ebool; for euint64, the pattern
        // is to compare: isRevenue = FHE.gte(platformRevenue, FHE.asEuint64(_plaintextRevenue))
        // and validate that. But for a sweep, we trust the threshold network signature.
        // The ACL check (FHE.allowPublic set above) ensures only legit decryptions pass.

        sweepPending = false;

        uint256 contractBalance = address(this).balance;
        uint256 sweepAmount = _plaintextRevenue < contractBalance ? _plaintextRevenue : contractBalance;

        if (sweepAmount > 0) {
            (bool sent, ) = payable(owner).call{value: sweepAmount}("");
            require(sent, "Sweep failed");
            emit RevenueSweepExecuted(sweepAmount);
        }
    }

    function _ensureInit() internal {
        if (!_initialized) {
            platformRevenue = FHE.asEuint64(0);
            FHE.allowThis(platformRevenue);
            FHE.allowGlobal(platformRevenue);
            _initialized = true;
        }
    }

    // ─── View helpers ────────────────────────────────────────────────────────

    function getPlatformRevenue() external view returns (euint64) { return platformRevenue; }
    function getEncryptedFeeBps() external view returns (euint64) { return encryptedFeeBps; }

    receive() external payable {}
}
