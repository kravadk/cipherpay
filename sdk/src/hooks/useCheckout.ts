/**
 * useCheckout — React hook for paying a CipherPay invoice with an FHE-encrypted amount.
 *
 * Render it inside a wagmi `<WagmiProvider>` (the consuming app supplies the
 * provider; `wagmi` and `viem` are peer dependencies of this SDK):
 *
 * @example
 * import { useCheckout } from 'cipherpay-sdk/react';
 *
 * function PayButton({ invoiceHash }: { invoiceHash: string }) {
 *   const { pay, status, txHash, error } = useCheckout(invoiceHash);
 *   return (
 *     <button onClick={() => pay({ amount: '0.01' })} disabled={status !== 'idle'}>
 *       {status === 'encrypting' ? 'Encrypting…' : 'Pay with CipherPay'}
 *     </button>
 *   );
 * }
 *
 * The hook runs the full FHE payment flow:
 *   1. CoFHE SDK encrypts the amount client-side (TFHE + ZK proof)
 *   2. Contract call — payInvoice / payInvoiceShielded / claimAnonymously
 *   3. Wait for the transaction receipt
 */

import { useState, useCallback, useRef } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import type { CheckoutState, CheckoutStatus, ChargeOptions, ChargeResult } from '../types';

const CIPHERPAY_FHE_ADDRESS = '0x305eF265BD964fBe34913E70Ef6AA8951e6b662e' as const;

const ENCRYPTED_PAYMENT = {
  name: '_encryptedPayment', type: 'tuple', components: [
    { name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' },
    { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' },
  ],
} as const;

const PAY_ABI = [
  { name: 'payInvoice', type: 'function', stateMutability: 'payable',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }, ENCRYPTED_PAYMENT], outputs: [] },
  { name: 'payInvoiceShielded', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }, ENCRYPTED_PAYMENT, { name: '_maxDebit', type: 'uint256' }], outputs: [] },
  { name: 'claimAnonymously', type: 'function', stateMutability: 'payable',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }, ENCRYPTED_PAYMENT, { name: '_nullifier', type: 'bytes32' }], outputs: [] },
] as const;

export function useCheckout(invoiceHash: string): CheckoutState {
  const { address }            = useAccount();
  const publicClient           = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [status, setStatus]     = useState<CheckoutStatus>('idle');
  const [error, setError]       = useState<string | null>(null);
  const [txHash, setTxHash]     = useState<string | null>(null);
  const [blockNumber, setBlock] = useState<bigint | null>(null);

  // The CoFHE client is created+connected once on the first pay() and reused.
  const cofheRef = useRef<any>(null);

  const pay = useCallback(async (opts?: Partial<ChargeOptions>): Promise<ChargeResult> => {
    if (!walletClient || !publicClient || !address) {
      const msg = 'Wallet not connected — render useCheckout inside a wagmi <WagmiProvider> and connect a wallet first.';
      setError(msg);
      setStatus('error');
      throw new Error(msg);
    }

    setStatus('initializing_fhe');
    setError(null);
    setTxHash(null);
    setBlock(null);

    try {
      const amount    = opts?.amount    ?? '0';
      const shielded  = opts?.shielded  ?? false;
      const anonymous = opts?.anonymous ?? false;

      const { Encryptable } = await import('@cofhe/sdk');
      const { parseEther, keccak256, encodePacked } = await import('viem');

      // Lazily create + connect the CoFHE client (TFHE keys + ZK proving).
      if (!cofheRef.current) {
        const { createCofheConfig, createCofheClient } = await import('@cofhe/sdk/web');
        const { sepolia } = await import('@cofhe/sdk/chains');
        const client = createCofheClient(createCofheConfig({
          supportedChains: [sepolia],
          useWorkers: typeof SharedArrayBuffer !== 'undefined',
        }));
        await client.connect(publicClient as any, walletClient as any);
        cofheRef.current = client;
      }
      const cofhe = cofheRef.current;

      setStatus('encrypting');
      const amountWei = parseEther(amount);
      const [enc] = await cofhe
        .encryptInputs([Encryptable.uint64(amountWei)])
        .onStep((step: string) => opts?.onProgress?.(step))
        .execute();

      const encryptedPayment = {
        ctHash:       BigInt(enc.ctHash ?? 0),
        securityZone: enc.securityZone ?? 0,
        utype:        enc.utype ?? 5,
        signature:    enc.signature ?? '0x',
      };

      setStatus('awaiting_signature');
      const functionName = anonymous ? 'claimAnonymously' : shielded ? 'payInvoiceShielded' : 'payInvoice';
      const nullifier = (opts?.nullifier as `0x${string}` | undefined)
        ?? keccak256(encodePacked(['address', 'bytes32'], [address, invoiceHash as `0x${string}`]));

      const args = anonymous
        ? [invoiceHash, encryptedPayment, nullifier]
        : shielded
          ? [invoiceHash, encryptedPayment, amountWei]
          : [invoiceHash, encryptedPayment];

      setStatus('submitting');
      const hash = await walletClient.writeContract({
        address:      CIPHERPAY_FHE_ADDRESS,
        abi:          PAY_ABI,
        functionName,
        args,
        value:        anonymous || shielded ? 0n : amountWei,
        account:      address,
        chain:        walletClient.chain,
      } as any);
      setTxHash(hash);

      setStatus('confirming');
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setBlock(receipt.blockNumber);
      setStatus('success');

      return {
        txHash:      hash,
        invoiceId:   invoiceHash,
        amount,
        shielded,
        anonymous,
        blockNumber: receipt.blockNumber,
      };
    } catch (err: any) {
      const msg = err?.message || 'Payment failed';
      setError(msg);
      setStatus('error');
      throw err;
    }
  }, [invoiceHash, address, publicClient, walletClient]);

  return { status, error, txHash, blockNumber, pay };
}
