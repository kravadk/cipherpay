import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Lock, Shield } from 'lucide-react';
import { useInvoiceStore } from '../store/useInvoiceStore';

export function EncryptedAmount({ amount, currency = 'ETH' }: { amount: string; currency?: string }) {
  const { revealAmounts } = useInvoiceStore();

  return (
    <div className="inline-flex items-center gap-2 group">
      <div className="relative overflow-hidden flex items-center">
        <AnimatePresence mode="wait">
          {!revealAmounts ? (
            <motion.div
              key="hidden"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-1.5"
            >
              <span className="text-lg font-bold tracking-widest text-text-muted">••••••</span>
              <span className="text-[8px] font-bold text-blue-500/60 bg-blue-500/10 px-1 py-0.5 rounded uppercase tracking-wider">FHE</span>
            </motion.div>
          ) : (
            <motion.div
              key="revealed"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-1"
            >
              {amount.split('').map((char, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="text-lg font-bold text-white"
                >
                  {char}
                </motion.span>
              ))}
              <span className="text-sm text-text-muted ml-1">{currency}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
