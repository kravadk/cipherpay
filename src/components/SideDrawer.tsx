import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, ExternalLink, Copy, CheckCircle, Link2 } from 'lucide-react';
import { Invoice } from '../store/useInvoiceStore';
import { StatusBadge, TypeBadge } from './Badge';
import { EncryptedAmount } from './EncryptedAmount';
import { CIPHERPAY_FHE_ADDRESS } from '../config/contract';
import { FHENIX_EXPLORER_URL } from '../config/fhenix';
import { useState } from 'react';
import { useToastStore } from './ToastContainer';

export function SideDrawer({ isOpen, onClose, invoice }: { isOpen: boolean; onClose: () => void; invoice: Invoice | null }) {
  const { addToast } = useToastStore();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    addToast('success', `${field} copied`);
    setTimeout(() => setCopiedField(null), 1500);
  };

  if (!invoice) return null;

  const isAnyone = !invoice.recipient || invoice.recipient === '0x0000000000000000000000000000000000000000';
  const hasMemo = invoice.memo && invoice.memo.trim().length > 0;
  const hasDeadline = invoice.deadline && new Date(invoice.deadline).getTime() > 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[10000] flex justify-end">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="relative w-full max-w-[440px] bg-surface-1 border-l border-border-default h-full overflow-y-auto"
          >
            <div className="p-8">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-xl font-bold text-white">Invoice Details</h2>
                <button onClick={onClose} className="p-2 rounded-full hover:bg-surface-2 text-text-secondary transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Status + Type */}
                <div className="flex items-center gap-3">
                  <StatusBadge status={invoice.status} />
                  <TypeBadge type={invoice.type} />
                </div>

                {/* Invoice Hash */}
                <div className="p-4 bg-surface-2 border border-border-default rounded-2xl space-y-2">
                  <p className="text-xs text-text-muted uppercase tracking-widest">Invoice Hash</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-mono text-white break-all">{invoice.hash.slice(0, 18)}...{invoice.hash.slice(-10)}</p>
                    <button onClick={() => handleCopy(invoice.hash, 'Hash')}
                      className="p-1.5 hover:bg-surface-3 rounded-lg text-text-muted hover:text-primary transition-colors flex-shrink-0">
                      {copiedField === 'Hash' ? <CheckCircle className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Amount */}
                <div className="p-4 bg-surface-2 border border-primary/10 rounded-2xl">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-primary" />
                      <p className="text-sm text-text-secondary">Amount</p>
                    </div>
                    <EncryptedAmount invoiceHash={invoice.hash} amount={invoice.amount} />
                  </div>
                </div>

                {/* Key Info */}
                <div className="bg-surface-2 border border-border-default rounded-2xl p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-text-muted">Recipient</p>
                    <p className="text-xs font-mono text-white">
                      {isAnyone ? 'Anyone' : `${invoice.recipient!.slice(0, 6)}...${invoice.recipient!.slice(-4)}`}
                    </p>
                  </div>
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-text-muted">Created</p>
                    <p className="text-xs text-white">{new Date(invoice.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  {hasDeadline && (
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-text-muted">Deadline</p>
                      <p className="text-xs text-white">{new Date(invoice.deadline!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    </div>
                  )}
                  {hasMemo && (
                    <div className="flex justify-between items-start">
                      <p className="text-xs text-text-muted">Memo</p>
                      <p className="text-xs text-white text-right max-w-[200px]">{invoice.memo}</p>
                    </div>
                  )}
                </div>

                {/* Footer info — block, small */}
                <div className="flex items-center justify-between text-xs text-text-dim px-1">
                  <span>Block #{invoice.blockNumber}</span>
                  <a href={`${FHENIX_EXPLORER_URL}/block/${invoice.blockNumber}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-primary transition-colors">
                    Etherscan <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>

                {/* Actions */}
                <div className="space-y-2 pt-2">
                  <button onClick={() => handleCopy(`${window.location.origin}/pay/${invoice.hash}`, 'Payment Link')}
                    className="w-full flex items-center gap-3 p-3.5 bg-surface-2 border border-border-default rounded-xl hover:border-primary/30 transition-colors text-left group">
                    <Link2 className="w-4 h-4 text-text-muted group-hover:text-primary" />
                    <span className="text-sm text-text-secondary group-hover:text-white">Copy Payment Link</span>
                  </button>
                  <a href={`${FHENIX_EXPLORER_URL}/block/${invoice.blockNumber}`} target="_blank" rel="noopener noreferrer"
                    className="w-full flex items-center gap-3 p-3.5 bg-surface-2 border border-border-default rounded-xl hover:border-primary/30 transition-colors group">
                    <ExternalLink className="w-4 h-4 text-text-muted group-hover:text-primary" />
                    <span className="text-sm text-text-secondary group-hover:text-white">View on Etherscan</span>
                  </a>
                  {invoice.status === 'open' && (
                    <a href={`/pay/${invoice.hash}`}
                      className="w-full flex items-center justify-center gap-2 p-3.5 bg-primary text-black font-bold rounded-xl hover:bg-primary/90 transition-colors">
                      Pay This Invoice →
                    </a>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
