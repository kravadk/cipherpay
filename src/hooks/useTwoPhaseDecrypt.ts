import { useCallback } from 'react';
import { useCofhe } from './useCofhe';

export interface TwoPhaseResult {
  plaintext: boolean;
  signature: `0x${string}`;
}

/**
 * Shared hook for the two-phase FHE decrypt pattern used across Wave 3–5.
 *
 * Pattern:
 *   1. Contract computes FHE.gte/eq etc. → stores ebool → FHE.allowPublic
 *   2. UI reads the ebool handle via a contract getter (returns uint256)
 *   3. decryptHandle(BigInt(handle)) → { plaintext: bool, signature: bytes }
 *   4. UI calls contract's publishXxx(id, plaintext, signature)
 *
 * Usage:
 *   const { decryptHandle, isDecrypting } = useTwoPhaseDecrypt();
 *   const result = await decryptHandle(BigInt(ctHashFromContract));
 *   await writeContractAsync({ functionName: 'publishProof', args: [id, result.plaintext, result.signature] });
 */
export function useTwoPhaseDecrypt() {
  const { decryptForTx, isReady } = useCofhe();

  const decryptHandle = useCallback(async (ctHandle: bigint): Promise<TwoPhaseResult> => {
    if (!isReady) throw new Error('FHE SDK not ready');
    if (ctHandle === 0n) throw new Error('Invalid handle (zero)');

    // allowPublic handles use withoutPermit — no EIP-712 signature required
    const raw = await decryptForTx(ctHandle, false) as any;

    // The SDK returns { ctHash, decryptedValue, signature }
    // decryptedValue is boolean for ebool; signature is hex string or Uint8Array
    const plaintext = Boolean(raw?.decryptedValue ?? raw?.value ?? false);
    const rawSig = raw?.signature ?? '0x';
    const signature: `0x${string}` = typeof rawSig === 'string'
      ? (rawSig.startsWith('0x') ? rawSig as `0x${string}` : `0x${rawSig}`)
      : (`0x${Array.from(rawSig as Uint8Array, (b: number) => b.toString(16).padStart(2, '0')).join('')}`) as `0x${string}`;

    return { plaintext, signature };
  }, [decryptForTx, isReady]);

  return { decryptHandle, isReady };
}
