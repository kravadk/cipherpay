import { motion, AnimatePresence } from 'framer-motion';
import { Search, ArrowRight, CheckCircle, Clock, XCircle, Shield, Copy, ExternalLink, X, Lock, Eye, Share2 } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { Invoice } from '../../store/useInvoiceStore';
import { MatrixStream } from '../../components/MatrixStream';
import { Button } from '../../components/Button';
import { CipherScramble } from '../../components/CipherScramble';
import { EncryptedAmount } from '../../components/EncryptedAmount';
import { useToastStore } from '../../components/ToastContainer';
import { useContractStatus } from '../../hooks/useContractStatus';
import { FHENIX_EXPLORER_URL } from '../../config/fhenix';
import { useNavigate } from 'react-router-dom';
import { useInvoices } from '../../hooks/useInvoices';
import { useAccount } from 'wagmi';
import { Users } from 'lucide-react';

function InvoiceCard({ invoice, onClick }: { invoice: Invoice; onClick: () => void }) {
  return (
    <motion.div
      whileHover={{ y: -6, borderColor: 'var(--accent-primary)' }}
      onClick={onClick}
      className="bg-surface-1 border border-border-default rounded-2xl p-6 cursor-pointer transition-all duration-300 group"
    >
      <div className="flex justify-between items-start mb-6">
        <div className="space-y-1">
          <p className="text-xs text-text-muted uppercase tracking-widest">Hash</p>
          <CipherScramble
            text={invoice.hash.slice(0, 8) + '...' + invoice.hash.slice(-4)}
            className="text-sm font-mono text-white group-hover:text-primary transition-colors"
          />
        </div>
        <div className={`px-2 py-1 rounded-md border text-xs font-bold uppercase tracking-widest ${
          invoice.status === 'settled'
            ? 'bg-primary/10 border-primary/20 text-primary'
            : invoice.status === 'open'
              ? 'bg-secondary/10 border-secondary/20 text-secondary'
              : invoice.status === 'locked'
                ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500'
                : 'bg-surface-2 border-border-default text-text-muted'
        }`}>
          {invoice.status}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="space-y-1">
          <p className="text-xs text-text-muted uppercase tracking-widest">Type</p>
          <p className="text-xs font-bold text-text-secondary uppercase tracking-widest">{invoice.type}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-text-muted uppercase tracking-widest">Created</p>
          <p className="text-xs text-text-secondary">{new Date(invoice.createdAt).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border-default">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-bold text-text-muted uppercase tracking-widest">Block {invoice.blockNumber}</span>
        </div>
        <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors" />
      </div>
    </motion.div>
  );
}

export function Explorer() {
  const { invoices, isLoading } = useInvoices();
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(['All']));
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const { addToast } = useToastStore();
  const { isDeployed } = useContractStatus();
  const { address } = useAccount();
  const navigate = useNavigate();

  const filterOptions = ['All', 'Standard', 'Multi Pay', 'Recurring', 'Vesting', 'Batch', 'Open', 'Settled'];

  const toggleFilter = (filter: string) => {
    if (filter === 'All') {
      setActiveFilters(new Set(['All']));
    } else {
      const next = new Set(activeFilters);
      next.delete('All');
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      if (next.size === 0) next.add('All');
      setActiveFilters(next);
    }
  };

  const filteredInvoices = useMemo(() => {
    return invoices.filter(invoice => {
      const matchesSearch = search.length < 2 ? true :
        invoice.hash.toLowerCase().includes(search.toLowerCase()) ||
        invoice.id.includes(search);

      if (activeFilters.has('All')) return matchesSearch;

      const typeFilters = [...activeFilters].filter(f => ['Standard', 'Multi Pay', 'Recurring', 'Vesting', 'Batch'].includes(f));
      const statusFilters = [...activeFilters].filter(f => ['Open', 'Settled'].includes(f));

      const matchesType = typeFilters.length === 0 || typeFilters.some(f =>
        invoice.type === f.toLowerCase().replace(' ', '-')
      );
      const matchesStatus = statusFilters.length === 0 || statusFilters.some(f =>
        invoice.status === f.toLowerCase()
      );

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [invoices, search, activeFilters]);

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    addToast('success', 'Hash copied');
  };

  return (
    <div className="relative min-h-screen">
      <MatrixStream />

      <div className="relative z-10 space-y-12">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-white tracking-tight">Explorer</h1>
          <p className="text-text-secondary">Public invoice ledger — encrypted content, verifiable state</p>
        </div>

        {/* Search + Filters */}
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
            <input
              type="text"
              placeholder="Search by invoice hash or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-14 pl-12 pr-4 bg-surface-1 border border-border-default rounded-2xl text-white placeholder:text-text-muted focus:border-primary/40 focus:outline-none transition-colors"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 no-scrollbar">
            {filterOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => toggleFilter(opt)}
                className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all duration-300 whitespace-nowrap ${
                  activeFilters.has(opt)
                    ? 'bg-primary text-black'
                    : 'bg-surface-1 text-text-secondary border border-border-default hover:border-primary/40'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence mode="popLayout">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-48 bg-surface-1 rounded-2xl border border-border-default animate-pulse" />
              ))
            ) : filteredInvoices.length > 0 ? (
              filteredInvoices.map((invoice) => (
                <InvoiceCard
                  key={invoice.id}
                  invoice={invoice}
                  onClick={() => setSelectedInvoice(invoice)}
                />
              ))
            ) : (
              <div className="col-span-full py-12 text-center text-text-muted bg-surface-1 rounded-2xl border border-border-default">
                <div className="flex flex-col items-center justify-center">
                  <Search className="w-12 h-12 mb-4 opacity-20" />
                  <p className="text-lg font-bold">No results found</p>
                  <p className="text-sm">Try adjusting your search or filters</p>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Side Drawer */}
      <AnimatePresence>
        {selectedInvoice && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedInvoice(null)}
              className="fixed inset-0 z-[10010] bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 z-[10011] w-full max-w-[400px] h-full bg-surface-1 border-l border-border-default p-8 shadow-2xl overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-12">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                    <Shield className="w-6 h-6 text-primary" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">Invoice Details</h2>
                </div>
                <button onClick={() => setSelectedInvoice(null)} className="p-2 rounded-full hover:bg-surface-2 text-text-secondary transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-10">
                {/* Hash + Status */}
                <div className="p-6 bg-surface-2 border border-border-default rounded-3xl space-y-6">
                  <div className="space-y-1">
                    <p className="text-xs text-text-muted uppercase tracking-widest">Invoice Hash</p>
                    <div className="flex items-center justify-between group">
                      <p className="text-sm font-mono text-white break-all">{selectedInvoice.hash}</p>
                      <button onClick={() => handleCopyHash(selectedInvoice.hash)} className="p-2 text-text-muted hover:text-primary transition-colors">
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <p className="text-xs text-text-muted uppercase tracking-widest">Status</p>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${
                          selectedInvoice.status === 'settled' ? 'bg-primary' :
                          selectedInvoice.status === 'open' ? 'bg-secondary' :
                          selectedInvoice.status === 'locked' ? 'bg-yellow-500' : 'bg-text-muted'
                        }`} />
                        <span className="text-sm font-bold text-white uppercase tracking-widest">{selectedInvoice.status}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-text-muted uppercase tracking-widest">Type</p>
                      <span className="text-sm font-bold text-white uppercase tracking-widest">{selectedInvoice.type}</span>
                    </div>
                  </div>
                </div>

                {/* Multi-Pay Progress (if applicable) */}
                {selectedInvoice.type === 'multi-pay' && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-secondary">
                      <Users className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-widest">Collection Progress</span>
                    </div>
                    <div className="p-5 bg-surface-2 border border-border-default rounded-2xl space-y-4">
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-2xl font-bold text-white">
                            {selectedInvoice.totalCollected || '0'} <span className="text-sm text-text-muted">/ {selectedInvoice.targetAmount || selectedInvoice.amount} ETH</span>
                          </p>
                        </div>
                        <span className="text-sm font-bold text-primary">{Math.round(selectedInvoice.collectedPercent || 0)}%</span>
                      </div>
                      <div className="w-full h-2 bg-surface-1 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${selectedInvoice.collectedPercent || 0}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-text-muted">
                        <span>{selectedInvoice.payerCount || 0} payer{(selectedInvoice.payerCount || 0) !== 1 ? 's' : ''}</span>
                        <span>{(selectedInvoice.collectedPercent || 0) >= 100 ? 'Fully funded' : 'Collecting...'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Encrypted Data */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2 text-secondary">
                    <Lock className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">Encrypted Data (FHE Protected)</span>
                  </div>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center p-4 bg-surface-2 border border-border-default rounded-2xl">
                      <span className="text-sm text-text-secondary">Amount</span>
                      <div className="flex items-center gap-2">
                        <EncryptedAmount amount={selectedInvoice.amount} />
                      </div>
                    </div>
                    <div className="flex justify-between items-center p-4 bg-surface-2 border border-border-default rounded-2xl">
                      <span className="text-sm text-text-secondary">Recipient</span>
                      <span className="text-sm font-mono text-white">{selectedInvoice.recipient}</span>
                    </div>
                    {selectedInvoice.memo && (
                      <div className="flex justify-between items-center p-4 bg-surface-2 border border-border-default rounded-2xl">
                        <span className="text-sm text-text-secondary">Memo</span>
                        <span className="text-sm text-white">{selectedInvoice.memo}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Public data */}
                <div className="pt-8 border-t border-border-default space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Block Number</span>
                    <span className="text-white font-mono">{selectedInvoice.blockNumber}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Timestamp</span>
                    <span className="text-white">{new Date(selectedInvoice.createdAt).toLocaleString('en-US')}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Deadline</span>
                    <span className="text-white">{selectedInvoice.deadline ? new Date(selectedInvoice.deadline).toLocaleDateString('en-US') : 'No deadline'}</span>
                  </div>
                  {selectedInvoice.type === 'vesting' && selectedInvoice.unlockHeight && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-text-muted">Unlock Block</span>
                        <span className="text-white font-mono">{selectedInvoice.unlockHeight}</span>
                      </div>
                    </div>
                  )}
                  {selectedInvoice.type === 'batch' && selectedInvoice.recipientCount && (
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">Recipients</span>
                      <span className="text-white">{selectedInvoice.recipientCount}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-3">
                  <Button variant="ghost" size="sm" className="w-full gap-2" onClick={() => handleCopyHash(selectedInvoice.hash)}>
                    <Copy className="w-4 h-4" /> Copy Hash
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full gap-2" onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/pay/${selectedInvoice.hash}`);
                    addToast('success', 'Payment link copied');
                  }}>
                    <Share2 className="w-4 h-4" /> Copy Payment Link
                  </Button>
                  <a href={`${FHENIX_EXPLORER_URL}/block/${selectedInvoice.blockNumber}`} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="sm" className="w-full gap-2">
                      <ExternalLink className="w-4 h-4" /> View on Etherscan
                    </Button>
                  </a>
                  {/* Pay — only if open AND not creator */}
                  {selectedInvoice.status === 'open' && address && selectedInvoice.creator?.toLowerCase() !== address.toLowerCase() && (
                    <Button variant="primary" className="w-full gap-2" onClick={() => navigate(`/pay/${selectedInvoice.hash}`)}>
                      Pay This Invoice <ArrowRight className="w-4 h-4" />
                    </Button>
                  )}
                  {/* Settle — only for multi-pay creator */}
                  {selectedInvoice.status === 'open' && selectedInvoice.type === 'multi-pay' && address && selectedInvoice.creator?.toLowerCase() === address.toLowerCase() && (
                    <Button variant="primary" className="w-full gap-2" onClick={() => navigate(`/pay/${selectedInvoice.hash}`)}>
                      <CheckCircle className="w-4 h-4" /> Settle Invoice
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
