import { motion } from 'framer-motion';
import { AppSidebar } from '../components/AppSidebar';
import { Outlet, Navigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { NetworkStrip } from '../components/NetworkStrip';

export function AppLayout() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="relative min-h-screen bg-bg-base flex overflow-hidden">
      <NetworkStrip />
      <div className="noise-overlay pointer-events-none" />
      <AppSidebar />
      <main className="flex-1 h-screen overflow-y-auto pl-60">
        <div className="max-w-7xl mx-auto p-8 md:p-12">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.div>
        </div>
      </main>
    </div>
  );
}
