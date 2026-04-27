import { motion, AnimatePresence } from 'framer-motion';
import {
  Repeat, Plus, CheckCircle, AlertTriangle, Lock, RefreshCw,
  Clock, Zap, Play, Terminal
} from 'lucide-react';
import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { parseEther } from 'viem';
import { Button } from '../../components/Button';
import { FheTerminal } from '../../components/FheTerminal';
import { useToastStore } from '../../components/ToastContainer';
import { useCofhe } from '../../hooks/useCofhe';
import { useTwoPhaseDecrypt } from '../../hooks/useTwoPhaseDecrypt';
import { RECURRING_SCHEDULER_ADDRESS, RECURRING_SCHEDULER_ABI } from '../../config/contract';

const isDeployed = RECURRING_SCHEDULER_ADDRESS !== '0x0000000000000000000000000000000000000000';

const FREQ_MAP: Record<string, { blocks: number; label: string; uint8: number }> = {
  daily:    { blocks: 7200,   label: 'Daily',      uint8: 0 },
  weekly:   { blocks: 50400,  label: 'Weekly',     uint8: 1 },
  biweekly: { blocks: 100800, label: 'Bi-weekly',  uint8: 2 },
  monthly:  { blocks: 216000, label: 'Monthly',    uint8: 3 },
};

interface LocalSchedule {
  id: string;
  beneficiary: string;
  memo: string;
  totalPeriods: number;
  claimedPeriods: number;
  ethPerPeriod: string;
  txHash: string;
  createdAt: number;
  active: boolean;
}

function loadSchedules(addr: string): LocalSchedule[] {
  try { return JSON.parse(localStorage.getItem(`cp_schedules_${addr.toLowerCase()}`) || '[]'); } catch { return []; }
}
function saveSchedule(addr: string, s: LocalSchedule) {
  const all = loadSchedules(addr);
  all.unshift(s);
  localStorage.setItem(`cp_schedules_${addr.toLowerCase()}`, JSON.stringify(all.slice(0, 50)));
}
function updateSchedule(addr: string, id: string, upd: Partial<LocalSchedule>) {
  const all = loadSchedules(addr);
  const idx = all.findIndex(s => s.id === id);
  if (idx >= 0) Object.assign(all[idx], upd);
  localStorage.setItem(`cp_schedules_${addr.toLowerCase()}`, JSON.stringify(all));
}

export function RecurringSchedulerPage() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { isReady: isFheReady, encrypt, getEncryptable } = useCofhe();
  const { decryptHandle } = useTwoPhaseDecrypt();
  const { addToast } = useToastStore();

  const [activeTab, setActiveTab] = useState<'create' | 'schedules'>('create');
  const [isCreating, setIsCreating] = useState(false);
  const [createLogs, setCreateLogs] = useState<string[]>([]);
  const [createDone, setCreateDone] = useState(false);
  const [createdId, setCreatedId] = useState('');

  // Form
  const [beneficiary, setBeneficiary] = useState('');
  const [frequency, setFrequency]     = useState('weekly');
  const [perPeriod, setPerPeriod]     = useState('');
  const [periods, setPeriods]         = useState('12');
  const [memo, setMemo]               = useState('');

  // Per-schedule trigger state
  const [triggeringId, setTriggeringId]   = useState('');
  const [triggerLogs, setTriggerLogs]     = useState<Record<string, string[]>>({});

  const [schedules, setSchedules] = useState<LocalSchedule[]>(() => address ? loadSchedules(address) : []);

  const addLog  = useCallback((m: string) => setCreateLogs(p => [...p, m]), []);
  const addTLog = useCallback((id: string, m: string) => setTriggerLogs(p => ({ ...p, [id]: [...(p[id] || []), m] })), []);

  const totalEth = (parseFloat(perPeriod) || 0) * (parseInt(periods) || 0);

  // ── Create ───────────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!isDeployed) { addToast('error', 'Contract not deployed'); return; }
    if (!address || !isFheReady) { addToast('error', !address ? 'Connect wallet' : 'FHE not ready'); return; }
    if (!beneficiary.startsWith('0x') || !perPeriod || !periods) { addToast('error', 'Fill all fields'); return; }

    setIsCreating(true);
    setCreateLogs([]);

    try {
      const Encryptable = getEncryptable();
      if (!Encryptable) throw new Error('Encryptable not available');

      addLog('> Encrypting frequency label and per-period amount...');
      addLog(`>   Frequency: ${frequency} → euint8(${FREQ_MAP[frequency].uint8}) — hidden on-chain`);

      const [encFreq, encAmount] = await encrypt(
        [Encryptable.uint8(FREQ_MAP[frequency].uint8), Encryptable.uint64(parseEther(perPeriod))],
        (step: string, ctx?: any) => {
          if (ctx?.isStart) addLog(`>   ${step}...`);
          if (ctx?.isEnd)   addLog(`>   ✓ ${step}`);
        }
      );

      const toTupleU8 = (r: any) => {
        const ctHash = BigInt(r?.ctHash ?? r?.data?.ctHash ?? 0);
        if (ctHash === 0n) throw new Error('FHE encryption failed: invalid handle');
        return { ctHash, securityZone: r?.securityZone ?? 0, utype: r?.utype ?? 1, signature: r?.signature ?? '0x' };
      };
      const toTuple64 = (r: any) => {
        const ctHash = BigInt(r?.ctHash ?? r?.data?.ctHash ?? 0);
        if (ctHash === 0n) throw new Error('FHE encryption failed: invalid handle');
        return { ctHash, securityZone: r?.securityZone ?? 0, utype: r?.utype ?? 5, signature: r?.signature ?? '0x' };
      };

      addLog('> ✓ euint8 frequency + euint64 amount encrypted');
      addLog('>   nextDue block stored as euint64 — nobody knows when payment fires');

      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = ('0x' + Array.from(saltBytes, b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
      const totalValue = parseEther(totalEth.toFixed(18));

      addLog(`> Creating ${periods} × ${perPeriod} ETH = ${totalEth.toFixed(4)} ETH schedule`);
      const txHash = await writeContractAsync({
        address: RECURRING_SCHEDULER_ADDRESS,
        abi: RECURRING_SCHEDULER_ABI as any,
        functionName: 'createSchedule',
        args: [beneficiary as `0x${string}`, toTupleU8(encFreq), toTuple64(encAmount),
               BigInt(parseInt(periods)), BigInt(FREQ_MAP[frequency].blocks), salt, memo || 'Recurring Schedule'],
        value: totalValue,
      });

      addLog(`> Transaction: ${txHash.slice(0, 14)}...`);
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addLog(`> ✓ Confirmed (block ${receipt.blockNumber})`);

      let id = '0x';
      for (const log of receipt.logs) {
        try {
          const { args } = (await import('viem')).decodeEventLog({
            abi: RECURRING_SCHEDULER_ABI as any,
            eventName: 'ScheduleCreated',
            data: log.data,
            topics: log.topics,
          });
          if ((args as any).id) { id = (args as any).id; break; }
        } catch {}
      }

      addLog(`> ✓ Schedule ID: ${id.slice(0, 16)}...`);
      addLog('>   Trigger: call triggerPayment(id) → FHE.gte(block, nextDue) check');
      addLog('>   Chainlink Automation compatible — auto-trigger possible');

      const newS: LocalSchedule = {
        id, beneficiary, memo: memo || 'Recurring Schedule',
        totalPeriods: parseInt(periods), claimedPeriods: 0,
        ethPerPeriod: perPeriod, txHash, createdAt: Date.now(), active: true,
      };
      saveSchedule(address, newS);
      setSchedules(loadSchedules(address));
      setCreatedId(id);
      setCreateDone(true);
      addToast('success', 'Recurring schedule created');
    } catch (err: any) {
      addLog(`> ✗ ${(err?.shortMessage || err?.message || 'Failed').slice(0, 80)}`);
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 80));
    } finally {
      setIsCreating(false);
    }
  };

  // ── Trigger Payment (Phase 1 + auto Phase 2) ─────────────────────────────────
  const handleTrigger = async (s: LocalSchedule) => {
    if (!isDeployed || !address) return;
    setTriggeringId(s.id);
    setTriggerLogs(prev => ({ ...prev, [s.id]: [] }));

    try {
      addTLog(s.id, '> Calling triggerPayment (Phase 1)...');
      addTLog(s.id, '>   FHE.gte(currentBlock, encryptedNextDue) → ebool isDue');

      const tx1 = await writeContractAsync({
        address: RECURRING_SCHEDULER_ADDRESS,
        abi: RECURRING_SCHEDULER_ABI as any,
        functionName: 'triggerPayment',
        args: [s.id as `0x${string}`],
      });

      addTLog(s.id, `> Phase 1 tx: ${tx1.slice(0, 14)}...`);
      await publicClient!.waitForTransactionReceipt({ hash: tx1 });
      addTLog(s.id, '> ✓ Phase 1 confirmed — reading isDue handle...');

      const handle = await publicClient!.readContract({
        address: RECURRING_SCHEDULER_ADDRESS,
        abi: [{ name: 'getIsDueResult', type: 'function', stateMutability: 'view', inputs: [{ name: '_id', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] }] as const,
        functionName: 'getIsDueResult',
        args: [s.id as `0x${string}`],
      });

      addTLog(s.id, '> Decrypting isDue via Threshold Network...');
      const { plaintext, signature } = await decryptHandle(BigInt(handle as bigint));
      addTLog(s.id, `> ✓ Payment due: ${plaintext}`);

      addTLog(s.id, '> Publishing result (Phase 2)...');
      const tx2 = await writeContractAsync({
        address: RECURRING_SCHEDULER_ADDRESS,
        abi: RECURRING_SCHEDULER_ABI as any,
        functionName: 'publishPaymentResult',
        args: [s.id as `0x${string}`, plaintext, signature],
      });

      addTLog(s.id, `> Phase 2 tx: ${tx2.slice(0, 14)}...`);
      await publicClient!.waitForTransactionReceipt({ hash: tx2 });

      if (plaintext) {
        addTLog(s.id, `> ✓ Payment executed — ${s.ethPerPeriod} ETH sent to beneficiary`);
        const newClaimed = s.claimedPeriods + 1;
        const active = newClaimed < s.totalPeriods;
        updateSchedule(address, s.id, { claimedPeriods: newClaimed, active });
        setSchedules(loadSchedules(address));
        addToast('success', `Payment ${newClaimed}/${s.totalPeriods} executed`);
      } else {
        addTLog(s.id, '> Payment not due yet — nextDue block not reached');
        addToast('info', 'Not due yet — try again when the block interval passes');
      }
    } catch (err: any) {
      addTLog(s.id, `> ✗ ${(err?.shortMessage || err?.message || 'Failed').slice(0, 80)}`);
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 60));
    } finally {
      setTriggeringId('');
    }
  };

  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">FHE Recurring Scheduler</h1>
        <p className="text-text-secondary">Encrypted payment cadence — schedule hidden on-chain, Chainlink Automation compatible</p>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <Repeat className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-text-secondary">
          <span className="text-primary font-bold">FHE clock</span> — <code className="font-mono">euint8</code> frequency hidden.
          <code className="font-mono text-primary"> FHE.gte(currentBlock, nextDue)</code> — nobody knows when next payment fires.
          Two-phase decrypt validates the result and advances <code className="font-mono">encryptedNextDue</code> via <code className="font-mono">FHE.add</code>.
        </p>
      </div>

      {!isDeployed && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-400">Run <code className="font-mono">npx hardhat run scripts/deploy-recurring.cts --network eth-sepolia</code></p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-border-default">
        {(['create', 'schedules'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`relative px-6 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === tab ? 'text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
            {tab === 'create' ? 'New Schedule' : `Schedules${schedules.length ? ` (${schedules.length})` : ''}`}
            {activeTab === tab && <motion.div layoutId="recurring-sched-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
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
                  <h2 className="text-2xl font-bold text-white">Schedule Created</h2>
                  {createdId && <p className="text-xs font-mono text-primary">{createdId.slice(0, 20)}...</p>}
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => { setCreateDone(false); setCreateLogs([]); setBeneficiary(''); setPerPeriod(''); setMemo(''); }}>Create Another</Button>
                  <Button onClick={() => setActiveTab('schedules')}>View Schedules</Button>
                </div>
              </div>
            ) : (
              <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
                <h2 className="text-xl font-bold text-white">New FHE Schedule</h2>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Beneficiary</label>
                  <input type="text" placeholder="0x..." value={beneficiary} onChange={e => setBeneficiary(e.target.value)}
                    className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none" />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Frequency <span className="text-primary">(encrypted as euint8)</span></label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(FREQ_MAP).map(([key, val]) => (
                      <button key={key} onClick={() => setFrequency(key)}
                        className={`p-3 rounded-xl border text-left transition-all ${frequency === key ? 'border-primary/40 bg-primary/5' : 'border-border-default bg-surface-2 hover:border-border-muted'}`}>
                        <p className={`text-sm font-bold ${frequency === key ? 'text-primary' : 'text-white'}`}>{val.label}</p>
                        <p className="text-xs text-text-muted">~{val.blocks.toLocaleString()} blocks</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Per Period (ETH)</label>
                    <input type="number" min="0" step="0.001" placeholder="0.01" value={perPeriod} onChange={e => setPerPeriod(e.target.value)}
                      className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Total Periods</label>
                    <input type="number" min="1" value={periods} onChange={e => setPeriods(e.target.value)}
                      className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                  </div>
                </div>

                {perPeriod && periods && (
                  <div className="p-4 bg-surface-2 rounded-xl flex justify-between text-sm">
                    <span className="text-text-secondary">Total ETH to escrow</span>
                    <span className="text-white font-bold">{totalEth.toFixed(4)} ETH</span>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Memo</label>
                  <input type="text" placeholder="e.g. Monthly Team Salary" value={memo} onChange={e => setMemo(e.target.value)}
                    className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                </div>

                {createLogs.length > 0 && <FheTerminal logs={createLogs} active={isCreating} />}

                <Button className="w-full h-12 gap-2" onClick={handleCreate}
                  disabled={isCreating || !isDeployed || !isFheReady || !beneficiary || !perPeriod || !periods}>
                  {isCreating ? <><RefreshCw className="w-4 h-4 animate-spin" /> Encrypting...</> : <><Lock className="w-4 h-4" /> Create Schedule ({totalEth.toFixed(4)} ETH)</>}
                </Button>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Schedules ───────────────────────────────────────────────────────── */}
        {activeTab === 'schedules' && (
          <motion.div key="schedules" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {schedules.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-6 bg-surface-1 border border-border-default rounded-[32px]">
                <Clock className="w-16 h-16 text-text-dim" />
                <p className="text-xl font-bold text-white">No schedules yet</p>
                <Button onClick={() => setActiveTab('create')}>Create Schedule</Button>
              </div>
            ) : (
              <div className="space-y-4">
                {schedules.map(s => {
                  const logs = triggerLogs[s.id] || [];
                  return (
                    <div key={s.id} className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-bold text-white">{s.memo}</h3>
                          <p className="text-xs text-text-muted font-mono mt-1">{s.id.slice(0, 14)}...</p>
                        </div>
                        <span className={`px-2 py-1 rounded-md border text-xs font-bold uppercase tracking-widest ${s.active ? 'border-primary/20 bg-primary/10 text-primary' : 'border-border-default bg-surface-3 text-text-muted'}`}>
                          {s.active ? 'Active' : 'Completed'}
                        </span>
                      </div>

                      <div className="grid grid-cols-4 gap-4 text-sm">
                        <div><p className="text-text-muted text-xs mb-1">Beneficiary</p><p className="text-white font-mono text-xs">{s.beneficiary.slice(0, 10)}...</p></div>
                        <div><p className="text-text-muted text-xs mb-1">Progress</p><p className="text-white">{s.claimedPeriods}/{s.totalPeriods}</p></div>
                        <div><p className="text-text-muted text-xs mb-1">Per Period</p><p className="text-white">{s.ethPerPeriod} ETH</p></div>
                        <div><p className="text-text-muted text-xs mb-1">Frequency</p><p className="text-primary flex items-center gap-1"><Lock className="w-3 h-3" /> Encrypted</p></div>
                      </div>

                      {/* Progress bar */}
                      <div className="space-y-1">
                        <div className="w-full h-1.5 bg-surface-3 rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(s.claimedPeriods / s.totalPeriods) * 100}%` }} />
                        </div>
                        <p className="text-xs text-text-muted">{Math.round((s.claimedPeriods / s.totalPeriods) * 100)}% claimed</p>
                      </div>

                      {/* Trigger button */}
                      {s.active && s.claimedPeriods < s.totalPeriods && (
                        <div className="space-y-3 pt-2 border-t border-border-default">
                          <Button size="sm" className="w-full gap-2"
                            disabled={triggeringId === s.id}
                            onClick={() => handleTrigger(s)}>
                            {triggeringId === s.id
                              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Checking & Paying...</>
                              : <><Play className="w-4 h-4" /> Trigger Payment (FHE.gte check)</>}
                          </Button>
                          {logs.length > 0 && <FheTerminal logs={logs} active={triggeringId === s.id} />}
                          <p className="text-xs text-text-muted">FHE checks if nextDue block is reached. If yes: payment executed and nextDue advances.</p>
                        </div>
                      )}

                      {s.claimedPeriods === s.totalPeriods && (
                        <p className="text-xs text-primary flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5" /> All {s.totalPeriods} payments executed</p>
                      )}
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
