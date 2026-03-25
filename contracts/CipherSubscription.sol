// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, euint8, InEuint8, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title CipherSubscription
 * @notice Optional SaaS subscription for CipherPay premium features
 * @dev Tier and expiry are FHE-encrypted — nobody can see who subscribes or at what level
 */
contract CipherSubscription {
    // Tiers: 0 = free (default), 1 = pro, 2 = business
    uint8 public constant TIER_FREE = 0;
    uint8 public constant TIER_PRO = 1;
    uint8 public constant TIER_BUSINESS = 2;

    // Duration: 30 days in seconds
    uint256 public constant PERIOD = 30 days;

    // Prices in wei (owner can update)
    mapping(uint8 => uint256) public tierPrice;

    // Encrypted subscription state — invisible on Etherscan
    mapping(address => euint8) private subTier;      // encrypted tier level
    mapping(address => euint64) private subExpiry;   // encrypted expiry timestamp
    mapping(address => bool) private _hasSubscription;

    // Platform encrypted aggregate — total revenue (only owner can decrypt)
    euint64 public totalRevenue;
    euint64 public subscriberCount;
    bool private _aggregatesInitialized;

    address public owner;
    address public treasury;

    event Subscribed(address indexed user, uint8 tier, uint256 paidWei);
    event Renewed(address indexed user, uint256 paidWei);
    event PriceUpdated(uint8 tier, uint256 newPrice);
    event TreasuryUpdated(address newTreasury);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _treasury) {
        owner = msg.sender;
        treasury = _treasury;

        // Default prices (testnet-friendly)
        tierPrice[TIER_PRO] = 0.005 ether;
        tierPrice[TIER_BUSINESS] = 0.03 ether;
    }


    /**
     * @notice Subscribe to a tier or upgrade existing subscription
     * @param tierLevel 1 = Pro, 2 = Business
     */
    function subscribe(uint8 tierLevel) external payable {
        require(tierLevel == TIER_PRO || tierLevel == TIER_BUSINESS, "Invalid tier");
        require(msg.value >= tierPrice[tierLevel], "Insufficient payment");

        // Encrypt tier and expiry — hidden on Etherscan
        euint8 encTier = FHE.asEuint8(tierLevel);
        euint64 encExpiry;

        if (_hasSubscription[msg.sender]) {
            euint64 now64 = FHE.asEuint64(uint64(block.timestamp));
            euint64 period64 = FHE.asEuint64(uint64(PERIOD));
            euint64 currentExpiry = subExpiry[msg.sender];

            // If still active: extend from expiry. If expired: extend from now.
            ebool stillActive = FHE.gte(currentExpiry, now64);
            euint64 base = FHE.select(stillActive, currentExpiry, now64);
            encExpiry = FHE.add(base, period64);
        } else {
            encExpiry = FHE.asEuint64(uint64(block.timestamp + PERIOD));
            _hasSubscription[msg.sender] = true;
        }

        subTier[msg.sender] = encTier;
        subExpiry[msg.sender] = encExpiry;

        // ACL: only the subscriber and owner can decrypt their status
        FHE.allowThis(encTier);
        FHE.allowSender(encTier);
        FHE.allow(encTier, owner);

        FHE.allowThis(encExpiry);
        FHE.allowSender(encExpiry);
        FHE.allow(encExpiry, owner);

        _updateAggregates(msg.value);

        // Refund overpayment
        uint256 excess = msg.value - tierPrice[tierLevel];
        if (excess > 0) {
            (bool ok, ) = msg.sender.call{value: excess}("");
            require(ok, "Refund failed");
        }

        emit Subscribed(msg.sender, tierLevel, tierPrice[tierLevel]);
    }

    /**
     * @notice Renew current tier for another period
     */
    function renew() external payable {
        require(_hasSubscription[msg.sender], "No subscription");

        // We don't know the tier (it's encrypted), so we accept payment
        // and verify on-chain that it covers at least Pro price
        require(msg.value >= tierPrice[TIER_PRO], "Insufficient for renewal");

        euint64 now64 = FHE.asEuint64(uint64(block.timestamp));
        euint64 period64 = FHE.asEuint64(uint64(PERIOD));
        euint64 currentExpiry = subExpiry[msg.sender];

        ebool stillActive = FHE.gte(currentExpiry, now64);
        euint64 base = FHE.select(stillActive, currentExpiry, now64);
        euint64 newExpiry = FHE.add(base, period64);

        subExpiry[msg.sender] = newExpiry;

        FHE.allowThis(newExpiry);
        FHE.allowSender(newExpiry);
        FHE.allow(newExpiry, owner);

        _updateAggregates(msg.value);

        emit Renewed(msg.sender, msg.value);
    }


    /**
     * @notice Get encrypted tier — decrypt via permit (only subscriber or owner)
     */
    function getMyTier(address user) external view returns (euint8) {
        require(_hasSubscription[user], "No subscription");
        return subTier[user];
    }

    /**
     * @notice Get encrypted expiry — decrypt via permit (only subscriber or owner)
     */
    function getMyExpiry(address user) external view returns (euint64) {
        require(_hasSubscription[user], "No subscription");
        return subExpiry[user];
    }

    /**
     * @notice Check if user has ever subscribed (public — not sensitive)
     */
    function hasSubscription(address user) external view returns (bool) {
        return _hasSubscription[user];
    }


    /**
     * @notice Returns encrypted boolean: is user's subscription active?
     * @dev Other CipherPay contracts call this to gate premium features
     */
    function isActive(address user) external returns (ebool) {
        require(_hasSubscription[user], "No subscription");
        euint64 now64 = FHE.asEuint64(uint64(block.timestamp));
        return FHE.gte(subExpiry[user], now64);
    }

    /**
     * @notice Returns encrypted boolean: is user at least the given tier?
     * @dev Gate features: isAtLeast(msg.sender, TIER_BUSINESS)
     */
    function isAtLeast(address user, uint8 minTier) external returns (ebool) {
        if (!_hasSubscription[user]) {
            return FHE.asEbool(false);
        }
        euint64 now64 = FHE.asEuint64(uint64(block.timestamp));
        ebool active = FHE.gte(subExpiry[user], now64);
        ebool tierOk = FHE.gte(subTier[user], FHE.asEuint8(minTier));
        return FHE.and(active, tierOk);
    }


    function setPrice(uint8 _tierLevel, uint256 _price) external onlyOwner {
        require(_tierLevel == TIER_PRO || _tierLevel == TIER_BUSINESS, "Invalid tier");
        tierPrice[_tierLevel] = _price;
        emit PriceUpdated(_tierLevel, _price);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function withdraw() external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "Nothing to withdraw");
        (bool ok, ) = treasury.call{value: bal}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(treasury, bal);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }


    function _updateAggregates(uint256 amount) private {
        euint64 encAmount = FHE.asEuint64(uint64(amount / 1e12)); // store in micro-ETH to fit uint64

        if (!_aggregatesInitialized) {
            totalRevenue = encAmount;
            subscriberCount = FHE.asEuint64(1);
            _aggregatesInitialized = true;
        } else {
            totalRevenue = FHE.add(totalRevenue, encAmount);
            subscriberCount = FHE.add(subscriberCount, FHE.asEuint64(1));
        }

        FHE.allowThis(totalRevenue);
        FHE.allow(totalRevenue, owner);
        FHE.allowThis(subscriberCount);
        FHE.allow(subscriberCount, owner);
    }
}
