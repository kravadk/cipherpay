import { motion, AnimatePresence } from 'framer-motion';
import { AppSidebar } from '../components/AppSidebar';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useState, useEffect } from 'react';
import { Menu } from 'lucide-react';

export function AppLayout() {
  const { isConnected } = useAccount();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar + scroll to top on route change
  useEffect(() => {
    setSidebarOpen(false);
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  if (!isConnected) return <Navigate to="/" replace />;

  return (
    <div className="relative min-h-screen bg-bg-base flex overflow-hidden">
      <div className="noise-overlay pointer-events-none" />

      {/* Mobile overlay backdrop */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar — always visible on md+, drawer on mobile */}
      <div className="hidden md:block">
        <AppSidebar />
      </div>

      {/* Mobile sidebar drawer */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="sidebar-mobile"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="fixed left-0 top-0 z-[10001] md:hidden"
          >
            <AppSidebar onClose={() => setSidebarOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main className="flex-1 h-screen overflow-y-auto">
        {/* Mobile top bar */}
        <div className="flex items-center gap-4 px-5 py-4 border-b border-border-default md:hidden sticky top-0 bg-bg-base/90 backdrop-blur-md z-10">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-xl bg-surface-1 border border-border-default text-text-secondary hover:text-primary hover:border-border-active transition-all"
            aria-label="Open menu"
          >
            <Menu className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold text-white">CipherPay</span>
        </div>

        <div className="max-w-6xl mx-auto px-5 py-7 md:px-10 md:py-10">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
