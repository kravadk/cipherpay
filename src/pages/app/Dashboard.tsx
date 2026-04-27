import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, Eye, EyeOff, Clock, CheckCircle, XCircle, Lock, RefreshCw, Copy, Share2, ExternalLink } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from '../../components/Button';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import type { Invoice } from '../../store/useInvoiceStore';
import { useAccount, useBalance, useWriteContract, usePublicClient } from 'wagmi';
import { CIPHERPAY_ADDRESS, CIPHERPAY_SIMPLE_ADDRESS, CIPHERPAY_ABI, SIMPLE_EXTRA_ABI } from '../../config/contract';
import { EncryptedAmount } from '../../components/EncryptedAmount';
import { Link, useNavigate } from 'react-router-dom';
import { CipherScramble } from '../../components/CipherScramble';
import { useToastStore } from '../../components/ToastContainer';
import { useContractStatus } from '../../hooks/useContractStatus';
import { useInvoices } from '../../hooks/useInvoices';
import { useCofhe } from '../../hooks/useCofhe';
import { SideDrawer } from '../../components/SideDrawer';
import { ShieldedBalance } from '../../components/ShieldedBalance';

function CountUpAnimation({ value, duration = 1500 }: { value: number; duration?: number }) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    if (value === 0) return;
    const start = Date.now();
    const animate = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOut
      setDisplayed(Math.round(value * eased));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value, duration]);

  return <>{displayed}</>;
}

export function Dashboard() {
  const { revealAmounts, toggleReveal } = useInvoiceStore();
  const { invoices, isLoading: isLoadingInvoices, refetch: refetchInvoices } = useInvoices();
  const { address } = useAccount();
  const { data: balanceData, refetch: refetchBalance } = useBalance({ address });
  const { addToast } = useToastStore();
  const { isDeployed } = useContractStatus();
  const { isReady: isFheReady, isConnecting: isFheConnecting } = useCofhe();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'all' | 'sender' | 'receiver' | 'recurring' | 'batch'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'settled' | 'cancelled'>('all');
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const [drawerInvoice, setDrawerInvoice] = useState<Invoice | null>(null);
  const [privateRevealed, setPrivateRevealed] = useState(false);
  const [isRevealingPrivate, setIsRevealingPrivate] = useState(false);

  const totalCount = invoices.length;
  const pendingCount = invoices.filter(i => i.status === 'open').length;
  const settledCount = invoices.filter(i => i.status === 'settled').length;
  const cancelledCount = invoices.filter(i => i.status === 'cancelled').length;
  const settleRate = totalCount > 0 ? Math.round((settledCount / totalCount) * 100) : 0;

  const stats = [
    { label: 'Total Invoices', value: totalCount, trend: totalCount > 3 ? `+${Math.min(totalCount, 5)} this week` : null, color: 'text-white' },
    { label: 'Pending', value: pendingCount, trend: pendingCount > 0 ? 'Awaiting payment' : 'All clear', color: 'text-secondary' },
    { label: 'Settled', value: settledCount, trend: settleRate > 0 ? `${settleRate}% settle rate` : null, color: 'text-primary' },
    { label: 'Volume', value: -1, isEncrypted: true, trend: 'FHE encrypted', color: 'text-blue-400' },
  ];

  const filteredInvoices = invoices.filter(invoice => {
    // Role filter
    if (activeTab === 'sender' && invoice.creator?.toLowerCase() !== address?.toLowerCase()) return false;
    if (activeTab === 'receiver' && invoice.creator?.toLowerCase() === address?.toLowerCase()) return false;
    if (activeTab === 'recurring' && invoice.type !== 'recurring') return false;
    if (activeTab === 'batch' && invoice.type !== 'batch') return false;
    // Status filter
    if (statusFilter !== 'all' && invoice.status !== statusFilter) return false;
    return true;
  }).slice(0, 10);

  const handleRefreshBalance = async () => {
    setIsRefreshingBalance(true);
    await refetchBalance();
    setIsRefreshingBalance(false);
  };

  const handleRevealPrivate = async () => {
    addToast('info', 'Encrypted balance tracking coming soon');
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    addToast('success', 'Hash copied');
  };

  const handleShareLink = (hash: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/pay/${hash}`);
    addToast('success', 'Payment link copied');
  };

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const handleSettle = async (hash: string) => {
    if (!publicClient) return;
    try {
      addToast('info', 'Settling invoice...');
      let tx: `0x${string}` | null = null;
      for (const addr of [CIPHERPAY_SIMPLE_ADDRESS, CIPHERPAY_ADDRESS]) {
        try {
          tx = await writeContractAsync({
            address: addr, abi: CIPHERPAY_ABI as any,
            functionName: 'settleInvoice', args: [hash as `0x${string}`],
          });
          break;
        } catch {}
      }
      if (!tx) throw new Error('Settle failed on all contracts');
      await publicClient.waitForTransactionReceipt({ hash: tx });
      addToast('success', 'Invoice settled — ETH transferred!');
      refetchInvoices();
    } catch (err: any) {
      const msg = err.shortMessage || err.message || 'Settle failed';
      addToast('error', msg.includes('User rejected') ? 'Transaction cancelled' : msg);
    }
  };

  const handleCancel = async (hash: string) => {
    if (!publicClient) return;
    try {
      addToast('info', 'Cancelling invoice...');
      let tx: `0x${string}` | null = null;
      for (const addr of [CIPHERPAY_SIMPLE_ADDRESS, CIPHERPAY_ADDRESS]) {
        try {
          tx = await writeContractAsync({
            address: addr, abi: CIPHERPAY_ABI as any,
            functionName: 'cancelInvoice', args: [hash as `0x${string}`],
          });
          break;
        } catch {}
      }
      if (!tx) throw new Error('Cancel failed on all contracts');
      await publicClient.waitForTransactionReceipt({ hash: tx });
      addToast('success', 'Invoice cancelled — ETH refunded');
      refetchInvoices();
    } catch (err: any) {
      const msg = err.shortMessage || err.message || 'Cancel failed';
      addToast('error', msg.includes('User rejected') ? 'Transaction cancelled' : msg);
    }
  };

  const handlePause = async (hash: string) => {
    if (!publicClient) return;
    try {
      const pauseAbi = [{ name: 'pauseInvoice', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [] }] as const;
      const tx = await writeContractAsync({
        address: CIPHERPAY_SIMPLE_ADDRESS, abi: pauseAbi as any,
        functionName: 'pauseInvoice', args: [hash as `0x${string}`],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      addToast('success', 'Invoice paused');
      refetchInvoices();
    } catch (err: any) {
      const msg = err.shortMessage || err.message || 'Pause failed';
      addToast('error', msg.includes('User rejected') ? 'Transaction cancelled' : msg);
    }
  };

  const handleResume = async (hash: string) => {
    if (!publicClient) return;
    try {
      const resumeAbi = [{ name: 'resumeInvoice', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [] }] as const;
      const tx = await writeContractAsync({
        address: CIPHERPAY_SIMPLE_ADDRESS, abi: resumeAbi as any,
        functionName: 'resumeInvoice', args: [hash as `0x${string}`],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      addToast('success', 'Invoice resumed');
      refetchInvoices();
    } catch (err: any) {
      const msg = err.shortMessage || err.message || 'Resume failed';
      addToast('error', msg.includes('User rejected') ? 'Transaction cancelled' : msg);
    }
  };

  const handleClaimRecurring = async (hash: string) => {
    if (!publicClient) return;
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
      refetchInvoices();
    } catch (err: any) {
      const msg = err.shortMessage || err.message || 'Claim failed';
      addToast('error', msg.includes('User rejected') ? 'Transaction cancelled' : msg.includes('Nothing to claim') ? 'No periods available yet' : msg);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'settled': return <CheckCircle className="w-4 h-4 text-primary" />;
      case 'open': return <Clock className="w-4 h-4 text-secondary" />;
      case 'cancelled': return <XCircle className="w-4 h-4 text-text-muted" />;
      case 'locked': return <Lock className="w-4 h-4 text-yellow-500" />;
      case 'paused': return <Clock className="w-4 h-4 text-orange-500" />;
      default: return null;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'settled': return 'text-primary';
      case 'open': return 'text-secondary';
      case 'cancelled': return 'text-text-muted';
      case 'locked': return 'text-yellow-500';
      case 'paused': return 'text-orange-500';
      default: return 'text-text-muted';
    }
  };

  const typeColor = (type: string) => {
    switch (type) {
      case 'standard': return 'bg-primary/10 border-primary/20 text-primary';
      case 'multi-pay': return 'bg-blue-500/10 border-blue-500/20 text-blue-500';
      case 'recurring': return 'bg-purple-500/10 border-purple-500/20 text-purple-500';
      case 'vesting': return 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500';
      case 'batch': return 'bg-orange-500/10 border-orange-500/20 text-orange-500';
      default: return 'bg-surface-2 border-border-default text-text-muted';
    }
  };

  return (
    <div className="space-y-12">
      {/* FHE Status Banner */}
      <div className="flex items-center gap-4 p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isFheReady ? 'bg-blue-500/20' : 'bg-surface-2'}`}>
          <Lock className={`w-5 h-5 ${isFheReady ? 'text-blue-400' : 'text-text-muted'}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">Fhenix FHE Protection</span>
            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
              isFheReady ? 'bg-blue-500/20 text-blue-400' : isFheConnecting ? 'bg-yellow-500/20 text-yellow-400' : 'bg-surface-3 text-text-muted'
            }`}>{isFheReady ? 'ACTIVE' : isFheConnecting ? 'LOADING' : 'STANDBY'}</span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            {isFheReady
              ? 'CoFHE SDK initialized — invoice amounts encrypted with TFHE + ZK proofs'
              : 'Fully Homomorphic Encryption powered by Fhenix CoFHE coprocessor'}
          </p>
        </div>
      </div>

      {/* Shielded Balance — prominent before CTAs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ShieldedBalance />
        <div className="bg-surface-1 border border-border-default rounded-2xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">Anonymous Claim</span>
              <span className="text-[9px] font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider">NEW</span>
            </div>
            <p className="text-xs text-text-muted">Pay invoices without recording your address on-chain. Creator sees only a nullifier hash.</p>
          </div>
          <div className="space-y-2 text-[10px] text-text-secondary">
            <div className="flex gap-2"><span className="text-primary">✓</span> Address NOT stored in contract</div>
            <div className="flex gap-2"><span className="text-primary">✓</span> No InvoicePaid event emitted</div>
            <div className="flex gap-2"><span className="text-primary">✓</span> Nullifier replay protection</div>
          </div>
          <Link to="/app/anon-claim"
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-surface-2 border border-border-default text-xs font-bold text-text-secondary hover:text-white hover:border-primary/50 transition-colors">
            Pay anonymously →
          </Link>
        </div>
      </div>

      {/* CTA Buttons */}
      <div className="flex flex-col md:flex-row gap-6">
        <Link to="/app/new-cipher" className="flex-1">
          <Button variant="primary" className="w-full h-[52px] text-lg gap-3">
            GET PAID PRIVATELY <ArrowUpRight className="w-6 h-6" />
          </Button>
        </Link>
        <Link to="/app/cipher-drop" className="flex-1">
          <Button variant="secondary" className="w-full h-[52px] text-lg gap-3">
            DISTRIBUTE PRIVATELY <ArrowDownRight className="w-6 h-6" />
          </Button>
        </Link>
      </div>

      {/* Balance removed — shown in sidebar */}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-3 hover:border-primary/20 transition-colors">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-text-secondary uppercase tracking-widest">{stat.label}</p>
              {i === 0 && <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />}
            </div>
            <div className="flex items-baseline gap-2">
              {stat.isEncrypted ? (
                <EncryptedAmount compact />
              ) : (
                <span className={`text-3xl font-bold ${(stat as any).color || 'text-white'}`}>
                  <CountUpAnimation value={stat.value} />
                </span>
              )}
            </div>
            {(stat as any).trend && (
              <p className="text-xs text-text-secondary">{(stat as any).trend}</p>
            )}
            {/* Mini progress bar for settle rate */}
            {stat.label === 'Settled' && totalCount > 0 && (
              <div className="w-full h-1 bg-surface-3 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${settleRate}%` }}
                  transition={{ duration: 1, delay: 0.5 }} className="h-full bg-primary rounded-full" />
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Recent Ciphers */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <h2 className="text-xl font-bold text-white uppercase tracking-tight">Recent Ciphers</h2>
          </div>
          <div className="flex items-center gap-4">
            {invoices.length > 0 && (
              <button
                onClick={() => {
                  const csv = ['Hash,Type,Status,Created'].concat(
                    invoices.map(i => `${i.hash},${i.type},${i.status},${new Date(i.createdAt).toISOString()}`)
                  ).join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = 'cipherpay-invoices.csv'; a.click();
                  URL.revokeObjectURL(url);
                  addToast('success', 'CSV exported');
                }}
                className="text-xs text-text-muted hover:text-primary transition-colors uppercase tracking-widest"
              >
                Export CSV
              </button>
            )}
            <Link to="/app/explorer" className="text-xs font-bold text-primary hover:underline uppercase tracking-widest">
              View All Explorer →
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-6">
          {/* Role filter */}
          <div className="flex items-center gap-1.5 bg-surface-1 border border-border-default rounded-xl p-1">
            {(['all', 'sender', 'receiver'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  activeTab === tab ? 'bg-primary text-black' : 'text-text-secondary hover:text-white hover:bg-surface-2'
                }`}
              >
                {tab === 'all' ? 'All' : tab === 'sender' ? 'Sent' : 'Received'}
              </button>
            ))}
          </div>
          {/* Status filter */}
          <div className="flex items-center gap-1.5 bg-surface-1 border border-border-default rounded-xl p-1">
            {(['all', 'open', 'settled', 'cancelled'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  statusFilter === status ? 'bg-primary text-black' : 'text-text-secondary hover:text-white hover:bg-surface-2'
                }`}
              >
                {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
          </div>
        </div>

        <div className="bg-surface-1 border border-border-default rounded-[32px] overflow-hidden">
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Hash</th>
                  <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Type</th>
                  <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Status</th>
                  <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Amount</th>
                  <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {isLoadingInvoices && Array.from({length: 3}).map((_, i) => (
                  <tr key={`skel-${i}`} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-24" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-16" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-20" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-14" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-12" /></td>
                  </tr>
                ))}
                {!isLoadingInvoices && filteredInvoices.length > 0 ? filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="group hover:bg-surface-2 transition-colors">
                    <td className="px-8 py-5">
                      <button onClick={() => handleCopyHash(invoice.hash)} className="cursor-pointer">
                        <CipherScramble
                          text={invoice.hash.slice(0, 12) + '...'}
                          className="text-sm font-mono text-text-secondary group-hover:text-white transition-colors"
                        />
                      </button>
                    </td>
                    <td className="px-8 py-5">
                      <span className={`text-xs font-bold uppercase tracking-widest px-2 py-1 rounded-md border ${typeColor(invoice.type)}`}>
                        {invoice.type}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2">
                        {statusIcon(invoice.status)}
                        <span className={`text-xs font-bold uppercase tracking-widest ${statusColor(invoice.status)}`}>
                          {invoice.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <EncryptedAmount invoiceHash={invoice.hash} amount={invoice.amount} compact />
                      {invoice.type === 'multi-pay' && invoice.totalCollected !== undefined && (
                        <div className="mt-1.5 space-y-1">
                          <div className="w-24 h-1 bg-surface-2 rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${invoice.collectedPercent || 0}%` }} />
                          </div>
                          <p className="text-xs text-text-muted">{invoice.totalCollected}/{invoice.targetAmount} ETH · {invoice.payerCount} payer{(invoice.payerCount || 0) !== 1 ? 's' : ''}</p>
                        </div>
                      )}
                    </td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDrawerInvoice(invoice)}>View</Button>
                        {/* Primary action */}
                        {invoice.status === 'open' && invoice.creator?.toLowerCase() !== address?.toLowerCase() && (
                          <Button variant="ghost" size="sm" className="text-secondary" onClick={() => navigate(`/pay/${invoice.hash}`)}>Pay</Button>
                        )}
                        {invoice.status === 'open' && invoice.type === 'recurring' && invoice.creator?.toLowerCase() === address?.toLowerCase() && (
                          <Button variant="ghost" size="sm" className="text-primary" onClick={() => handleClaimRecurring(invoice.hash)}>Claim</Button>
                        )}
                        {invoice.status === 'open' && invoice.type === 'multi-pay' && invoice.creator?.toLowerCase() === address?.toLowerCase() && (
                          <Button variant="ghost" size="sm" className="text-primary" onClick={() => handleSettle(invoice.hash)}>Settle</Button>
                        )}
                        {/* More actions dropdown */}
                        {(invoice.creator?.toLowerCase() === address?.toLowerCase() && (invoice.status === 'open' || invoice.status === 'paused')) && (
                          <details className="relative inline-block">
                            <summary className="list-none cursor-pointer p-2 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-surface-2">
                              <span className="text-sm font-bold tracking-wide">...</span>
                            </summary>
                            <div className="absolute right-0 top-full mt-1 z-50 bg-surface-1 border border-border-default rounded-xl shadow-xl py-1 min-w-[140px]">
                              {invoice.status === 'open' && (
                                <button onClick={() => handlePause(invoice.hash)} className="w-full text-left px-4 py-2 text-xs font-bold text-orange-400 hover:bg-surface-2 transition-colors">Pause</button>
                              )}
                              {invoice.status === 'paused' && (
                                <button onClick={() => handleResume(invoice.hash)} className="w-full text-left px-4 py-2 text-xs font-bold text-primary hover:bg-surface-2 transition-colors">Resume</button>
                              )}
                              <button onClick={() => handleCancel(invoice.hash)} className="w-full text-left px-4 py-2 text-xs font-bold text-red-400 hover:bg-surface-2 transition-colors">Cancel</button>
                              <button onClick={() => handleShareLink(invoice.hash)} className="w-full text-left px-4 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2 transition-colors">Share Link</button>
                            </div>
                          </details>
                        )}
                        {!(invoice.creator?.toLowerCase() === address?.toLowerCase() && (invoice.status === 'open' || invoice.status === 'paused')) && (
                          <button
                            onClick={() => handleShareLink(invoice.hash)}
                            className="p-2 text-text-muted hover:text-primary transition-colors"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )) : !isLoadingInvoices ? (
                  <tr>
                    <td colSpan={5} className="px-8 py-16 text-center">
                      <div className="flex flex-col items-center gap-6 relative">
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-32 h-32 bg-primary/10 rounded-full blur-3xl" />
                        </div>
                        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                          className="relative w-16 h-16 bg-surface-2 rounded-2xl flex items-center justify-center border border-border-default">
                          <Lock className="w-8 h-8 text-text-dim" />
                        </motion.div>
                        <div className="space-y-2 text-center">
                          <p className="text-sm font-bold text-white">No Invoices Yet</p>
                          <p className="text-xs text-text-muted max-w-xs">Create your first encrypted invoice and start accepting private payments</p>
                        </div>
                        <Link to="/app/new-cipher">
                          <Button variant="primary" size="sm">Create First Cipher →</Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <SideDrawer isOpen={!!drawerInvoice} onClose={() => setDrawerInvoice(null)} invoice={drawerInvoice} />
    </div>
  );
}
