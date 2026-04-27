import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useCofhe } from '../hooks/useCofhe';
import { useToastStore } from './ToastContainer';
import { CIPHERPAY_ADDRESS, CIPHERPAY_ABI, CIPHERPAY_SIMPLE_ADDRESS } from '../config/contract';
import { usePublicClient } from 'wagmi';
import { formatEther } from 'viem';
import { useAccount } from 'wagmi';

interface EncryptedAmountProps {
  invoiceHash?: string;
  amount?: string; // if already known (Simple contract)
  currency?: string;
  compact?: boolean; // smaller size for tables
}

type PermitState = 'idle' | 'missing' | 'expired' | 'rejected' | 'ok';

const PERMIT_EXPLAINER_KEY = 'cipherpay:permitExplainerSeen';

export function EncryptedAmount({ invoiceHash, amount: knownAmount, currency = 'ETH', compact = false }: EncryptedAmountProps) {
  const [revealed, setRevealed] = useState(false);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [permitState, setPermitState] = useState<PermitState>('idle');
  const [showExplainer, setShowExplainer] = useState(false);
  const { isReady, decrypt, createFreshPermit, getFheTypes, cofheClient } = useCofhe();
  const { addToast } = useToastStore();
  const { address } = useAccount();
  const publicClient = usePublicClient();

  const handleReveal = useCallback(async () => {
    if (revealed) {
      // Hide
      setRevealed(false);
      setRevealedValue(null);
      return;
    }

    // First time? Show the inline explainer before triggering MetaMask.
    // The explainer's "Continue" button re-calls handleReveal with the
    // explainer dismissed.
    try {
      if (typeof window !== 'undefined' && !window.localStorage.getItem(PERMIT_EXPLAINER_KEY)) {
        setShowExplainer(true);
        return;
      }
    } catch {}

    // If we already know the amount (Simple contract fallback)
    if (knownAmount && parseFloat(knownAmount) > 0) {
      setRevealedValue(knownAmount);
      setRevealed(true);
      return;
    }

    // Try FHE decryption
    if (!isReady || !invoiceHash || !publicClient) {
      // Fallback: try reading from Simple contract
      try {
        const simpleAbi = [{ name: 'getInvoiceAmount', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] }] as const;
        const amountRaw = await publicClient!.readContract({
          address: CIPHERPAY_SIMPLE_ADDRESS, abi: simpleAbi as any,
          functionName: 'getInvoiceAmount', args: [invoiceHash as `0x${string}`],
        }) as bigint;
        if (amountRaw > 0n) {
          setRevealedValue(formatEther(amountRaw));
          setRevealed(true);
          return;
        }
      } catch {}
      addToast('info', 'FHE SDK not ready — cannot decrypt');
      return;
    }

    setIsDecrypting(true);
    try {
      // Step 1: Inspect existing permit before triggering a wallet popup,
      // so we can give the user an explicit reason if it's missing/expired.
      let existingPermit: any = null;
      try {
        existingPermit = cofheClient?.permits?.getActivePermit?.() ?? null;
      } catch { existingPermit = null; }

      if (!existingPermit) {
        setPermitState('missing');
        addToast('info', 'No permit found — sign one in your wallet to decrypt');
      } else {
        const expiresAt = Number(existingPermit.expiration ?? existingPermit.expiresAt ?? 0);
        if (expiresAt && expiresAt * 1000 < Date.now()) {
          setPermitState('expired');
          addToast('warning', 'Permit expired — re-sign in your wallet');
        } else {
          setPermitState('ok');
        }
      }

      try {
        await createFreshPermit(address);
        setPermitState('ok');
      } catch (permitErr: any) {
        const m = (permitErr?.message || '').toLowerCase();
        if (m.includes('reject') || m.includes('denied') || permitErr?.code === 4001) {
          setPermitState('rejected');
          addToast('warning', 'Permit signature rejected — reveal cancelled');
        } else if (m.includes('expired')) {
          setPermitState('expired');
          addToast('warning', 'Permit expired — please re-sign');
        } else {
          setPermitState('missing');
          addToast('error', `Permit creation failed: ${permitErr?.message?.slice(0, 80) || 'unknown'}`);
        }
        setIsDecrypting(false);
        return;
      }

      // Step 2: Get encrypted handle from FHE contract
      const ctHash = await publicClient.readContract({
        address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
        functionName: 'getEncryptedAmount', args: [invoiceHash as `0x${string}`],
      }) as bigint;

      if (!ctHash || ctHash === 0n) {
        // No FHE amount — try Simple contract (plaintext)
        const simpleAbi = [{ name: 'getInvoiceAmount', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] }] as const;
        const amountRaw = await publicClient.readContract({
          address: CIPHERPAY_SIMPLE_ADDRESS, abi: simpleAbi as any,
          functionName: 'getInvoiceAmount', args: [invoiceHash as `0x${string}`],
        }) as bigint;
        setRevealedValue(formatEther(amountRaw));
        setRevealed(true);
        setIsDecrypting(false);
        addToast('success', 'Amount revealed (Simple contract)');
        return;
      }

      // Step 3: Decrypt via CoFHE Threshold Network
      const FheTypes = getFheTypes();
      const plaintext = await decrypt(ctHash, FheTypes.Uint64);
      setRevealedValue(formatEther(BigInt(plaintext)));
      setRevealed(true);
      addToast('success', 'Amount decrypted via FHE Threshold Network');
    } catch (err: any) {
      console.warn('[Reveal] FHE decrypt failed, falling back to Simple:', err.message);
      // Fallback: try Simple contract
      try {
        const simpleAbi = [{ name: 'getInvoiceAmount', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] }] as const;
        const amountRaw = await publicClient!.readContract({
          address: CIPHERPAY_SIMPLE_ADDRESS, abi: simpleAbi as any,
          functionName: 'getInvoiceAmount', args: [invoiceHash as `0x${string}`],
        }) as bigint;
        if (amountRaw > 0n) {
          setRevealedValue(formatEther(amountRaw));
          setRevealed(true);
          setIsDecrypting(false);
          return;
        }
      } catch {}

      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('user rejected') || msg.includes('denied') || err?.code === 4001) {
        setPermitState('rejected');
        addToast('warning', 'Permit signature rejected');
      } else if (msg.includes('permitexpired') || msg.includes('expired')) {
        setPermitState('expired');
        addToast('warning', 'Permit expired — click reveal again to re-sign');
      } else if (msg.includes('permitnotfound') || msg.includes('no active permit') || msg.includes('missing permit')) {
        setPermitState('missing');
        addToast('warning', 'No active permit — click reveal again to sign');
      } else {
        addToast('error', 'Decryption failed — check permissions');
      }
    }
    setIsDecrypting(false);
  }, [revealed, knownAmount, isReady, invoiceHash, publicClient, decrypt, createFreshPermit, getFheTypes, addToast, cofheClient, address]);

  const textSize = compact ? 'text-sm' : 'text-lg';

  return (
    <div className="inline-flex items-center gap-2 group">
      <div className="relative overflow-hidden flex items-center">
        <AnimatePresence mode="wait">
          {!revealed ? (
            <motion.div
              key="hidden"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-1.5"
            >
              <span className={`${textSize} font-bold tracking-widest text-text-muted`}>••••••</span>
              {isDecrypting && <div className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
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
              {(revealedValue || '0').split('').map((char, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={`${textSize} font-bold text-white`}
                >
                  {char}
                </motion.span>
              ))}
              <span className="text-sm text-text-muted ml-1">{currency}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Permit-state hint (shows when last reveal needs a re-sign) */}
      {!revealed && permitState !== 'idle' && permitState !== 'ok' && (
        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
            permitState === 'expired' ? 'text-amber-400 bg-amber-500/10' :
            permitState === 'missing' ? 'text-blue-400 bg-blue-500/10' :
            'text-red-400 bg-red-500/10'
          }`}
          title={
            permitState === 'expired' ? 'Your decrypt permit has expired — click the eye to re-sign' :
            permitState === 'missing' ? 'No active decrypt permit — click the eye to sign one' :
            'Permit signature was rejected — click the eye to retry'
          }
        >
          {permitState === 'expired' ? 'Permit expired' : permitState === 'missing' ? 'Sign permit' : 'Sign rejected'}
        </span>
      )}

      {/* Reveal/Hide button */}
      <button
        onClick={handleReveal}
        disabled={isDecrypting}
        className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-all disabled:opacity-50"
        title={
          revealed ? 'Hide amount' :
          permitState === 'expired' ? 'Re-sign expired permit and reveal' :
          permitState === 'missing' ? 'Sign decrypt permit and reveal' :
          'Reveal amount (requires FHE permit)'
        }
      >
        {isDecrypting ? (
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        ) : revealed ? (
          <EyeOff className="w-4 h-4" />
        ) : (
          <Eye className="w-4 h-4" />
        )}
      </button>

      {/* First-time permit explainer — shown once per browser, before the
          first MetaMask popup, to explain WHY a signature is needed. */}
      {showExplainer && (
        <div
          className="fixed inset-0 z-[10002] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowExplainer(false)}
        >
          <div
            className="max-w-md w-full bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider">FHE permit</span>
              <h3 className="text-base font-bold text-white">One-time signature</h3>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">
              CipherPay is about to ask your wallet to sign a permit. This is a free,
              gas-less EIP-712 signature — <strong className="text-white">not a transaction</strong>.
            </p>
            <div className="bg-bg-base border border-border-default rounded-lg p-3 space-y-2 text-xs text-text-secondary">
              <div className="flex gap-2"><span className="text-primary">•</span><span>The permit lets <strong className="text-white">only you</strong> decrypt this amount via the FHE Threshold Network.</span></div>
              <div className="flex gap-2"><span className="text-primary">•</span><span>The smart contract still doesn't know the plaintext value — it stays encrypted on-chain.</span></div>
              <div className="flex gap-2"><span className="text-primary">•</span><span>The permit expires automatically and is revocable anytime in Settings.</span></div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowExplainer(false)}
                className="flex-1 py-2.5 rounded-xl bg-surface-2 text-text-secondary text-sm font-bold hover:bg-surface-3 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  try { window.localStorage.setItem(PERMIT_EXPLAINER_KEY, '1'); } catch {}
                  setShowExplainer(false);
                  // Re-trigger reveal — now the localStorage flag is set so it skips the modal
                  setTimeout(() => handleReveal(), 50);
                }}
                className="flex-1 py-2.5 rounded-xl bg-primary text-black text-sm font-bold hover:opacity-90 transition-opacity"
              >
                Continue & sign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
