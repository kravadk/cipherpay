import { useState, useEffect } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { sepolia } from 'viem/chains';

const TARGET_CHAIN_ID = sepolia.id;
const RPC_URL = 'https://1rpc.io/sepolia';

export function NetworkStrip() {
  const [latency, setLatency] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const isWrongNetwork = isConnected && chainId !== undefined && chainId !== TARGET_CHAIN_ID;

  useEffect(() => {
    let cancelled = false;

    const measureLatency = async () => {
      try {
        const start = Date.now();
        const res = await fetch(RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        });
        if (res.ok && !cancelled) {
          setLatency(Date.now() - start);
          setIsOnline(true);
        }
      } catch {
        if (!cancelled) setIsOnline(false);
      }
    };

    measureLatency();
    const interval = setInterval(measureLatency, 10000);

    const handleOffline = () => setIsOnline(false);
    const handleOnline = () => setIsOnline(true);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const stripColor = !isOnline ? 'bg-red-500' : isWrongNetwork ? 'bg-yellow-500' : 'bg-primary';
  const dotColor = !isOnline ? 'bg-red-500' : isWrongNetwork ? 'bg-yellow-500' : 'bg-primary';

  const label = !isOnline
    ? 'Network unreachable'
    : isWrongNetwork
      ? '⚠ Wrong Network — Switch to Sepolia'
      : `Sepolia + Fhenix CoFHE — ${latency ? `${latency}ms` : '...'}`;

  return (
    <div className={`fixed top-0 left-0 right-0 z-[10007] h-[2px] transition-colors duration-500 ${stripColor}`}>
      <div className="absolute top-0 right-8 px-3 py-1 bg-bg-base/80 backdrop-blur-md rounded-b-lg border-x border-b border-border-default flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${dotColor}`} />
        <span className="text-xs font-bold text-text-secondary uppercase tracking-widest">
          {label}
        </span>
        {isWrongNetwork && (
          <button
            onClick={() => switchChain({ chainId: TARGET_CHAIN_ID })}
            className="text-xs font-bold text-yellow-400 hover:text-yellow-300 underline ml-1"
          >
            Switch
          </button>
        )}
      </div>
    </div>
  );
}
