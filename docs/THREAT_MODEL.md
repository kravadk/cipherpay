# CipherPay — Threat Model

This document is an honest, mechanical inventory of what CipherPay hides on
chain, what it intentionally does not hide, and why. It is meant to be read
end-to-end before drawing conclusions about CipherPay's privacy guarantees.

CipherPay is built on Fhenix CoFHE (Sepolia testnet). It uses fully
homomorphic encryption (FHE) to keep invoice amounts, payment amounts,
running totals, recipient addresses, tax computations, and platform-wide
aggregates encrypted while still computable inside the EVM.

## Adversaries considered

| # | Adversary | Capabilities |
|---|---|---|
| A1 | Passive chain observer | Can read every event, every storage slot, every tx envelope on Ethereum Sepolia |
| A2 | Curious creator | Has the right to decrypt their own invoice's running total via permit |
| A3 | Curious payer | Has the right to decrypt their own contribution via permit |
| A4 | Third-party merchant embedding the checkout iframe | Receives only the postMessage CipherPay sends after payment |
| A5 | Malicious frontend operator | Could log inputs typed in the UI |
| A6 | Compromised wallet / phishing | Can sign arbitrary EIP-712 messages |

CipherPay protects against A1 and partially A4. It does not protect against
A5 (the user must trust the page they enter the amount into) or A6 (a
compromised wallet defeats any signature-based scheme).

## What CipherPay hides

| Datum | Mechanism | Visible to |
|---|---|---|
| Invoice amount | `euint64` ciphertext stored in `invoices[hash].encryptedAmount`; `FHE.allowSender` only | Creator (via permit) |
| Recipient address (when used as `eaddress`) | `eaddress` ciphertext in `invoices[hash].encryptedRecipient`; `FHE.allowSender` only | Creator (via permit) |
| Per-payment payment amount | `euint64` ciphertext passed in calldata; never written to storage as plaintext | Contract for arithmetic only (transient) |
| Running collected total | `euint64` accumulated via `FHE.add`; granted to `creator` and `payer` only | Creator + payer (via permit) |
| Encrypted tax amount | Computed as `FHE.div(FHE.mul(encAmount, taxRate), 10000)`; `FHE.allowSender` to creator only | Creator (via permit) |
| Per-invoice line items (breakdown) | Each `BreakdownItem.encryptedPrice` is `euint64`; `FHE.allowSender` to creator only | Creator (via permit) |
| Identity of an anonymous payer | `claimAnonymously` does NOT write `msg.sender` to storage and does NOT emit `InvoicePaid`. The only event is `AnonClaimSubmitted(invoiceHash, nullifier)` | Nobody (the nullifier is a hash of a payer-only secret) |
| Number of distinct anonymous payers | Anonymous claims do not increment `payerCount` and do not append to `_payers[]` | Nobody |
| Payment-vs-invoice link in the shielded path | `payInvoiceShielded` carries `msg.value == 0`; ETH movement happens internally between `shieldedBalance[payer]` and `shieldedBalance[creator]`; the user-chosen bucket is the only thing visible | Aggregate bucket only |

## What CipherPay does **not** hide

We list these explicitly so that no one mistakes the threat model.

### 1. `msg.value` on the plain `payInvoice` entrypoint
The original `payInvoice` accepts ETH directly. The `value` field of the tx
envelope is plaintext on the L1 and reveals the exact ETH amount being moved
in that call. The encrypted `_encryptedPayment` matches this value
operationally — meaning a chain observer can read it directly.

**Mitigation:** the `payInvoiceShielded` entrypoint uses a prefunded
`shieldedBalance` and accepts `msg.value == 0`. The merchant checkout embed
auto-routes to the shielded path when the payer has enough balance. Plain
`payInvoice` is retained for first-time payers who have not yet deposited.

### 2. ETH transfers from the contract
When an invoice auto-settles or a creator sweeps the anonymous pool, the
plaintext payout amount appears in an outgoing call. The relationship
between this payout and any individual encrypted contribution is concealed
(many encrypted contributions can map to one plaintext payout), but the
total ETH that leaves the contract per call is public.

**Mitigation:** the shielded path keeps funds in `shieldedBalance[creator]`
indefinitely so creators can settle on their own schedule (cover-traffic
style) before withdrawing.

### 3. Caller address on non-anonymous entrypoints
`payInvoice` and `payInvoiceShielded` both record `msg.sender` against the
invoice (`hasPaid`, `_payers[]`, `paidInvoices[]`). This is intentional —
those entrypoints are designed for invoices where the creator wants a payer
list. Use `claimAnonymously` if the payer needs identity privacy.

### 4. Existence and status of an invoice
`invoiceHash`, `creator`, `recipient` (if `hasRecipient`), `status`,
`deadline`, `createdAt`, `unlockBlock`, `payerCount`, and `memo` are all
plaintext. CipherPay treats invoice **existence** as public metadata and
only the **economic content** (amounts, recipient, line items) as private.

### 5. Aggregate platform metrics
`platformVolume` and `platformInvoiceCount` are intentionally
`FHE.allowGlobal` so they can be displayed as a public protocol KPI
(similar to TVL on a DEX). This is the only `allowGlobal` use in the
contract — see `scripts/audit-acl.cts` for the assertion. These aggregates
do not contain per-user information by construction.

### 6. Gas usage and transaction timing
FHE operations have characteristic gas profiles. A sophisticated observer
can infer how many `FHE.add` / `FHE.min` calls a transaction performed,
which leaks the *type* of operation (e.g. "this looks like a payment") but
not the values. Timing side channels are not addressed.

### 7. The bucket size on the shielded path
`payInvoiceShielded(_invoiceHash, _encryptedPayment, _maxDebit)` accepts a
plaintext `_maxDebit`. This is a coarse-grained bucket the user picks
(0.001 / 0.01 / 0.1 ETH). Picking a non-standard bucket fingerprints the
payer; the UI restricts users to three preset buckets so the anonymity set
is the union of all users picking the same bucket.

### 8. Off-chain wallet/phishing attacks
The permit system relies on the user signing an EIP-712 typed message in
their wallet. A malicious wallet can sign arbitrary messages on the user's
behalf. CipherPay shows an inline explainer the first time a user reveals
an amount, describing what the permit grants and that it never grants ETH
movement, only decryption rights.

## ACL discipline (least-privilege summary)

Every `FHE.allow*` call in [contracts/CipherPayFHE.sol](contracts/CipherPayFHE.sol) falls into one of:

- `FHE.allowThis` — required so the contract can perform further FHE
  arithmetic on the value across calls. Grants nothing to any external
  party.
- `FHE.allowSender` / `FHE.allow(handle, addr)` — narrow grant to a single
  party (creator, recipient, payer) so that party can decrypt off-chain
  with a permit.
- `FHE.allowTransient(handle, address(this))` — single-tx grant for
  intermediate values used only inside the current transaction (e.g.
  `remaining`, `actualPayment`). Strictly tighter than `allowThis`.
- `FHE.allowGlobal` — used **only** on `platformVolume` and
  `platformInvoiceCount`, which are documented as protocol-wide aggregates.
  Enforced by `scripts/audit-acl.cts` in CI.

`inv.totalCollected` notably does **not** receive `allowSender` in the
anonymous path — that would let an anonymous payer decrypt the running
aggregate, which would leak across the anonymity set.

## Out of scope

- Tor / network-level metadata. Use a privacy network if the goal is to
  also hide the IP that submitted the tx.
- MEV / mempool ordering. Ciphertexts are stable across reorderings, but
  ordering itself is observable.
- Wallet-level address linkability. CipherPay does not provide a stealth
  address scheme; pair with one if pseudonymous addresses are required.
- Mainnet deployment. CoFHE is currently testnet-only.

## Audit checklist

When reviewing a change to the contract, verify that:

1. No new `FHE.allowGlobal` call appears outside `_ensurePlatformInit`. CI
   enforces this via `scripts/audit-acl.cts`.
2. No new entrypoint stores `msg.sender` against an invoice in anonymous
   mode (the anon path must not write `hasPaid`, `_payers`, or
   `paidInvoices`).
3. Any new encrypted handle is followed immediately by either `allowThis`,
   `allowTransient(self)`, or a documented narrow `allow(addr)`.
4. Any function that moves ETH out of the contract has at most one
   external call and follows checks-effects-interactions.
5. Plaintext storage (struct fields, mappings) does not duplicate any
   value that exists in encrypted form. Duplicating defeats the purpose.
