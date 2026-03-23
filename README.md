<div align="center">

# ◆ CipherPay

**Privacy-first invoice & payment protocol powered by Fhenix FHE**

[![Ethereum Sepolia](https://img.shields.io/badge/Network-Ethereum_Sepolia-blue)](https://sepolia.etherscan.io)
[![CoFHE SDK](https://img.shields.io/badge/CoFHE_SDK-0.4.0-green)](https://www.npmjs.com/package/@cofhe/sdk)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

Encrypted invoicing where amounts are hidden on-chain using Fully Homomorphic Encryption.
Only authorized parties can decrypt — no one else sees the numbers, not even validators.

[Live App](https://cipherpayy.vercel.app) · [Etherscan](https://sepolia.etherscan.io/address/0x11B9d10bc7Cf5970dE860D8d52674329b7A791C4) · [Fhenix Docs](https://cofhe-docs.fhenix.zone)

</div>

---

## Problem

On-chain payments today are **fully transparent**. Every transaction on Ethereum exposes:

- **Exact amounts** — salary, contractor rates, business deals visible to anyone on Etherscan
- **Payment patterns** — competitors track vendor relationships, pricing strategies, cash flow
- **MEV vulnerability** — bots front-run visible pending transactions for profit
- **All-or-nothing privacy** — either everything is public or nothing is verifiable for compliance

Businesses, freelancers, and DAOs need payment privacy but can't sacrifice on-chain verifiability. Current solutions force a choice between transparency and confidentiality.

## Who It's For

- **Freelancers & contractors** — invoice clients without exposing rates publicly
- **Businesses** — pay vendors and employees without revealing financial strategy
- **DAOs** — distribute funds privately while maintaining governance accountability
- **Anyone** sending payments who doesn't want the world to see the amount

## Solution

CipherPay encrypts invoice amounts on-chain using **Fhenix Fully Homomorphic Encryption (FHE)**. The protocol stores amounts as `euint64` ciphertext — not plaintext numbers. The CoFHE coprocessor performs arithmetic on encrypted data (adding payments, checking thresholds) without ever decrypting. Only authorized parties can reveal amounts via EIP-712 wallet permits.

**What makes this different from ZK:**
- ZK proves a statement is true without revealing data — but the data must exist somewhere in plaintext during computation
- FHE encrypts data AND computes on it while encrypted — plaintext never exists on-chain, not even during computation
- The contract adds encrypted payments via `FHE.add()` — the total is computed without any party seeing individual amounts

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
| CipherPayFHE | [`0x11B9...91C4`](https://sepolia.etherscan.io/address/0x11B9d10bc7Cf5970dE860D8d52674329b7A791C4) | Primary — FHE encrypted amounts + eaddress + tax + analytics |
| CipherPaySimple | [`0xF3A1...713F`](https://sepolia.etherscan.io/address/0xF3A15EC0FAE753D6BEC3AAB3aEB2d72824c0713F) | Fallback — real ETH transfers, vesting escrow |
| PaymentProof | [`0x54C2...7293`](https://sepolia.etherscan.io/address/0x54C22cdF7B65E64C75EeEF565E775503C7657293) | On-chain payment receipts with encrypted amounts |
| SharedInvoice | [`0xd12e...B746`](https://sepolia.etherscan.io/address/0xd12eAcAD8FD0cd82894d819f4fb5e4E9168eB746) | Split bills with encrypted individual shares |
| InvoiceMetrics | [`0x02ae...25eF`](https://sepolia.etherscan.io/address/0x02ae50D014Ed6E627Aacd92A7E8C057F662b25eF) | Encrypted per-user payment analytics |
| CipherSubscription | [`0xd817...937f`](https://sepolia.etherscan.io/address/0xd8176dB76f75856E687FCc756f07966B568f937f) | FHE-encrypted subscription tiers |

**App:** [cipherpayy.vercel.app](https://cipherpayy.vercel.app)

### What's Working (Wave 1)

- ✅ FHE encryption end-to-end — full 5-stage pipeline (~9 seconds)
- ✅ Ciphertext on Etherscan — amounts invisible, only handles visible
- ✅ Permit-based Reveal — EIP-712 → decryptForView
- ✅ Real ETH transfers — auto-settle, cancel with refund
- ✅ Vesting escrow — creator deposits, recipient claims after unlock
- ✅ Multi-pay with FHE.add() — encrypted aggregation
- ✅ Pause/Resume invoice lifecycle
- ✅ 12 app pages — all data from blockchain, zero local storage
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

### Wave 1 ✅ (Current)

**Smart Contracts (7 deployed on Sepolia):**
- [x] CipherPayFHE — primary FHE contract with 18+ encrypted operations (euint64, euint32, euint8, euint128, eaddress, ebool)
- [x] CipherPaySimple — real ETH transfers, vesting escrow, pause/resume, cancel with refund
- [x] CipherSubscription — FHE-encrypted subscription tiers with recurring payments
- [x] PaymentProof — on-chain payment receipts with encrypted amounts
- [x] SharedInvoice — split bills with encrypted individual shares
- [x] InvoiceMetrics — encrypted per-user payment analytics (volume, count)

**FHE Operations Used:**
- [x] `FHE.asEuint64`, `FHE.asEaddress` — encrypt amounts and addresses
- [x] `FHE.add`, `FHE.sub`, `FHE.mul`, `FHE.div` — encrypted arithmetic
- [x] `FHE.min`, `FHE.max` — cap payments, enforce limits
- [x] `FHE.gt`, `FHE.gte`, `FHE.eq`, `FHE.ne`, `FHE.not` — encrypted comparisons
- [x] `FHE.select` — conditional logic on encrypted data
- [x] `FHE.allowSender`, `FHE.allow`, `FHE.allowTransient`, `FHE.allowGlobal` — access control
- [x] `FHE.decrypt` + `FHE.getDecryptResultSafe` — async on-chain decryption
- [x] `FHE.randomEuint64` — unpredictable encrypted nonce
- [x] `eaddress` — encrypted recipient (hidden on Etherscan)

**Client SDK:**
- [x] Full 5-stage encryption pipeline: initTfhe → fetchKeys → pack → prove → verify (~9 sec)
- [x] Permit-based Reveal — EIP-712 → decryptForView via Threshold Network
- [x] Invoice Breakdown — encrypted line items per invoice

**Features:**
- [x] Standard, Multi Pay, Recurring invoice types with real ETH transfers
- [x] Vesting escrow — creator deposits ETH, recipient claims after unlock block
- [x] Pause/Resume/Cancel with automatic refund to all payers
- [x] Encrypted tax calculation (FHE.mul + FHE.div on basis points)
- [x] Platform-wide encrypted aggregates (volume, invoice count) via FHE.allowGlobal
- [x] Payment stepper UI (Encrypting → Submitting → Confirming)
- [x] On-chain commitments display (ciphertext handle + Etherscan link)
- [x] E2E test suite — 31 tests with 2 wallets, all passing

**App:**
- [x] 14 pages — Dashboard, Explorer, NewCipher, Pay, Recurring, SharedInvoice, PaymentProofs, Identity, Settings, Build, Guide, Profile, Claim
- [x] 100% on-chain data — no localStorage, no backend, no cache
- [x] Vercel deployment with WASM support (COOP/COEP headers)

### Wave 2 — Indexing & Receipts
- [ ] The Graph subgraph for InvoiceCreated, InvoicePaid, InvoiceSettled events
- [ ] Encrypted threshold milestones — FHE.gte for multi-pay 25/50/75/100% without revealing amounts
- [ ] Dual receipt system — payer and creator both get on-chain proof
- [ ] Donation invoice type — open-ended amount, no target
- [ ] Full FHE decryption for all flows — remove Simple contract fallback

### Wave 3 — Automation & Scale
- [ ] Recurring automation via Chainlink Automation (Keeper triggers payInvoice on schedule)
- [ ] Batch single-tx payments — createBatchInvoice() for N recipients in one transaction
- [ ] CipherDrop — Merkle airdrop with nullifier-based claims and encrypted amounts
- [ ] Encrypted balance tracking per user (volume, count, avg) via InvoiceMetrics
- [ ] Subscription management UI for CipherSubscription contract

### Wave 4 — Compliance & Disclosure
- [ ] Salary Proof — prove "income >= X" via FHE.gte → ebool without revealing amount
- [ ] Audit packages — createSharing() permits with scoped, time-limited disclosure
- [ ] Audit Center — manage audit reports, export encrypted proofs for accountants
- [ ] Backend API for persistent preferences and webhook notifications

### Wave 5 — Platform & Monetization
- [ ] Platform fee module — configurable % per invoice (encrypted via FHE, collected automatically)
- [ ] Merchant SDK (@cipherpay/sdk) — npm package with Stripe-like API for integrations
- [ ] Hosted invoice pages — merchants embed payment link, CipherPay handles encryption
- [ ] Multi-chain deployment (pending CoFHE L2 support)
- [ ] Mobile responsive polish for all pages
- [ ] Security audit — reentrancy, gas optimization, access control

### Revenue Model
- **Platform fee** — small % on each settled invoice (e.g. 0.3%), encrypted via FHE so individual fees are private, only aggregate platform revenue is visible via FHE.allowGlobal
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

<div align="center">

Built with Fhenix FHE for the Privacy-by-Design dApp Buildathon

</div>
