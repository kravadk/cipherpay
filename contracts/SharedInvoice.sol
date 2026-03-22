// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title SharedInvoice
 * @notice Split a bill between multiple participants with encrypted individual shares
 * @dev Each participant's share is encrypted — only they can see their own amount.
 *      Creator sets total + participants. Contract splits or assigns custom shares.
 */
contract SharedInvoice {
    struct Share {
        address participant;
        euint64 encryptedShare;    // how much this person owes
        bool paid;
    }

    struct Group {
        bytes32 groupHash;
        address creator;
        euint64 encryptedTotal;     // total bill (encrypted)
        uint256 participantCount;
        uint256 paidCount;
        uint8 status;               // 0=open, 1=settled, 2=cancelled
        uint256 createdAt;
        string memo;
    }

    mapping(bytes32 => Group) public groups;
    mapping(bytes32 => mapping(uint256 => Share)) public shares;  // groupHash -> index -> share
    mapping(bytes32 => mapping(address => uint256)) public participantIndex;  // groupHash -> address -> index+1 (0 = not participant)
    mapping(address => bytes32[]) public userGroups;

    uint256 public totalGroups;

    event GroupCreated(bytes32 indexed groupHash, address indexed creator, uint256 participants, string memo);
    event SharePaid(bytes32 indexed groupHash, address indexed participant);
    event GroupSettled(bytes32 indexed groupHash);

    /**
     * @notice Create a shared invoice with equal split
     * @param _encryptedTotal Total bill amount (encrypted)
     * @param _participants List of addresses to split between
     * @param _encryptedShares Individual share amounts (encrypted, one per participant)
     */
    function createGroup(
        InEuint64 calldata _encryptedTotal,
        address[] calldata _participants,
        InEuint64[] calldata _encryptedShares,
        string calldata _memo
    ) external returns (bytes32) {
        require(_participants.length >= 2, "Need at least 2 participants");
        require(_participants.length <= 20, "Max 20 participants");
        require(_participants.length == _encryptedShares.length, "Shares must match participants");

        bytes32 groupHash = keccak256(abi.encodePacked(
            msg.sender, block.number, block.timestamp, totalGroups
        ));

        euint64 total = FHE.asEuint64(_encryptedTotal);
        FHE.allowThis(total);
        FHE.allowSender(total);

        groups[groupHash] = Group({
            groupHash: groupHash,
            creator: msg.sender,
            encryptedTotal: total,
            participantCount: _participants.length,
            paidCount: 0,
            status: 0,
            createdAt: block.timestamp,
            memo: _memo
        });

        for (uint256 i = 0; i < _participants.length; i++) {
            euint64 share = FHE.asEuint64(_encryptedShares[i]);
            FHE.allowThis(share);
            // Each participant can only see their own share
            FHE.allow(share, _participants[i]);
            // Creator can see all shares
            FHE.allow(share, msg.sender);

            shares[groupHash][i] = Share({
                participant: _participants[i],
                encryptedShare: share,
                paid: false
            });
            participantIndex[groupHash][_participants[i]] = i + 1;  // 1-indexed
            userGroups[_participants[i]].push(groupHash);
        }

        userGroups[msg.sender].push(groupHash);
        totalGroups++;

        emit GroupCreated(groupHash, msg.sender, _participants.length, _memo);
        return groupHash;
    }

    /**
     * @notice Pay your share of a group invoice
     */
    function payShare(bytes32 _groupHash) external payable {
        Group storage grp = groups[_groupHash];
        require(grp.creator != address(0), "Group not found");
        require(grp.status == 0, "Not open");

        uint256 idx = participantIndex[_groupHash][msg.sender];
        require(idx > 0, "Not a participant");
        idx--; // convert to 0-indexed

        Share storage share = shares[_groupHash][idx];
        require(!share.paid, "Already paid");

        share.paid = true;
        grp.paidCount++;

        emit SharePaid(_groupHash, msg.sender);

        // Auto-settle when all participants paid
        if (grp.paidCount >= grp.participantCount) {
            grp.status = 1;
            emit GroupSettled(_groupHash);
        }
    }

    // View functions

    function getGroup(bytes32 _groupHash) external view returns (
        address creator, uint256 participantCount, uint256 paidCount,
        uint8 status, uint256 createdAt, string memory memo
    ) {
        Group storage grp = groups[_groupHash];
        return (grp.creator, grp.participantCount, grp.paidCount, grp.status, grp.createdAt, grp.memo);
    }

    function getShare(bytes32 _groupHash, uint256 _index) external view returns (
        address participant, bool paid
    ) {
        Share storage s = shares[_groupHash][_index];
        return (s.participant, s.paid);
    }

    function getShareEncryptedAmount(bytes32 _groupHash, uint256 _index) external view returns (euint64) {
        return shares[_groupHash][_index].encryptedShare;
    }

    function getMyShareIndex(bytes32 _groupHash, address _user) external view returns (uint256) {
        uint256 idx = participantIndex[_groupHash][_user];
        require(idx > 0, "Not a participant");
        return idx - 1;
    }

    function getUserGroups(address _user) external view returns (bytes32[] memory) {
        return userGroups[_user];
    }

    function getEncryptedTotal(bytes32 _groupHash) external view returns (euint64) {
        return groups[_groupHash].encryptedTotal;
    }
}
