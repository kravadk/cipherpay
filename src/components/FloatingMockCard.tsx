import { motion } from 'framer-motion';
import { Lock, CheckCircle } from 'lucide-react';

export function FloatingMockCard() {
  return (
    <motion.div
      animate={{ y: [0, -12, 0] }}
      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      className="relative w-full max-w-[400px] bg-surface-2 border border-border-default rounded-[32px] p-8 shadow-2xl text-left"
    >
      <div className="flex justify-between items-start mb-8">
        <div className="space-y-1">
          <p className="text-[10px] text-text-muted uppercase tracking-widest">Invoice Hash</p>
          <p className="text-sm font-mono text-white">cx8f...3a2</p>
        </div>
        <div className="px-3 py-1 bg-primary/10 border border-primary/20 rounded-full flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Settled</span>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <span className="text-sm text-text-secondary">Amount</span>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-white tracking-widest">••••••</span>
            <Lock className="w-4 h-4 text-text-muted" />
          </div>
        </div>

        <div className="h-[1px] bg-border-default w-full" />

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-[10px] text-text-muted uppercase tracking-widest">From</p>
            <p className="text-xs font-mono text-text-secondary">0x3f...••••</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] text-text-muted uppercase tracking-widest">To</p>
            <p className="text-xs font-mono text-text-secondary">0x9a...••••</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-[10px] uppercase tracking-widest">
            <span className="text-text-muted">Settlement Progress</span>
            <span className="text-primary font-bold">100%</span>
          </div>
          <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: '100%' }}
              transition={{ duration: 1.5, delay: 0.5 }}
              className="h-full bg-primary"
            />
          </div>
        </div>
      </div>

      <div className="mt-8 flex items-center gap-2 text-[10px] text-text-muted uppercase tracking-widest">
        <CheckCircle className="w-3 h-3 text-primary" />
        <span>Verified on Sepolia · Encrypted</span>
      </div>
    </motion.div>
  );
}
