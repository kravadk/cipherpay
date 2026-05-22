import { motion } from 'framer-motion';
import { BarChart2, Lock, Globe, Shield, RefreshCw, Eye, TrendingUp, Hash } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useReadContract } from 'wagmi';
import { formatEther, type Hex } from 'viem';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { useCofhe } from '../../hooks/useCofhe';
import { useInvoices } from '../../hooks/useInvoices';
import { buildMerkleTree, getMerkleProof, verifyMerkleProof } from '../../lib/merkle';
import { CIPHERPAY_ADDRESS, CIPHERPAY_ABI } from '../../config/contract';

// Real keccak256 Merkle existence proof over the caller's invoice hashes.
// Invoice hashes are public on-chain; amounts and recipients never enter the tree.
function MerkleProofWidget() {
  const { invoices, isLoading } = useInvoices();
  const { addToast } = useToastStore();
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState<{ root: Hex; proof: Hex[]; valid: boolean } | null>(null);

  // Build a real sorted-pair Merkle tree from the user's invoice hashes.
  const tree = useMemo(
    () => buildMerkleTree(invoices.map(i => i.hash as Hex)),
    [invoices],
  );

  const generateProof = () => {
    const leaf = selected as Hex;
    if (!leaf || !leaf.startsWith('0x') || leaf.length !== 66) {
      addToast('error', 'Select an invoice first');
      return;
    }
    const proof = getMerkleProof(tree, leaf);
    if (!proof) {
      addToast('error', 'That invoice is not in the tree');
      return;
    }
    // Verify the proof by recomputing the root from leaf + sibling path.
    const valid = verifyMerkleProof(leaf, proof, tree.root);
    setResult({ root: tree.root, proof, valid });
    addToast(valid ? 'success' : 'error', valid ? 'Merkle proof verified locally' : 'Proof failed to verify');
  };

  return (
    <div className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Hash className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-bold text-white">Invoice Existence Proof</h3>
      </div>
      <p className="text-xs text-text-secondary">
        A real keccak256 Merkle tree over your{' '}
        <span className="text-primary font-bold">{tree.leaves.length}</span>{' '}
        invoice {tree.leaves.length === 1 ? 'hash' : 'hashes'}. A proof shows an invoice
        existed without revealing its amount or recipient. Anchor the root on-chain with{' '}
        <code className="font-mono text-primary">PayrollAnchor.sol</code> to make it publicly checkable.
      </p>

      <div className="space-y-2">
        <select
          value={selected}
          onChange={e => { setSelected(e.target.value); setResult(null); }}
          className="w-full h-10 px-3 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none"
        >
          <option value="">{isLoading ? 'Loading invoices…' : 'Select an invoice'}</option>
          {invoices.map(inv => (
            <option key={inv.hash} value={inv.hash}>{inv.id} · {inv.type}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" className="w-full" onClick={generateProof} disabled={!selected}>
          Generate Merkle proof
        </Button>
      </div>

      {tree.leaves.length > 0 && (
        <div className="p-3 bg-black rounded-xl space-y-1">
          <p className="text-[10px] text-text-muted uppercase tracking-widest">Merkle root</p>
          <p className="text-xs font-mono text-primary break-all">{tree.root}</p>
        </div>
      )}

      {result && (
        <div className="p-3 bg-black rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-text-muted uppercase tracking-widest">
              Proof — {result.proof.length} {result.proof.length === 1 ? 'node' : 'nodes'}
            </p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${result.valid ? 'bg-primary/15 text-primary' : 'bg-red-500/15 text-red-400'}`}>
              {result.valid ? '✓ Verified' : '✗ Invalid'}
            </span>
          </div>
          {result.proof.length === 0
            ? <p className="text-xs text-text-muted">Single-leaf tree — the root is the leaf itself.</p>
            : result.proof.map((p, i) => (
                <p key={i} className="text-xs font-mono text-text-secondary break-all">{p}</p>
              ))}
        </div>
      )}
    </div>
  );
}

// Platform aggregate stats from FHE.allowGlobal handles
function PlatformStats() {
  const { decrypt, decryptForTx, isReady, getOrCreateSelfPermit, getFheTypes } = useCofhe();
  const { addToast } = useToastStore();
  const [volume, setVolume]     = useState<string | null>(null);
  const [count, setCount]       = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  const { data: volumeHandle } = useReadContract({
    address: CIPHERPAY_ADDRESS,
    abi: CIPHERPAY_ABI as any,
    functionName: 'getPlatformVolume',
  });

  const { data: countHandle } = useReadContract({
    address: CIPHERPAY_ADDRESS,
    abi: CIPHERPAY_ABI as any,
    functionName: 'getPlatformInvoiceCount',
  });

  const handleDecrypt = async () => {
    if (!isReady) { addToast('error', 'FHE SDK not ready'); return; }
    if (!volumeHandle || !countHandle) { addToast('error', 'Handles not available'); return; }

    setIsDecrypting(true);
    try {
      const FheTypes = getFheTypes();
      if (!FheTypes) throw new Error('FheTypes not available');

      const [vol, cnt] = await Promise.all([
        decrypt(BigInt(volumeHandle as any), FheTypes.Uint64),
        decrypt(BigInt(countHandle as any), FheTypes.Uint32),
      ]);

      setVolume(formatEther(BigInt(vol as any)));
      setCount(String(cnt));
      addToast('success', 'Platform stats decrypted');
    } catch (err: any) {
      addToast('error', (err?.message || 'Decrypt failed').slice(0, 60));
    } finally {
      setIsDecrypting(false);
    }
  };

  return (
    <div className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-bold text-white">Platform Aggregates</h3>
        </div>
        <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary flex items-center gap-1">
          <Globe className="w-3 h-3" /> FHE.allowGlobal
        </span>
      </div>
      <p className="text-xs text-text-secondary">
        Total platform volume and invoice count — the only public FHE aggregates.
        Individual payment amounts and recipient data are private.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 bg-surface-2 rounded-xl text-center">
          <p className="text-2xl font-bold text-white">{volume ?? '—'}</p>
          <p className="text-xs text-text-muted uppercase tracking-widest mt-1">Total Volume (ETH)</p>
          {!volume && <p className="text-xs text-primary mt-1 flex items-center justify-center gap-1"><Lock className="w-3 h-3" /> Encrypted</p>}
        </div>
        <div className="p-4 bg-surface-2 rounded-xl text-center">
          <p className="text-2xl font-bold text-white">{count ?? '—'}</p>
          <p className="text-xs text-text-muted uppercase tracking-widest mt-1">Total Invoices</p>
          {!count && <p className="text-xs text-primary mt-1 flex items-center justify-center gap-1"><Lock className="w-3 h-3" /> Encrypted</p>}
        </div>
      </div>
      <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleDecrypt} disabled={isDecrypting || !isReady}>
        {isDecrypting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Decrypting...</> : <><Eye className="w-4 h-4" /> Reveal Aggregates (Permit)</>}
      </Button>
      <p className="text-xs text-text-muted text-center">Requires EIP-712 permit signature</p>
    </div>
  );
}

// Aggregate disclosure model — what CipherPay publishes vs. withholds.
function DifferentialPrivacyCard() {
  const rows = [
    { label: 'Platform volume', tag: 'Published', mono: 'FHE.allowGlobal', note: 'Sum across all invoices — no single amount is derivable from it', pub: true },
    { label: 'Invoice count', tag: 'Published', mono: 'FHE.allowGlobal', note: 'Total count across the protocol', pub: true },
    { label: 'Per-invoice amount & recipient', tag: 'Withheld', mono: 'euint64 / eaddress', note: 'Decryptable only with an EIP-712 permit', pub: false },
    { label: 'Payer count per invoice', tag: 'Withheld', mono: '—', note: 'Never published in anon mode', pub: false },
  ];

  return (
    <div className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Shield className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-bold text-white">Aggregate Disclosure Model</h3>
      </div>
      <p className="text-xs text-text-secondary">
        Only two aggregates are ever published, both via <code className="font-mono text-primary">FHE.allowGlobal</code>.
        Every per-invoice field stays permit-gated.
      </p>
      <div className="space-y-3">
        {rows.map(item => (
          <div key={item.label} className="flex items-start gap-3 p-3 bg-surface-2 rounded-xl">
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${item.pub ? 'bg-blue-400' : 'bg-primary'}`} />
            <div>
              <p className="text-sm font-bold text-white">
                {item.label}
                <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded ${item.pub ? 'bg-blue-500/15 text-blue-400' : 'bg-primary/15 text-primary'}`}>{item.tag}</span>
              </p>
              <p className="text-xs font-mono text-text-secondary">{item.mono}</p>
              <p className="text-xs text-text-muted">{item.note}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-text-muted border-t border-border-default pt-3">
        <span className="text-text-secondary font-bold">Planned:</span> encrypted noise on the
        published aggregates (differential privacy) so a single large payout can't be inferred by
        differencing snapshots. Not yet enabled — tracked in the roadmap.
      </p>
    </div>
  );
}

export function PrivacyAnalytics() {
  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Privacy Analytics</h1>
        <p className="text-text-secondary">Protocol-level stats — no individual data, FHE-encrypted aggregates only</p>
      </div>

      {/* Info */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <BarChart2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs text-text-secondary space-y-1">
          <p><span className="text-primary font-bold">Privacy-preserving analytics</span> — CipherPay exposes only two global FHE aggregates (<code className="font-mono">platformVolume</code> and <code className="font-mono">platformInvoiceCount</code>) via <code className="font-mono">FHE.allowGlobal</code>. All other data requires EIP-712 permits.</p>
          <p>Real keccak256 Merkle proofs verify invoice existence without exposing amounts or parties. Aggregate noise (differential privacy) is a planned hardening step.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PlatformStats />
        <DifferentialPrivacyCard />
        <MerkleProofWidget />

        {/* FHE ACL summary */}
        <div className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold text-white">Data Visibility Model</h3>
          </div>
          <div className="space-y-2">
            {[
              { data: 'Invoice amounts',    who: 'Creator + payer only',     icon: '🔒' },
              { data: 'Recipient address',  who: 'Creator only',              icon: '🔒' },
              { data: 'Payment totals',     who: 'Creator (via permit)',      icon: '🔒' },
              { data: 'Tax calculations',   who: 'Creator (via permit)',      icon: '🔒' },
              { data: 'Platform volume',    who: 'Anyone (allowGlobal)',      icon: '🌐' },
              { data: 'Invoice count',      who: 'Anyone (allowGlobal)',      icon: '🌐' },
              { data: 'Anon payer',         who: 'Nobody (nullifier only)',   icon: '👻' },
              { data: 'Shielded payments',  who: 'Nobody (msg.value = 0)',    icon: '🛡' },
              { data: 'Proof results',      who: 'Anyone (allowPublic)',      icon: '✅' },
            ].map(item => (
              <div key={item.data} className="flex items-center justify-between py-1.5 border-b border-border-default last:border-0">
                <span className="text-sm text-text-secondary">{item.data}</span>
                <span className="text-xs text-right">
                  <span className="mr-1">{item.icon}</span>
                  <span className={item.icon === '🔒' ? 'text-primary' : item.icon === '🌐' ? 'text-blue-400' : 'text-text-muted'}>{item.who}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
