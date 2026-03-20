import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, Eye, EyeOff, Clock, CheckCircle, XCircle, Lock, RefreshCw, Copy, Share2, ExternalLink } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from '../../components/Button';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import type { Invoice } from '../../store/useInvoiceStore';
import { useAccount, useBalance, useWriteContract, usePublicClient } from 'wagmi';
import { CIPHERPAY_ADDRESS, CIPHERPAY_ABI } from '../../config/contract';
import { EncryptedAmount } from '../../components/EncryptedAmount';
import { Link, useNavigate } from 'react-router-dom';
import { CipherScramble } from '../../components/CipherScramble';
import { useToastStore } from '../../components/ToastContainer';
import { useContractStatus } from '../../hooks/useContractStatus';
import { useInvoices } from '../../hooks/useInvoices';
import { useCofhe } from '../../hooks/useCofhe';

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
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const [privateRevealed, setPrivateRevealed] = useState(false);
  const [isRevealingPrivate, setIsRevealingPrivate] = useState(false);

  const stats = [
    { label: 'Total Invoices', value: invoices.length },
    { label: 'Pending', value: invoices.filter(i => i.status === 'open').length },
    { label: 'Settled', value: invoices.filter(i => i.status === 'settled').length },
    { label: 'Volume', value: -1, isEncrypted: true },
  ];

  const filteredInvoices = invoices.filter(invoice => {
    if (activeTab === 'all') return true;
    if (activeTab === 'sender') return invoice.creator?.toLowerCase() === address?.toLowerCase();
    if (activeTab === 'receiver') return invoice.creator?.toLowerCase() !== address?.toLowerCase();
    if (activeTab === 'recurring') return invoice.type === 'recurring';
    if (activeTab === 'batch') return invoice.type === 'batch';
    return true;
  }).slice(0, 10);

  const handleRefreshBalance = async () => {
    setIsRefreshingBalance(true);
    await refetchBalance();
    setIsRefreshingBalance(false);
  };

  const handleRevealPrivate = async () => {
    // Private balance requires FHERC20 token contract — not available yet
    addToast('info', 'Private balance requires FHERC20 token (coming in Wave 3)');
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
      const tx = await writeContractAsync({
        address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
        functionName: 'settleInvoice', args: [hash as `0x${string}`],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      addToast('success', 'Invoice settled!');
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
      const tx = await writeContractAsync({
        address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
        functionName: 'cancelInvoice', args: [hash as `0x${string}`],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      addToast('success', 'Invoice cancelled');
      refetchInvoices();
    } catch (err: any) {
      const msg = err.shortMessage || err.message || 'Cancel failed';
      addToast('error', msg.includes('User rejected') ? 'Transaction cancelled' : msg);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'settled': return <CheckCircle className="w-4 h-4 text-primary" />;
      case 'open': return <Clock className="w-4 h-4 text-secondary" />;
      case 'cancelled': return <XCircle className="w-4 h-4 text-text-muted" />;
      case 'locked': return <Lock className="w-4 h-4 text-yellow-500" />;
      default: return null;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'settled': return 'text-primary';
      case 'open': return 'text-secondary';
      case 'cancelled': return 'text-text-muted';
      case 'locked': return 'text-yellow-500';
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

      {/* Balance Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Public Balance */}
        <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Public Balance</p>
            <button
              onClick={handleRefreshBalance}
              className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-secondary transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshingBalance ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-4xl font-bold text-primary">{balanceData ? Number((balanceData as any).formatted ?? '0').toFixed(4) : '0.00'}</span>
            <span className="text-xl font-bold text-text-secondary mb-1">{balanceData?.symbol || 'ETH'}</span>
          </div>
        </div>

        {/* Private Balance */}
        <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-4 relative overflow-hidden group">
          <div className="absolute inset-0 bg-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Private Balance</p>
          <div className="flex items-center justify-between relative">
            <div className="flex items-end gap-2">
              <span className="text-4xl font-bold tracking-widest text-text-muted">• • • • • •</span>
              <span className="text-xl font-bold text-text-secondary mb-1">FHE</span>
            </div>
            <span className="text-[10px] text-text-dim uppercase tracking-widest">Requires FHERC20</span>
          </div>
          <p className="text-[10px] text-text-dim">Private balance will be available when FHERC20 token is deployed (Wave 3)</p>
        </div>
      </div>

      {/* end balance row */}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-2">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">{stat.label}</p>
            <div className="flex items-center gap-2">
              {stat.isEncrypted ? (
                <EncryptedAmount amount="7,050" />
              ) : (
                <span className="text-2xl font-bold text-white">
                  <CountUpAnimation value={stat.value} />
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Ciphers */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <h2 className="text-xl font-bold text-white uppercase tracking-tight">Recent Ciphers</h2>
          </div>
          <Link to="/app/explorer" className="text-xs font-bold text-primary hover:underline uppercase tracking-widest">
            View All Explorer →
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {(['all', 'sender', 'receiver', 'recurring', 'batch'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
                activeTab === tab ? 'bg-primary text-black' : 'bg-surface-1 text-text-secondary border border-border-default hover:border-primary/40'
              }`}
            >
              {tab === 'all' ? 'All' : tab === 'sender' ? 'As Sender' : tab === 'receiver' ? 'As Receiver' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="bg-surface-1 border border-border-default rounded-[32px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="px-8 py-5 text-[10px] font-bold text-text-muted uppercase tracking-widest">Hash</th>
                  <th className="px-8 py-5 text-[10px] font-bold text-text-muted uppercase tracking-widest">Type</th>
                  <th className="px-8 py-5 text-[10px] font-bold text-text-muted uppercase tracking-widest">Status</th>
                  <th className="px-8 py-5 text-[10px] font-bold text-text-muted uppercase tracking-widest">Amount</th>
                  <th className="px-8 py-5 text-[10px] font-bold text-text-muted uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {filteredInvoices.length > 0 ? filteredInvoices.map((invoice) => (
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
                      <EncryptedAmount amount={invoice.amount} />
                      {invoice.type === 'multi-pay' && invoice.totalCollected !== undefined && (
                        <div className="mt-1.5 space-y-1">
                          <div className="w-24 h-1 bg-surface-2 rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${invoice.collectedPercent || 0}%` }} />
                          </div>
                          <p className="text-[9px] text-text-muted">{invoice.totalCollected}/{invoice.targetAmount} ETH · {invoice.payerCount} payer{(invoice.payerCount || 0) !== 1 ? 's' : ''}</p>
                        </div>
                      )}
                    </td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/app/explorer`)}>View</Button>
                        {/* Settle — only for multi-pay creator */}
                        {invoice.status === 'open' && invoice.type === 'multi-pay' && invoice.creator?.toLowerCase() === address?.toLowerCase() && (
                          <Button variant="ghost" size="sm" className="text-primary" onClick={() => handleSettle(invoice.hash)}>Settle</Button>
                        )}
                        {/* Cancel — only for creator's open invoices */}
                        {invoice.status === 'open' && invoice.creator?.toLowerCase() === address?.toLowerCase() && (
                          <Button variant="ghost" size="sm" className="text-red-400" onClick={() => handleCancel(invoice.hash)}>Cancel</Button>
                        )}
                        {/* Pay — only for non-creator open invoices */}
                        {invoice.status === 'open' && invoice.creator?.toLowerCase() !== address?.toLowerCase() && (
                          <Button variant="ghost" size="sm" className="text-secondary" onClick={() => navigate(`/pay/${invoice.hash}`)}>Pay</Button>
                        )}
                        <button
                          onClick={() => handleShareLink(invoice.hash)}
                          className="p-2 text-text-muted hover:text-primary transition-colors"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-8 py-16 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <Lock className="w-12 h-12 text-text-dim" />
                        <p className="text-text-muted">No ciphers found</p>
                        <Link to="/app/new-cipher">
                          <Button variant="primary" size="sm">Create your first cipher →</Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
