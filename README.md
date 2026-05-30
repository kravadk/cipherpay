<div align="center">

# ◆ CipherPay

### The confidential payroll rail on Fhenix FHE

**Pay your team, contractors, and DAO contributors on-chain — while every salary stays encrypted.**

[![Network](https://img.shields.io/badge/Ethereum-Sepolia-3C3C3D)](https://sepolia.etherscan.io)
[![Network](https://img.shields.io/badge/Arbitrum-Sepolia-28A0F0)](https://sepolia.arbiscan.io)
[![E2E tests](https://img.shields.io/badge/E2E_tests-67%2F67_passing-brightgreen)](#-verification--evidence)
[![SDK](https://img.shields.io/badge/npm-cipherpay--sdk-CB3837)](https://www.npmjs.com/package/cipherpay-sdk)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

Amounts, recipients, balances and totals are stored as Fully Homomorphic Encryption ciphertext.
The Fhenix CoFHE coprocessor computes on that encrypted data — sums payouts, checks thresholds,
deducts fees — **without ever decrypting**. Only authorized parties decrypt, via EIP-712 permits.

[**▶ Live App**](https://cipherpayy.vercel.app) · [**Proof page**](https://cipherpayy.vercel.app/app/proof) · [**npm: cipherpay-sdk**](https://www.npmjs.com/package/cipherpay-sdk) · [**Fhenix Docs**](https://cofhe-docs.fhenix.zone)

</div>

---

## ⚡ TL;DR for judges

CipherPay is a **confidential payroll rail**: one product that lets an employer or DAO pay many
people on-chain while every salary is an FHE ciphertext (`euint64`). It is **real FHE, not
mocked** — and every claim below is verifiable on-chain.

| | |
|---|---|
| **Smart contracts** | 15 deployed & verified on Ethereum Sepolia |
| **FHE operations** | 57+ distinct ops on real Fhenix CoFHE |
| **On-chain E2E tests** | **67 / 67 passing** (real FHE on Sepolia) — 35 Wave 1–2 + 32 Wave 3–5 |
| **Unit tests** | 13 / 13 passing |
| **SDK** | [`cipherpay-sdk`](https://www.npmjs.com/package/cipherpay-sdk) — published & installable |
| **Networks** | Ethereum Sepolia (core stack) + Arbitrum Sepolia (Privara settlement) |
| **App** | 27 pages, 100% on-chain — [cipherpayy.vercel.app](https://cipherpayy.vercel.app) |

**How this maps to the evaluation criteria:**

| Criterion | Where to look |
|---|---|
| **Quality of Fhenix integration** | [How the FHE works](#-how-the-fhe-works) — 57+ real CoFHE ops, per-row ACL, two-phase decrypt |
| **Evidence of testing / usage** | [Verification & evidence](#-verification--evidence) — 67/67 live E2E, in-app [Proof page](https://cipherpayy.vercel.app/app/proof), seeded demo data |
| **Progress between submissions** | [Wave-by-wave progression](#-wave-by-wave-progression) — invoicing → a full payroll rail |
| **Clarity of product direction** | One sharp problem (confidential payroll), one product, [six coherent layers](#-what-cipherpay-is) |

---

## The problem

Run payroll on a public chain today and you leak everything: what the CTO earns, what each
contractor charges, who just got a raise, how large the treasury is. Salary data is the most
sensitive financial data an organization has — and on transparent rails it is visible to
competitors, recruiters, and anyone with an Etherscan tab.

That single architectural fact is why crypto-native companies, DAOs, and freelance platforms
still run payroll off-chain. They **can't** put it on-chain — not won't, can't.

**FHE vs ZK:** ZK proves a fact without revealing data, but plaintext still exists *during*
computation. FHE encrypts data **and computes on it while encrypted** — the plaintext salary
never touches the chain.

---

## ◆ What CipherPay is

A confidential payroll rail, built as **six coherent layers of one product**:

| Layer | Contract | What it does |
|---|---|---|
| **Batch Payout** | `BatchCipher` | Pay N recipients in one tx; per-row `FHE.allow` so no recipient can decrypt another's amount |
| **Recurring Payroll** | `RecurringScheduler` | Encrypted pay schedule — frequency & next-due block hidden; Chainlink-Automation compatible |
| **Salary Proof** | `SalaryProof` | An employee proves "income ≥ X" on-chain without revealing the amount |
| **Audit Center** | `AuditCenter` | Scoped, time-limited disclosure — an auditor decrypts only the fields & period you grant |
| **DAO Treasury** | `DAOTreasury` | Encrypted budget proposals + `euint32` vote tallies for DAO-run payroll |
| **Fee Module** | `FeeModule` | Encrypted platform fee rate; `FHE.mul` on ciphertext; only aggregate revenue is public |

Plus two payout-asset rails and an evidence layer:

- **`ConfidentialPayrollToken`** — an FHERC-20 confidential stablecoin (`euint64` balances); pay
  salaries in a price-stable token, not volatile ETH.
- **Privara settlement** — confidential escrow payroll on Arbitrum Sepolia via `@reineira-os/sdk`.
- **`PayrollAnchor`** — an on-chain Merkle anchor that makes invoice-existence proofs publicly
  verifiable without revealing amounts or parties.

Underneath, the same engine powers confidential **invoicing** primitives (standard, multi-pay,
recurring, vesting, donation) — useful on their own, and the building blocks the payroll layers
settle through.

**Who it's for:** crypto-native companies paying salaries in-protocol · DAOs paying contributors
from an encrypted treasury · freelance & contractor platforms hiding rates between clients ·
anyone who needs **selective disclosure** for an auditor or tax accountant.

---

## ★ Key features

- **Batch payout with per-row encryption** — one transaction pays a whole team; `FHE.allow` is
  granted per row, so recipient A mathematically cannot decrypt recipient B's salary.
- **Prove income without revealing it** — `FHE.gte(income, threshold)` yields an on-chain boolean
  "income ≥ X: true" — usable for credit, rental, or DAO voting weight, with no amount disclosed.
- **Selective, scoped audit** — grant an auditor decryption of *specific fields* for a *specific
  period*; everything else stays encrypted. Compliance without surveillance.
- **Confidential stablecoin** — `ConfidentialPayrollToken`: an FHERC-20 where the balance itself
  is a ciphertext; transfers clamp to the available balance via `FHE.select` (no leak on
  insufficient funds).
- **Encrypted DAO governance** — budget proposals and `euint32` vote tallies stay encrypted; the
  quorum result is revealed only after the vote closes.
- **Anonymous claim & shielded pool** — nullifier-based claims with no address on-chain;
  `msg.value = 0` payments that break Etherscan amount-correlation.
- **Real Merkle existence proofs** — `PayrollAnchor` + a real keccak256 Merkle tree prove an
  invoice existed without exposing it.
- **Two-phase on-chain decryption** — `allowPublic → decryptForTx → publishDecryptResult`, the
  current CoFHE async-decrypt pattern.

---

## 🔌 Integrations

| Integration | How CipherPay uses it |
|---|---|
| **Fhenix CoFHE** | The core FHE coprocessor — `@fhenixprotocol/cofhe-contracts` in Solidity, `@cofhe/sdk` (TFHE + ZK) client-side. 57+ FHE operations across 15 contracts. |
| **Privara / ReineiraOS** | `@reineira-os/sdk` — confidential escrow settlement on Arbitrum Sepolia. The in-app **Privara Settlement** page creates, funds and redeems confidential-USDC escrows as a second payout rail. |
| **`cipherpay-sdk`** | Our own published npm package — `runPayroll()` (batch payroll), `useCheckout()` React hook, HMAC-SHA256 webhook verification. Lets any merchant integrate confidential payroll in ~10 lines. |
| **wagmi + viem** | Multi-chain wallet layer — Ethereum Sepolia for the core stack, Arbitrum Sepolia for Privara, with in-app network switching. |
| **Chainlink Automation** | `RecurringScheduler` exposes an `FHE.gte(block, nextDue)` check compatible with Automation keepers — recurring payroll without revealing the cadence. |

---

## 🔐 How the FHE works

### Architecture

```
User (Browser)                 Ethereum Sepolia              CoFHE (Fhenix)
┌─────────────┐                ┌──────────────┐              ┌──────────────┐
│ @cofhe/sdk  │──encrypt──────>│ BatchCipher  │──FHE ops────>│ FHEOS Server │
│ TFHE + ZK   │                │ euint64      │<─results─────│ (off-chain)  │
│ Web Worker  │                │ FHE.add()    │              └──────────────┘
└──────┬──────┘                │ FHE.allow()  │              ┌──────────────┐
       │                       └──────────────┘              │  Threshold   │
       │──permit (EIP-712)──────────────────────────────────>│  Network     │
       │<─decrypted value────────────────────────────────────│ (decrypt)    │
       │                                                     └──────────────┘
```

1. **Client encrypts** — `@cofhe/sdk` encrypts the amount in-browser with TFHE + a ZK proof
   (Web Worker, ~9 s).
2. **Contract stores** — `FHE.asEuint64(encryptedInput)` becomes an on-chain ciphertext handle.
3. **CoFHE computes** — `FHE.add`, `FHE.gte`, `FHE.select` … run on ciphertext off-chain, result
   returned on-chain.
4. **ACL controls** — `FHE.allow(handle, recipient)` defines exactly who may decrypt each handle.
5. **Threshold decrypts** — an authorized user signs an EIP-712 permit → the CoFHE Threshold
   Network decrypts → plaintext is returned only to that user.

### Real FHE — encrypted types & operations

```solidity
import {FHE, euint64, euint32, euint8, eaddress, InEuint64, ebool}
  from "@fhenixprotocol/cofhe-contracts/FHE.sol";

euint64 amount   = FHE.asEuint64(_encryptedInput);   // ciphertext handle on-chain
euint64 total    = FHE.add(collected, amount);       // arithmetic on ciphertext
ebool   enough   = FHE.gte(balance, amount);         // comparison → encrypted bool
euint64 sent     = FHE.select(enough, amount, FHE.asEuint64(0)); // encrypted ternary

FHE.allow(amount, recipient);   // per-recipient decrypt rights — the batch-payroll ACL
FHE.allowGlobal(platformVolume);// only aggregate stats are public
FHE.allowPublic(result);        // phase 1 of two-phase async decrypt
```

### What's visible vs. hidden

| Data | Etherscan (public) | With EIP-712 permit |
|------|-------------------|---------------------|
| Salary / payout amount | ciphertext handle only | decrypted value |
| Recipient (encrypted invoices) | ciphertext handle only | decrypted address |
| Confidential-token balance | ciphertext handle only | decrypted balance |
| Aggregate platform volume | `FHE.allowGlobal` — public | — |
| Invoice hash, type, status, creator, block | ✓ visible | ✓ visible |

> `msg.value` (ETH) is always visible on Ethereum L1 — a protocol limitation no encryption can
> remove. FHE encrypts **contract state**; the confidential stablecoin and shielded pool exist
> precisely to keep payout *values* off the transaction envelope.

---

## ✅ Verification & evidence

Everything below is reproducible — nothing is a mock.

| Check | Result |
|---|---|
| Wave 1–2 E2E (`scripts/e2e-test.cts`) | **35 / 35 passing** — real FHE on Sepolia |
| Wave 3–5 E2E (`scripts/test-all-flows.cts`) | **32 / 32 passing** — all 8 payroll/compliance contracts |
| Contract unit tests (`test/`) | **13 / 13 passing** — `PayrollAnchor`, `ConfidentialPayrollToken` |
| Frontend build (`vite build`) | ✅ green |
| Contract compile (`hardhat compile`) | ✅ green — 17 contracts |
| `cipherpay-sdk` type-check | ✅ green |

**In-app evidence:** the [**Proof page**](https://cipherpayy.vercel.app/app/proof) lists all 15
contracts with live Etherscan links; the deployment is also seeded with demo payroll invoices so
the app is not empty.

### Live deployment — Ethereum Sepolia

Payroll layers first; full set of 15 contracts. Deployment record: `deployments/eth-sepolia.json`.

| Contract | Address | Role |
|----------|---------|------|
| **BatchCipher** | [`0x347f…d4C4`](https://sepolia.etherscan.io/address/0x347fb466f3c9bC031560b49973ec05BdAdD2d4C4) | Batch payout — per-row `FHE.allow` |
| **RecurringScheduler** | [`0xdB4F…B9D7`](https://sepolia.etherscan.io/address/0xdB4F6A0CC67B3dF1f25129079E3f45b996A4B9D7) | Recurring payroll — encrypted schedule |
| **SalaryProof** | [`0x7C23…c0bA`](https://sepolia.etherscan.io/address/0x7C23cE4d05D9A906c8aC3701cAA6070eA7bDc0bA) | Prove income ≥ X without revealing it |
| **AuditCenter** | [`0x747B…2d86`](https://sepolia.etherscan.io/address/0x747B6154De3895a4bfC8CF6eb42AF13E1C362d86) | Scoped, time-limited audit disclosure |
| **DAOTreasury** | [`0x1084…5b95`](https://sepolia.etherscan.io/address/0x1084BCdc75356B4FF761bd420313FfA6194f5b95) | Encrypted DAO budget + vote tallies |
| **ConfidentialPayrollToken** | [`0xBD9D…8Bfb`](https://sepolia.etherscan.io/address/0xBD9D748Dcd27baF163c8E400990744959A7D8Bfb) | FHERC-20 confidential payout token |
| **PayrollAnchor** | [`0xdd8D…4982`](https://sepolia.etherscan.io/address/0xdd8D14ae7bAf18a2e71a6B0Bfa41B4D16cBD4982) | Merkle anchor for invoice-existence proofs |
| **FeeModule** | [`0xAfBe…9A39`](https://sepolia.etherscan.io/address/0xAfBefEe6C72F34eA3f35004dA4F5bDA69D069A39) | Encrypted platform fee rate |
| CipherPayFHE | [`0x305e…662e`](https://sepolia.etherscan.io/address/0x305eF265BD964fBe34913E70Ef6AA8951e6b662e) | Invoice engine — encrypted amounts, anon claim |
| CipherPaySimple | [`0x5F49…38E3`](https://sepolia.etherscan.io/address/0x5F4999829D57f714497343f5677e66e6A56238E3) | Fallback — real ETH escrow, vesting |
| PaymentProof | [`0xa3B5…76d1`](https://sepolia.etherscan.io/address/0xa3B5c8276C06C812e5d0aC266c30cF83e36d76d1) | On-chain encrypted payment receipts |
| SharedInvoice | [`0xE4dF…58Be`](https://sepolia.etherscan.io/address/0xE4dFef03E107225f2239CFfF955a378A9a8158Be) | Bill splitting with encrypted shares |
| InvoiceMetrics | [`0xec76…116D`](https://sepolia.etherscan.io/address/0xec7608730978B68A8D8c36B5d1f131634621116D) | Encrypted per-user analytics |
| CipherDrop | [`0x74F7…41BD`](https://sepolia.etherscan.io/address/0x74F75532428A99E613a865C97D1084b7f38241BD) | FHE-gated airdrop |
| MilestoneEscrow | [`0x98e1…6FF4`](https://sepolia.etherscan.io/address/0x98e1E3A36796a42feC93B1971F9C7714f3D16FF4) | Chained `FHE.select` milestone tiers |

### Reproduce it

```bash
# Redeploy every contract from one script
TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/deploy-all.cts \
  --network eth-sepolia --config hardhat.config.cts

# Run the full 67-test on-chain E2E suite (needs PRIVATE_KEY + PRIVATE_KEY_B)
TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/e2e-test.cts       --network eth-sepolia --config hardhat.config.cts
TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/test-all-flows.cts --network eth-sepolia --config hardhat.config.cts

# Run the contract unit tests
TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat test --config hardhat.config.cts
```

---

## 📦 The `cipherpay-sdk`

Published on npm — confidential payroll in ~10 lines:

```ts
import { CipherPay } from 'cipherpay-sdk';

const cp = new CipherPay({ rpcUrl: process.env.SEPOLIA_RPC_URL!, privateKey: EMPLOYER_KEY });

await cp.runPayroll({
  memo: 'April Payroll',
  recipients: [
    { address: '0xAbc…', amount: '2500.00' },
    { address: '0xDef…', amount: '1800.00' },
  ],
});
```

Every salary is FHE-encrypted client-side, then one `BatchCipher` transaction creates an
encrypted row per recipient. React hooks (`useCheckout`) live at `cipherpay-sdk/react`.

---

## 🛠 Tech stack

| Layer | Technology |
|-------|-----------|
| FHE coprocessor | Fhenix CoFHE |
| Client encryption | `@cofhe/sdk` (TFHE + ZK proofs, Web Worker) |
| Contracts | Solidity 0.8.25 · `@fhenixprotocol/cofhe-contracts` |
| Tooling | Hardhat · `@cofhe/hardhat-plugin` · TypeChain |
| Frontend | React 18 · TypeScript · Vite · Tailwind CSS 4 · Framer Motion |
| Web3 | wagmi + viem — multi-chain (Sepolia + Arbitrum Sepolia) |
| Settlement partner | Privara / ReineiraOS (`@reineira-os/sdk`) |
| Data | 100% on-chain — no backend, no database |

---

## 🚀 Run it locally

```bash
git clone https://github.com/kravadk/cipherpay.git
cd cipherpay
npm install
cp .env.example .env        # set SEPOLIA_RPC_URL, PRIVATE_KEY
npm run dev                 # http://localhost:3000
```

---

## 📈 Wave-by-wave progression

The buildathon rewards progress between submissions. CipherPay grew from encrypted invoicing
into a focused payroll rail:

| Wave | Delivered |
|---|---|
| **1** | CipherPayFHE invoice engine, 6 invoice types, real ETH escrow, 25+ FHE ops |
| **2** | Nullifier-based anonymous claim, shielded pool (`msg.value = 0`), checkout embed |
| **3** | `BatchCipher` (per-row ACL), `CipherDrop` (FHE-gated airdrop), `MilestoneEscrow`, `RecurringScheduler` (FHE clock) |
| **4** | `SalaryProof`, `AuditCenter` (scoped disclosure), `DAOTreasury` (encrypted votes) |
| **5** | Repositioned to **confidential payroll**: `ConfidentialPayrollToken`, `PayrollAnchor`, published `cipherpay-sdk`, Privara/Arbitrum settlement, mocks removed, full redeploy + 67/67 E2E verified |

---

## 🛡 Security

See [`docs/SECURITY.md`](docs/SECURITY.md) for the honest self-audit and [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
for the adversary model. Headline points:

- Every `FHE.allow*` grant is CI-checked by `scripts/audit-acl.cts`.
- Reentrancy: checks-effects-interactions on all ETH paths; covered by a Hardhat invariant suite.
- **Testnet only.** Contracts have not had a third-party audit — do not use with real funds.
- One open item is disclosed, not hidden: two-phase decrypt does not yet enforce on-chain
  permit freshness (planned).

---

## Roadmap

- Third-party security audit of the payroll core (`BatchCipher`, `RecurringScheduler`,
  `ConfidentialPayrollToken`) ahead of any mainnet move.
- On-chain permit-freshness / expiry for the two-phase decrypt path.
- Privara cross-chain (CCTP) funding — fund an Arbitrum payroll escrow directly from Sepolia.
- Mainnet when Fhenix CoFHE is generally available there.

---

## Links

- **Live app** — https://cipherpayy.vercel.app
- **npm SDK** — https://www.npmjs.com/package/cipherpay-sdk
- **Fhenix** — https://fhenix.io · [CoFHE docs](https://cofhe-docs.fhenix.zone)
- **Privara** — https://reineira.xyz

## License

MIT

<div align="center">

**Built with Fhenix CoFHE for the Privacy-by-Design dApp Buildathon.**
Real FHE · 15 contracts · 67/67 tests · zero mocks.

</div>
