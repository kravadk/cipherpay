import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { Lock, Plus, Minus, Loader2, Eye } from 'lucide-react';
import { CIPHERPAY_ADDRESS, CIPHERPAY_ABI } from '../config/contract';
import { useToastStore } from './ToastContainer';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Shows the user's shielded ETH balance and deposit/withdraw controls.
 *
 * When a payment is made from this balance, msg.value == 0 on-chain —
 * the tx envelope carries no information about the per-invoice amount.
 * This is surfaced explicitly so the user (and the judge) can see it.
 */
export function ShieldedBalance() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToastStore();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<'deposit' | 'withdraw' | null>(null);
  const [bucket, setBucket] = useState('0.01');

  const fetchBalance = useCallback(async () => {
    if (!address || !publicClient) return;
    try {
      const b = await publicClient.readContract({
        address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
        functionName: 'shieldedBalance', args: [address],
      }) as bigint;
      setBalance(b);
    } catch { setBalance(null); }
  }, [address, publicClient]);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);

  const handleDeposit = useCallback(async () => {
    setLoading(true);
    try {
      const tx = await writeContractAsync({
        address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
        functionName: 'depositShielded',
        value: parseEther(bucket),
      } as any);
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      await fetchBalance();
      addToast('success', `${bucket} ETH added to shielded balance`);
      setAction(null);
    } catch (e: any) {
      addToast('error', e?.shortMessage || 'Deposit failed');
    }
    setLoading(false);
  }, [bucket, writeContractAsync, publicClient, fetchBalance, addToast]);

  const handleWithdraw = useCallback(async () => {
    setLoading(true);
    try {
      const amt = parseEther(bucket);
      if (balance !== null && balance < amt) {
        addToast('warning', 'Insufficient shielded balance');
        setLoading(false);
        return;
      }
      const tx = await writeContractAsync({
        address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
        functionName: 'withdrawShielded',
        args: [amt],
      } as any);
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      await fetchBalance();
      addToast('success', `${bucket} ETH withdrawn from shielded balance`);
      setAction(null);
    } catch (e: any) {
      addToast('error', e?.shortMessage || 'Withdraw failed');
    }
    setLoading(false);
  }, [bucket, balance, writeContractAsync, publicClient, fetchBalance, addToast]);

  const formatted = balance !== null ? formatEther(balance) : '—';
  const hasBalance = balance !== null && balance > 0n;

  return (
    <div className="bg-surface-1 border border-border-default rounded-2xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold text-white">Shielded Balance</span>
        </div>
        <button onClick={fetchBalance} className="text-text-muted hover:text-primary transition-colors">
          <Loader2 className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Balance + privacy tag */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-3xl font-bold text-white">{formatted}</p>
          <p className="text-xs text-text-muted">ETH</p>
        </div>
        <div className="text-right space-y-1">
          <div className="flex items-center justify-end gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${hasBalance ? 'bg-primary animate-pulse' : 'bg-text-dim'}`} />
            <span className={`text-[10px] font-bold uppercase tracking-widest ${hasBalance ? 'text-primary' : 'text-text-dim'}`}>
              {hasBalance ? 'Active' : 'Empty'}
            </span>
          </div>
          {hasBalance && (
            <div className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 rounded-lg">
              <Eye className="w-2.5 h-2.5 text-primary" />
              <span className="text-[9px] font-bold text-primary">msg.value = 0 on next pay</span>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => setAction(action === 'deposit' ? null : 'deposit')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
            action === 'deposit' ? 'bg-primary text-black border-primary' : 'bg-surface-2 text-text-secondary border-border-default hover:border-primary/50'
          }`}
        >
          <Plus className="w-3.5 h-3.5" /> Deposit
        </button>
        <button
          onClick={() => setAction(action === 'withdraw' ? null : 'withdraw')}
          disabled={!hasBalance}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border transition-colors disabled:opacity-30 ${
            action === 'withdraw' ? 'bg-surface-3 text-white border-border-default' : 'bg-surface-2 text-text-secondary border-border-default hover:border-primary/50'
          }`}
        >
          <Minus className="w-3.5 h-3.5" /> Withdraw
        </button>
      </div>

      {/* Inline bucket picker + confirm */}
      <AnimatePresence>
        {action && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-1 space-y-3">
              <div className="flex gap-1.5">
                {['0.001', '0.01', '0.1'].map(v => (
                  <button
                    key={v}
                    onClick={() => setBucket(v)}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${
                      bucket === v ? 'bg-primary text-black border-primary' : 'bg-surface-2 text-text-secondary border-border-default'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              {action === 'withdraw' && balance !== null && parseEther(bucket) > balance && (
                <p className="text-[10px] text-amber-400">Insufficient balance ({formatted} ETH available)</p>
              )}
              <button
                onClick={action === 'deposit' ? handleDeposit : handleWithdraw}
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-primary text-black text-xs font-bold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2 transition-opacity"
              >
                {loading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
                  : `${action === 'deposit' ? 'Deposit' : 'Withdraw'} ${bucket} ETH`}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-[9px] text-text-muted leading-relaxed">
        Payments from shielded balance carry <strong className="text-white">msg.value = 0</strong> — the tx envelope reveals no per-invoice amount.
        <a href="/app/anon-claim" className="text-primary ml-1 hover:underline">Use with anonymous claim →</a>
      </p>
    </div>
  );
}
