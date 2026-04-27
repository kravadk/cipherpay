import { motion } from 'framer-motion';
import { Shield, Gift, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { useAccount } from 'wagmi';
import { WalletModal } from '../components/WalletModal';

export function Claim() {
  const { hash } = useParams<{ hash: string }>();
  const { isConnected } = useAccount();
  const navigate = useNavigate();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  const handleClaim = () => {
    // Forward to CipherDrop claim tab with the drop ID pre-filled
    navigate(`/app/cipher-drop?dropId=${hash}`);
  };

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
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Gift className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Private Claim</h1>
                <p className="text-xs text-text-muted uppercase tracking-widest">CipherDrop · FHE-gated airdrop</p>
              </div>
            </div>
            {hash && (
              <div className="flex items-center gap-3 p-3 bg-surface-2 rounded-xl border border-border-default">
                <span className="text-xs font-bold text-text-muted uppercase tracking-widest shrink-0">Drop ID</span>
                <span className="text-xs font-mono text-text-secondary truncate">{hash.slice(0, 18)}...{hash.slice(-6)}</span>
                <button
                  onClick={() => { if (hash) { navigator.clipboard.writeText(hash); } }}
                  className="text-xs text-primary hover:underline shrink-0"
                >Copy</button>
              </div>
            )}
          </div>

          <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl space-y-2">
            <p className="text-xs font-bold text-primary uppercase tracking-widest">How eligibility works</p>
            <p className="text-xs text-text-secondary leading-relaxed">
              Your wallet balance is encrypted with FHE and compared against the drop threshold on-chain.
              The contract never sees your actual balance — only whether you qualify.
            </p>
            <div className="flex flex-col gap-1 text-[11px] text-text-muted pt-1">
              <span>✓ Balance checked via <span className="font-mono text-primary">FHE.gte(balance, threshold)</span></span>
              <span>✓ Nullifier prevents double-claim</span>
              <span>✓ Ineligible wallets receive zero silently</span>
            </div>
          </div>

          {!isConnected ? (
            <div className="space-y-4 text-center">
              <Shield className="w-12 h-12 text-text-dim mx-auto" />
              <p className="text-sm text-text-secondary">Connect your wallet to check eligibility and claim</p>
              <Button className="w-full" onClick={() => setIsWalletModalOpen(true)}>Connect Wallet</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Button className="w-full gap-2" onClick={handleClaim}>
                <Gift className="w-4 h-4" />
                Check Eligibility & Claim
              </Button>
              <button
                onClick={() => navigate('/app/cipher-drop')}
                className="w-full flex items-center justify-center gap-2 py-2 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Open CipherDrop dashboard
              </button>
            </div>
          )}
        </motion.div>
      </div>

      <div className="px-8 py-6 text-center">
        <p className="text-xs text-text-muted uppercase tracking-widest">
          Powered by Fhenix CoFHE · Privacy by default on Ethereum Sepolia
        </p>
      </div>

      <WalletModal isOpen={isWalletModalOpen} onClose={() => setIsWalletModalOpen(false)} />
    </div>
  );
}
