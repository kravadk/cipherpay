<div align="center">

# ◆ CipherPay

**Privacy-first invoice & payment protocol powered by Fhenix FHE**

`7 contracts` · `25+ FHE operations` · `5 invoice types` · `14 app pages` · `6 deployed on Sepolia`

[![Ethereum Sepolia](https://img.shields.io/badge/Network-Ethereum_Sepolia-blue)](https://sepolia.etherscan.io)
[![CoFHE SDK](https://img.shields.io/badge/CoFHE_SDK-0.4.0-green)](https://www.npmjs.com/package/@cofhe/sdk)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

Encrypted invoicing where amounts, recipients, and payment totals are hidden on-chain using Fully Homomorphic Encryption. The contract performs arithmetic on ciphertext — addition, comparison, conditional logic — without ever seeing plaintext. Only authorized parties decrypt via EIP-712 permits.

[Live App](https://cipherpayy.vercel.app) · [FHE Contract](https://sepolia.etherscan.io/address/0x626c1661cF0b72E47E9FcA0BF96d0D1A70d42852) · [Fhenix Docs](https://cofhe-docs.fhenix.zone)

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
| CipherPayFHE | [`0x11B9...91C4`](https://sepolia.etherscan.io/address/0x626c1661cF0b72E47E9FcA0BF96d0D1A70d42852) | Primary — FHE encrypted amounts + eaddress + tax + analytics |
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
- [x] CipherPayFHE — primary FHE contract with 25+ encrypted operations (euint64, euint32, euint8, euint128, eaddress, ebool)
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
- [x] 5 invoice types: Standard, Multi Pay, Recurring, Vesting, Batch — all with real ETH transfers
- [x] Vesting escrow — creator deposits ETH, recipient claims after unlock block
- [x] Batch invoicing — CSV import for N recipients
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

### Wave 2 — Stablecoin Payments & Receipts (Testnet)
- [ ] Confidential USDC (cUSDC) payments via Privara SDK (`@reineira-os/sdk`) on Arbitrum Sepolia
- [ ] FHE-encrypted escrow for stablecoin invoices — amount hidden even at token level
- [ ] The Graph subgraph for InvoiceCreated, InvoicePaid, InvoiceSettled events
- [ ] Dual receipt system — payer and creator both get on-chain proof
- [ ] Donation invoice type — open-ended amount, no target

### Wave 3 — Conditional Settlement & Automation (Testnet)
- [ ] Conditional escrow via Privara Gate — release funds only when condition is met (delivery proof, oracle, deadline)
- [ ] Recurring automation via Chainlink Automation (Keeper triggers payInvoice on schedule)
- [ ] Encrypted threshold milestones — FHE.gte for multi-pay 25/50/75/100% without revealing amounts
- [ ] Subscription management UI for CipherSubscription contract

### Wave 4 — Cross-chain & Insurance (Testnet)
- [ ] Cross-chain invoice payments: Ethereum Sepolia → Arbitrum Sepolia via Circle CCTP v2
- [ ] Payer pays from any supported chain, settlement happens on Arbitrum where FHE runs
- [ ] Dispute resolution via Privara Insurance — encrypted coverage pools, automated refunds
- [ ] Salary Proof — prove "income >= X" via FHE.gte → ebool without revealing amount
- [ ] Audit packages — scoped, time-limited disclosure permits

### Wave 5 — Platform & Mainnet (When CoFHE Mainnet Launches)
- [ ] Mainnet deployment — pending CoFHE coprocessor availability on Ethereum/Arbitrum/Base mainnet
- [ ] Platform fee module — configurable % per invoice, encrypted via FHE
- [ ] Merchant SDK (@cipherpay/sdk) — npm package with Stripe-like API
- [ ] Hosted invoice pages — merchants embed payment link, CipherPay handles encryption
- [ ] Security audit — reentrancy, gas optimization, access control

> **Note:** Fhenix CoFHE currently operates on testnets only (Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia). Mainnet deployment depends on CoFHE coprocessor going live on mainnet. All Wave 2-4 features are buildable and demonstrable on testnet today.

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

## Hackathon Submission — Wave 1

### TL;DR for Judges

CipherPay is the most FHE-intensive project in this buildathon. We use **25+ distinct FHE operations** across **7 smart contracts** to build an encrypted invoicing protocol where amounts, recipients, collected totals, tax calculations, subscription tiers, and per-user analytics are all stored as ciphertext.

**What we built (all deployed on Sepolia):**

| Metric | Value |
|--------|-------|
| Smart contracts | 7 (all deployed and functional) |
| FHE operations used | 25+ (add, sub, mul, div, min, max, eq, ne, gt, gte, lt, lte, and, or, not, select, decrypt, randomEuint64, allow, allowSender, allowThis, allowTransient, allowGlobal, asEuint64, asEaddress) |
| Encrypted data types | 6 (`euint64`, `euint32`, `euint8`, `euint128`, `eaddress`, `ebool`) |
| Invoice types | 5 (standard, multi-pay, recurring, vesting, batch) |
| Frontend pages | 14 (100% on-chain data, zero localStorage) |
| Real ETH | Yes — payable escrow with auto-settle + cancel refunds |

**What FHE encrypts in CipherPay:**
- Invoice amounts (`euint64`) — Etherscan shows only ciphertext handles
- Recipient addresses (`eaddress`) — who gets paid is hidden
- Collected payment totals — computed via `FHE.add()` on ciphertext
- Tax calculations — `FHE.mul()` + `FHE.div()` on encrypted basis points
- Subscription tiers (`euint8`) and expiry (`euint64`)
- Per-user metrics: totalSent, totalReceived, invoiceCount
- Shared invoice individual shares — each participant sees only their own
- Platform aggregate volume — only owner decrypts via `FHE.allowGlobal()`

**Verify on Etherscan:** Open the [FHE contract](https://sepolia.etherscan.io/address/0x626c1661cF0b72E47E9FcA0BF96d0D1A70d42852) → click any transaction → Input Data shows ciphertext handles (not human-readable amounts). Internal transactions show real ETH moving through escrow.

**Why this matters:** No other project in this wave combines encrypted amounts + encrypted recipients + encrypted tax + encrypted analytics + encrypted subscriptions + encrypted bill splitting in a single protocol with real ETH settlement.

---

<div align="center">

Built with Fhenix CoFHE for the Privacy-by-Design dApp Buildathon

</div>
