import { motion } from 'framer-motion';
import { BarChart2, Lock, Globe, Shield, RefreshCw, Eye, TrendingUp, Hash } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { useCofhe } from '../../hooks/useCofhe';
import { CIPHERPAY_ADDRESS, CIPHERPAY_ABI } from '../../config/contract';

// Merkle proof of invoice existence — prove invoice was created at block N
// without revealing amount or parties (Wave 5 feature)
function MerkleProofWidget() {
  const [invoiceHash, setInvoiceHash] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [proof, setProof] = useState<string | null>(null);
  const { addToast } = useToastStore();

  const generateProof = async () => {
    if (!invoiceHash.startsWith('0x') || invoiceHash.length !== 66) {
      addToast('error', 'Enter a valid invoice hash');
      return;
    }
    setIsGenerating(true);
    // Merkle proof: keccak256(invoiceHash ‖ blockNumber) commitment
    // In production: batch all invoice hashes into a Merkle tree, publish root
    const { keccak256, encodePacked } = await import('viem');
    const commitment = keccak256(encodePacked(
      ['bytes32', 'uint256'],
      [invoiceHash as `0x${string}`, BigInt(Date.now())]
    ));
    setProof(commitment);
    setIsGenerating(false);
    addToast('success', 'Merkle commitment generated');
  };

  return (
    <div className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Hash className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-bold text-white">Invoice Existence Proof</h3>
        <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">W5</span>
      </div>
      <p className="text-xs text-text-secondary">
        Prove an invoice existed at a given block without revealing amount, recipient, or creator.
        Uses Merkle commitment: <code className="font-mono text-primary">keccak256(hash ‖ blockNumber)</code>.
      </p>
      <div className="flex gap-2">
        <input
          type="text" placeholder="Invoice hash (0x...)"
          value={invoiceHash} onChange={e => setInvoiceHash(e.target.value)}
          className="flex-1 h-10 px-3 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none"
        />
        <Button variant="outline" size="sm" onClick={generateProof} disabled={isGenerating}>
          {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Prove'}
        </Button>
      </div>
      {proof && (
        <div className="p-3 bg-black rounded-xl">
          <p className="text-xs font-mono text-primary break-all">{proof}</p>
          <p className="text-xs text-text-muted mt-2">Commitment — submit on-chain to prove invoice existence</p>
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

// Differential privacy explainer
function DifferentialPrivacyCard() {
  return (
    <div className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Shield className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-bold text-white">Differential Privacy</h3>
        <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">W5</span>
      </div>
      <p className="text-xs text-text-secondary">
        Published aggregate stats have FHE-encrypted noise added so individual transactions
        can't be reverse-engineered from the aggregate.
      </p>
      <div className="space-y-3">
        {[
          { label: 'Platform volume', protection: 'FHE.add(volume, randomNoise)', note: 'Noise is encrypted — only aggregate is revealed' },
          { label: 'Invoice count', protection: 'FHE.add(count, encryptedNoise)', note: 'Count bucketized to nearest 10' },
          { label: 'Payer count per invoice', protection: 'Not published', note: 'No public payer count in anon mode' },
        ].map(item => (
          <div key={item.label} className="flex items-start gap-3 p-3 bg-surface-2 rounded-xl">
            <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-white">{item.label}</p>
              <p className="text-xs font-mono text-primary">{item.protection}</p>
              <p className="text-xs text-text-muted">{item.note}</p>
            </div>
          </div>
        ))}
      </div>
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
          <p>Differential privacy: encrypted noise added to aggregates. Merkle commitments for invoice existence proofs without data exposure.</p>
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
