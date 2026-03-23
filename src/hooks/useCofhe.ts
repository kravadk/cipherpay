import { useEffect, useState, useCallback, useRef } from 'react';
import { useWalletClient, usePublicClient } from 'wagmi';

/**
 * Hook to interact with CofheClient from @cofhe/sdk.
 * Initializes with real wagmi wallet/public clients on Ethereum Sepolia.
 */
export function useCofhe() {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [isReady, setIsReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<any>(null);
  const sdkRef = useRef<any>(null);

  const retryCountRef = useRef(0);
  const maxRetries = 3;

  const initCofhe = useCallback(async (wc: any, pc: any, cancelled: { value: boolean }) => {
    setIsConnecting(true);
    setError(null);

    try {
      const webSdk = await import('@cofhe/sdk/web');
      const coreSdk = await import('@cofhe/sdk');

      sdkRef.current = coreSdk;

      const { createCofheConfig, createCofheClient } = webSdk;

      const { sepolia: sepoliaChain } = await import('@cofhe/sdk/chains');

      const config = createCofheConfig({
        supportedChains: [sepoliaChain],
        useWorkers: typeof SharedArrayBuffer !== 'undefined',
      });

      const client = createCofheClient(config);

      // connect(publicClient, walletClient) — wagmi clients are already viem-compatible
      await client.connect(pc as any, wc as any);

      if (!cancelled.value) {
        clientRef.current = client;
        retryCountRef.current = 0;
        setIsReady(true);
        setIsConnecting(false);
      }
    } catch (err: any) {
      if (!cancelled.value) {
        console.warn(`[CipherPay] CoFHE SDK init failed (attempt ${retryCountRef.current + 1}/${maxRetries}):`, err);
        retryCountRef.current++;
        if (retryCountRef.current < maxRetries) {
          setTimeout(() => {
            if (!cancelled.value) initCofhe(wc, pc, cancelled);
          }, 2000 * retryCountRef.current);
        } else {
          setError(err.message || 'FHE SDK init failed');
          setIsReady(false);
          setIsConnecting(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!walletClient || !publicClient) return;
    const cancelled = { value: false };
    retryCountRef.current = 0;
    initCofhe(walletClient, publicClient, cancelled);
    return () => { cancelled.value = true; };
  }, [walletClient, publicClient, initCofhe]);

  const encrypt = useCallback(async (encryptables: any[], onStep?: (step: string, ctx?: any) => void) => {
    if (!clientRef.current) throw new Error('CofheClient not initialized');
    let builder = clientRef.current.encryptInputs(encryptables);
    if (onStep) {
      builder = builder.onStep(onStep);
    }
    return builder.execute();
  }, []);

  const decrypt = useCallback(async (ctHash: bigint, fheType: any) => {
    if (!clientRef.current) throw new Error('CofheClient not initialized');
    return clientRef.current.decryptForView(ctHash, fheType).withPermit().execute();
  }, []);

  const getOrCreateSelfPermit = useCallback(async () => {
    if (!clientRef.current) throw new Error('CofheClient not initialized');
    return clientRef.current.permits.getOrCreateSelfPermit();
  }, []);

  const removeActivePermit = useCallback(async () => {
    if (!clientRef.current) throw new Error('CofheClient not initialized');
    return clientRef.current.permits.removeActivePermit();
  }, []);

  // Force create a new permit (always triggers MetaMask popup)
  const createFreshPermit = useCallback(async (issuerAddress?: string) => {
    if (!clientRef.current) throw new Error('CofheClient not initialized');
    // Try getOrCreate first (uses cached permit if valid)
    // If that fails, create fresh with issuer
    try {
      return await clientRef.current.permits.getOrCreateSelfPermit();
    } catch {
      if (issuerAddress) {
        return clientRef.current.permits.createSelf({ issuer: issuerAddress, name: 'CipherPay Reveal' });
      }
      throw new Error('No issuer address for permit');
    }
  }, []);

  // Expose Encryptable and FheTypes for consumers
  const getEncryptable = useCallback(() => sdkRef.current?.Encryptable, []);
  const getFheTypes = useCallback(() => sdkRef.current?.FheTypes, []);

  return {
    cofheClient: clientRef.current,
    isReady,
    isConnecting,
    error,
    encrypt,
    decrypt,
    getOrCreateSelfPermit,
    removeActivePermit,
    createFreshPermit,
    getEncryptable,
    getFheTypes,
  };
}
