// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title  ConfidentialPayrollToken
 * @notice An FHERC-20-style confidential token for payroll settlement. Every
 *         balance is an FHE ciphertext (`euint64`) — no holder's balance and no
 *         transfer amount is visible on-chain. Only the holder (and the issuer,
 *         for audit) can decrypt a balance, via an EIP-712 CoFHE permit.
 *
 *         This is the on-Sepolia payout asset for CipherPay payroll: an employer
 *         mints confidential tokens and pays salaries with `transfer`, so the
 *         amount each employee receives is encrypted end-to-end. Paying salaries
 *         in a (price-stable) confidential token, rather than volatile ETH, is
 *         what makes the payroll flow realistic.
 *
 * @dev FHE operations: asEuint64, add, sub, gte, select, allowThis, allow.
 *      Transfers clamp the sent amount to the available balance with
 *      `FHE.select`, so a transfer never reverts in a way that would leak
 *      whether the sender had enough funds.
 */
contract ConfidentialPayrollToken {
    string public name;
    string public symbol;
    uint8  public constant decimals = 6;          // stablecoin convention
    address public immutable issuer;

    // Encrypted balance handle per account.
    mapping(address => euint64) private _balances;
    mapping(address => bool)    public  hasAccount;
    address[] private _holders;

    event AccountOpened(address indexed account);
    event Mint(address indexed to);
    event ConfidentialTransfer(address indexed from, address indexed to);

    constructor(string memory _name, string memory _symbol) {
        name   = _name;
        symbol = _symbol;
        issuer = msg.sender;
    }

    modifier onlyIssuer() {
        require(msg.sender == issuer, "Not issuer");
        _;
    }

    /// @dev Open an encrypted zero balance the first time an address is seen.
    function _ensureAccount(address a) internal {
        if (!hasAccount[a]) {
            hasAccount[a] = true;
            _holders.push(a);
            euint64 zero = FHE.asEuint64(0);
            FHE.allowThis(zero);
            _balances[a] = zero;
            emit AccountOpened(a);
        }
    }

    /**
     * @notice Issuer mints encrypted tokens to `to`.
     * @param to               recipient address
     * @param encryptedAmount  FHE-encrypted mint amount
     */
    function mint(address to, InEuint64 calldata encryptedAmount) external onlyIssuer {
        require(to != address(0), "Zero address");
        _ensureAccount(to);

        euint64 amount = FHE.asEuint64(encryptedAmount);
        FHE.allowThis(amount);

        euint64 newBal = FHE.add(_balances[to], amount);
        _balances[to] = newBal;

        FHE.allowThis(newBal);
        FHE.allow(newBal, to);       // holder can decrypt their balance
        FHE.allow(newBal, issuer);   // issuer can audit

        emit Mint(to);
    }

    /**
     * @notice Confidential transfer — the amount is encrypted. If the sender's
     *         balance is insufficient the transferred amount is clamped to zero,
     *         so the transaction never reveals whether they had enough.
     * @param to               recipient address
     * @param encryptedAmount  FHE-encrypted transfer amount
     */
    function transfer(address to, InEuint64 calldata encryptedAmount) external {
        require(to != address(0), "Zero address");
        require(to != msg.sender, "Self transfer");
        _ensureAccount(msg.sender);
        _ensureAccount(to);

        euint64 amount = FHE.asEuint64(encryptedAmount);
        FHE.allowThis(amount);

        euint64 fromBal = _balances[msg.sender];

        // sent = amount if balance >= amount, else 0 — no revert, no leak.
        ebool   enough = FHE.gte(fromBal, amount);
        euint64 sent   = FHE.select(enough, amount, FHE.asEuint64(0));

        euint64 newFrom = FHE.sub(fromBal, sent);
        euint64 newTo   = FHE.add(_balances[to], sent);
        _balances[msg.sender] = newFrom;
        _balances[to]         = newTo;

        FHE.allowThis(newFrom);
        FHE.allow(newFrom, msg.sender);
        FHE.allow(newFrom, issuer);

        FHE.allowThis(newTo);
        FHE.allow(newTo, to);
        FHE.allow(newTo, issuer);

        emit ConfidentialTransfer(msg.sender, to);
    }

    /// @notice Encrypted balance handle — decrypt with a CoFHE permit.
    function balanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }

    /// @notice Number of accounts that have ever held the token.
    function holderCount() external view returns (uint256) {
        return _holders.length;
    }
}
