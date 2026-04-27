import { motion } from 'framer-motion';
import { Code, ExternalLink, Copy, Terminal, Globe, Shield, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { CIPHERPAY_ADDRESS, CIPHERPAY_FHE_ADDRESS, CIPHERPAY_SIMPLE_ADDRESS } from '../../config/contract';
import { FHENIX_EXPLORER_URL } from '../../config/fhenix';

const CHECKOUT_EMBED_SNIPPET = `<!-- 1. Add the CipherPay embed script -->
<script src="https://cipherpayy.vercel.app/cipherpay.js"
  data-invoice="0xYOUR_INVOICE_HASH_HERE"
  data-theme="dark">
</script>

<!-- 2. Add a pay button anywhere on your page -->
<button onclick="CipherPay.open()">
  Pay with CipherPay
</button>

<!-- 3. Listen for payment confirmation -->
<script>
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'cipherpay:paid') {
      console.log('Payment tx:', e.data.tx);
      // Unlock content, confirm order, etc.
    }
  });
</script>`;

const CHECKOUT_INLINE_SNIPPET = `<!-- Inline mode — embed directly in your page -->
<div id="my-payment-widget"></div>

<script src="https://cipherpayy.vercel.app/cipherpay.js"
  data-invoice="0xYOUR_INVOICE_HASH_HERE"
  data-mode="inline"
  data-target="my-payment-widget">
</script>`;

const CODE_SNIPPETS = [
  {
    title: 'Installation',
    lang: 'bash',
    code: 'npm install @cofhe/sdk@0.5.1 @fhenixprotocol/cofhe-contracts@0.1.0 wagmi viem',
  },
  {
    title: 'Initialize CoFHE Client',
    lang: 'typescript',
    code: `import { createCofheConfig, createCofheClient } from '@cofhe/sdk/web';
import { chains } from '@cofhe/sdk/chains';
import { Encryptable, FheTypes } from '@cofhe/sdk';

const config = createCofheConfig({
  supportedChains: [chains.sepolia],
});
const client = createCofheClient(config);

// Connect with viem clients
await client.connect(publicClient, walletClient);`,
  },
  {
    title: 'Encrypt & Create Invoice',
    lang: 'typescript',
    code: `// Encrypt amount client-side (ZK Proof of Knowledge)
const [encryptedAmount] = await client
  .encryptInputs([Encryptable.uint64(parseEther('0.1'))])
  .onStep((step, ctx) => {
    if (ctx?.isStart) console.log(step + '...');
    if (ctx?.isEnd) console.log('✓ ' + step);
  })
  .execute();

// Send encrypted InEuint64 tuple to contract
const tx = await walletClient.writeContract({
  address: CIPHERPAY_ADDRESS,
  abi: CipherPayFHE_ABI,
  functionName: 'createInvoice',
  args: [
    encryptedAmount,  // { ctHash, securityZone, utype, signature }
    recipientAddress,
    0,                // type: 0=standard, 1=multipay, 2=recurring, 3=vesting
    deadline,
    unlockBlock,
    salt,
    memo,
  ],
});`,
  },
  {
    title: 'Decrypt Amount (with Permit)',
    lang: 'typescript',
    code: `// Sign EIP-712 permit (one-time per session)
await client.permits.getOrCreateSelfPermit();

// Get encrypted handle from contract
const ctHash = await contract.read.getEncryptedAmount([invoiceHash]);

// Decrypt via CoFHE Threshold Network
const amount = await client
  .decryptForView(ctHash, FheTypes.Uint64)
  .execute();

console.log('Decrypted amount:', formatEther(amount));`,
  },
  {
    title: 'Read Public Invoice Data (no permit needed)',
    lang: 'typescript',
    code: `// Public metadata — visible to anyone
const invoice = await contract.read.getInvoice([invoiceHash]);
// Returns: { creator, recipient, type, status, deadline, createdAt, block, unlockBlock }
// Amount is NOT returned — it's encrypted (euint64)

// Payer count (public for multi-pay)
const payerCount = await contract.read.getPayerCount([invoiceHash]);`,
  },
  {
    title: 'Solidity — FHE Encrypted Types',
    lang: 'solidity',
    code: `import {FHE, euint64, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

// Store encrypted amount
euint64 amount = FHE.asEuint64(_encryptedInput);

// Encrypted arithmetic
euint64 total = FHE.add(collected, payment);

// Access control — who can decrypt
FHE.allowThis(amount);          // Contract can use it
FHE.allowSender(amount);        // Caller can decrypt
FHE.allow(amount, recipient);   // Specific address`,
  },
];

export function Build() {
  const { addToast } = useToastStore();
  const [checkoutSnippet, setCheckoutSnippet] = useState<'modal' | 'inline'>('modal');
  const [iframeHash, setIframeHash] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // Smart contract functions (not REST — these are on-chain calls)
  const contractFunctions = [
    { type: 'write', name: 'createInvoice', desc: 'Create invoice with FHE-encrypted amount', auth: 'Wallet + FHE encrypt' },
    { type: 'write', name: 'payInvoice', desc: 'Pay invoice with encrypted payment', auth: 'Wallet + FHE encrypt' },
    { type: 'write', name: 'settleInvoice', desc: 'Settle multi-pay (creator only)', auth: 'Creator wallet' },
    { type: 'write', name: 'cancelInvoice', desc: 'Cancel open invoice (creator only)', auth: 'Creator wallet' },
    { type: 'read', name: 'getInvoice', desc: 'Public invoice metadata', auth: 'None' },
    { type: 'read', name: 'getEncryptedAmount', desc: 'Get ciphertext handle (needs permit to decrypt)', auth: 'None (read) / Permit (decrypt)' },
    { type: 'read', name: 'getEncryptedCollected', desc: 'Multi-pay collected amount handle', auth: 'None (read) / Permit (decrypt)' },
    { type: 'read', name: 'getInvoiceMemo', desc: 'Invoice memo text', auth: 'None' },
    { type: 'read', name: 'getPayerCount', desc: 'Number of payers (multi-pay)', auth: 'None' },
    { type: 'read', name: 'getUserInvoices', desc: 'List invoices created by address', auth: 'None' },
    { type: 'read', name: 'getPaidInvoices', desc: 'List invoices paid by address', auth: 'None' },
    { type: 'read', name: 'checkHasPaid', desc: 'Check if address has paid invoice', auth: 'None' },
  ];

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    addToast('success', 'Code copied');
  };

  return (
    <div className="space-y-12">
      <div className="flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-white tracking-tight">Build</h1>
          <p className="text-text-secondary">Integrate CipherPay — privacy-first invoicing with Fhenix FHE</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-4 py-2 bg-primary/10 border border-primary/20 rounded-full flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-bold text-primary uppercase tracking-widest">Ethereum Sepolia</span>
          </div>
          <a href={FHENIX_EXPLORER_URL} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-2">
              <ExternalLink className="w-4 h-4" /> Explorer
            </Button>
          </a>
        </div>
      </div>

      {/* Contract Info */}
      <div className="p-8 bg-surface-1 border border-border-default rounded-[32px] space-y-6">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-text-secondary" />
          <h2 className="text-xl font-bold text-white">Deployed Contracts</h2>
        </div>
        <div className="space-y-4">
          <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-primary" />
              <span className="text-text-muted">CipherPayFHE (primary)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white font-mono text-xs">{CIPHERPAY_FHE_ADDRESS}</span>
              <button onClick={() => { navigator.clipboard.writeText(CIPHERPAY_FHE_ADDRESS); addToast('success', 'Address copied'); }}
                className="p-1 text-text-muted hover:text-primary"><Copy className="w-3.5 h-3.5" /></button>
              <a href={`${FHENIX_EXPLORER_URL}/address/${CIPHERPAY_FHE_ADDRESS}`} target="_blank" rel="noopener noreferrer"
                className="p-1 text-text-muted hover:text-primary"><ExternalLink className="w-3.5 h-3.5" /></a>
            </div>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-text-muted">CipherPaySimple (fallback)</span>
            <div className="flex items-center gap-2">
              <span className="text-text-dim font-mono text-xs">{CIPHERPAY_SIMPLE_ADDRESS}</span>
              <button onClick={() => { navigator.clipboard.writeText(CIPHERPAY_SIMPLE_ADDRESS); addToast('success', 'Address copied'); }}
                className="p-1 text-text-muted hover:text-primary"><Copy className="w-3.5 h-3.5" /></button>
            </div>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-text-muted">Network</span>
            <span className="text-white">Ethereum Sepolia (Chain ID: 11155111)</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-text-muted">FHE Library</span>
            <span className="text-white font-mono text-xs">@fhenixprotocol/cofhe-contracts@0.1.0</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-text-muted">SDK</span>
            <span className="text-white font-mono text-xs">@cofhe/sdk@0.5.1</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-text-muted">Encrypted Types Used</span>
            <span className="text-white font-mono text-xs">euint64, InEuint64, ebool</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Contract Functions */}
        <div className="space-y-8">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Terminal className="w-5 h-5 text-text-secondary" />
              <h2 className="text-xl font-bold text-white">Contract Functions</h2>
            </div>
            <div className="bg-surface-1 border border-border-default rounded-[32px] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="px-6 py-4 text-xs font-bold text-text-muted uppercase tracking-widest">Type</th>
                      <th className="px-6 py-4 text-xs font-bold text-text-muted uppercase tracking-widest">Function</th>
                      <th className="px-6 py-4 text-xs font-bold text-text-muted uppercase tracking-widest">Description</th>
                      <th className="px-6 py-4 text-xs font-bold text-text-muted uppercase tracking-widest">Auth</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {contractFunctions.map((fn, i) => (
                      <tr key={i} className="group hover:bg-surface-2 transition-colors">
                        <td className="px-6 py-4">
                          <span className={`text-xs font-bold px-2 py-1 rounded-md border ${
                            fn.type === 'write' ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-secondary/10 border-secondary/20 text-secondary'
                          }`}>{fn.type.toUpperCase()}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs font-mono text-text-secondary group-hover:text-white transition-colors">{fn.name}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs text-text-muted">{fn.desc}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs text-text-dim">{fn.auth}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Code Snippets */}
        <div className="space-y-8">
          <div className="flex items-center gap-3">
            <Code className="w-5 h-5 text-text-secondary" />
            <h2 className="text-xl font-bold text-white">Code Examples</h2>
          </div>

          {CODE_SNIPPETS.map((snippet, i) => (
            <div key={i} className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/10 to-secondary/10 rounded-3xl blur opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative bg-black border border-border-default rounded-[24px] overflow-hidden">
                <div className="flex items-center justify-between px-6 py-3 border-b border-border-default bg-surface-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-text-muted uppercase tracking-widest">{snippet.title}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-surface-3 text-text-dim">{snippet.lang}</span>
                  </div>
                  <button onClick={() => copyCode(snippet.code)} className="p-1.5 text-text-muted hover:text-primary transition-colors">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <pre className="p-6 text-sm font-mono text-text-secondary overflow-x-auto leading-relaxed">
                  <code>{snippet.code}</code>
                </pre>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Checkout Embed */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <ShoppingCart className="w-5 h-5 text-text-secondary" />
          <h2 className="text-xl font-bold text-white">Checkout Embed</h2>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">NEW · Wave 2</span>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          Accept private payments on any website with one script tag. The checkout runs in a sandboxed iframe — no SDK required, no wallet SDK on your page. FHE encryption happens inside the iframe; your page only sees the <code className="text-primary text-xs">cipherpay:paid</code> event.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Snippet tabs */}
          <div className="space-y-3">
            <div className="flex gap-2">
              {(['modal', 'inline'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setCheckoutSnippet(mode)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    checkoutSnippet === mode
                      ? 'bg-primary text-black'
                      : 'bg-surface-2 text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {mode === 'modal' ? 'Modal (default)' : 'Inline embed'}
                </button>
              ))}
            </div>
            <div className="relative group">
              <div className="relative bg-black border border-border-default rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border-default bg-surface-1">
                  <span className="text-xs font-bold text-text-muted uppercase tracking-widest">
                    {checkoutSnippet === 'modal' ? 'Modal Mode — HTML' : 'Inline Mode — HTML'}
                  </span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(checkoutSnippet === 'modal' ? CHECKOUT_EMBED_SNIPPET : CHECKOUT_INLINE_SNIPPET); addToast('success', 'Snippet copied'); }}
                    className="p-1.5 text-text-muted hover:text-primary transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <pre className="p-5 text-xs font-mono text-text-secondary overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  <code>{checkoutSnippet === 'modal' ? CHECKOUT_EMBED_SNIPPET : CHECKOUT_INLINE_SNIPPET}</code>
                </pre>
              </div>
            </div>
          </div>

          {/* Live preview */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Live Preview</p>
            <div className="bg-surface-1 border border-border-default rounded-2xl p-5 space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-text-muted">Invoice Hash (0x...)</label>
                <input
                  value={iframeHash}
                  onChange={(e) => { setIframeHash(e.target.value); setShowPreview(false); }}
                  placeholder="0xabc123..."
                  className="w-full bg-surface-2 border border-border-default rounded-xl px-3 py-2 text-sm text-white placeholder-text-dim font-mono focus:outline-none focus:border-primary/50"
                />
              </div>
              <button
                onClick={() => setShowPreview(true)}
                disabled={!iframeHash.startsWith('0x')}
                className="w-full py-2 rounded-xl text-sm font-bold bg-primary text-black hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Launch Checkout
              </button>
              {showPreview && iframeHash.startsWith('0x') && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl overflow-hidden border border-border-default"
                >
                  <iframe
                    src={`/checkout/${iframeHash}`}
                    className="w-full h-72"
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                    title="CipherPay Checkout Preview"
                  />
                </motion.div>
              )}
              {!showPreview && (
                <div className="h-40 rounded-xl border border-dashed border-border-default flex flex-col items-center justify-center gap-2">
                  <ShoppingCart className="w-6 h-6 text-text-dim" />
                  <span className="text-xs text-text-dim">Enter an invoice hash to preview</span>
                </div>
              )}
            </div>

            <div className="space-y-2 text-xs text-text-muted">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>Sandbox: <code className="text-text-secondary">allow-scripts allow-same-origin allow-popups</code></span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>Your page receives only <code className="text-text-secondary">cipherpay:paid</code> events — no keys, no addresses</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>Auto-routes to shielded path when payer has <code className="text-text-secondary">shieldedBalance</code> ≥ bucket</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Privacy architecture note */}
      <div className="p-6 bg-surface-1 border border-primary/20 rounded-2xl">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-white">Privacy Architecture</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              CipherPay uses Fhenix CoFHE coprocessor for Fully Homomorphic Encryption. Invoice amounts are encrypted client-side
              using TFHE + ZK proofs, stored as <code className="text-primary">euint64</code> handles on-chain, and can only be decrypted
              by authorized parties (creator, recipient) via EIP-712 permits. The CoFHE Threshold Network ensures no single party
              can decrypt without permission. Public metadata (type, status, block) remains queryable without permits.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
