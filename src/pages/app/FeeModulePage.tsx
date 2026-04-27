import { motion } from 'framer-motion';
import { DollarSign, Lock, RefreshCw, AlertTriangle, CheckCircle, Eye, Zap } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient, useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { Button } from '../../components/Button';
import { FheTerminal } from '../../components/FheTerminal';
import { useToastStore } from '../../components/ToastContainer';
import { useCofhe } from '../../hooks/useCofhe';
import { FEE_MODULE_ADDRESS, FEE_MODULE_ABI } from '../../config/contract';

const isDeployed = FEE_MODULE_ADDRESS !== '0x0000000000000000000000000000000000000000';

export function FeeModulePage() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { isReady: isFheReady, encrypt, getEncryptable, decrypt, decryptForTx, getFheTypes } = useCofhe();
  const { addToast } = useToastStore();

  const [feeRateBps, setFeeRateBps]   = useState('30');
  const [isSettingRate, setSettingRate] = useState(false);
  const [rateLogs, setRateLogs]       = useState<string[]>([]);
  const [rateDone, setRateDone]       = useState(false);

  const [isRequestingSweep, setRequestingSweep] = useState(false);
  const [revenuePlaintext, setRevenuePlaintext] = useState<bigint | null>(null);
  const [revenueSig, setRevenueSig]   = useState<`0x${string}` | null>(null);
  const [isSweeping, setSweeping]     = useState(false);

  const { data: sweepPending } = useReadContract({
    address: FEE_MODULE_ADDRESS,
    abi: FEE_MODULE_ABI as any,
    functionName: 'sweepPending',
    query: { enabled: !!address && isDeployed },
  });

  const { data: owner } = useReadContract({
    address: FEE_MODULE_ADDRESS,
    abi: FEE_MODULE_ABI as any,
    functionName: 'owner',
    query: { enabled: !!address && isDeployed },
  });

  const isOwner = address && owner && address.toLowerCase() === (owner as string).toLowerCase();
  const addRLog = useCallback((m: string) => setRateLogs(p => [...p, m]), []);

  const handleSetRate = async () => {
    if (!isDeployed || !address || !isFheReady) return;
    const bps = parseInt(feeRateBps);
    if (!bps || bps < 1 || bps > 1000) { addToast('error', 'Fee rate must be 1–1000 bps'); return; }

    setSettingRate(true);
    setRateLogs([]);

    try {
      const Encryptable = getEncryptable();
      if (!Encryptable) throw new Error('Encryptable not available');
      addRLog(`> Encrypting fee rate: ${bps} bps (${(bps / 100).toFixed(2)}%) as euint64...`);
      const [encRate] = await encrypt([Encryptable.uint64(BigInt(bps))]);
      addRLog('> ✓ Fee rate encrypted — nobody sees the platform take rate');

      const toTuple = (r: any) => {
        const ctHash = BigInt(r?.ctHash ?? r?.data?.ctHash ?? 0);
        if (ctHash === 0n) throw new Error('FHE encryption failed: invalid handle');
        return { ctHash, securityZone: r?.securityZone ?? 0, utype: r?.utype ?? 5, signature: r?.signature ?? '0x' };
      };

      const txHash = await writeContractAsync({
        address: FEE_MODULE_ADDRESS,
        abi: FEE_MODULE_ABI as any,
        functionName: 'setFeeRate',
        args: [toTuple(encRate)],
      });
      addRLog(`> Transaction: ${txHash.slice(0, 14)}...`);
      await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addRLog('> ✓ Fee rate updated on-chain (encrypted)');
      setRateDone(true);
      addToast('success', 'Fee rate set (encrypted)');
    } catch (err: any) {
      addRLog(`> ✗ ${(err?.shortMessage || err?.message || 'Failed').slice(0, 80)}`);
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 60));
    } finally {
      setSettingRate(false);
    }
  };

  const handleRequestSweep = async () => {
    if (!isDeployed || !address) return;
    setRequestingSweep(true);
    try {
      // Phase 1: request sweep → FHE.allowPublic on revenue handle
      const tx = await writeContractAsync({
        address: FEE_MODULE_ADDRESS,
        abi: FEE_MODULE_ABI as any,
        functionName: 'requestRevenueSweep',
      });
      await publicClient!.waitForTransactionReceipt({ hash: tx });

      // Read revenue handle
      const handle = await publicClient!.readContract({
        address: FEE_MODULE_ADDRESS,
        abi: FEE_MODULE_ABI as any,
        functionName: 'getPlatformRevenue',
      });

      // Decrypt via decryptForTx (allowPublic set)
      const raw = await decryptForTx(BigInt(handle as any), false) as any;
      const plaintext = BigInt(String(raw?.decryptedValue ?? raw?.value ?? 0));
      const rawSig = raw?.signature ?? '0x';
      const sig: `0x${string}` = typeof rawSig === 'string'
        ? rawSig as `0x${string}`
        : `0x${Array.from(rawSig as Uint8Array, (b: number) => b.toString(16).padStart(2, '0')).join('')}`;

      setRevenuePlaintext(plaintext);
      setRevenueSig(sig);
      addToast('success', `Revenue decrypted: ${formatEther(plaintext)} ETH`);
    } catch (err: any) {
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 60));
    } finally {
      setRequestingSweep(false);
    }
  };

  const handleSweep = async () => {
    if (!revenuePlaintext || !revenueSig) return;
    setSweeping(true);
    try {
      const txHash = await writeContractAsync({
        address: FEE_MODULE_ADDRESS,
        abi: FEE_MODULE_ABI as any,
        functionName: 'publishSweepResult',
        args: [revenuePlaintext, revenueSig],
      });
      await publicClient!.waitForTransactionReceipt({ hash: txHash });
      setRevenuePlaintext(null);
      setRevenueSig(null);
      addToast('success', `Revenue swept: ${formatEther(revenuePlaintext)} ETH`);
    } catch (err: any) {
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 60));
    } finally {
      setSweeping(false);
    }
  };

  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Fee Module</h1>
        <p className="text-text-secondary">Platform fee with encrypted rate — nobody sees the percentage</p>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <DollarSign className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-text-secondary">
          <span className="text-primary font-bold">Encrypted fee rate</span> — stored as <code className="font-mono">euint8</code>.
          Fee collection: <code className="font-mono text-primary">FHE.mul(amount, feeBps) / 10000</code>.
          Revenue accumulated in <code className="font-mono">platformRevenue: euint64</code> with <code className="font-mono">FHE.allowGlobal</code>.
          Sweep via two-phase decrypt.
        </p>
      </div>

      {!isDeployed && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-400">Run <code className="font-mono">npx hardhat run scripts/deploy-fee.cts --network eth-sepolia</code></p>
        </div>
      )}

      {isDeployed && !isOwner && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-400">You are not the contract owner. Admin functions are restricted.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Set fee rate */}
        <div className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold text-white">Set Fee Rate (encrypted)</h2>
          </div>
          <p className="text-xs text-text-secondary">Fee rate stored as <code className="font-mono">euint8</code>. Only owner can decrypt. Charged on settlements via <code className="font-mono">FHE.mul</code>.</p>
          <div className="flex gap-2">
            <input type="number" min="1" max="1000" value={feeRateBps} onChange={e => setFeeRateBps(e.target.value)}
              className="flex-1 h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
            <span className="flex items-center text-sm text-text-secondary pr-2">bps ({(parseFloat(feeRateBps || '0') / 100).toFixed(2)}%)</span>
          </div>
          {rateLogs.length > 0 && <FheTerminal logs={rateLogs} active={isSettingRate} />}
          {rateDone ? (
            <div className="flex items-center gap-2 text-primary text-sm"><CheckCircle className="w-4 h-4" /> Fee rate updated</div>
          ) : (
            <Button className="w-full gap-2" onClick={handleSetRate} disabled={isSettingRate || !isDeployed || !isFheReady || !isOwner}>
              {isSettingRate ? <><RefreshCw className="w-4 h-4 animate-spin" /> Encrypting...</> : <><Lock className="w-4 h-4" /> Set Encrypted Rate</>}
            </Button>
          )}
        </div>

        {/* Sweep revenue */}
        <div className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold text-white">Sweep Revenue</h2>
          </div>
          <p className="text-xs text-text-secondary">Two-phase: request → decryptForTx → publish result → ETH transferred to owner.</p>
          {!revenuePlaintext ? (
            <Button className="w-full gap-2" onClick={handleRequestSweep}
              disabled={isRequestingSweep || !isDeployed || !isFheReady || !isOwner}>
              {isRequestingSweep ? <><RefreshCw className="w-4 h-4 animate-spin" /> Decrypting Revenue...</> : <><Eye className="w-4 h-4" /> Request Revenue Sweep</>}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                <p className="text-xs text-text-muted mb-1">Decrypted Revenue</p>
                <p className="text-2xl font-bold text-primary">{formatEther(revenuePlaintext)} ETH</p>
              </div>
              <Button className="w-full gap-2" onClick={handleSweep} disabled={isSweeping}>
                {isSweeping ? <><RefreshCw className="w-4 h-4 animate-spin" /> Sweeping...</> : <><DollarSign className="w-4 h-4" /> Sweep to Owner</>}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
