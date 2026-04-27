import { motion, AnimatePresence } from 'framer-motion';
import {
  Gift, Plus, X, CheckCircle, XCircle, ArrowRight, Terminal, RefreshCw,
  AlertTriangle, Lock, Zap, Copy, Eye
} from 'lucide-react';
import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { parseEther, keccak256, encodePacked } from 'viem';
import { Button } from '../../components/Button';
import { FheTerminal } from '../../components/FheTerminal';
import { useToastStore } from '../../components/ToastContainer';
import { useCofhe } from '../../hooks/useCofhe';
import { useTwoPhaseDecrypt } from '../../hooks/useTwoPhaseDecrypt';
import { CIPHER_DROP_ADDRESS, CIPHER_DROP_ABI } from '../../config/contract';

interface Drop {
  dropId: string;
  txHash: string;
  createdAt: number;
  slots: number;
  slotsRemaining: number;
  ethPerClaim: number;
  memo: string;
}

const isDropDeployed = CIPHER_DROP_ADDRESS !== '0x0000000000000000000000000000000000000000';

function loadDrops(owner: string): Drop[] {
  try { return JSON.parse(localStorage.getItem(`cp_drops_${owner.toLowerCase()}`) || '[]'); } catch { return []; }
}
function saveDrop(owner: string, d: Drop) {
  const all = loadDrops(owner);
  all.unshift(d);
  localStorage.setItem(`cp_drops_${owner.toLowerCase()}`, JSON.stringify(all.slice(0, 50)));
}

type ClaimStep = 'idle' | 'phase1_tx' | 'decrypting' | 'eligible' | 'ineligible' | 'phase2_tx' | 'done' | 'error';

export function CipherDrop() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { isReady: isFheReady, encrypt, getEncryptable } = useCofhe();
  const { decryptHandle } = useTwoPhaseDecrypt();
  const { addToast } = useToastStore();

  const [activeTab, setActiveTab]       = useState<'campaigns' | 'claim'>('campaigns');
  const [showWizard, setShowWizard]     = useState(false);
  const [wizardStep, setWizardStep]     = useState(1);

  // Create form
  const [slots, setSlots]               = useState('10');
  const [ethPerClaim, setEthPerClaim]   = useState('0.01');
  const [minBalance, setMinBalance]     = useState('');
  const [claimAmount, setClaimAmount]   = useState('');
  const [dropMemo, setDropMemo]         = useState('');
  const [isDeploying, setIsDeploying]   = useState(false);
  const [deployLogs, setDeployLogs]     = useState<string[]>([]);
  const [deploySuccess, setDeploySuccess] = useState(false);
  const [deployedDropId, setDeployedDropId] = useState('');

  // Claim state machine
  const [claimDropId, setClaimDropId]   = useState('');
  const [claimBalance, setClaimBalance] = useState('');
  const [claimStep, setClaimStep]       = useState<ClaimStep>('idle');
  const [claimLogs, setClaimLogs]       = useState<string[]>([]);

  // Persisted between phases
  const [savedNullifier, setSavedNullifier]   = useState<`0x${string}` | null>(null);
  const [savedPlaintext, setSavedPlaintext]   = useState<boolean | null>(null);
  const [savedSignature, setSavedSignature]   = useState<`0x${string}` | null>(null);
  const [claimTxHash, setClaimTxHash]         = useState<string | null>(null);

  const drops = address ? loadDrops(address) : [];
  const totalEth = (parseFloat(slots) || 0) * (parseFloat(ethPerClaim) || 0);

  const addLog  = useCallback((m: string) => setDeployLogs(p => [...p, m]), []);
  const addCLog = useCallback((m: string) => setClaimLogs(p => [...p, m]), []);

  // ── Create drop ─────────────────────────────────────────────────────────────
  const handleDeploy = async () => {
    if (!isDropDeployed) { addToast('error', 'CipherDrop contract not deployed yet'); return; }
    if (!address) { addToast('error', 'Wallet not connected'); return; }
    if (!isFheReady) { addToast('error', 'FHE SDK not ready'); return; }
    const nSlots = parseInt(slots);
    const ethPer = parseFloat(ethPerClaim);
    if (!nSlots || nSlots < 1 || !ethPer || ethPer <= 0) { addToast('error', 'Invalid slots or ETH per claim'); return; }

    setIsDeploying(true);
    setDeployLogs([]);

    try {
      const Encryptable = getEncryptable();
      if (!Encryptable) throw new Error('Encryptable not available');

      addLog('> Encrypting eligibility threshold and claim amount via FHE...');
      const minBalWei   = parseEther(minBalance || '0');
      const claimAmtWei = parseEther(claimAmount || ethPerClaim);

      const [encMin, encClaim] = await encrypt(
        [Encryptable.uint64(minBalWei), Encryptable.uint64(claimAmtWei)],
        (step: string, ctx?: any) => {
          if (ctx?.isStart) addLog(`>   ${step}...`);
          if (ctx?.isEnd)   addLog(`>   ✓ ${step}`);
        }
      );

      addLog('> ✓ minBalance encrypted — threshold invisible on-chain');
      addLog('> ✓ claimAmount encrypted — per-claim amount hidden');

      const toTuple = (r: any) => {
        const ctHash = BigInt(r?.ctHash ?? r?.data?.ctHash ?? 0);
        if (ctHash === 0n) throw new Error('FHE encryption failed: invalid handle');
        return { ctHash, securityZone: r?.securityZone ?? r?.data?.securityZone ?? 0, utype: r?.utype ?? r?.data?.utype ?? 5, signature: r?.signature ?? r?.data?.signature ?? '0x' };
      };

      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = ('0x' + Array.from(saltBytes, b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
      const totalValue = parseEther((nSlots * ethPer).toFixed(18));

      addLog(`> Deploying: ${nSlots} slots × ${ethPer} ETH`);
      const txHash = await writeContractAsync({
        address: CIPHER_DROP_ADDRESS,
        abi: CIPHER_DROP_ABI as any,
        functionName: 'createDrop',
        args: [toTuple(encMin), toTuple(encClaim), BigInt(nSlots), salt, dropMemo || 'CipherDrop'],
        value: totalValue,
      });

      addLog(`> Transaction: ${txHash.slice(0, 14)}...`);
      addLog('> Awaiting confirmation...');
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addLog(`> ✓ Confirmed at block ${receipt.blockNumber}`);

      let dropId = '0x';
      for (const log of receipt.logs) {
        try {
          const { args } = (await import('viem')).decodeEventLog({
            abi: CIPHER_DROP_ABI as any,
            eventName: 'DropCreated',
            data: log.data,
            topics: log.topics,
          });
          if ((args as any).dropId) { dropId = (args as any).dropId; break; }
        } catch {}
      }

      addLog(`> ✓ Drop ID: ${dropId.slice(0, 16)}...`);
      addLog('>   FHE: FHE.gte(claimerBalance, minBalance) per claim');
      addLog('>   FHE: FHE.select(isEligible, claimAmount, zero) — ineligible gets zero');

      saveDrop(address, { dropId, txHash, createdAt: Date.now(), slots: nSlots, slotsRemaining: nSlots, ethPerClaim: ethPer, memo: dropMemo || 'CipherDrop' });
      setDeployedDropId(dropId);
      setDeploySuccess(true);
      addToast('success', 'CipherDrop deployed');
    } catch (err: any) {
      addLog(`> ✗ ${(err?.shortMessage || err?.message || 'Failed').slice(0, 80)}`);
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 80));
    } finally {
      setIsDeploying(false);
    }
  };

  // ── Claim Phase 1 ────────────────────────────────────────────────────────────
  const handleCheckEligibility = async () => {
    if (!isDropDeployed) { addToast('error', 'Contract not deployed'); return; }
    if (!address) { addToast('error', 'Wallet not connected'); return; }
    if (!isFheReady) { addToast('error', 'FHE SDK not ready'); return; }
    if (!claimDropId.startsWith('0x')) { addToast('error', 'Enter valid Drop ID (0x...)'); return; }
    if (!claimBalance || parseFloat(claimBalance) < 0) { addToast('error', 'Enter your balance to prove'); return; }

    setClaimStep('phase1_tx');
    setClaimLogs([]);
    setSavedNullifier(null);
    setSavedPlaintext(null);
    setSavedSignature(null);

    try {
      addCLog('> Generating nullifier (keccak256(deviceSecret ‖ dropId))...');
      const secretBytes = crypto.getRandomValues(new Uint8Array(32));
      const secret = ('0x' + Array.from(secretBytes, b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
      const nullifier = keccak256(encodePacked(['bytes32', 'bytes32'], [secret, claimDropId as `0x${string}`]));
      setSavedNullifier(nullifier);
      addCLog(`>   Nullifier: ${nullifier.slice(0, 16)}...`);

      addCLog('> Encrypting balance proof via FHE...');
      const Encryptable = getEncryptable();
      if (!Encryptable) throw new Error('Encryptable not available');
      const [encBal] = await encrypt([Encryptable.uint64(parseEther(claimBalance))]);
      addCLog('> ✓ Balance encrypted');

      const toTuple = (r: any) => {
        const ctHash = BigInt(r?.ctHash ?? r?.data?.ctHash ?? 0);
        if (ctHash === 0n) throw new Error('FHE encryption failed: invalid handle');
        return { ctHash, securityZone: r?.securityZone ?? r?.data?.securityZone ?? 0, utype: r?.utype ?? r?.data?.utype ?? 5, signature: r?.signature ?? r?.data?.signature ?? '0x' };
      };

      addCLog('> Submitting requestEligibilityCheck (Phase 1)...');
      addCLog('>   FHE.gte(yourBalance, minBalance) → ebool isEligible');
      addCLog('>   FHE.select(isEligible, claimAmount, zero) stored on-chain');

      const txHash = await writeContractAsync({
        address: CIPHER_DROP_ADDRESS,
        abi: CIPHER_DROP_ABI as any,
        functionName: 'requestEligibilityCheck',
        args: [claimDropId as `0x${string}`, toTuple(encBal), nullifier],
      });

      addCLog(`> Phase 1 tx: ${txHash.slice(0, 14)}...`);
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addCLog(`> ✓ Phase 1 confirmed (block ${receipt.blockNumber})`);

      // Phase 1 done — now read handle and decrypt
      setClaimStep('decrypting');
      addCLog('> Reading eligibility result handle from contract...');

      const handle = await publicClient!.readContract({
        address: CIPHER_DROP_ADDRESS,
        abi: CIPHER_DROP_ABI as any,
        functionName: 'getEligibilityResult',
        args: [claimDropId as `0x${string}`, nullifier],
      });

      addCLog(`> ✓ Handle: ${String(handle).slice(0, 20)}...`);
      addCLog('> Decrypting via Threshold Network (FHE.allowPublic)...');

      const { plaintext, signature } = await decryptHandle(BigInt(handle as bigint));

      setSavedPlaintext(plaintext);
      setSavedSignature(signature);

      if (plaintext) {
        setClaimStep('eligible');
        addCLog('> ✓ Eligible — your balance meets the threshold');
        addCLog('>   Result: FHE.gte returned true (encrypted)');
      } else {
        setClaimStep('ineligible');
        addCLog('> ✗ Not eligible — balance below encrypted threshold');
        addCLog('>   FHE.select returned zero — no ETH to claim');
      }
    } catch (err: any) {
      addCLog(`> ✗ ${(err?.shortMessage || err?.message || 'Failed').slice(0, 80)}`);
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 80));
      setClaimStep('error');
    }
  };

  // ── Claim Phase 2 ────────────────────────────────────────────────────────────
  const handleClaimDrop = async () => {
    if (!savedNullifier || savedPlaintext === null || !savedSignature) {
      addToast('error', 'Missing phase 2 data — retry from phase 1');
      return;
    }

    setClaimStep('phase2_tx');
    addCLog('');
    addCLog('> Submitting claimDrop (Phase 2)...');
    addCLog('>   FHE.publishDecryptResult validates threshold signature');

    try {
      const txHash = await writeContractAsync({
        address: CIPHER_DROP_ADDRESS,
        abi: CIPHER_DROP_ABI as any,
        functionName: 'claimDrop',
        args: [claimDropId as `0x${string}`, savedNullifier, savedPlaintext, savedSignature],
      });

      addCLog(`> Phase 2 tx: ${txHash.slice(0, 14)}...`);
      await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addCLog('> ✓ ETH claimed successfully');
      setClaimTxHash(txHash);
      setClaimStep('done');
      addToast('success', 'Drop claimed!');
    } catch (err: any) {
      addCLog(`> ✗ ${(err?.shortMessage || err?.message || 'Failed').slice(0, 80)}`);
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 80));
      setClaimStep('eligible'); // revert to eligible so user can retry
    }
  };

  const resetClaim = () => {
    setClaimStep('idle');
    setClaimLogs([]);
    setSavedNullifier(null);
    setSavedPlaintext(null);
    setSavedSignature(null);
    setClaimTxHash(null);
    setClaimDropId('');
    setClaimBalance('');
  };

  const resetWizard = () => {
    setShowWizard(false);
    setWizardStep(1);
    setDeploySuccess(false);
    setDeployLogs([]);
    setSlots('10');
    setEthPerClaim('0.01');
    setMinBalance('');
    setClaimAmount('');
    setDropMemo('');
  };

  const claimBusy = claimStep === 'phase1_tx' || claimStep === 'decrypting' || claimStep === 'phase2_tx';

  return (
    <div className="space-y-12">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-white tracking-tight">Cipher Drop</h1>
          <p className="text-text-secondary">FHE-encrypted airdrop — eligibility threshold hidden on-chain</p>
        </div>
        <Button variant="primary" size="sm" className="gap-2" onClick={() => { setShowWizard(true); setWizardStep(1); setDeploySuccess(false); }}>
          <Plus className="w-4 h-4" /> New Drop
        </Button>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <Zap className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-text-secondary">
          <span className="text-primary font-bold">FHE eligibility</span> — threshold encrypted.
          Claim = <span className="font-mono">FHE.gte(balance, threshold)</span> → two-phase decrypt → ETH transferred.
          Ineligible: <span className="font-mono">FHE.select → zero</span>, no revert, no leak.
        </p>
      </div>

      {!isDropDeployed && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-400">Run <code className="font-mono">npx hardhat run scripts/deploy-drop.cts --network eth-sepolia</code>, then update CIPHER_DROP_ADDRESS</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-border-default">
        {(['campaigns', 'claim'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`relative px-6 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === tab ? 'text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
            {tab === 'campaigns' ? `Drops${drops.length ? ` (${drops.length})` : ''}` : 'Claim Drop'}
            {activeTab === tab && <motion.div layoutId="drop-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      {/* ── Campaigns tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'campaigns' && (
        <div>
          {drops.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-6 bg-surface-1 border border-border-default rounded-[32px]">
              <Gift className="w-16 h-16 text-text-dim" />
              <div className="text-center space-y-2">
                <p className="text-xl font-bold text-white">No drops yet</p>
                <p className="text-text-secondary">Create your first FHE-gated airdrop</p>
              </div>
              <Button variant="primary" onClick={() => { setShowWizard(true); setWizardStep(1); }}>Create Drop</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {drops.map(d => (
                <div key={d.dropId} className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
                  <div className="flex justify-between items-start">
                    <h3 className="text-lg font-bold text-white">{d.memo}</h3>
                    <span className="px-2 py-1 rounded-md border border-primary/20 bg-primary/10 text-primary text-xs font-bold">active</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-text-secondary"><span>Slots</span><span className="text-white">{d.slots}</span></div>
                    <div className="flex justify-between text-text-secondary"><span>ETH per claim</span><span className="text-white">{d.ethPerClaim} ETH</span></div>
                    <div className="flex justify-between text-text-secondary"><span>Eligibility</span><span className="flex items-center gap-1 text-primary"><Lock className="w-3 h-3" /> Encrypted</span></div>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-border-default">
                    <code className="text-xs font-mono text-text-muted flex-1 truncate">{d.dropId.slice(0, 18)}...</code>
                    <button onClick={() => { navigator.clipboard.writeText(d.dropId); addToast('success', 'Copied'); }} className="p-1.5 text-text-muted hover:text-primary rounded-lg hover:bg-surface-2 transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                  </div>
                  <button onClick={() => { setActiveTab('claim'); setClaimDropId(d.dropId); }} className="w-full text-xs text-center text-primary hover:underline">Claim from this drop →</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Claim tab ──────────────────────────────────────────────────────────── */}
      {activeTab === 'claim' && (
        <div className="max-w-lg space-y-6">
          <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
            <h2 className="text-xl font-bold text-white">Claim from a Drop</h2>
            <p className="text-sm text-text-secondary">
              Two-phase: (1) submit balance proof → (2) contract verifies via FHE.gte → ETH transferred.
            </p>

            {/* Input form — shown when idle/error */}
            {(claimStep === 'idle' || claimStep === 'error') && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Drop ID</label>
                  <input type="text" placeholder="0x..." value={claimDropId} onChange={e => setClaimDropId(e.target.value)}
                    className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Your Balance (ETH)</label>
                  <input type="number" placeholder="e.g. 0.5" value={claimBalance} onChange={e => setClaimBalance(e.target.value)}
                    className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                  <p className="text-xs text-text-muted">Encrypted via FHE — contract only sees the proof, not the value.</p>
                </div>
                <Button className="w-full h-12 gap-2" onClick={handleCheckEligibility}
                  disabled={!isDropDeployed || !isFheReady || !claimDropId || !claimBalance}>
                  <Zap className="w-4 h-4" /> Check Eligibility
                </Button>
              </div>
            )}

            {/* Log output — shown during processing */}
            {claimLogs.length > 0 && <FheTerminal logs={claimLogs} active={claimBusy} />}

            {/* Progress steps */}
            {claimStep !== 'idle' && claimStep !== 'error' && (
              <div className="flex items-center gap-2">
                {[
                  { key: 'phase1_tx', label: 'Phase 1' },
                  { key: 'decrypting', label: 'Decrypt' },
                  { key: 'eligible', label: 'Result' },
                  { key: 'phase2_tx', label: 'Phase 2' },
                  { key: 'done', label: 'Done' },
                ].map((step, i) => {
                  const steps: ClaimStep[] = ['phase1_tx', 'decrypting', 'eligible', 'phase2_tx', 'done'];
                  const currentIdx = steps.indexOf(claimStep);
                  const thisIdx = i;
                  const active = claimStep === step.key;
                  const done = currentIdx > thisIdx || (claimStep === 'ineligible' && thisIdx <= 2);
                  return (
                    <div key={step.key} className="flex items-center gap-2 flex-1">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        active ? 'bg-primary text-black' : done ? 'bg-primary/20 text-primary' : 'bg-surface-2 text-text-muted'
                      }`}>
                        {done ? '✓' : i + 1}
                      </div>
                      <span className={`text-xs ${active ? 'text-white' : 'text-text-muted'}`}>{step.label}</span>
                      {i < 4 && <div className={`flex-1 h-0.5 ${done ? 'bg-primary' : 'bg-border-default'}`} />}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Eligible — show claim button */}
            {claimStep === 'eligible' && (
              <div className="space-y-4">
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-primary">Eligible!</p>
                    <p className="text-xs text-text-secondary">Your balance meets the encrypted threshold. Click to claim ETH.</p>
                  </div>
                </div>
                <Button className="w-full h-12 gap-2" onClick={handleClaimDrop}>
                  <Gift className="w-4 h-4" /> Claim ETH (Phase 2)
                </Button>
                <Button variant="ghost" size="sm" className="w-full" onClick={resetClaim}>Cancel</Button>
              </div>
            )}

            {/* Ineligible */}
            {claimStep === 'ineligible' && (
              <div className="space-y-4">
                <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-2xl flex items-center gap-3">
                  <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-red-400">Not eligible</p>
                    <p className="text-xs text-text-secondary">Your balance is below the encrypted threshold. FHE.select returned zero.</p>
                  </div>
                </div>
                <Button variant="outline" className="w-full" onClick={resetClaim}>Try Another Drop</Button>
              </div>
            )}

            {/* Success */}
            {claimStep === 'done' && (
              <div className="space-y-4">
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-primary">ETH claimed!</p>
                    {claimTxHash && (
                      <a href={`https://sepolia.etherscan.io/tx/${claimTxHash}`} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-text-muted hover:text-primary transition-colors">↗ View on Etherscan</a>
                    )}
                  </div>
                </div>
                <Button variant="outline" className="w-full" onClick={resetClaim}>Claim Another</Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Create Drop Wizard ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showWizard && (
          <div className="fixed inset-0 z-[10010] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={resetWizard} />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-surface-1 border border-border-default rounded-[32px] p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-8"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white">New CipherDrop</h2>
                <button onClick={resetWizard} className="p-2 rounded-full hover:bg-surface-2 text-text-secondary"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex items-center gap-4">
                {[1, 2, 3].map(s => (
                  <div key={s} className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${wizardStep === s ? 'bg-primary text-black' : wizardStep > s ? 'bg-primary/20 text-primary' : 'bg-surface-2 text-text-muted'}`}>
                      {wizardStep > s ? '✓' : s}
                    </div>
                    {s < 3 && <div className={`w-8 h-0.5 rounded-full ${wizardStep > s ? 'bg-primary' : 'bg-border-default'}`} />}
                  </div>
                ))}
                <span className="text-xs text-text-muted ml-2">{wizardStep === 1 ? 'Configuration' : wizardStep === 2 ? 'Eligibility' : 'Deploy'}</span>
              </div>

              {wizardStep === 1 && !deploySuccess && (
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-white">Drop Configuration</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Slots</label>
                      <input type="number" min="1" max="10000" value={slots} onChange={e => setSlots(e.target.value)}
                        className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted uppercase tracking-widest">ETH per Claim</label>
                      <input type="number" min="0" step="0.001" value={ethPerClaim} onChange={e => setEthPerClaim(e.target.value)}
                        className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Drop Name</label>
                    <input type="text" placeholder="Community Airdrop 2026" value={dropMemo} onChange={e => setDropMemo(e.target.value)}
                      className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                  </div>
                  <div className="p-4 bg-surface-2 rounded-2xl flex justify-between text-sm">
                    <span className="text-text-secondary">Total ETH</span>
                    <span className="text-white font-bold">{totalEth.toFixed(4)} ETH</span>
                  </div>
                  <Button className="w-full" onClick={() => setWizardStep(2)}
                    disabled={!slots || !ethPerClaim || parseFloat(slots) < 1 || parseFloat(ethPerClaim) <= 0}>
                    Next →
                  </Button>
                </div>
              )}

              {wizardStep === 2 && !deploySuccess && (
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-white">Eligibility <span className="text-primary">(FHE-encrypted)</span></h3>
                  <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl text-xs text-text-secondary space-y-1">
                    <p><span className="text-primary">FHE.gte(claimerBalance, minBalance)</span> — nobody sees the threshold.</p>
                    <p>Ineligible: <span className="font-mono">FHE.select(false, amount, zero)</span> — zero silently, no revert.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Min Balance (ETH) ← encrypted</label>
                    <input type="number" min="0" step="0.001" placeholder="e.g. 0.1" value={minBalance} onChange={e => setMinBalance(e.target.value)}
                      className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Claim Amount Display (ETH) ← encrypted</label>
                    <input type="number" min="0" step="0.001" placeholder={`Default: ${ethPerClaim} ETH`} value={claimAmount} onChange={e => setClaimAmount(e.target.value)}
                      className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => setWizardStep(1)}>Back</Button>
                    <Button className="flex-[2]" onClick={() => setWizardStep(3)}>Next →</Button>
                  </div>
                </div>
              )}

              {wizardStep === 3 && !deploySuccess && (
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-white">Deploy CipherDrop</h3>
                  <div className="p-4 bg-surface-2 rounded-2xl space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-text-secondary">Slots</span><span className="text-white">{slots}</span></div>
                    <div className="flex justify-between"><span className="text-text-secondary">ETH per claim</span><span className="text-white">{ethPerClaim} ETH</span></div>
                    <div className="flex justify-between"><span className="text-text-secondary">Total ETH</span><span className="text-white font-bold">{totalEth.toFixed(4)} ETH</span></div>
                    <div className="flex justify-between"><span className="text-text-secondary">Min balance</span><span className="text-primary flex items-center gap-1"><Lock className="w-3 h-3" /> Encrypted</span></div>
                  </div>
                  {deployLogs.length > 0 && <FheTerminal logs={deployLogs} active={isDeploying} />}
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => setWizardStep(2)} disabled={isDeploying}>Back</Button>
                    <Button className="flex-[2] gap-2" onClick={handleDeploy}
                      disabled={isDeploying || !isDropDeployed || !isFheReady}>
                      {isDeploying ? <><RefreshCw className="w-4 h-4 animate-spin" /> Deploying...</> : `Deploy (${totalEth.toFixed(4)} ETH)`}
                    </Button>
                  </div>
                </div>
              )}

              {deploySuccess && (
                <div className="flex flex-col items-center text-center space-y-6 py-8">
                  <div className="w-20 h-20 bg-primary/10 rounded-[24px] flex items-center justify-center">
                    <CheckCircle className="w-10 h-10 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold text-white">Drop Deployed!</h3>
                    {deployedDropId && <p className="text-xs font-mono text-primary">{deployedDropId.slice(0, 20)}...</p>}
                    <p className="text-text-secondary text-sm">Share the Drop ID so claimants can prove eligibility</p>
                  </div>
                  <Button onClick={resetWizard} className="gap-2">Close <ArrowRight className="w-4 h-4" /></Button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
