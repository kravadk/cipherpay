import { motion } from 'framer-motion';
import { Shield, CheckCircle, XCircle, AlertTriangle, Lock, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { useContractStatus } from '../hooks/useContractStatus';
import { useAccount } from 'wagmi';
import { WalletModal } from '../components/WalletModal';

type ClaimStatus = 'idle' | 'checking' | 'eligible' | 'not-eligible' | 'coming-soon';

export function Claim() {
  const { hash } = useParams<{ hash: string }>();
  const { isConnected } = useAccount();
  const { isDeployed } = useContractStatus();
  const [claimStatus, setClaimStatus] = useState<ClaimStatus>('idle');
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  // CipherDrop contract not deployed yet — show coming soon
  useEffect(() => {
    if (isConnected) {
      setClaimStatus('coming-soon');
    }
  }, [isConnected]);

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      <div className="px-8 py-6">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center rotate-45">
            <div className="w-3 h-3 bg-black rounded-sm -rotate-45" />
          </div>
          <span className="text-sm font-bold text-white tracking-tight">CipherPay · Private Claim</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-[480px] bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-8"
        >
          <div className="space-y-4">
            <h1 className="text-3xl font-bold text-white">Private Claim</h1>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-text-muted uppercase tracking-widest">Hash</span>
              <span className="text-xs font-mono text-text-secondary">{hash?.slice(0, 12)}...{hash?.slice(-6)}</span>
              <button
                onClick={() => { if (hash) navigator.clipboard.writeText(hash); }}
                className="text-xs text-primary hover:underline"
              >Copy</button>
            </div>
          </div>

          {!isConnected && (
            <div className="space-y-6 text-center py-8">
              <Shield className="w-16 h-16 text-text-dim mx-auto" />
              <p className="text-lg text-text-secondary">Connect wallet to check eligibility</p>
              <Button className="w-full" onClick={() => setIsWalletModalOpen(true)}>Connect Wallet</Button>
            </div>
          )}

          {claimStatus === 'coming-soon' && (
            <div className="space-y-6 text-center py-8">
              <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto" />
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white">CipherDrop — Coming in Wave 2</h2>
                <p className="text-sm text-text-secondary">
                  Merkle-based private distributions will be available after the CipherDrop contract is deployed.
                </p>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      <div className="px-8 py-6 text-center">
        <p className="text-xs text-text-muted uppercase tracking-widest">
          Powered by CoFHE · Privacy by default on Ethereum Sepolia
        </p>
      </div>

      <WalletModal isOpen={isWalletModalOpen} onClose={() => setIsWalletModalOpen(false)} />
    </div>
  );
}
