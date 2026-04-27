import { motion } from 'framer-motion';
import { BookOpen, Search, ChevronRight, ChevronDown, ExternalLink, Info, Zap, Shield, Lock, Code, HelpCircle } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const NAV_SECTIONS = [
  {
    title: 'Getting Started', icon: Zap, items: [
      'What is CipherPay?', 'Connect Your Wallet', 'Your First Invoice',
    ]
  },
  {
    title: 'Invoice Types', icon: Shield, items: [
      'Standard', 'Multi Pay', 'Recurring', 'Vesting', 'Batch',
    ]
  },
  {
    title: 'Payments', icon: Lock, items: [
      'Paying an Invoice', 'Tracking Status', 'Proof of Settlement',
    ]
  },
  {
    title: 'Privacy & Encryption', icon: Lock, items: [
      'How FHE Works', 'What is Encrypted?', 'Privacy Matrix',
    ]
  },
  {
    title: 'Audit & Compliance', icon: Shield, items: [
      'Audit Packages', 'Selective Disclosure', 'Sharing Permits',
    ]
  },
  {
    title: 'SDK Reference', icon: Code, items: [
      'Installation', 'encryptInputs', 'decryptForView', 'Permits',
    ]
  },
  {
    title: 'FAQ', icon: HelpCircle, items: [
      'Common Errors', 'Troubleshooting',
    ]
  },
];

const CONTENT: Record<string, string> = {
  'What is CipherPay?': `# What is CipherPay?

CipherPay is a privacy-first invoice and payment protocol built on **Ethereum Sepolia** using the **Fhenix CoFHE coprocessor** for Fully Homomorphic Encryption. It allows you to create, pay, and settle invoices without revealing sensitive data like amounts on-chain.

## Key Features

- **FHE-Encrypted Amounts**: Invoice amounts stored as \`euint64\` on-chain — invisible to observers
- **CoFHE Coprocessor**: Encryption/decryption handled by Fhenix infrastructure on top of standard EVM
- **EIP-712 Permits**: Only authorized parties (creator, recipient) can decrypt via wallet signature
- **On-chain Verifiable**: All state transitions (create, pay, settle, cancel) are publicly verifiable
- **Access Control**: \`FHE.allowSender()\`, \`FHE.allow(address)\` — fine-grained decryption permissions

## Architecture

\`\`\`
Browser (SDK)  →  Encrypt amount (TFHE + ZK proof)  →  Contract (Sepolia)
                                                          ↕
                                                    CoFHE Coprocessor
                                                    (FHE operations)
                                                          ↕
                                                    Threshold Network
                                                    (decryption with permit)
\`\`\`

## Who is it for?

- **Freelancers** who want payment privacy
- **DAOs** distributing funds privately
- **Businesses** with compliance requirements
- **Anyone** who values financial privacy`,

  'Connect Your Wallet': `# Connect Your Wallet

## Prerequisites

- MetaMask or any injected wallet
- Sepolia testnet ETH for gas fees (get from faucets)

## Steps

1. Click **"Connect Wallet"** on the landing page
2. Select your wallet provider (MetaMask, Rabby, OKX, etc.)
3. Approve the connection request in your wallet
4. Ensure you're on **Ethereum Sepolia** (Chain ID: 11155111)

> **Tip:** If you see "Wrong Network", click the Switch Network button to auto-configure Ethereum Sepolia.

## Network Details

- **Chain ID**: 11155111
- **Network**: Ethereum Sepolia
- **Currency**: SepoliaETH
- **RPC**: \`https://1rpc.io/sepolia\`
- **Explorer**: \`https://sepolia.etherscan.io\``,

  'Your First Invoice': `# Your First Invoice

## Creating a Standard Invoice

1. Navigate to **New Cipher** from the sidebar
2. Select **"Standard"** as the cipher type
3. Enter the amount in ETH (USD conversion shown automatically)
4. Optionally add a recipient address and memo
5. Click **"Preview Encryption"** to review what's public vs encrypted
6. Click **"Deploy to Sepolia"** to submit

## What Happens On-Chain

1. **Client-side**: Amount is encrypted using CoFHE SDK (\`encryptInputs\` + ZK proof)
2. **Contract**: \`FHE.asEuint64(encryptedInput)\` converts to on-chain ciphertext
3. **Access control**: \`FHE.allowSender()\` + \`FHE.allow(recipient)\` set decryption permissions
4. **Event**: \`InvoiceCreated\` emitted with invoice hash, type, public metadata
5. **Amount**: Stored as \`euint64\` handle — NOT visible on Etherscan

> **Note:** The recipient can pay using the invoice hash or the payment link you share.`,

  'Standard': `# Standard Invoice

A single invoice for a single payment. The simplest and most common type.

## Use Cases
- Freelance project payments
- One-off service fees
- Simple transfers

## How It Works
1. Creator sets amount + optional recipient
2. Amount is encrypted via \`Encryptable.uint64()\` and sent as \`InEuint64\` tuple
3. Contract stores encrypted amount with \`FHE.allowSender()\` for creator
4. Invoice stays **Open** until paid
5. Once paid, status automatically changes to **Settled**

## On-Chain Data
- **Public**: hash, type, status, creator, recipient, block, deadline
- **Encrypted**: amount (\`euint64\`)`,

  'Multi Pay': `# Multi Pay Invoice

Accept encrypted payments from multiple parties into a single invoice.

## Use Cases
- Crowdfunding campaigns
- Group expenses
- Community fundraising

## How It Works
1. Creator creates invoice with target amount (encrypted)
2. Multiple wallets can submit payments via \`payInvoice(hash, encryptedAmount)\`
3. Each payment is encrypted — collected total computed via \`FHE.add()\` on-chain
4. Payer count is public, but individual amounts are encrypted
5. Invoice stays **Open** until creator manually calls \`settleInvoice()\`

## Key Difference from Standard
- Standard: auto-settles after first payment
- Multi Pay: requires creator to explicitly settle`,

  'Recurring': `# Recurring Invoice

Set up repeating payments with configurable frequency.

## Use Cases
- Salary payments
- Subscription fees
- Retainer agreements

## Frequency Options
- **Daily** — every day
- **Custom** — every N days (2-30)
- **Weekly** — every 7 days
- **Bi-weekly** — every 14 days
- **Monthly** — every 30 days

## Settings
- **Frequency**: Daily / Custom / Weekly / Bi-weekly / Monthly
- **Custom Days**: 2-30 (when Custom selected)
- **Max Cycles**: 1-120
- **Start Date**: When the first payment is due

> **Note:** In Wave 1, recurring metadata is stored in the memo field. Automated payments via Chainlink Automation planned for Wave 2.`,

  'Vesting': `# Vesting Invoice

Amount is locked until a specific block height is reached.

## Use Cases
- Contractor milestone payments
- Token vesting schedules
- Time-locked escrow

## How It Works
1. Creator sets amount + unlock date
2. Unlock date is converted to estimated block height (\`currentBlock + days * blocksPerDay\`)
3. Invoice has status **Open** but contract enforces \`require(block.number >= unlockBlock)\`
4. Before unlock: payment transactions revert with "Still locked"
5. After unlock: payment proceeds normally

## On-Chain Enforcement
The lock is enforced in the smart contract — not in the UI. Even if someone calls \`payInvoice\` directly, it will revert before the unlock block.`,

  'Batch': `# Batch Invoice

Pay multiple recipients privately in one transaction.

## Use Cases
- Payroll processing
- Airdrop distributions
- Multi-party settlements

## Limits
- Maximum 20 recipients per batch
- Each amount is encrypted individually via \`Encryptable.uint64()\`
- \`encryptInputs\` limit: 2048 bits per call (max ~32 uint64 values)
- For >32 recipients: split into multiple transactions

> **Note:** In Wave 1, batch creates individual invoices. A single-transaction batch function is planned for Wave 2.`,


  'Tracking Status': `# Tracking Status

## Invoice Statuses

| Status | Meaning |
|--------|---------|
| **Open** | Awaiting payment |
| **Settled** | Fully paid and closed |
| **Cancelled** | Cancelled by creator |

## Where to Check
- **Dashboard**: Shows your invoices with real-time status from blockchain
- **Explorer**: Search by invoice hash
- **Notifications**: On-chain events (payment received, settled, cancelled)
- **Etherscan**: Transaction-level verification

## Real-Time Updates
All data is fetched directly from the Ethereum Sepolia blockchain. No local cache — refresh the page for the latest state.`,

  'How FHE Works': `# How FHE Works

Fully Homomorphic Encryption (FHE) allows computation on encrypted data without decrypting it.

## CipherPay's FHE Architecture

1. **Client Encryption**: Browser encrypts amount using CoFHE SDK (TFHE + ZK proof via Web Worker)
2. **On-Chain Storage**: Contract receives \`InEuint64\` tuple → \`FHE.asEuint64()\` → stores \`euint64\` handle
3. **On-Chain Computation**: \`FHE.add(a, b)\` adds encrypted values. CoFHE coprocessor executes off-chain, returns result on-chain
4. **Access Control**: \`FHE.allowSender()\`, \`FHE.allow(address)\` — who can request decryption
5. **Decryption**: Threshold Network decrypts only for authorized addresses with valid EIP-712 permit

## CoFHE Coprocessor

CipherPay doesn't run on a separate FHE blockchain. The contract lives on **Ethereum Sepolia** (standard EVM). FHE operations are handled by the CoFHE coprocessor:

- \`FHE.asEuint64()\` → emits event → CoFHE processes → result returned on-chain
- \`FHE.add(a, b)\` → same flow
- Decryption → Threshold Network (no single party has the full key)

## Encrypted Types Used

| Type | Bits | Use Case |
|------|------|----------|
| \`euint64\` | 64 | Invoice amounts, payment amounts |
| \`InEuint64\` | — | Client → contract encrypted input |
| \`ebool\` | 1 | Comparison results |`,

  'What is Encrypted?': `# What is Encrypted?

## Encrypted (FHE-protected, requires permit to decrypt)
- Invoice amounts (\`euint64\` on-chain)
- Payment amounts (\`euint64\` on-chain)
- Collected totals for multi-pay (\`euint64\`, computed via \`FHE.add()\`)

## Public (visible on Etherscan)
- Invoice hash
- Invoice type (standard, multi-pay, recurring, vesting)
- Status (open / settled / cancelled)
- Creator address
- Recipient address
- Block number, timestamp
- Deadline
- Unlock block (vesting)
- Payer count (multi-pay)
- Memo text

## Access Control (who can decrypt)

| Role | Can Decrypt Amount? |
|------|-------------------|
| Creator | Yes — \`FHE.allowSender()\` at creation |
| Recipient | Yes — \`FHE.allow(recipient)\` at creation |
| Payer | Own payment only — \`FHE.allowSender()\` at payment |
| Anyone else | No — unless granted via sharing permit |`,

  'Privacy Matrix': `# Privacy Matrix

| Data | Public | Auditor | Creator | Recipient |
|---|---|---|---|---|
| Invoice Amount | ✗ Encrypted | ✓ With Audit Package | ✓ With Permit | ✓ With Permit |
| Payment Amount | ✗ Encrypted | ✓ Scoped | ✓ Own payments | ✓ Own payments |
| Invoice Hash | ✓ | ✓ | ✓ | ✓ |
| Status | ✓ | ✓ | ✓ | ✓ |
| Creator Address | ✓ | ✓ | ✓ | ✓ |
| Recipient Address | ✓ | ✓ | ✓ | ✓ |
| Memo | ✓ On-chain | ✓ | ✓ | ✓ |
| Block / Timestamp | ✓ | ✓ | ✓ | ✓ |
| Payer Count | ✓ | ✓ | ✓ | ✓ |

**Note:** "With Permit" means the user must sign an EIP-712 permit in their wallet. This authorizes the CoFHE Threshold Network to decrypt and return the plaintext value.`,

  'Audit Packages': `# Audit Packages

Audit Packages allow selective disclosure of encrypted invoice data to trusted third parties.

## How It Works

1. Go to **Identity > Audit Packages**
2. Click **"Generate Package"**
3. Select an invoice and scope (Amount, Recipient, Memo)
4. Set an expiry date
5. Share the generated package + audit key with your auditor

## Under the Hood

1. Self permit is created via \`client.permits.getOrCreateSelfPermit()\`
2. Sharing permit created for auditor address via \`client.permits.createSharing()\`
3. Package exported without private key
4. Auditor imports package + key to decrypt scoped fields only

## Security

- Both the package AND the audit key are required for decryption
- Packages expire after the set date
- Auditors can only decrypt the fields you've scoped
- Revocation removes the sharing permit`,

  'Selective Disclosure': `# Selective Disclosure

Selective disclosure means proving specific facts about encrypted data without revealing the data itself.

## In CipherPay

When generating an Audit Package, you choose which fields to disclose:

- **Amount only**: Auditor sees the invoice amount but not who paid
- **Full scope**: Amount + recipient + memo — complete transparency for that invoice
- **Partial**: Any combination of fields

## Why It Matters

Compliance requirements vary:
- Tax audits may need only amounts
- Legal disputes may need full transaction details
- Regular reporting may need aggregate data only

Selective disclosure lets you satisfy each requirement with minimum information exposure.`,

  'Installation': `# SDK Installation

\`\`\`bash
npm install @cofhe/sdk@0.5.1 @fhenixprotocol/cofhe-contracts@0.1.0 wagmi viem
\`\`\`

## Quick Setup

\`\`\`typescript
import { createCofheConfig, createCofheClient } from '@cofhe/sdk/web';
import { chains } from '@cofhe/sdk/chains';
import { Encryptable, FheTypes } from '@cofhe/sdk';

const config = createCofheConfig({
  supportedChains: [chains.sepolia],
});
const client = createCofheClient(config);

// Connect with viem wallet + public clients
await client.connect(publicClient, walletClient);
\`\`\`

## Solidity

\`\`\`solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
\`\`\`

> **Note:** \`@cofhe/react\` hooks (useEncrypt, useDecrypt) are still in development. Use \`@cofhe/sdk/web\` directly — this is the recommended approach per Fhenix docs.`,

  'encryptInputs': `# encryptInputs

Encrypts one or more values for submission to a Fhenix-enabled contract.

\`\`\`typescript
import { Encryptable } from '@cofhe/sdk';

const [encryptedAmount] = await cofheClient
  .encryptInputs([Encryptable.uint64(parseEther('0.1'))])
  .onStep((step, ctx) => {
    if (ctx?.isStart) console.log(\`Starting: \${step}\`);
    if (ctx?.isEnd) console.log(\`Done: \${step} (\${ctx.duration}ms)\`);
  })
  .execute();
\`\`\`

## Encryption Steps (5 phases)

1. **InitTfhe** — Load TFHE WebAssembly module
2. **FetchKeys** — Get FHE public key from CoFHE
3. **Pack** — Pack values into compact ciphertext
4. **Prove** — Generate ZK proof (Web Worker)
5. **Verify** — On-chain ZK verification

## Result Structure

\`\`\`typescript
// encryptedAmount is an InEuint64 tuple:
{
  ctHash: bigint,       // Ciphertext hash (handle)
  securityZone: number, // Security zone (0 = default)
  utype: number,        // FHE type (5 = uint64)
  signature: bytes,     // ZK proof signature
}
\`\`\`

## Bit Limit

- Maximum 2048 bits per \`encryptInputs\` call
- \`uint64\` = 64 bits → max 32 values per call
- For larger batches, split into multiple calls`,

  'decryptForView': `# decryptForView

Decrypts a ciphertext handle for viewing in the UI. Requires an active permit.

\`\`\`typescript
import { FheTypes } from '@cofhe/sdk';

// Step 1: Sign permit (one-time per session, EIP-712 wallet signature)
await cofheClient.permits.getOrCreateSelfPermit();

// Step 2: Get ciphertext handle from contract
const ctHash = await contract.read.getEncryptedAmount([invoiceHash]);

// Step 3: Decrypt via CoFHE Threshold Network
const amount = await cofheClient
  .decryptForView(ctHash, FheTypes.Uint64)
  .execute();

console.log('Decrypted:', formatEther(amount));
\`\`\`

## How It Works

1. SDK sends permit + ciphertext hash to Threshold Network
2. Threshold Network verifies permit is valid (signed by authorized address)
3. Threshold Network checks on-chain ACL (\`FHE.allowSender\` / \`FHE.allow\`)
4. If authorized → decrypts and returns plaintext
5. If not → request rejected

## Important

- Permit is an EIP-712 signature — stored by SDK, not in localStorage
- Each session requires a new permit signature
- Decryption only works for addresses authorized via \`FHE.allow()\` in the contract`,

  'Permits': `# Permits

Permits authorize decryption of encrypted on-chain data via EIP-712 wallet signatures.

## Self Permits

\`\`\`typescript
const permit = await cofheClient.permits.getOrCreateSelfPermit();
\`\`\`

This triggers a MetaMask signature popup. The permit authorizes you to decrypt data where you have \`FHE.allowSender()\` or \`FHE.allow(yourAddress)\`.

## Sharing Permits (for Auditors)

\`\`\`typescript
const sharingPermit = await cofheClient.permits.createSharing({
  issuer: connectedAddress,
  recipient: auditorAddress,
  name: 'Audit permit for invoice 0x...',
});

// Export for auditor (strips private key)
const exported = PermitUtils.export(sharingPermit);
\`\`\`

## Revoking

\`\`\`typescript
await cofheClient.permits.removeActivePermit();
\`\`\`

## Important Notes

- Permits are session-based — re-signed on each page load
- The contract's ACL (\`FHE.allow\`) is the source of truth, not the permit alone
- Both permit AND ACL authorization are required for decryption`,

  'Common Errors': `# Common Errors

| Error | Cause | Fix |
|---|---|---|
| \`initTfhe failed\` | TFHE WASM module failed to load | Refresh page, check browser WASM support |
| \`ZkPackFailed\` | Too many items in one encryptInputs call | Split into batches of max 32 |
| \`FetchKeysFailed\` | Can't reach CoFHE key server | Check network connection |
| \`PermitExpired\` | Permit past expiry | Re-sign with \`getOrCreateSelfPermit()\` |
| \`UserRejected\` | User cancelled wallet popup | Retry the action |
| \`WrongChain\` | Not on Ethereum Sepolia | Switch to Chain ID 11155111 |
| \`Not authorized\` | Recipient-restricted invoice | Only the specified recipient can pay |
| \`Still locked\` | Vesting invoice not yet unlocked | Wait for unlock block |
| \`Not open\` | Invoice already settled or cancelled | Cannot pay a closed invoice |
| \`Only creator\` | Settle/cancel attempted by non-creator | Only the invoice creator can settle/cancel |`,

  'Troubleshooting': `# Troubleshooting

## "Wrong Network" Banner
Click the **"Switch Network"** button or manually configure:
- **Chain ID**: 11155111
- **Network Name**: Ethereum Sepolia
- **RPC**: \`https://1rpc.io/sepolia\`
- **Symbol**: ETH
- **Explorer**: \`https://sepolia.etherscan.io\`

## Amounts Show as "●●●●●●"
This is expected — amounts are FHE-encrypted on-chain. To reveal:
1. Click the Reveal (eye) button
2. Sign the EIP-712 permit in your wallet
3. Wait for CoFHE Threshold Network to decrypt

If decryption fails:
- Verify you are the creator or authorized recipient
- Check that the CoFHE SDK initialized successfully (sidebar shows "FHE Ready")
- Try refreshing the page to re-initialize

## Transaction Stuck at "Awaiting confirmation"
- Check Etherscan for tx status
- Sepolia can be slow (12-15s per block)
- If RPC is down, try refreshing — the app uses \`rpc.ankr.com/eth_sepolia\`
- Ensure sufficient SepoliaETH for gas

## CoFHE SDK Shows "FHE Standby"
The SDK requires:
1. Wallet connected to Sepolia
2. TFHE WASM module to load (can take a few seconds)
3. Connection to CoFHE infrastructure

If stuck on Standby: refresh the page after connecting wallet.

## "Contract not deployed" Errors
The app uses two contracts:
- **CipherPayFHE** (\`0x3965...\`): Primary — FHE encrypted amounts
- **CipherPaySimple** (\`0xa846...\`): Fallback — plaintext amounts

If FHE contract calls fail, the app automatically falls back to Simple.`,

  'Paying an Invoice': `# Paying an Invoice

## Via Payment Link

1. Open the payment link shared by the creator (\`/pay/0x...\`)
2. Connect your wallet
3. Enter the payment amount in ETH
4. Click **"Pay"**
5. CoFHE SDK encrypts your payment client-side (ZK proof generated)
6. Encrypted \`InEuint64\` tuple sent to contract
7. Contract adds encrypted payment to total via \`FHE.add()\`

## Why Enter Amount Manually?

Because the invoice amount is FHE-encrypted, the Pay page cannot display it. The payer enters the agreed amount — the contract handles everything encrypted.

## Multi Pay

For multi-pay invoices, multiple payers can contribute. Each payment is individually encrypted. The payer count is public but amounts are not.

## Via Dashboard

1. Find the invoice in Explorer or Dashboard
2. Click **"Pay"** in the actions column
3. Same flow as via payment link`,

  'Proof of Settlement': `# Proof of Settlement

## On-Chain Proof

Every settlement is an on-chain transaction. The \`InvoiceSettled\` event is emitted with the invoice hash, providing:

- **Transaction hash** — verifiable on Etherscan
- **Block number** — immutable timestamp
- **Invoice hash** — links to the specific invoice

## For Standard Invoices

Settlement happens automatically when payment is received. The \`InvoicePaid\` + \`InvoiceSettled\` events serve as proof.

## For Multi Pay

Creator explicitly calls \`settleInvoice()\`. This is a separate transaction — additional proof that the creator acknowledged receipt.

## Encrypted Proof

The payment amount is encrypted. To prove the amount to a third party, use **Audit Packages** with selective disclosure.`,

  'Sharing Permits': `# Sharing Permits

Sharing permits allow you to grant decryption access to specific addresses (e.g., auditors, accountants).

## How It Works

1. You create a sharing permit specifying the recipient address
2. The permit is exported (without your private key)
3. The recipient imports the permit
4. Combined with on-chain ACL, they can decrypt scoped data

## Creating a Sharing Permit

\`\`\`typescript
const sharingPermit = await client.permits.createSharing({
  issuer: yourAddress,
  recipient: auditorAddress,
  name: 'Q1 2026 Tax Audit',
});

// Export for the auditor
const exportedPermit = PermitUtils.export(sharingPermit);
const auditKey = sharingPermit.hash;
\`\`\`

## Security

- Recipient needs BOTH the exported permit AND the audit key
- On-chain ACL must also authorize the recipient
- Permits can be revoked by the issuer at any time`,
};

export function Guide() {
  const [activeItem, setActiveItem] = useState('What is CipherPay?');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(NAV_SECTIONS.map(s => s.title)));
  const [searchQuery, setSearchQuery] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  const toggleSection = (title: string) => {
    const next = new Set(expandedSections);
    if (next.has(title)) next.delete(title); else next.add(title);
    setExpandedSections(next);
  };

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handleScroll = () => {
      const progress = el.scrollTop / (el.scrollHeight - el.clientHeight);
      setScrollProgress(Math.min(progress, 1));
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [activeItem]);

  const filteredSections = searchQuery
    ? NAV_SECTIONS.map(s => ({ ...s, items: s.items.filter(item => item.toLowerCase().includes(searchQuery.toLowerCase())) })).filter(s => s.items.length > 0)
    : NAV_SECTIONS;

  return (
    <div className="flex flex-col lg:flex-row gap-12">
      {/* Sidebar */}
      <aside className="w-full lg:w-64 shrink-0 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-white tracking-tight">Guide</h1>
          <p className="text-sm text-text-secondary">Documentation & Tutorials</p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" placeholder="Search docs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-10 pr-4 bg-surface-1 border border-border-default rounded-xl text-sm text-white focus:border-primary/40 focus:outline-none transition-colors" />
        </div>

        <nav className="space-y-2">
          {filteredSections.map((section) => (
            <div key={section.title}>
              <button onClick={() => toggleSection(section.title)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-text-muted uppercase tracking-widest hover:text-text-secondary transition-colors">
                <div className="flex items-center gap-2">
                  <section.icon className="w-3.5 h-3.5" />
                  {section.title}
                </div>
                <ChevronDown className={`w-3 h-3 transition-transform ${expandedSections.has(section.title) ? '' : '-rotate-90'}`} />
              </button>
              {expandedSections.has(section.title) && (
                <div className="ml-2 space-y-0.5">
                  {section.items.map((item) => (
                    <button key={item} onClick={() => setActiveItem(item)}
                      className={`w-full text-left px-4 py-1.5 rounded-lg text-sm transition-all ${
                        activeItem === item ? 'bg-primary/10 text-primary font-bold' : 'text-text-secondary hover:text-white hover:bg-surface-1'
                      }`}>
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 max-w-3xl relative">
        {/* Scroll progress */}
        <div className="sticky top-0 z-10 h-0.5 bg-surface-2 -mx-4 mb-4">
          <div className="h-full bg-primary transition-all duration-150" style={{ width: `${scrollProgress * 100}%` }} />
        </div>

        <div ref={contentRef} className="bg-surface-1 border border-border-default rounded-[40px] p-8 md:p-12 space-y-8 min-h-[600px] overflow-y-auto max-h-[80vh]">
          <div className="prose prose-invert prose-primary max-w-none
            [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:text-white [&_h1]:tracking-tight [&_h1]:mb-6
            [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_h2]:mt-8 [&_h2]:mb-4
            [&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-white
            [&_p]:text-text-secondary [&_p]:leading-relaxed
            [&_li]:text-text-secondary
            [&_strong]:text-white
            [&_code]:text-primary [&_code]:bg-surface-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-sm
            [&_pre]:bg-black [&_pre]:rounded-xl [&_pre]:p-4 [&_pre]:border [&_pre]:border-border-default [&_pre]:overflow-x-auto
            [&_pre_code]:bg-transparent [&_pre_code]:p-0
            [&_blockquote]:border-l-4 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-text-muted
            [&_table]:w-full [&_th]:text-left [&_th]:text-text-muted [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-widest [&_th]:pb-2 [&_th]:border-b [&_th]:border-border-default
            [&_td]:py-2 [&_td]:text-sm [&_td]:text-text-secondary [&_td]:border-b [&_td]:border-border-default
            [&_a]:text-primary [&_a]:hover:underline
          ">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{CONTENT[activeItem] || `# ${activeItem}\n\nThis section is currently under development.`}</ReactMarkdown>
          </div>

          <div className="pt-12 border-t border-border-default flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4 text-xs text-text-muted uppercase tracking-widest">
              <span>Last updated: 2026-03-20</span>
              <span>·</span>
              <span>CipherPay v1.0 — Wave 1</span>
            </div>
            <div className="p-4 bg-primary/5 border border-primary/10 rounded-2xl flex items-center gap-3">
              <Info className="w-5 h-5 text-primary" />
              <p className="text-xs text-text-secondary">Questions? Join the <a href="https://t.me/+rA9gI3AsW8c3YzIx" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Fhenix Buildathon Telegram</a></p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
