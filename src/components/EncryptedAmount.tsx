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

export function EncryptedAmount({ invoiceHash, amount: knownAmount, currency = 'ETH', compact = false }: EncryptedAmountProps) {
  const [revealed, setRevealed] = useState(false);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const { isReady, decrypt, createFreshPermit, getFheTypes } = useCofhe();
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
      // Step 1: Get or create permit (EIP-712)
      addToast('info', 'Sign the permit in your wallet...');
      await createFreshPermit(address);

      // Step 2: Get encrypted handle from FHE contract
      const ctHash = await publicClient.readContract({
        address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
        functionName: 'getEncryptedAmount', args: [invoiceHash as `0x${string}`],
      }) as bigint;

      if (!ctHash || ctHash === 0n) {
        // No FHE amount — try Simple contract (plaintext)
        console.log('[Reveal] No FHE ciphertext — reading from Simple contract');
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
      console.log('[Reveal] FHE ciphertext found (handle:', ctHash.toString().slice(0, 15) + '...) — requesting decryption via Threshold Network');
      const FheTypes = getFheTypes();
      const plaintext = await decrypt(ctHash, FheTypes.Uint64);
      console.log('[Reveal] FHE decrypt SUCCESS via Threshold Network');
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

      if (err.message?.includes('User rejected') || err.message?.includes('denied')) {
        addToast('warning', 'Permit signature rejected');
      } else {
        addToast('error', 'Decryption failed — check permissions');
      }
    }
    setIsDecrypting(false);
  }, [revealed, knownAmount, isReady, invoiceHash, publicClient, decrypt, createFreshPermit, getFheTypes, addToast]);

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

      {/* Reveal/Hide button */}
      <button
        onClick={handleReveal}
        disabled={isDecrypting}
        className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-all disabled:opacity-50"
        title={revealed ? 'Hide amount' : 'Reveal amount (requires FHE permit)'}
      >
        {isDecrypting ? (
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        ) : revealed ? (
          <EyeOff className="w-4 h-4" />
        ) : (
          <Eye className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}
