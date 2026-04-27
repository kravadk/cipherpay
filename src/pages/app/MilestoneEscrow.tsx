import { motion, AnimatePresence } from 'framer-motion';
import {
  Target, Plus, CheckCircle, AlertTriangle, Lock, RefreshCw,
  TrendingUp, Zap, ArrowRight, Eye, Unlock
} from 'lucide-react';
import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { parseEther } from 'viem';
import { Button } from '../../components/Button';
import { FheTerminal } from '../../components/FheTerminal';
import { useToastStore } from '../../components/ToastContainer';
import { useCofhe } from '../../hooks/useCofhe';
import { MILESTONE_ESCROW_ADDRESS, MILESTONE_ESCROW_ABI } from '../../config/contract';

const isDeployed = MILESTONE_ESCROW_ADDRESS !== '0x0000000000000000000000000000000000000000';

const TIER_LABELS = ['No funds', '< 25%', '25–50%', '50–75%', '> 75%', 'Complete'];
const TIER_COLORS = ['text-text-dim', 'text-blue-400', 'text-yellow-400', 'text-orange-400', 'text-primary', 'text-primary'];
const TIER_BG    = ['bg-surface-3', 'bg-blue-500/10 border-blue-500/20', 'bg-yellow-500/10 border-yellow-500/20', 'bg-orange-500/10 border-orange-500/20', 'bg-primary/10 border-primary/20', 'bg-primary/20 border-primary/40'];

interface LocalEscrow {
  id: string;
  beneficiary: string;
  memo: string;
  ethHeld: string;
  txHash: string;
  createdAt: number;
  releasedMilestones: number;
  tier?: number;
}

function loadEscrows(addr: string): LocalEscrow[] {
  try { return JSON.parse(localStorage.getItem(`cp_milestones_${addr.toLowerCase()}`) || '[]'); } catch { return []; }
}
function saveEscrow(addr: string, e: LocalEscrow) {
  const all = loadEscrows(addr);
  all.unshift(e);
  localStorage.setItem(`cp_milestones_${addr.toLowerCase()}`, JSON.stringify(all.slice(0, 50)));
}
function updateEscrow(addr: string, id: string, upd: Partial<LocalEscrow>) {
  const all = loadEscrows(addr);
  const idx = all.findIndex(e => e.id === id);
  if (idx >= 0) Object.assign(all[idx], upd);
  localStorage.setItem(`cp_milestones_${addr.toLowerCase()}`, JSON.stringify(all));
}

export function MilestoneEscrow() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { isReady: isFheReady, encrypt, getEncryptable, decrypt, getFheTypes } = useCofhe();
  const { addToast } = useToastStore();

  const [activeTab, setActiveTab] = useState<'create' | 'escrows'>('create');
  const [isCreating, setIsCreating] = useState(false);
  const [createLogs, setCreateLogs] = useState<string[]>([]);
  const [createDone, setCreateDone] = useState(false);
  const [createdId, setCreatedId] = useState('');

  // Create form
  const [beneficiary, setBeneficiary] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [q1Amount, setQ1Amount]       = useState('');
  const [q2Amount, setQ2Amount]       = useState('');
  const [q3Amount, setQ3Amount]       = useState('');
  const [memo, setMemo]               = useState('');

  // Per-escrow action state
  const [fundingId, setFundingId]     = useState('');
  const [fundAmount, setFundAmount]   = useState<Record<string, string>>({});
  const [fundEncAmt, setFundEncAmt]   = useState<Record<string, string>>({});
  const [releasingId, setReleasingId] = useState('');
  const [revealingId, setRevealingId] = useState('');
  const [actionLog, setActionLog]     = useState<Record<string, string[]>>({});

  const [escrows, setEscrows] = useState<LocalEscrow[]>(() => address ? loadEscrows(address) : []);

  const addLog  = useCallback((m: string) => setCreateLogs(p => [...p, m]), []);
  const addALog = useCallback((id: string, m: string) => setActionLog(p => ({ ...p, [id]: [...(p[id] || []), m] })), []);

  const autofillQuartiles = () => {
    if (!totalAmount) return;
    const t = parseFloat(totalAmount);
    setQ1Amount((t * 0.25).toFixed(4));
    setQ2Amount((t * 0.50).toFixed(4));
    setQ3Amount((t * 0.75).toFixed(4));
  };

  // ── Create ───────────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!isDeployed) { addToast('error', 'Contract not deployed'); return; }
    if (!address || !isFheReady) { addToast('error', !address ? 'Connect wallet' : 'FHE not ready'); return; }
    if (!beneficiary.startsWith('0x') || !totalAmount || !q1Amount || !q2Amount || !q3Amount) {
      addToast('error', 'Fill all fields'); return;
    }

    setIsCreating(true);
    setCreateLogs([]);

    try {
      const Encryptable = getEncryptable();
      if (!Encryptable) throw new Error('Encryptable not available');

      addLog('> Encrypting 4 milestone thresholds via FHE...');
      const [encTotal, encQ1, encQ2, encQ3] = await encrypt(
        [
          Encryptable.uint64(parseEther(totalAmount)),
          Encryptable.uint64(parseEther(q1Amount)),
          Encryptable.uint64(parseEther(q2Amount)),
          Encryptable.uint64(parseEther(q3Amount)),
        ],
        (step: string, ctx?: any) => {
          if (ctx?.isStart) addLog(`>   ${step}...`);
          if (ctx?.isEnd)   addLog(`>   ✓ ${step}`);
        }
      );

      const toTuple = (r: any) => {
        const ctHash = BigInt(r?.ctHash ?? r?.data?.ctHash ?? 0);
        if (ctHash === 0n) throw new Error('FHE encryption failed: invalid handle');
        return { ctHash, securityZone: r?.securityZone ?? r?.data?.securityZone ?? 0, utype: r?.utype ?? r?.data?.utype ?? 5, signature: r?.signature ?? r?.data?.signature ?? '0x' };
      };

      addLog('> ✓ 4 thresholds encrypted — nobody sees milestone amounts');
      addLog('>   Tier computed via: select(gte(collected,total), 4, select(gte(c,q3), 3, ...))');

      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = ('0x' + Array.from(saltBytes, b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;

      const txHash = await writeContractAsync({
        address: MILESTONE_ESCROW_ADDRESS,
        abi: MILESTONE_ESCROW_ABI as any,
        functionName: 'createEscrow',
        args: [beneficiary as `0x${string}`, toTuple(encTotal), toTuple(encQ1), toTuple(encQ2), toTuple(encQ3), salt, memo || 'Milestone Escrow'],
      });

      addLog(`> Transaction: ${txHash.slice(0, 14)}...`);
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addLog(`> ✓ Confirmed (block ${receipt.blockNumber})`);

      let id = '0x';
      for (const log of receipt.logs) {
        try {
          const { args } = (await import('viem')).decodeEventLog({
            abi: MILESTONE_ESCROW_ABI as any,
            eventName: 'EscrowCreated',
            data: log.data,
            topics: log.topics,
          });
          if ((args as any).id) { id = (args as any).id; break; }
        } catch {}
      }

      addLog(`> ✓ Escrow ID: ${id.slice(0, 16)}...`);
      addLog('>   Fund it with fundMilestone() to start tracking progress');

      saveEscrow(address, { id, beneficiary, memo: memo || 'Milestone Escrow', ethHeld: '0', txHash, createdAt: Date.now(), releasedMilestones: 0 });
      setEscrows(loadEscrows(address));
      setCreatedId(id);
      setCreateDone(true);
      addToast('success', 'Milestone escrow created');
    } catch (err: any) {
      addLog(`> ✗ ${(err?.shortMessage || err?.message || 'Failed').slice(0, 80)}`);
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 80));
    } finally {
      setIsCreating(false);
    }
  };

  // ── Fund Milestone ───────────────────────────────────────────────────────────
  const handleFund = async (e: LocalEscrow) => {
    if (!isDeployed || !address || !isFheReady) return;
    const ethAmt = fundAmount[e.id];
    const encAmt = fundEncAmt[e.id];
    if (!ethAmt || parseFloat(ethAmt) <= 0) { addToast('error', 'Enter ETH amount to fund'); return; }
    if (!encAmt || parseFloat(encAmt) <= 0) { addToast('error', 'Enter the encrypted amount (must match ETH sent)'); return; }

    setFundingId(e.id);
    setActionLog(prev => ({ ...prev, [e.id]: [] }));

    try {
      addALog(e.id, `> Encrypting payment amount ${encAmt} ETH...`);
      const Encryptable = getEncryptable();
      if (!Encryptable) throw new Error('Encryptable not available');
      const [encPayment] = await encrypt([Encryptable.uint64(parseEther(encAmt))]);

      addALog(e.id, '> ✓ Payment encrypted');
      addALog(e.id, '>   Contract will recompute tier via chained FHE.select');

      const toTuple = (r: any) => {
        const ctHash = BigInt(r?.ctHash ?? r?.data?.ctHash ?? 0);
        if (ctHash === 0n) throw new Error('FHE encryption failed: invalid handle');
        return { ctHash, securityZone: r?.securityZone ?? r?.data?.securityZone ?? 0, utype: r?.utype ?? r?.data?.utype ?? 5, signature: r?.signature ?? r?.data?.signature ?? '0x' };
      };

      const txHash = await writeContractAsync({
        address: MILESTONE_ESCROW_ADDRESS,
        abi: MILESTONE_ESCROW_ABI as any,
        functionName: 'fundMilestone',
        args: [e.id as `0x${string}`, toTuple(encPayment)],
        value: parseEther(ethAmt),
      });

      addALog(e.id, `> Transaction: ${txHash.slice(0, 14)}...`);
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addALog(e.id, `> ✓ Funded — tier updated via FHE.select chain`);

      const newEthHeld = (parseFloat(e.ethHeld) + parseFloat(ethAmt)).toFixed(4);
      updateEscrow(address, e.id, { ethHeld: newEthHeld });
      setEscrows(loadEscrows(address));
      setFundAmount(prev => ({ ...prev, [e.id]: '' }));
      setFundEncAmt(prev => ({ ...prev, [e.id]: '' }));
      addToast('success', `Funded ${ethAmt} ETH`);
    } catch (err: any) {
      addALog(e.id, `> ✗ ${(err?.shortMessage || err?.message || 'Failed').slice(0, 80)}`);
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 60));
    } finally {
      setFundingId('');
    }
  };

  // ── Reveal Tier ──────────────────────────────────────────────────────────────
  const handleRevealTier = async (e: LocalEscrow) => {
    if (!isDeployed || !address) return;
    setRevealingId(e.id);
    try {
      const handle = await publicClient!.readContract({
        address: MILESTONE_ESCROW_ADDRESS,
        abi: MILESTONE_ESCROW_ABI as any,
        functionName: 'getEncryptedTier',
        args: [e.id as `0x${string}`],
      });

      if (!handle || BigInt(handle as any) === 0n) {
        addToast('info', 'No tier yet — fund the escrow first');
        return;
      }

      // Tier is allowPublic — decrypt without permit
      const FheTypes = getFheTypes();
      if (!FheTypes) throw new Error('FheTypes not available');
      const tier = await decrypt(BigInt(handle as any), FheTypes.Uint64);
      const tierNum = Number(tier);

      updateEscrow(address, e.id, { tier: tierNum });
      setEscrows(loadEscrows(address));
      addToast('success', `Tier ${tierNum}: ${TIER_LABELS[tierNum] || 'Unknown'}`);
    } catch (err: any) {
      addToast('error', (err?.shortMessage || err?.message || 'Decrypt failed').slice(0, 60));
    } finally {
      setRevealingId('');
    }
  };

  // ── Release Milestone ────────────────────────────────────────────────────────
  const handleRelease = async (e: LocalEscrow) => {
    if (!isDeployed || !address) return;
    if (e.releasedMilestones >= 4) { addToast('info', 'All milestones released'); return; }
    setReleasingId(e.id);
    try {
      const txHash = await writeContractAsync({
        address: MILESTONE_ESCROW_ADDRESS,
        abi: MILESTONE_ESCROW_ABI as any,
        functionName: 'releaseMilestone',
        args: [e.id as `0x${string}`],
      });
      await publicClient!.waitForTransactionReceipt({ hash: txHash });
      const released = e.releasedMilestones + 1;
      updateEscrow(address, e.id, { releasedMilestones: released });
      setEscrows(loadEscrows(address));
      addToast('success', `Milestone ${released}/4 released to beneficiary`);
    } catch (err: any) {
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 60));
    } finally {
      setReleasingId('');
    }
  };

  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Milestone Escrow</h1>
        <p className="text-text-secondary">Encrypted thresholds — tier shown without revealing exact amounts</p>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <Target className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-text-secondary">
          <span className="text-primary font-bold">Chained FHE.select</span> — 4 encrypted thresholds.
          Progress tier computed as: <code className="font-mono text-primary">select(gte(c,total), 4, select(gte(c,q3), 3, select(gte(c,q2), 2, select(gte(c,q1), 1, 0))))</code>.
          Tier (0–4) is <code className="font-mono">allowPublic</code> — verifiable without permits.
        </p>
      </div>

      {!isDeployed && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-400">Run <code className="font-mono">npx hardhat run scripts/deploy-milestone.cts --network eth-sepolia</code></p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-border-default">
        {(['create', 'escrows'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`relative px-6 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === tab ? 'text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
            {tab === 'create' ? 'Create Escrow' : `Escrows${escrows.length ? ` (${escrows.length})` : ''}`}
            {activeTab === tab && <motion.div layoutId="milestone-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ── Create ──────────────────────────────────────────────────────────── */}
        {activeTab === 'create' && (
          <motion.div key="create" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-lg space-y-6">
            {createDone ? (
              <div className="flex flex-col items-center text-center space-y-6 py-16 bg-surface-1 border border-border-default rounded-[32px]">
                <div className="w-20 h-20 bg-primary/10 rounded-[24px] flex items-center justify-center"><CheckCircle className="w-10 h-10 text-primary" /></div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-white">Escrow Created</h2>
                  {createdId && <p className="text-xs font-mono text-primary">{createdId.slice(0, 20)}...</p>}
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => { setCreateDone(false); setCreateLogs([]); }}>Create Another</Button>
                  <Button onClick={() => setActiveTab('escrows')}>Fund Escrow</Button>
                </div>
              </div>
            ) : (
              <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
                <h2 className="text-xl font-bold text-white">New Milestone Escrow</h2>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Beneficiary Address</label>
                  <input type="text" placeholder="0x..." value={beneficiary} onChange={e => setBeneficiary(e.target.value)}
                    className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none" />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Memo</label>
                  <input type="text" placeholder="e.g. Q1 Project Milestone" value={memo} onChange={e => setMemo(e.target.value)}
                    className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Thresholds <span className="text-primary">(all encrypted)</span></label>
                    <button onClick={autofillQuartiles} disabled={!totalAmount} className="text-xs text-primary hover:underline disabled:opacity-40">Autofill quartiles</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Total (100%)', val: totalAmount, set: setTotalAmount },
                      { label: 'Q1 (25%)',     val: q1Amount,    set: setQ1Amount    },
                      { label: 'Q2 (50%)',     val: q2Amount,    set: setQ2Amount    },
                      { label: 'Q3 (75%)',     val: q3Amount,    set: setQ3Amount    },
                    ].map(({ label, val, set }) => (
                      <div key={label} className="space-y-1">
                        <label className="text-xs text-text-muted">{label}</label>
                        <input type="number" min="0" step="0.001" placeholder="0.0 ETH" value={val} onChange={e => set(e.target.value)}
                          className="w-full h-10 px-3 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-text-muted">All 4 values encrypted — funders see only tier badge (0–4), not amounts.</p>
                </div>

                {createLogs.length > 0 && <FheTerminal logs={createLogs} active={isCreating} />}

                <Button className="w-full h-12 gap-2" onClick={handleCreate}
                  disabled={isCreating || !isDeployed || !isFheReady || !beneficiary || !totalAmount || !q1Amount || !q2Amount || !q3Amount}>
                  {isCreating ? <><RefreshCw className="w-4 h-4 animate-spin" /> Encrypting...</> : <><Lock className="w-4 h-4" /> Create Milestone Escrow</>}
                </Button>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Escrows list ─────────────────────────────────────────────────────── */}
        {activeTab === 'escrows' && (
          <motion.div key="escrows" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {escrows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-6 bg-surface-1 border border-border-default rounded-[32px]">
                <Target className="w-16 h-16 text-text-dim" />
                <p className="text-xl font-bold text-white">No escrows yet</p>
                <Button onClick={() => setActiveTab('create')}>Create Escrow</Button>
              </div>
            ) : (
              <div className="space-y-6">
                {escrows.map(e => {
                  const logs = actionLog[e.id] || [];
                  const tier = e.tier ?? 0;
                  return (
                    <div key={e.id} className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-5">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-bold text-white">{e.memo}</h3>
                          <p className="text-xs font-mono text-text-muted mt-1">{e.id.slice(0, 14)}...</p>
                        </div>
                        <div className={`px-3 py-1.5 rounded-xl border text-sm font-bold ${TIER_BG[tier] || TIER_BG[0]}`}>
                          <span className={TIER_COLORS[tier]}>{TIER_LABELS[tier]}</span>
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div><p className="text-text-muted text-xs mb-1">Beneficiary</p><p className="text-white font-mono text-xs">{e.beneficiary.slice(0, 10)}...</p></div>
                        <div><p className="text-text-muted text-xs mb-1">ETH Held</p><p className="text-white">{e.ethHeld} ETH</p></div>
                        <div><p className="text-text-muted text-xs mb-1">Released</p><p className="text-white">{e.releasedMilestones}/4</p></div>
                      </div>

                      {/* Tier progress */}
                      <div className="flex items-center gap-1">
                        {[0, 1, 2, 3, 4].map(t => (
                          <div key={t} className={`flex-1 h-2 rounded-full transition-all ${tier >= t ? 'bg-primary' : 'bg-surface-3'}`} />
                        ))}
                      </div>

                      {/* Action log */}
                      {logs.length > 0 && <FheTerminal logs={logs} active={fundingId === e.id} />}

                      {/* Fund section */}
                      <div className="space-y-3 pt-3 border-t border-border-default">
                        <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Fund Milestone</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-xs text-text-muted">ETH to send</label>
                            <input type="number" min="0" step="0.001" placeholder="0.1"
                              value={fundAmount[e.id] || ''} onChange={ev => setFundAmount(p => ({ ...p, [e.id]: ev.target.value }))}
                              className="w-full h-10 px-3 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-text-muted">Encrypted amount</label>
                            <input type="number" min="0" step="0.001" placeholder="same"
                              value={fundEncAmt[e.id] || ''} onChange={ev => setFundEncAmt(p => ({ ...p, [e.id]: ev.target.value }))}
                              className="w-full h-10 px-3 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                          </div>
                        </div>
                        <Button size="sm" className="w-full gap-2"
                          disabled={fundingId === e.id || !fundAmount[e.id] || !fundEncAmt[e.id]}
                          onClick={() => handleFund(e)}>
                          {fundingId === e.id ? <><RefreshCw className="w-4 h-4 animate-spin" /> Funding...</> : <><Zap className="w-4 h-4" /> Fund & Update Tier</>}
                        </Button>
                      </div>

                      {/* Reveal tier + Release */}
                      <div className="flex gap-2 pt-2">
                        <Button variant="outline" size="sm" className="flex-1 gap-2"
                          disabled={revealingId === e.id}
                          onClick={() => handleRevealTier(e)}>
                          {revealingId === e.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                          Reveal Tier
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1 gap-2"
                          disabled={releasingId === e.id || e.releasedMilestones >= 4}
                          onClick={() => handleRelease(e)}>
                          {releasingId === e.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
                          Release {e.releasedMilestones < 4 ? `(${e.releasedMilestones + 1}/4)` : 'Done'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
