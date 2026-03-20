import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Globe, ExternalLink, Copy, CheckCircle } from 'lucide-react';
import { Invoice } from '../store/useInvoiceStore';
import { StatusBadge, TypeBadge } from './Badge';
import { Button } from './Button';

export function SideDrawer({ isOpen, onClose, invoice }: { isOpen: boolean; onClose: () => void; invoice: Invoice | null }) {
  if (!invoice) return null;

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
            className="relative w-full max-w-[480px] bg-surface-1 border-l border-border-default h-full overflow-y-auto"
          >
            <div className="p-8">
              <div className="flex justify-between items-center mb-10">
                <h2 className="text-2xl font-bold text-white">Invoice Details</h2>
                <button
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-surface-2 text-text-secondary transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-8">
                {/* Status Section */}
                <div className="flex items-center justify-between p-4 bg-surface-2 border border-border-default rounded-2xl">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={invoice.status} />
                    <TypeBadge type={invoice.type} />
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-text-muted uppercase tracking-widest">Block Height</p>
                    <p className="text-sm font-mono text-white">{invoice.blockNumber}</p>
                  </div>
                </div>

                {/* Public Data */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-text-secondary">
                    <Globe className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">Public Data</span>
                  </div>
                  <div className="bg-surface-2 border border-border-default rounded-2xl p-6 space-y-4">
                    <div className="space-y-1">
                      <p className="text-[10px] text-text-muted uppercase tracking-widest">Invoice Hash</p>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-mono text-white break-all">{invoice.hash}</p>
                        <button className="p-1.5 hover:bg-surface-3 rounded-lg text-text-secondary transition-colors">
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] text-text-muted uppercase tracking-widest">Created At</p>
                      <p className="text-sm text-white">{new Date(invoice.createdAt).toLocaleString('en-US')}</p>
                    </div>
                  </div>
                </div>

                {/* Encrypted Data */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-primary">
                    <Lock className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">Encrypted Data (FHE)</span>
                  </div>
                  <div className="bg-surface-2 border border-border-default rounded-2xl p-6 space-y-4 relative overflow-hidden">
                    <div className="absolute inset-0 bg-primary/[0.02] pointer-events-none" />
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] text-text-muted uppercase tracking-widest">Amount</p>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-white tracking-widest">••••••</span>
                        <Lock className="w-4 h-4 text-text-muted" />
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] text-text-muted uppercase tracking-widest">Recipient</p>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-white tracking-widest">0x••••••••</span>
                        <Lock className="w-4 h-4 text-text-muted" />
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] text-text-muted uppercase tracking-widest">Memo</p>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white tracking-widest">••••••••</span>
                        <Lock className="w-4 h-4 text-text-muted" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-8 space-y-4">
                  <Button variant="primary" className="w-full">
                    <CheckCircle className="w-5 h-5 mr-2" /> Settle Invoice
                  </Button>
                  <Button variant="outline" className="w-full">
                    <ExternalLink className="w-5 h-5 mr-2" /> View on Fhenix Explorer
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
