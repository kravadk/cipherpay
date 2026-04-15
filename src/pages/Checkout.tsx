import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAccount, useConnect, useWriteContract, usePublicClient } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { Lock, Eye, Check, X, Loader2 } from 'lucide-react';
import { CIPHERPAY_ADDRESS, CIPHERPAY_ABI } from '../config/contract';
import { useCofhe } from '../hooks/useCofhe';

/**
 * Encrypted Checkout — minimal-chrome payment widget designed to be embedded
 * via iframe by third-party merchants. The merchant only needs to drop
 * `<script src="/cipherpay.js" data-invoice="0x...">` on their page.
 *
 * Privacy properties surfaced to the embedding merchant:
 *  - the iframe is sandboxed; the parent page never sees the payer address
 *  - the payment uses the shielded path (msg.value == 0) when the payer has
 *    a prefunded shielded balance, otherwise falls back to plain payInvoice
 *  - the merchant receives a `cipherpay:paid` postMessage with the tx hash,
 *    nothing else — no payer identity, no plaintext amount
 */
export function Checkout() {
  const { hash } = useParams<{ hash: string }>();
  const [params] = useSearchParams();
  const merchantOrigin = params.get('origin') || '*';

  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { isReady: fheReady, encrypt, getEncryptable } = useCofhe();

  const [status, setStatus] = useState<'idle' | 'paying' | 'success' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [shieldedBal, setShieldedBal] = useState<bigint>(0n);
  const [bucket, setBucket] = useState<string>('0.01');

  // Read the payer's shielded balance to decide between shielded and plain path
  useEffect(() => {
    if (!address || !publicClient) return;
    publicClient.readContract({
      address: CIPHERPAY_ADDRESS,
      abi: CIPHERPAY_ABI as any,
      functionName: 'shieldedBalance',
      args: [address],
    }).then((b: any) => setShieldedBal(BigInt(b))).catch(() => setShieldedBal(0n));
  }, [address, publicClient, status]);

  const handlePay = useCallback(async () => {
    if (!address || !hash || !publicClient) return;
    setStatus('paying');
    setErrMsg(null);
    try {
      if (!fheReady) throw new Error('FHE not ready — wait a moment');
      const Encryptable = getEncryptable();
      if (!Encryptable) throw new Error('Encryption unavailable');

      const bucketWei = parseEther(bucket);
      const useShielded = shieldedBal >= bucketWei;

      // Encrypt the bucket as the "payment" handle (the contract clamps to remaining)
      const [enc] = await encrypt([Encryptable.uint64(bucketWei)]);
      const encTuple = {
        ctHash: BigInt(enc.ctHash || enc.data?.ctHash || 0),
        securityZone: enc.securityZone ?? enc.data?.securityZone ?? 0,
        utype: enc.utype ?? enc.data?.utype ?? 5,
        signature: enc.signature ?? enc.data?.signature ?? '0x',
      };

      let tx: `0x${string}`;
      if (useShielded) {
        tx = await writeContractAsync({
          address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
          functionName: 'payInvoiceShielded',
          args: [hash as `0x${string}`, encTuple, bucketWei],
        } as any);
      } else {
        tx = await writeContractAsync({
          address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
          functionName: 'payInvoice',
          args: [hash as `0x${string}`, encTuple],
          value: bucketWei,
        } as any);
      }

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === 'reverted') throw new Error('Transaction reverted');

      setTxHash(tx);
      setStatus('success');

      // Notify the embedding merchant page — no payer identity, no amount.
      try {
        window.parent?.postMessage(
          { type: 'cipherpay:paid', tx, invoice: hash },
          merchantOrigin
        );
      } catch {}
    } catch (e: any) {
      setErrMsg(e?.shortMessage || e?.message || 'Payment failed');
      setStatus('error');
      try {
        window.parent?.postMessage({ type: 'cipherpay:error', error: e?.message || 'failed' }, merchantOrigin);
      } catch {}
    }
  }, [address, hash, publicClient, fheReady, encrypt, getEncryptable, writeContractAsync, bucket, shieldedBal, merchantOrigin]);

  return (
    <div className="min-h-screen bg-bg-base text-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface-1 border border-border-default rounded-2xl p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold tracking-tight">CipherPay Checkout</span>
          </div>
          <span className="text-[9px] font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider">FHE</span>
        </div>

        {/* Encrypted amount placeholder */}
        <div className="bg-bg-base border border-border-default rounded-xl p-4 text-center space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-text-muted">Amount</div>
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl font-bold tracking-widest text-text-muted">••••••</span>
            <Eye className="w-4 h-4 text-text-muted opacity-50" />
          </div>
          <div className="text-[10px] text-text-muted">encrypted on-chain · only the merchant can reveal</div>
        </div>

        {/* Bucket selector */}
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest text-text-muted">Pay bucket</div>
          <div className="flex gap-1.5">
            {['0.001', '0.01', '0.1'].map(b => (
              <button
                key={b}
                onClick={() => setBucket(b)}
                disabled={status === 'paying'}
                className={`flex-1 px-2 py-2 rounded-lg text-xs font-bold border transition-colors ${
                  bucket === b
                    ? 'bg-primary text-black border-primary'
                    : 'bg-surface-2 text-text-secondary border-border-default hover:border-primary/50'
                }`}
              >
                {b} ETH
              </button>
            ))}
          </div>
          <div className="text-[9px] text-text-muted">
            {shieldedBal >= parseEther(bucket)
              ? `Shielded balance: ${formatEther(shieldedBal)} ETH — msg.value will be 0`
              : 'Plain ETH path — top up shielded balance for full privacy'}
          </div>
        </div>

        {/* Action */}
        {!isConnected ? (
          <button
            onClick={() => connect({ connector: connectors[0] })}
            className="w-full py-3 rounded-xl bg-primary text-black font-bold text-sm hover:opacity-90 transition-opacity"
          >
            Connect Wallet
          </button>
        ) : status === 'success' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-primary/10 text-primary text-sm font-bold">
              <Check className="w-4 h-4" /> Payment confirmed
            </div>
            {txHash && (
              <a
                href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank" rel="noreferrer"
                className="block text-center text-[10px] text-text-muted hover:text-primary"
              >
                {txHash.slice(0, 14)}…
              </a>
            )}
          </div>
        ) : (
          <button
            onClick={handlePay}
            disabled={status === 'paying' || !fheReady}
            className="w-full py-3 rounded-xl bg-primary text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {status === 'paying' ? <><Loader2 className="w-4 h-4 animate-spin" /> Encrypting & paying…</> : 'Pay encrypted'}
          </button>
        )}

        {status === 'error' && errMsg && (
          <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/10 text-red-400 text-[10px]">
            <X className="w-3 h-3 mt-0.5 shrink-0" /> <span>{errMsg}</span>
          </div>
        )}

        <div className="text-[9px] text-text-muted text-center pt-2 border-t border-border-default">
          Powered by <span className="text-primary font-bold">CipherPay</span> · invoice {hash?.slice(0, 10)}…
        </div>
      </div>
    </div>
  );
}
