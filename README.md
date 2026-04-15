<div align="center">

# ◆ CipherPay

**Privacy-first invoice & payment protocol powered by Fhenix FHE**

`7 contracts` · `33+ FHE operations` · `6 invoice types` · `16 app pages` · `Wave 2 complete`

[![Ethereum Sepolia](https://img.shields.io/badge/Network-Ethereum_Sepolia-blue)](https://sepolia.etherscan.io)
[![CoFHE SDK](https://img.shields.io/badge/CoFHE_SDK-0.4.0-green)](https://www.npmjs.com/package/@cofhe/sdk)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

Encrypted invoicing where amounts, recipients, and payment totals are hidden on-chain using Fully Homomorphic Encryption. The contract performs arithmetic on ciphertext — addition, comparison, conditional logic — without ever seeing plaintext. Only authorized parties decrypt via EIP-712 permits.

[Live App](https://cipherpayy.vercel.app) · [FHE Contract](https://sepolia.etherscan.io/address/0xb3Fb5d67795CC2AaeFC4b843417DF9f45C864069) · [Fhenix Docs](https://cofhe-docs.fhenix.zone)

</div>

---

## Why CipherPay

Every payment on Ethereum today is **fully public** — amounts, recipients, and patterns visible to anyone on Etherscan. Businesses can't invoice on-chain without exposing rates, salary data, and vendor relationships.

CipherPay fixes this by storing all financial data as FHE ciphertext (`euint64`, `eaddress`). The CoFHE coprocessor computes on encrypted data — adds payments, checks thresholds, calculates tax — without decryption. Only authorized parties with EIP-712 permits see the numbers.

**FHE vs ZK:** ZK proves a fact without revealing data, but plaintext exists during computation. FHE encrypts data AND computes on it while encrypted — plaintext never touches the chain.

### Competitive Landscape

| | **CipherPay** | OnlyPaca | PrivPay | Zalary | LastVault | StealthFlow | HomoVault |
|---|---|---|---|---|---|---|---|
| **Contracts deployed** | **7** | 2 | 3 | ABI only | 0 | 0 FHE in deploy | 0 |
| **Real FHE on-chain** | **Yes (25+ ops)** | Yes (10 ops) | Mocked | INCO (not Fhenix) | Not deployed | Fake (hex encode) | None |
| **Invoice types** | **5** | 1 | 1 | 1 | 1 | 1 | 0 |
| **Real ETH escrow** | **Yes + auto-settle** | Via relayer | Direct | USDC | No | Yes | No |
| **Frontend pages** | **14** | 5 | 4 | 4 | 1 demo | 5 | 0 |
| **Encrypted types** | euint64, eaddress, ebool, euint8, euint32, euint128 | euint8, euint64 | bytes (mock) | euint256 | eaddress, euint128 | bytes32 (plain) | — |
| **Unique features** | QR, CSV, proofs, shared invoices, explorer, subscriptions, bill split, metrics, tax calc | Revenue range proofs, relayer | 3-role (vendor/payer/auditor) | cUSDC swap, TEE attestation | Dead-man's switch, encrypted heir | Time-lock UI | AI agent concept |

> CipherPay uses more FHE operations than all competitors combined. It is the only project with multiple invoice types, encrypted tax calculation, on-chain payment proofs, and a bill-splitting contract — all on Fhenix CoFHE.

### Who It's For

- **Freelancers** — invoice clients without exposing rates on Etherscan
- **Businesses** — pay vendors and employees without revealing financial strategy
- **DAOs** — distribute funds privately while maintaining on-chain verifiability
- **Payroll** — recurring encrypted payments where only employer and employee see amounts

## How It Works — Fhenix FHE Integration

### Architecture

```
User (Browser)                 Ethereum Sepolia              CoFHE (Fhenix)
┌─────────────┐                ┌──────────────┐              ┌──────────────┐
│ @cofhe/sdk  │──encrypt──────>│ CipherPayFHE │──FHE ops────>│ FHEOS Server │
│ TFHE + ZK   │                │ euint64      │<─results─────│ (off-chain)  │
│ Web Worker  │                │ FHE.add()    │              └──────────────┘
└──────┬──────┘                │ FHE.allow()  │              ┌──────────────┐
       │                       └──────────────┘              │  Threshold   │
       │──permit (EIP-712)──────────────────────────────────>│  Network     │
       │<─decrypted value────────────────────────────────────│ (decrypt)    │
       │                                                     └──────────────┘
```

1. **Client encrypts** — `@cofhe/sdk` encrypts amount in browser using TFHE + ZK proof (Web Worker, ~9 seconds)
2. **Contract stores** — `FHE.asEuint64(encryptedInput)` converts to on-chain ciphertext handle
3. **CoFHE computes** — `FHE.add(collected, payment)` adds encrypted payments off-chain, returns result on-chain
4. **ACL controls** — `FHE.allowSender()` + `FHE.allow(recipient)` define who can decrypt
5. **Threshold decrypts** — Authorized user signs EIP-712 permit → CoFHE Threshold Network decrypts → plaintext returned only to that user

### Smart Contract — Encrypted Types

```solidity
import {FHE, euint64, euint32, euint8, euint128, eaddress, InEuint64, InEaddress, ebool}
  from "@fhenixprotocol/cofhe-contracts/FHE.sol";

// Store encrypted amount — Etherscan shows only handle, not value
euint64 amount = FHE.asEuint64(_encryptedInput);

// Encrypted recipient — address hidden on Etherscan
eaddress recipient = FHE.asEaddress(_encryptedRecipient);

// Arithmetic on encrypted data
euint64 remaining = FHE.sub(amount, totalCollected);     // subtraction
euint64 capped = FHE.min(remaining, payment);            // cap payment
euint64 total = FHE.add(collected, capped);              // addition
euint64 tax = FHE.div(FHE.mul(amount, rate), 10000);     // tax calculation

// Comparisons — returns ebool (encrypted boolean)
ebool isPaid = FHE.gte(collected, amount);       // >= check
ebool isPartial = FHE.ne(collected, amount);     // != check
ebool notPaid = FHE.not(isPaid);                 // negation
ebool isAuth = FHE.eq(recipient, FHE.asEaddress(msg.sender)); // address match

// Conditional logic on encrypted data
euint64 result = FHE.select(condition, valueA, valueB); // ternary

// Access control
FHE.allowSender(amount);          // Creator can decrypt
FHE.allowTransient(amount, addr); // Temporary access (current tx only)
FHE.allowGlobal(platformVolume);  // Public aggregate stat

// Async on-chain decrypt (two-phase)
FHE.decrypt(isPaid);              // Request decryption
FHE.getDecryptResultSafe(isPaid); // Poll result

// Random encrypted value
euint64 nonce = FHE.randomEuint64(); // Unpredictable on-chain
```

### Client SDK — 5-Stage Encryption Pipeline

```typescript
const [encryptedAmount] = await cofheClient
  .encryptInputs([Encryptable.uint64(parseEther('0.1'))])
  .onStep((step) => console.log(step))   // initTfhe → fetchKeys → pack → prove → verify
  .execute();

// Send encrypted InEuint64 tuple to contract
await contract.createInvoice(encryptedAmount, recipient, type, ...);
```

| Stage | Time | What happens |
|-------|------|-------------|
| initTfhe | ~580ms | Load TFHE WebAssembly module |
| fetchKeys | ~2200ms | Get FHE public key from CoFHE server |
| pack | ~1ms | Pack value into compact ciphertext |
| prove | ~5100ms | Generate ZK proof (Web Worker) |
| verify | ~1300ms | On-chain ZK verification |

### Permit-Based Decryption

```typescript
// Sign EIP-712 permit in MetaMask
await cofheClient.permits.getOrCreateSelfPermit();

// Get ciphertext handle from contract
const ctHash = await contract.getEncryptedAmount(invoiceHash);

// Decrypt via CoFHE Threshold Network — only works for authorized addresses
const amount = await cofheClient.decryptForView(ctHash, FheTypes.Uint64).execute();
```

### What's Visible vs Hidden

| Data | Etherscan (public) | With Permit (private) |
|------|-------------------|----------------------|
| Invoice amount | Ciphertext handle only | Decrypted value |
| Payment amount | Ciphertext handle only | Decrypted value |
| Multi-pay total | Computed via FHE.add() — encrypted | Decrypted total |
| Invoice hash | ✓ Visible | ✓ Visible |
| Type & status | ✓ Visible | ✓ Visible |
| Creator address | ✓ Visible | ✓ Visible |
| Block & timestamp | ✓ Visible | ✓ Visible |
| Payer count | ✓ Visible | ✓ Visible |

---

## Key Features

### Invoice Types

| Type | How It Works |
|------|-------------|
| **Standard** | Single payer → auto-settles → ETH transferred to creator |
| **Multi Pay** | Multiple payers contribute → progress via `FHE.add()` → creator settles → ETH transferred |
| **Recurring** | Configurable frequency (daily / N days / weekly / bi-weekly / monthly) |
| **Vesting** | Creator deposits ETH as escrow → locked until block height → recipient claims |
| **Batch** | CSV import → N recipients → encrypted amounts per recipient |

### Payment Flow

1. Creator creates invoice → amount encrypted via CoFHE SDK → stored as `euint64` on FHE contract
2. Creator shares payment link (includes amount parameter for payer convenience)
3. Payer opens link → encrypts payment client-side → submits to contract
4. Contract executes `FHE.add(collected, payment)` on ciphertext
5. Standard: auto-settles when paid → ETH goes to creator
6. Multi Pay: creator manually settles → all ETH goes to creator
7. Cancel: all payers get automatic refund

### Additional Features

- **Pause/Resume** — creator can temporarily block payments on open invoices
- **Vesting Escrow** — creator deposits ETH at creation, recipient claims after unlock block
- **Cancel with Refund** — automatically refunds all payers on cancellation
- **Reveal (decrypt)** — click eye icon → sign EIP-712 permit → see decrypted amount
- **Real ETH Transfers** — payments move real ETH via payable contract functions

---

## Expected User Experience

### Creator Flow
1. Connect wallet → Dashboard shows balance and invoices from blockchain
2. Create invoice → select type, enter amount, optional recipient
3. Watch FHE encryption in real-time (deploy logs show each stage)
4. Get payment link with invoice hash → share with payer
5. Dashboard updates when payment arrives (on-chain events)
6. Click Reveal to see decrypted amount (permit signature required)

### Payer Flow
1. Open payment link → see invoice details (type, status, creator)
2. Amount pre-filled from URL (or enter manually for FHE-encrypted invoices)
3. Click "Pay" → MetaMask confirms ETH transfer
4. Payment recorded on-chain → creator notified via events

### Verifier/Auditor Flow (Wave 4)
1. Receive audit package from invoice creator
2. Import permit → decrypt only scoped fields (amount, or amount + recipient)
3. Verify on-chain without seeing unscoped data

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| FHE Coprocessor | Fhenix CoFHE | Encrypted computation on EVM without custom chain |
| Client SDK | @cofhe/sdk 0.4.0 | Client-side TFHE encryption + ZK proofs |
| Contracts | @fhenixprotocol/cofhe-contracts 0.1.0 | Solidity FHE library (euint64, FHE.add, FHE.allow) |
| Solidity | 0.8.25 (evmVersion: cancun) | Smart contract language |
| Hardhat | @cofhe/hardhat-plugin 0.4.0 | Contract compilation + deployment |
| Frontend | React 18 + TypeScript + Vite | App interface |
| Wallet | Wagmi v2 + Viem | Wallet connection + contract interaction |
| Styling | Tailwind CSS 4 + Framer Motion | UI + animations |
| Network | Ethereum Sepolia (11155111) | Testnet deployment |
| Data | 100% on-chain | No backend, no localStorage, no cache |

---

## Live Deployment

| Contract | Address | Role |
|----------|---------|------|
| CipherPayFHE | [`0xb3Fb...4069`](https://sepolia.etherscan.io/address/0xb3Fb5d67795CC2AaeFC4b843417DF9f45C864069) | Primary — Wave 2: anon claim, shielded pool, donation type, allowPublic migration |
| CipherPaySimple | [`0xF3A1...713F`](https://sepolia.etherscan.io/address/0xF3A15EC0FAE753D6BEC3AAB3aEB2d72824c0713F) | Fallback — real ETH transfers, vesting escrow |
| PaymentProof | [`0x54C2...7293`](https://sepolia.etherscan.io/address/0x54C22cdF7B65E64C75EeEF565E775503C7657293) | On-chain payment receipts with encrypted amounts |
| SharedInvoice | [`0xd12e...B746`](https://sepolia.etherscan.io/address/0xd12eAcAD8FD0cd82894d819f4fb5e4E9168eB746) | Split bills with encrypted individual shares |
| InvoiceMetrics | [`0x02ae...25eF`](https://sepolia.etherscan.io/address/0x02ae50D014Ed6E627Aacd92A7E8C057F662b25eF) | Encrypted per-user payment analytics |
| CipherSubscription | [`0xd817...937f`](https://sepolia.etherscan.io/address/0xd8176dB76f75856E687FCc756f07966B568f937f) | FHE-encrypted subscription tiers |

**App:** [cipherpayy.vercel.app](https://cipherpayy.vercel.app)

### What's Working (Wave 2)

- ✅ FHE encryption end-to-end — full 5-stage pipeline (~9 seconds)
- ✅ Ciphertext on Etherscan — amounts invisible, only handles visible
- ✅ Permit-based Reveal — EIP-712 → decryptForView (UX overhauled with first-time explainer modal)
- ✅ Real ETH transfers — auto-settle, cancel with refund
- ✅ Vesting escrow — creator deposits, recipient claims after unlock
- ✅ Multi-pay with FHE.add() — encrypted aggregation
- ✅ Anonymous invoice claim — nullifier-based, no address in storage or events
- ✅ Shielded balance pool — msg.value = 0 payments, amount correlation broken
- ✅ Donation invoice type (type=4) — open-ended, any amount accepted
- ✅ Checkout embed — `<script>` + sandboxed iframe + postMessage API
- ✅ allowPublic + decryptForTx migration (deprecated FHE.decrypt removed)
- ✅ ACL CI audit — blocks unauthorized allowGlobal in CI
- ✅ Shielded invariant test suite — 11 tests, all passing
- ✅ 16 app pages — Dashboard, Explorer, NewCipher, Pay, AnonClaim, Checkout, Recurring, SharedInvoice, PaymentProofs, Identity, Settings, Build, Guide, Profile, Claim + 1 more
- ✅ Vercel deployment with WASM support (COOP/COEP headers)

### Etherscan Proof

**Standard transaction (no privacy):**
```
Value: 0.01 ETH                    ← amount visible to everyone
Input: amount=10000000000000000    ← plaintext in calldata
Storage: balance[addr] = 10000... ← readable by anyone
```

**CipherPay FHE transaction:**
```
Value: 0.04844 ETH                ← ETH transfer visible (Ethereum L1 limitation)
Input: ctHash=32773097825...      ← ciphertext handle, meaningless without permit
Storage: euint64 handle only      ← encrypted, unreadable on Etherscan
CoFHE ops: sub, min, add, gte... ← arithmetic on encrypted data
```

> **Note:** `msg.value` (ETH amount) is always visible on Ethereum L1 — this is a protocol limitation, not solvable by any encryption. FHE encrypts **contract state**: invoice amounts, recipients, collected totals, and tax calculations stored as `euint64`/`eaddress` are unreadable on Etherscan. Only authorized parties with EIP-712 permits can decrypt.

---

## Roadmap

### Wave 1 ✅ Complete

**Smart Contracts (7 deployed on Sepolia):**
- [x] CipherPayFHE — 25+ FHE operations (euint64, euint32, euint8, euint128, eaddress, ebool)
- [x] CipherPaySimple — real ETH escrow, vesting, pause/resume, cancel with refund
- [x] CipherSubscription — FHE-encrypted subscription tiers + recurring payments
- [x] PaymentProof — on-chain payment receipts with encrypted amounts
- [x] SharedInvoice — split bills with encrypted individual shares
- [x] InvoiceMetrics — per-user encrypted analytics (volume, count, history)

**FHE Operations:** `asEuint64`, `asEaddress`, `add`, `sub`, `mul`, `div`, `min`, `max`, `gt`, `gte`, `eq`, `ne`, `not`, `select`, `allowSender`, `allow`, `allowTransient`, `allowGlobal`, `decrypt`, `getDecryptResultSafe`, `randomEuint64`

**App:** 14 pages, 100% on-chain, COOP/COEP WASM, Vercel deployment, E2E test suite (31 tests)

---

### Wave 2 ✅ Complete

#### Novel features no other project has:

**Anonymous Invoice Claim — nullifier-based privacy**
- Payer derives `nullifier = keccak256(deviceSecret ‖ invoiceHash)` in browser — address never written to storage
- Contract checks `anonNullifierUsed[nullifier]` to prevent double-claim without knowing who claimed
- `InvoicePaidAnon(hash, nullifier)` event has no address — Etherscan shows nothing about the payer
- `anonEthPool[hash]` tracks funds separately so normal `shieldedBalance` invariants hold
- Creator sweeps via `sweepAnonPool(hash)` — funds reach creator without linking payer to payment

**Shielded Balance Pool — msg.value = 0 payments**
- Payer pre-funds `shieldedBalance[address]` with any ETH bucket (0.001/0.01/0.1)
- On pay: contract checks `shieldedBalance[payer] >= amount`, deducts atomically, pays via `payInvoiceShielded()`
- `msg.value = 0` on the actual payment transaction — Etherscan sees no value transfer, breaking amount correlation
- Invariant: `sum(shieldedBalance[users]) == address(this).balance` — enforced by Hardhat invariant test suite (11 tests)

**Donation Invoice Type (type=4)**
- Open-ended amount — payer sets what they want to pay, no target enforced
- No auto-settle threshold, no `FHE.gte` comparison needed — all payments accepted
- Creator settles to sweep all donations; `payerCount` still encrypted

**Encrypted Checkout Embed**
- Merchant adds `<script src="cipherpay.js" data-invoice="0x...">` + `CipherPay.open()` — one line
- FHE encryption runs inside sandboxed iframe; parent page never sees wallet keys or payer address
- `postMessage({type:'cipherpay:paid', tx, invoice})` on success — Stripe-like API for web2 merchants
- Auto-routes to shielded path when `shieldedBalance >= bucket` (msg.value = 0 silently)
- `/checkout/:hash` embeddable widget works standalone and in iframe

**Security hardening (judge feedback addressed):**
- Removed all legacy `cofhejs@0.3.1` + `cofhe-hardhat-plugin@0.3.1` deps — migrated to `@cofhe/sdk@0.4` + `@cofhe/hardhat-plugin@0.4`
- `FHE.allowPublic` + `decryptForTx` + `publishDecryptResult` — migrated from deprecated `FHE.decrypt()` (April 13 deprecation)
- ACL least-privilege audit: removed redundant `allowTransient(self)` grants, documented all `allowGlobal` with CI enforcement (`scripts/audit-acl.cts`)
- Permit UX overhaul: first-time explainer modal, pre-check permit state, distinct error badges (missing/expired/rejected)
- `THREAT_MODEL.md` — 6 adversary types, explicit NOT-hidden list, ACL discipline, audit checklist

**Deployed:** `0xaEa45e55A90AD78f8c6F954D94956f7BbA95F8cd` (Ethereum Sepolia)

---

### Wave 3 — Batch Cipher & CipherDrop (Planned)

**Batch Cipher — private payroll / airdrop**
- Creator uploads CSV (address, encrypted amount per recipient) — each row gets its own `euint64` ciphertext
- Contract loops via `batchCreateInvoice([InEuint64[]])` — N invoices from one tx, N different encrypted amounts
- Recipient claims their own row; no other recipient can see any other amount
- FHE ACL: `allow(row.amount, recipient)` per row — per-recipient access control without mapping exposure
- UI: drag-and-drop CSV → preview amounts → encrypt all → one Deploy tx → track per-recipient claim status

**CipherDrop — encrypted token airdrop with eligibility proof**
- Creator sets eligibility condition (`euint64 minBalance`) — also encrypted, nobody knows the threshold
- Payer proves `FHE.gte(myBalance, minThreshold)` → `ebool isEligible` — contract releases only if true
- Uses `FHE.select(isEligible, claimAmount, FHE.asEuint64(0))` — claim is zero if not eligible, no revert leaking status
- Drop creator never reveals who qualified or how many claimed until sweep
- ZK nullifier per drop — claim once, can't claim twice, no address linkage if anon mode enabled

**Encrypted milestone escrow**
- Multi-pay progress bar reveals only "< 25%", "25–50%", "50–75%", "> 75%" — not exact amount collected
- Uses `FHE.select(FHE.gte(collected, q1), ...)` chained — contract knows exact value, UI shows only tier
- Milestone release: creator sets 4 encrypted thresholds; Chainlink Keeper checks `FHE.gte` on-chain and calls `releaseEscrow(milestone)` automatically

**Encrypted recurring with FHE clock**
- On-chain encrypted payment schedule — frequency stored as `euint8`, not visible on Etherscan
- Chainlink Automation keeper checks `FHE.gte(blockNumber, nextDue)` — triggers payment without revealing schedule
- Payer can't correlate payment timing to infer amounts or relationships from Etherscan patterns

---

### Wave 4 — Salary Proof & Audit Center (Planned)

**Salary Proof — prove income ≥ X without revealing amount**
- `proveSalary(euint64 threshold)` — contract computes `FHE.gte(myIncome, threshold)` → `ebool result`
- Uses `allowPublic(result)` + `decryptForTx` + `publishDecryptResult` two-phase pattern
- Proof is a signed boolean on-chain: "income ≥ X: true" — no amount, no recipient, no history
- Used for: credit scoring, DAO governance voting weight, rental applications, KYC-less income verification
- Verifier gets proof hash — can verify on-chain without ever knowing the number

**Scoped Audit Packages — time-limited disclosure permits**
- Creator generates `AuditPackage{scope: ['amount', 'recipient'], expiresAt: timestamp, auditor: address}`
- EIP-712 permit scoped to specific ciphertexts and expiry — cannot decrypt other fields or other invoices
- Auditor calls `decryptForView(ctHash, permit)` — only works for scoped handles within expiry window
- On-chain record: `AuditGranted(invoiceHash, auditor, scope, expiry)` — audit trail without data exposure
- Tax reporting: export scoped permit for accountant — they see amounts but not recipient identities

**Cross-chain invoice payment via CCTP**
- Payer on Arbitrum Sepolia pays invoice on Ethereum Sepolia — USDC burned/minted via Circle CCTP v2
- FHE verification runs on destination chain — `verifyPayment(cctp_attestation, encAmount)` checks amounts match
- Invoice status updates when CCTP message arrives — cross-chain settlement without bridging ETH

**Encrypted DAO treasury**
- DAO votes encrypted budget allocations — each proposal stores `euint64 budget` 
- Vote threshold via `FHE.gte(votesFor, quorum)` — outcome revealed only after vote closes
- Treasury spends via `payInvoice(proposalHash)` — individual allocations hidden, aggregate visible via `FHE.allowGlobal`

---

### Wave 5 — Platform & Mainnet (When CoFHE Mainnet Launches)

**Merchant SDK — `@cipherpay/sdk`**
- npm package with Stripe-like API: `CipherPay.charge({amount, currency: 'ETH', invoiceId})`
- React hook: `useCheckout(invoiceHash)` — returns `{pay, status, txHash}` — zero FHE boilerplate
- Webhook server: relay `InvoicePaid` events to HTTPS endpoint — merchants get order confirmation like Stripe webhooks
- Merchant dashboard: analytics, payout history, export to CSV — all encrypted on-chain, permit-gated

**Privacy-preserving analytics**
- `FHE.allowGlobal` on aggregate stats: total volume, invoice count, payer count — no individual data exposed
- Differential privacy layer: add encrypted noise to published aggregates so individual transactions can't be reverse-engineered
- Merkle proof of invoice existence — prove an invoice was created at block N without revealing amount or parties

**Platform fee module (self-funding)**
- Configurable fee: `euint8 feeBps` — even the fee rate is encrypted (only owner decrypts)
- Fee is deducted via `FHE.mul(amount, feeBps)` — arithmetic on ciphertext, collected into `platformRevenue: euint64`
- Owner calls `sweepRevenue()` → `FHE.allowPublic(platformRevenue)` + two-phase decrypt → ETH transferred
- Individual fees never visible; only aggregate platform revenue is decryptable by owner

**Mainnet deployment**
- Pending Fhenix CoFHE coprocessor on Ethereum/Arbitrum/Base mainnet
- Gas optimization pass — remove redundant FHE ops, batch ACL grants, optimize storage layout
- Security audit — reentrancy, ACL bypass, ciphertext handle collision, replay attacks
- Bug bounty program via Immunefi

> **FHE operation count by wave:** Wave 1: 25 ops · Wave 2: +8 ops (allowPublic, decryptForTx, anonClaim, shielded arithmetic) · Wave 3: +12 ops (batch per-row ACL, milestone select chains, recurring gte clock) · Wave 4: +6 ops (salary gte, scoped permits, cross-chain verify) · Wave 5: +4 ops (fee mul, noise injection, sweep decrypt) = **55+ distinct FHE operations total**

### Revenue Model
- **Platform fee** — small % on each settled invoice (e.g. 0.3%), encrypted via FHE so individual fees are private, only aggregate revenue visible via FHE.allowGlobal
- **Merchant API** — paid tier for high-volume users (batch invoicing, webhooks, custom branding)
- **Hosted pages** — SaaS model where merchants get a branded payment page without running their own frontend
- **Premium features** — audit packages, advanced analytics, priority settlement

---

## Getting Started

```bash
git clone https://github.com/kravadk/cipherpay.git
cd cipherpay
npm install

cp .env.example .env
npx vite --port 3005

# Compile contracts
TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat compile --config hardhat.config.cts

# Deploy FHE contract
TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/deploy-fhe.cts --network eth-sepolia --config hardhat.config.cts
```

## Project Structure

```
contracts/
├── CipherPayFHE.sol           # Primary — euint64, FHE.add, FHE.allow
├── CipherPaySimple.sol        # Fallback — real ETH transfers, vesting escrow
├── CipherSubscription.sol     # FHE-encrypted subscription tiers
└── CipherPay.sol              # Original FHE v1

src/
├── config/
│   ├── contract.ts            # ABI + addresses (InEuint64 tuples)
│   └── wagmi.ts               # Wagmi + Sepolia RPC
├── hooks/
│   ├── useCofhe.ts            # CoFHE SDK — encrypt, decrypt, permits
│   ├── useInvoices.ts         # Read invoices from blockchain
│   └── useNotifications.ts    # Parse on-chain events
├── pages/                     # Dashboard, Explorer, NewCipher, Pay, Settings, etc.
└── store/                     # Zustand — ephemeral UI state only (no data persistence)
```

## Links

- [Fhenix](https://fhenix.io)
- [CoFHE Documentation](https://cofhe-docs.fhenix.zone)
- [CoFHE SDK](https://www.npmjs.com/package/@cofhe/sdk)
- [Buildathon Telegram](https://t.me/+rA9gI3AsW8c3YzIx)

---

## License

MIT

---

## Hackathon Submission — Wave 2

### TL;DR for Judges

CipherPay is the only project with **anonymous invoice claiming**, **shielded balance pools** (msg.value = 0 payments), a **working checkout embed** (merchant script tag + sandboxed iframe), and **6 invoice types** — all on Fhenix CoFHE with real ETH on Ethereum Sepolia.

**Wave 2 additions:**

| Metric | Wave 1 | Wave 2 |
|--------|--------|--------|
| FHE operations | 25+ | **33+** |
| Invoice types | 5 | **6** (+ Donation) |
| Frontend pages | 14 | **16** (+ AnonClaim, Checkout) |
| Privacy features | Permit-based decrypt | **+ Anon nullifier, shielded pool, checkout embed** |
| Security | Basic ACL | **+ ACL CI audit, THREAT_MODEL, invariant tests, deprecated API migration** |
| Contract address | 0x626c...2852 | **0xb3Fb...4069** (Wave 2 deploy) |

**What's novel in Wave 2 (no other project has these):**

1. **Nullifier-based anon claim** — `keccak256(deviceSecret ‖ invoiceHash)` stored instead of address. Etherscan shows zero identity data for the payer. Double-spend prevented without recording who paid.

2. **Shielded balance pool** — payer pre-funds any ETH bucket. Actual payment tx has `msg.value = 0` — Etherscan shows no ETH transfer, breaking amount correlation entirely.

3. **Checkout embed** — merchants add one `<script>` tag. FHE encryption runs in sandboxed iframe. Parent page gets only `cipherpay:paid` event. Stripe-like DX for private payments.

4. **Donation type** — open-ended FHE invoice with no target threshold. All amounts accepted, no `FHE.gte` gating.

5. **Deprecated API migration** — migrated from `FHE.decrypt()` (deprecated April 13 2026) to `allowPublic + decryptForTx + publishDecryptResult` two-phase pattern. Running ahead of the deprecation curve.

6. **ACL CI enforcement** — `scripts/audit-acl.cts` parses all `.sol` files, whitelists every `FHE.allowGlobal` grant, exits 1 on unauthorized. Runs in CI. No accidental data exposure.

**What FHE encrypts in CipherPay (cumulative):**
- Invoice amounts (`euint64`) — Etherscan shows only handles
- Recipient addresses (`eaddress`) — hidden on Etherscan
- Collected payment totals — `FHE.add()` on ciphertext
- Tax calculations — `FHE.mul()` + `FHE.div()` on encrypted basis points
- Subscription tiers (`euint8`) + expiry (`euint64`)
- Per-user metrics: totalSent, totalReceived, invoiceCount
- Shared invoice individual shares
- Platform aggregate volume — `FHE.allowGlobal()` only
- Shielded balance per address — bucket size not leaked
- Anon claim result — no payer identity stored

**Verify on Etherscan:** [Wave 2 contract](https://sepolia.etherscan.io/address/0xb3Fb5d67795CC2AaeFC4b843417DF9f45C864069) — Input Data shows ciphertext handles. Anon claim txs have no `from` address in events. Shielded payments have `msg.value = 0`.

---

<div align="center">

Built with Fhenix CoFHE for the Privacy-by-Design dApp Buildathon

</div>
