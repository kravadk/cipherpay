import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Wallet, X, CheckCircle, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { useNavigate, useLocation } from 'react-router-dom';
import { useConnect, useAccount, useSwitchChain } from 'wagmi';
import { sepolia } from 'viem/chains';
import { useState, useEffect, useRef } from 'react';

export function WalletModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { connectors, connect, isPending, error } = useConnect();
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const navigate = useNavigate();
  const location = useLocation();
  const [connectError, setConnectError] = useState<string | null>(null);
  const didRedirect = useRef(false);

  const needsSwitch = isConnected && chainId !== sepolia.id;

  // Redirect when connected successfully — but NOT if already on /pay or /profile page
  useEffect(() => {
    if (isOpen && isConnected && !needsSwitch && !didRedirect.current) {
      didRedirect.current = true;
      const isPublicPage = location.pathname.startsWith('/pay') || location.pathname.startsWith('/profile') || location.pathname.startsWith('/claim') || location.pathname.startsWith('/shared');
      setTimeout(() => {
        onClose();
        if (!isPublicPage) {
          navigate('/app/dashboard');
        }
        // If on public page — just close modal, stay on page
      }, 800);
    }
  }, [isConnected, needsSwitch, isOpen]);

  // Reset redirect flag when modal closes
  useEffect(() => {
    if (!isOpen) didRedirect.current = false;
  }, [isOpen]);

  const handleConnect = async (connectorIndex: number) => {
    setConnectError(null);
    const connector = connectors[connectorIndex];
    if (!connector) return;

    try {
      connect(
        { connector, chainId: sepolia.id },
        {
          onError: (err) => {
            setConnectError(err.message?.includes('rejected') ? 'Connection rejected by user' : err.message || 'Connection failed');
          },
        }
      );
    } catch (e: any) {
      setConnectError(e.message || 'Connection failed');
    }
  };

  const handleSwitchNetwork = () => {
    switchChain({ chainId: sepolia.id });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.9, opacity: 0, rotate: 0 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0, opacity: 0, rotate: 15 }}
            transition={{ type: 'spring', damping: 20, stiffness: 150 }}
            className="relative w-full max-w-[400px] bg-surface-1 border border-border-default rounded-[24px] p-8 shadow-2xl overflow-hidden"
          >
            <button
              onClick={onClose}
              className="absolute top-6 right-6 p-2 rounded-full hover:bg-surface-2 text-text-secondary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                <Shield className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Connect to CipherPay</h2>
              <p className="text-text-secondary text-sm">
                Connect your wallet to Ethereum Sepolia to access the privacy protocol.
              </p>
            </div>

            {needsSwitch ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl">
                  <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                  <p className="text-sm text-yellow-200">Wrong network. Please switch to Ethereum Sepolia.</p>
                </div>
                <Button className="w-full" onClick={handleSwitchNetwork}>
                  Switch to Sepolia
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {connectors.map((connector, index) => (
                  <button
                    key={connector.uid}
                    disabled={isPending || isConnected}
                    onClick={() => handleConnect(index)}
                    className="w-full group relative flex items-center justify-between p-4 bg-surface-2 border border-border-default rounded-2xl hover:border-primary/40 hover:bg-surface-3 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center border border-border-default">
                        {connector.name.toLowerCase().includes('metamask') ? (
                          <Wallet className="w-6 h-6 text-secondary" />
                        ) : (
                          <Shield className="w-6 h-6 text-primary" />
                        )}
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-white">{connector.name}</p>
                        <p className="text-xs text-text-muted">Ethereum Sepolia</p>
                      </div>
                    </div>
                    {isPending ? (
                      <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    ) : isConnected ? (
                      <CheckCircle className="w-5 h-5 text-primary" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-primary/20 group-hover:bg-primary transition-colors" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {isPending && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 flex flex-col items-center gap-3"
              >
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      animate={{ opacity: [0.2, 1, 0.2] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                      className="w-1.5 h-1.5 rounded-full bg-primary"
                    />
                  ))}
                </div>
                <p className="text-xs font-mono text-primary uppercase tracking-widest">Approve in wallet...</p>
              </motion.div>
            )}

            {isConnected && !needsSwitch && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-8 flex flex-col items-center gap-3"
              >
                <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-primary" />
                </div>
                <p className="text-xs font-mono text-primary uppercase tracking-widest">✓ Connected Successfully</p>
              </motion.div>
            )}

            {(connectError || error) && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl"
              >
                <p className="text-xs text-red-400">{connectError || error?.message}</p>
              </motion.div>
            )}

            <div className="mt-8 pt-6 border-t border-border-default text-center">
              <p className="text-[10px] text-text-muted uppercase tracking-widest">
                By connecting, you agree to the CipherPay Manifesto.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
