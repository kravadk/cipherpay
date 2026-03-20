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

  useEffect(() => {
    if (!walletClient || !publicClient) return;
    let cancelled = false;

    async function initCofhe() {
      setIsConnecting(true);
      setError(null);

      try {
        // Import SDK modules
        const webSdk = await import('@cofhe/sdk/web');
        const coreSdk = await import('@cofhe/sdk');
        const adaptersMod = await import('@cofhe/sdk/adapters');

        sdkRef.current = coreSdk;

        const { createCofheConfig, createCofheClient } = webSdk;
        // Handle both ESM default and named exports
        const WagmiAdapter = adaptersMod.WagmiAdapter || (adaptersMod as any).default?.WagmiAdapter;

        // Create config with Sepolia
        const config = createCofheConfig({
          supportedChains: [{ id: 11155111 }] as any,
        });

        // Create client
        const client = createCofheClient(config);

        // Connect — WagmiAdapter is an async function (not a class), takes (walletClient, publicClient)
        if (WagmiAdapter && typeof WagmiAdapter === 'function') {
          try {
            const adapter = await WagmiAdapter(walletClient as any, publicClient as any);
            await client.connect(publicClient as any, adapter as any);
          } catch (adapterErr: any) {
            console.warn('[CipherPay] WagmiAdapter failed, trying direct connect:', adapterErr.message);
            await client.connect(publicClient as any, walletClient as any);
          }
        } else {
          await client.connect(publicClient as any, walletClient as any);
        }

        if (!cancelled) {
          clientRef.current = client;
          setIsReady(true);
          setIsConnecting(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.warn('[CipherPay] CoFHE SDK init failed:', err);
          setError(err.message || 'FHE SDK init failed');
          setIsReady(false);
          setIsConnecting(false);
        }
      }
    }

    initCofhe();
    return () => { cancelled = true; };
  }, [walletClient, publicClient]);

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
    getEncryptable,
    getFheTypes,
  };
}
