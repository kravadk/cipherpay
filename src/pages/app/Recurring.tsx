import { motion } from 'framer-motion';
import { Repeat, Clock, CheckCircle, Pause, Play, X, AlertTriangle, Download } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Invoice } from '../../store/useInvoiceStore';
import { Button } from '../../components/Button';
import { EncryptedAmount } from '../../components/EncryptedAmount';
import { useContractStatus } from '../../hooks/useContractStatus';
import { useInvoices } from '../../hooks/useInvoices';
import { useWriteContract, usePublicClient, useAccount, useReadContract } from 'wagmi';
import { CIPHERPAY_ADDRESS, CIPHERPAY_ABI, CIPHERPAY_SIMPLE_ADDRESS, SIMPLE_EXTRA_ABI } from '../../config/contract';
import { useToastStore } from '../../components/ToastContainer';

function CountdownTimer({ targetDate }: { targetDate: string }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const target = new Date(targetDate).getTime();
      const diff = target - now;
      if (diff <= 0) { setTimeLeft('Overdue'); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setTimeLeft(`in ${d}d ${h}h ${m}m`);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return <span className={timeLeft === 'Overdue' ? 'text-red-500' : 'text-white'}>{timeLeft}</span>;
}

export function Recurring() {
  const navigate = useNavigate();
  const { invoices: allInvoices, isLoading: isLoadingInvoices } = useInvoices();
  const invoices = allInvoices;
  const { isDeployed } = useContractStatus();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { addToast } = useToastStore();
  const { address } = useAccount();
  const [pausedInvoices, setPausedInvoices] = useState<Set<string>>(new Set());
  const [cancelModal, setCancelModal] = useState<string | null>(null);
  const [claimingHash, setClaimingHash] = useState<string | null>(null);

  const handleClaim = async (hash: string) => {
    if (!publicClient) return;
    setClaimingHash(hash);
    try {
      addToast('info', 'Claiming recurring payment...');
      const tx = await writeContractAsync({
        address: CIPHERPAY_SIMPLE_ADDRESS,
        abi: SIMPLE_EXTRA_ABI as any,
        functionName: 'claimRecurring',
        args: [hash as `0x${string}`],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      addToast('success', 'Payment claimed!');
    } catch (err: any) {
      const msg = err.shortMessage || err.message || 'Claim failed';
      addToast('error', msg.includes('User rejected') ? 'Transaction cancelled' : msg.includes('Nothing to claim') ? 'No periods available to claim yet' : msg);
    }
    setClaimingHash(null);
  };

  const recurringInvoices = invoices.filter(i => i.type === 'recurring');
  const activeCount = recurringInvoices.filter(i => i.status === 'open' && !pausedInvoices.has(i.hash)).length;
  const settledCount = recurringInvoices.filter(i => i.status === 'settled').length;

  const nearestNext = recurringInvoices
    .filter(i => i.nextPaymentDate && i.status === 'open')
    .sort((a, b) => new Date(a.nextPaymentDate!).getTime() - new Date(b.nextPaymentDate!).getTime())[0];

  const togglePause = (hash: string) => {
    setPausedInvoices(prev => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash); else next.add(hash);
      return next;
    });
  };

  const getStatus = (invoice: typeof recurringInvoices[0]) => {
    if (invoice.status === 'cancelled') return 'cancelled';
    if (invoice.status === 'settled') return 'completed';
    if (pausedInvoices.has(invoice.hash)) return 'paused';
    return 'active';
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string }> = {
      active: { bg: 'bg-primary/10 border-primary/20 text-primary', text: 'Active' },
      paused: { bg: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500', text: 'Paused' },
      completed: { bg: 'bg-blue-500/10 border-blue-500/20 text-blue-500', text: 'Completed' },
      cancelled: { bg: 'bg-surface-2 border-border-default text-text-muted', text: 'Cancelled' },
    };
    const s = map[status] || map.cancelled;
    return <span className={`px-2 py-1 rounded-md border text-xs font-bold uppercase tracking-widest ${s.bg}`}>{s.text}</span>;
  };

  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Recurring</h1>
        <p className="text-text-secondary">Manage automated encrypted payment schedules</p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-2">
          <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Active Schedules</p>
          <span className="text-2xl font-bold text-white">{activeCount}</span>
        </div>
        <div className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-2">
          <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Total Paid</p>
          <span className="text-2xl font-bold text-white">{settledCount}</span>
        </div>
        <div className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-2">
          <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Next Payment In</p>
          <span className="text-2xl font-bold">
            {nearestNext?.nextPaymentDate ? <CountdownTimer targetDate={nearestNext.nextPaymentDate} /> : <span className="text-text-muted">—</span>}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface-1 border border-border-default rounded-[32px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-default">
                <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Hash</th>
                <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Recipient</th>
                <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest hidden md:table-cell">Frequency</th>
                <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Next Date</th>
                <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest hidden md:table-cell">Cycles</th>
                <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Status</th>
                <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {isLoadingInvoices && Array.from({length: 3}).map((_, i) => (
                <tr key={`skel-${i}`} className="animate-pulse">
                  <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-24" /></td>
                  <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-20" /></td>
                  <td className="px-6 py-4 hidden md:table-cell"><div className="h-4 bg-surface-2 rounded w-16" /></td>
                  <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-20" /></td>
                  <td className="px-6 py-4 hidden md:table-cell"><div className="h-4 bg-surface-2 rounded w-14" /></td>
                  <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-16" /></td>
                  <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-12" /></td>
                </tr>
              ))}
              {!isLoadingInvoices && recurringInvoices.length > 0 ? recurringInvoices.map((invoice) => {
                const status = getStatus(invoice);
                const totalCycles = (invoice.cyclesLeft ?? 0) + (12 - (invoice.cyclesLeft ?? 0));
                const completedCycles = 12 - (invoice.cyclesLeft ?? 0);
                return (
                  <tr key={invoice.id} className="group hover:bg-surface-2 transition-colors">
                    <td className="px-8 py-5">
                      <span className="text-sm font-mono text-text-secondary group-hover:text-white transition-colors">
                        {invoice.hash.slice(0, 10)}...
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <span className="text-sm font-mono text-text-secondary">{invoice.recipient}</span>
                    </td>
                    <td className="px-8 py-5 hidden md:table-cell">
                      <span className="text-xs font-bold text-text-primary uppercase tracking-widest px-2 py-1 bg-surface-2 rounded-md border border-border-default">
                        {invoice.memo?.includes('freq:')
                          ? invoice.memo.split('freq:')[1]?.split(',')[0]?.trim() || 'Recurring'
                          : 'Recurring'}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <span className="text-xs text-text-secondary">
                        {invoice.createdAt
                          ? new Date(invoice.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : '—'}
                      </span>
                    </td>
                    <td className="px-8 py-5 hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-secondary">
                          {invoice.memo?.includes('cycles:')
                            ? `0 / ${invoice.memo.split('cycles:')[1]?.split(',')[0]?.trim() || '?'}`
                            : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-5">{statusBadge(status)}</td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {status === 'active' && invoice.creator?.toLowerCase() === address?.toLowerCase() && (
                          <Button variant="ghost" size="sm"
                            onClick={() => handleClaim(invoice.hash)}
                            disabled={claimingHash === invoice.hash}
                            className="gap-1 text-primary">
                            <Download className="w-3.5 h-3.5" /> {claimingHash === invoice.hash ? 'Claiming...' : 'Claim'}
                          </Button>
                        )}
                        {status === 'active' && (
                          <Button variant="ghost" size="sm" onClick={() => togglePause(invoice.hash)} className="gap-1 text-yellow-500">
                            <Pause className="w-3.5 h-3.5" /> Pause
                          </Button>
                        )}
                        {status === 'paused' && (
                          <Button variant="ghost" size="sm" onClick={() => togglePause(invoice.hash)} className="gap-1 text-primary">
                            <Play className="w-3.5 h-3.5" /> Resume
                          </Button>
                        )}
                        {(status === 'active' || status === 'paused') && (
                          <Button variant="ghost" size="sm" onClick={() => setCancelModal(invoice.hash)} className="gap-1 text-red-500">
                            <X className="w-3.5 h-3.5" /> Cancel
                          </Button>
                        )}
                        <Button variant="ghost" size="sm">View</Button>
                      </div>
                    </td>
                  </tr>
                );
              }) : !isLoadingInvoices ? (
                <tr>
                  <td colSpan={7} className="px-8 py-16 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <Repeat className="w-12 h-12 text-text-dim" />
                      <p className="text-text-muted">No recurring invoices yet</p>
                      <Button variant="primary" size="sm" onClick={() => navigate('/app/new-cipher')}>
                        Create Recurring Cipher
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      {cancelModal && (
        <div className="fixed inset-0 z-[10010] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCancelModal(null)} />
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative bg-surface-1 border border-border-default rounded-3xl p-8 max-w-sm w-full space-y-6"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-red-500" />
              <h3 className="text-xl font-bold text-white">Cancel Invoice?</h3>
            </div>
            <p className="text-sm text-text-secondary">Remaining payments will not be sent. This action cannot be undone.</p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setCancelModal(null)}>Keep Active</Button>
              <Button className="flex-1 !bg-red-500 !text-white" onClick={async () => {
                if (!publicClient || !cancelModal) { setCancelModal(null); return; }
                try {
                  addToast('info', 'Cancelling invoice...');
                  const tx = await writeContractAsync({
                    address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
                    functionName: 'cancelInvoice', args: [cancelModal as `0x${string}`],
                  });
                  await publicClient.waitForTransactionReceipt({ hash: tx });
                  addToast('success', 'Invoice cancelled');
                } catch (err: any) {
                  const msg = err.shortMessage || err.message || 'Cancel failed';
                  addToast('error', msg.includes('User rejected') ? 'Transaction cancelled' : msg);
                }
                setCancelModal(null);
              }}>Cancel Invoice</Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
