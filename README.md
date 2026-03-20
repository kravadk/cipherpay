# CipherPay

**Privacy-first invoice & payment protocol powered by Fhenix FHE on Ethereum Sepolia**

CipherPay enables encrypted invoicing where amounts are hidden on-chain using Fully Homomorphic Encryption. Only authorized parties can decrypt — no one else sees the numbers, not even validators.

## How Fhenix FHE is Used

CipherPay is built on the **Fhenix CoFHE coprocessor** — FHE-as-a-Service for EVM chains. The contract lives on Ethereum Sepolia, but all encryption operations are handled by Fhenix infrastructure.

### Solidity — Encrypted Types & Operations

```solidity
import {FHE, euint64, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

// Store encrypted amount on-chain
euint64 amount = FHE.asEuint64(_encryptedInput);

// Encrypted arithmetic (multi-pay: add payments without revealing)
euint64 total = FHE.add(collected, payment);

// Access control — who can decrypt
FHE.allowThis(amount);          // Contract can reuse ciphertext
FHE.allowSender(amount);        // Creator can decrypt
FHE.allow(amount, recipient);   // Recipient can decrypt
```

The contract `CipherPayFHE.sol` uses `euint64` for all amounts. Values stored on-chain are ciphertext handles — not plaintext numbers. Even Etherscan shows only the handle, not the amount.

### Client SDK — Encryption & ZK Proofs

```typescript
import { Encryptable } from '@cofhe/sdk';

// Encrypt amount in browser (TFHE + ZK Proof of Knowledge)
const [encryptedAmount] = await cofheClient
  .encryptInputs([Encryptable.uint64(parseEther('0.1'))])
  .onStep((step, ctx) => {
    if (ctx?.isEnd) console.log(`✓ ${step}`);
  })
  .execute();

// Send encrypted InEuint64 tuple to contract
await contract.createInvoice(encryptedAmount, recipient, type, ...);
```

Encryption happens client-side in 5 steps: InitTfhe → FetchKeys → Pack → Prove → Verify. The ZK proof runs in a Web Worker to avoid blocking UI.

### Permits — Decryption Authorization

```typescript
// Sign EIP-712 permit (MetaMask popup)
await cofheClient.permits.getOrCreateSelfPermit();

// Get ciphertext handle from contract
const ctHash = await contract.getEncryptedAmount(invoiceHash);

// Decrypt via CoFHE Threshold Network
const amount = await cofheClient
  .decryptForView(ctHash, FheTypes.Uint64)
  .execute();
```

Decryption requires both an on-chain ACL check (`FHE.allowSender`) and a valid EIP-712 permit. The Threshold Network ensures no single party holds the full decryption key.

### What's Encrypted vs Public

| Data | Visibility |
|------|-----------|
| Invoice amount | Encrypted (`euint64`) — permit required |
| Payment amounts | Encrypted (`euint64`) — permit required |
| Collected total (multi-pay) | Encrypted — computed via `FHE.add()` |
| Invoice hash, type, status | Public |
| Creator & recipient addresses | Public |
| Block number, timestamp | Public |
| Payer count | Public |
| Memo | Public (on-chain string) |

## Architecture

```
Browser                          Ethereum Sepolia              CoFHE (Fhenix)
┌─────────────┐                  ┌──────────────┐              ┌──────────────┐
│ @cofhe/sdk  │──encrypt────────>│ CipherPayFHE │──FHE ops────>│ FHEOS Server │
│ TFHE + ZK   │                  │ euint64      │<─results─────│ (off-chain)  │
│ Web Worker  │                  │ FHE.add()    │              └──────────────┘
└──────┬──────┘                  │ FHE.allow()  │              ┌──────────────┐
       │                         └──────────────┘              │  Threshold   │
       │──permit (EIP-712)──────────────────────────────────>  │  Network     │
       │<─decrypted value────────────────────────────────────  │ (decrypt)    │
       │                                                       └──────────────┘
```

## Deployed Contracts

| Contract | Address | Role |
|----------|---------|------|
| CipherPayFHE | `0x39655b5171577e91AFB57d86a48c6D39D51f20eb` | Primary — FHE encrypted amounts |
| CipherPaySimple | `0xa84607842BBb8b9871E3A64FD9a5AFEb8d2C9aBE` | Fallback — plaintext amounts |

Network: Ethereum Sepolia (Chain ID: 11155111)

## Features

**Invoice Types:**
- **Standard** — single payer, auto-settle on payment
- **Multi Pay** — multiple payers contribute, creator settles manually. Amounts added via `FHE.add()` on-chain
- **Recurring** — configurable frequency (daily/custom/weekly/bi-weekly/monthly)
- **Vesting** — locked until specific block height, enforced in contract

**App Pages:**
- Dashboard — real-time balance + invoice list from blockchain
- Explorer — search by hash, filter by type/status
- New Cipher — create invoices with FHE encryption flow
- Pay — encrypted payments with ZK proof generation
- Recurring — manage schedules, pause/resume/cancel
- Batch — CSV upload, multi-recipient payments
- Identity — CipherCard, QR code, downloadable card
- Notifications — on-chain events (InvoicePaid, InvoiceSettled, InvoiceCancelled)
- Settings — FHE permit management, preferences
- Build — contract functions reference, code examples
- Guide — 20+ documentation sections

**Data:**
- 100% on-chain — no localStorage, no backend, no cache
- All invoice data fetched from Sepolia via `readContract`
- Notifications parsed from blockchain event logs

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS 4 + Framer Motion |
| Wallet | Wagmi v2 + Viem |
| FHE SDK | @cofhe/sdk 0.4.0 |
| Contracts | @fhenixprotocol/cofhe-contracts 0.1.0 |
| Solidity | 0.8.25, evmVersion: cancun |
| Hardhat | @cofhe/hardhat-plugin 0.4.0 |
| Network | Ethereum Sepolia |

## Run Locally

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Add your private key to .env (for contract deployment only)

# Start development server
npx vite --port 3005

# Compile contracts
TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat compile --config hardhat.config.cts

# Deploy FHE contract to Sepolia
TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/deploy-fhe.cts --network eth-sepolia --config hardhat.config.cts
```

## Project Structure

```
contracts/
├── CipherPayFHE.sol          # Primary contract with FHE (euint64, FHE.add, FHE.allow)
├── CipherPaySimple.sol        # Fallback contract (plaintext uint256)
└── CipherPay.sol              # Original FHE attempt (v1)

src/
├── components/                # UI components (CipherCard, DatePicker, NetworkStrip, etc.)
├── config/
│   ├── contract.ts            # ABI + addresses (FHE InEuint64 tuples)
│   ├── fhenix.ts              # Fhenix explorer URL, chain config
│   └── wagmi.ts               # Wagmi + Sepolia config
├── hooks/
│   ├── useCofhe.ts            # CoFHE SDK init, encrypt, decrypt, permits
│   ├── useInvoices.ts         # Read invoices from blockchain
│   └── useNotifications.ts    # Parse on-chain events
├── pages/
│   ├── app/                   # Dashboard, Explorer, NewCipher, Settings, etc.
│   ├── Pay.tsx                # Public pay page with FHE encryption
│   └── Profile.tsx            # Public profile via QR code
└── store/                     # Zustand — UI state only (no invoice data)

scripts/
├── deploy-fhe.cts             # Deploy CipherPayFHE to Sepolia
└── deploy-simple.cts          # Deploy CipherPaySimple to Sepolia
```

## Hackathon

Built for **Privacy-by-Design dApp Buildathon** by Fhenix.

- Wave 1: Core protocol + FHE integration + working MVP
- Wave 2: Full FHE decryption, The Graph subgraph
- Wave 3: Recurring automation, Batch tx, CipherDrop, FHERC20
- Wave 4: Audit packages, backend, claim page
- Wave 5: Multi-chain, mobile, security audit

## Links

- [Fhenix](https://fhenix.io)
- [CoFHE Docs](https://cofhe-docs.fhenix.zone)
- [CoFHE SDK](https://www.npmjs.com/package/@cofhe/sdk)
- [Buildathon Telegram](https://t.me/+rA9gI3AsW8c3YzIx)
