import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Preloader() {
  const [isVisible, setIsVisible] = useState(true);
  const text = "CipherPay";

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 0 }}
          exit={{ y: '-100%' }}
          transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
          className="fixed inset-0 z-[10010] bg-bg-base flex flex-col items-center justify-center"
        >
          <div className="relative overflow-hidden">
            <div className="flex gap-1">
              {text.split('').map((char, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.5 }}
                  className="text-4xl md:text-6xl font-bold text-white tracking-tighter"
                >
                  {char}
                </motion.span>
              ))}
            </div>
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ duration: 1.5, delay: 0.5, ease: 'easeInOut' }}
              className="absolute bottom-0 left-0 w-full h-1 bg-primary"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
