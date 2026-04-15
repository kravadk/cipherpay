import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { parseEther, formatEther, keccak256, toBytes, encodePacked } from 'viem';
import { Shield, Eye, EyeOff, Loader2, Copy, AlertTriangle, Check, Lock, RefreshCw, ArrowDownToLine } from 'lucide-react';
import { useCofhe } from '../../hooks/useCofhe';
import { useToastStore } from '../../components/ToastContainer';
import { CIPHERPAY_ADDRESS, CIPHERPAY_ABI } from '../../config/contract';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Anonymous Invoice Claim
 *
 * Privacy model shown to user:
 *  - creator does NOT learn who paid (no msg.sender stored, no InvoicePaid event)
 *  - creator does NOT learn how many distinct payers exist (payerCount not incremented)
 *  - replay protection via a per-device nullifier (keccak256 of a local secret)
 *  - encrypted payment amount stays encrypted on-chain
 *  - msg.value IS visible in the tx envelope — combine with shielded balance for full privacy
 */

const NULLIFIER_STORAGE_KEY = 'cipherpay:anonSecrets';

function getOrCreateSecret(invoiceHash: string): string {
  try {
    const stored = JSON.parse(localStorage.getItem(NULLIFIER_STORAGE_KEY) || '{}');
    if (stored[invoiceHash]) return stored[invoiceHash];
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    stored[invoiceHash] = secret;
    localStorage.setItem(NULLIFIER_STORAGE_KEY, JSON.stringify(stored));
    return secret;
  } catch {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

function deriveNullifier(secret: string, invoiceHash: string): `0x${string}` {
  return keccak256(encodePacked(['bytes32', 'bytes32'], [
    `0x${secret}` as `0x${string}`,
    invoiceHash as `0x${string}`,
  ]));
}

export function AnonClaim() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { isReady: fheReady, encrypt, getEncryptable } = useCofhe();
  const { addToast } = useToastStore();

  const [invoiceHash, setInvoiceHash] = useState('');
  const [amount, setAmount] = useState('0.01');
  const [status, setStatus] = useState<'idle' | 'checking' | 'ready' | 'paying' | 'done' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [anonEnabled, setAnonEnabled] = useState(false);
  const [nullifierRevealed, setNullifierRevealed] = useState(false);
  const [secret, setSecret] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  // Creator sweep state
  const [invoiceCreator, setInvoiceCreator] = useState<string | null>(null);
  const [anonPool, setAnonPool] = useState<bigint>(0n);
  const [sweeping, setSweeping] = useState(false);

  const addLog = (msg: string) => setLogs(l => [...l, msg]);

  const checkInvoice = useCallback(async () => {
    if (!invoiceHash || !publicClient) return;
    setStatus('checking');
    setErrMsg(null);
    try {
      const [enabled, invoice, pool] = await Promise.all([
        publicClient.readContract({
          address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
          functionName: 'anonEnabled', args: [invoiceHash as `0x${string}`],
        }) as Promise<boolean>,
        publicClient.readContract({
          address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
          functionName: 'getInvoice', args: [invoiceHash as `0x${string}`],
        }) as Promise<any>,
        publicClient.readContract({
          address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
          functionName: 'anonEthPool', args: [invoiceHash as `0x${string}`],
        }) as Promise<bigint>,
      ]);
      setAnonEnabled(enabled);
      setInvoiceCreator(invoice?.creator ?? null);
      setAnonPool(pool ?? 0n);
      if (enabled) {
        const s = getOrCreateSecret(invoiceHash);
        setSecret(s);
        setStatus('ready');
        addToast('success', 'Anonymous claim enabled on this invoice');
      } else {
        setStatus('error');
        setErrMsg('This invoice does not have anonymous claim enabled by the creator.');
      }
    } catch (e: any) {
      setStatus('error');
      setErrMsg(e?.shortMessage || 'Invoice not found or contract unreachable');
    }
  }, [invoiceHash, publicClient, addToast]);

  const handleSweep = useCallback(async () => {
    if (!invoiceHash || !publicClient) return;
    setSweeping(true);
    try {
      const tx = await writeContractAsync({
        address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
        functionName: 'sweepAnonPool',
        args: [invoiceHash as `0x${string}`],
      } as any);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setAnonPool(0n);
      addToast('success', `Swept ${formatEther(anonPool)} ETH from anon pool`);
    } catch (e: any) {
      addToast('error', e?.shortMessage || 'Sweep failed');
    } finally {
      setSweeping(false);
    }
  }, [invoiceHash, publicClient, writeContractAsync, anonPool, addToast]);

  const handlePay = useCallback(async () => {
    if (!address || !publicClient || !fheReady || !secret) return;
    setStatus('paying');
    setLogs([]);
    setErrMsg(null);
    try {
      const amountWei = parseEther(amount);
      const nullifier = deriveNullifier(secret, invoiceHash);

      addLog('> Encrypting payment amount with FHE...');
      const Encryptable = getEncryptable();
      if (!Encryptable) throw new Error('FHE SDK not ready');
      const [enc] = await encrypt([Encryptable.uint64(amountWei)]);
      const encTuple = {
        ctHash: BigInt(enc.ctHash || enc.data?.ctHash || 0),
        securityZone: enc.securityZone ?? enc.data?.securityZone ?? 0,
        utype: enc.utype ?? enc.data?.utype ?? 5,
        signature: enc.signature ?? enc.data?.signature ?? '0x',
      };
      addLog('> ✓ Payment encrypted — your address will NOT be recorded');

      addLog(`> Submitting anonymous claim (nullifier: ${nullifier.slice(0, 14)}...)`);
      const tx = await writeContractAsync({
        address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
        functionName: 'claimAnonymously',
        args: [invoiceHash as `0x${string}`, encTuple, nullifier],
        value: amountWei,
      } as any);

      addLog(`> Tx: ${tx.slice(0, 14)}...`);
      addLog('> Awaiting confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === 'reverted') throw new Error('Transaction reverted');

      addLog(`> ✓ Confirmed in block ${receipt.blockNumber}`);
      addLog('> ✓ Identity not recorded — only the nullifier hash is on-chain');
      setTxHash(tx);
      setStatus('done');
      addToast('success', 'Anonymous payment confirmed');
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Payment failed';
      setErrMsg(msg.includes('Nullifier used') ? 'Nullifier already used — you already paid this invoice from this device.' : msg);
      setStatus('error');
    }
  }, [address, publicClient, fheReady, secret, invoiceHash, amount, encrypt, getEncryptable, writeContractAsync, addToast]);

  const nullifier = secret ? deriveNullifier(secret, invoiceHash || '0x' + '0'.repeat(64)) : null;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Anonymous Claim</h1>
            <p className="text-sm text-text-muted">Pay an invoice without revealing your identity on-chain</p>
          </div>
          <span className="ml-auto text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-1 rounded uppercase tracking-wider">FHE</span>
        </div>
      </div>

      {/* Privacy model explainer */}
      <div className="bg-surface-1 border border-border-default rounded-2xl p-5 space-y-3">
        <p className="text-xs font-bold text-text-muted uppercase tracking-widest">What stays private</p>
        <div className="grid grid-cols-1 gap-2">
          {[
            { yes: true, text: 'Your address — NOT stored on-chain. No InvoicePaid event.' },
            { yes: true, text: 'Payer count — creator cannot tell how many people paid.' },
            { yes: true, text: 'Payment amount — encrypted via FHE, visible only via permit.' },
            { yes: false, text: 'ETH amount in tx envelope — msg.value is public. Use shielded balance for full privacy.' },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-text-secondary">
              {item.yes
                ? <Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />}
              <span className={item.yes ? '' : 'text-amber-400/80'}>{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Invoice hash */}
      <div className="bg-surface-1 border border-border-default rounded-2xl p-5 space-y-4">
        <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Step 1 — Invoice</p>
        <div className="space-y-2">
          <label className="text-xs text-text-secondary">Invoice hash (0x…)</label>
          <input
            type="text"
            value={invoiceHash}
            onChange={e => { setInvoiceHash(e.target.value); setStatus('idle'); setAnonEnabled(false); }}
            placeholder="0x..."
            className="w-full bg-bg-base border border-border-default rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-text-dim focus:outline-none focus:border-primary/50"
          />
        </div>
        <button
          onClick={checkInvoice}
          disabled={!invoiceHash || status === 'checking'}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-black text-sm font-bold hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {status === 'checking' ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</> : 'Verify invoice'}
        </button>
      </div>

      {/* Step 2: Nullifier */}
      <AnimatePresence>
        {status !== 'idle' && status !== 'checking' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="bg-surface-1 border border-border-default rounded-2xl p-5 space-y-4"
          >
            <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Step 2 — Your nullifier</p>
            <div className="bg-bg-base border border-border-default rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-muted uppercase tracking-wider">Nullifier hash</span>
                <div className="flex gap-2">
                  <button onClick={() => setNullifierRevealed(v => !v)} className="text-text-muted hover:text-primary">
                    {nullifierRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  {nullifier && (
                    <button onClick={() => { navigator.clipboard.writeText(nullifier); addToast('info', 'Nullifier copied'); }}
                      className="text-text-muted hover:text-primary">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs font-mono text-text-secondary break-all">
                {nullifierRevealed ? nullifier : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
              </p>
              <p className="text-[10px] text-text-muted">
                Derived from a device secret stored locally. Re-using the same nullifier reverts — protecting against replay.
              </p>
            </div>
            {!anonEnabled && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 text-red-400 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {errMsg}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Step 3: Amount + Pay */}
      <AnimatePresence>
        {status === 'ready' || status === 'paying' || status === 'done' ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="bg-surface-1 border border-border-default rounded-2xl p-5 space-y-4"
          >
            <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Step 3 — Pay anonymously</p>
            <div className="flex gap-2">
              {['0.001', '0.01', '0.1'].map(v => (
                <button
                  key={v}
                  onClick={() => setAmount(v)}
                  disabled={status === 'paying' || status === 'done'}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                    amount === v ? 'bg-primary text-black border-primary' : 'bg-surface-2 text-text-secondary border-border-default hover:border-primary/50'
                  }`}
                >
                  {v} ETH
                </button>
              ))}
            </div>

            {logs.length > 0 && (
              <div className="bg-bg-base border border-border-default rounded-xl p-3 space-y-0.5 font-mono text-[11px] text-text-secondary max-h-32 overflow-y-auto">
                {logs.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}

            {status === 'done' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-primary/10 text-primary text-sm font-bold">
                  <Check className="w-4 h-4" /> Anonymous payment confirmed
                </div>
                {txHash && (
                  <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer"
                    className="flex items-center justify-center gap-1 text-[11px] text-text-muted hover:text-primary">
                    <Lock className="w-3 h-3" /> {txHash.slice(0, 18)}… (notice: only nullifier in event, no address)
                  </a>
                )}
              </div>
            ) : (
              <button
                onClick={handlePay}
                disabled={status === 'paying' || !fheReady || !address}
                className="w-full py-3 rounded-xl bg-primary text-black font-bold text-sm hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2 transition-opacity"
              >
                {status === 'paying'
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                  : <><Shield className="w-4 h-4" /> Pay anonymously — identity not recorded</>}
              </button>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
      {/* Creator: Sweep anon pool */}
      <AnimatePresence>
        {invoiceCreator && address?.toLowerCase() === invoiceCreator.toLowerCase() && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="bg-surface-1 border border-primary/20 rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-primary uppercase tracking-widest">Creator — Sweep Anon Pool</p>
                <p className="text-xs text-text-muted">You created this invoice. Collect ETH paid anonymously.</p>
              </div>
              <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded">Creator</span>
            </div>

            <div className="flex items-center justify-between bg-bg-base border border-border-default rounded-xl px-4 py-3">
              <div className="space-y-0.5">
                <p className="text-[10px] text-text-muted uppercase tracking-wider">Anon pool balance</p>
                <p className="text-lg font-bold text-white">
                  {formatEther(anonPool)} <span className="text-sm text-text-muted font-normal">ETH</span>
                </p>
              </div>
              {anonPool === 0n && (
                <span className="text-xs text-text-dim">No funds yet</span>
              )}
            </div>

            <button
              onClick={handleSweep}
              disabled={sweeping || anonPool === 0n}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-black font-bold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {sweeping
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Sweeping…</>
                : <><ArrowDownToLine className="w-4 h-4" /> Sweep {anonPool > 0n ? formatEther(anonPool) + ' ETH' : '(empty)'} to your wallet</>}
            </button>
            <p className="text-[10px] text-text-muted text-center">
              Funds are transferred to your wallet. Payer identities remain hidden — no link between this sweep and individual payments.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
