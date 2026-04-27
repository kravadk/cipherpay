import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, CheckCircle, Clock, Lock, Plus, RefreshCw, Terminal,
  AlertTriangle, Eye, Copy, TrendingUp, FileCheck, XCircle
} from 'lucide-react';
import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient, useReadContract } from 'wagmi';
import { parseEther } from 'viem';
import { Button } from '../../components/Button';
import { FheTerminal } from '../../components/FheTerminal';
import { useToastStore } from '../../components/ToastContainer';
import { useCofhe } from '../../hooks/useCofhe';
import { useTwoPhaseDecrypt } from '../../hooks/useTwoPhaseDecrypt';
import { SALARY_PROOF_ADDRESS, SALARY_PROOF_ABI } from '../../config/contract';

const isDeployed = SALARY_PROOF_ADDRESS !== '0x0000000000000000000000000000000000000000';

interface LocalProof {
  proofId: string;
  threshold: string;
  label: string;
  createdAt: number;
  txHash: string;
}

function loadProofs(addr: string): LocalProof[] {
  try { return JSON.parse(localStorage.getItem(`cp_salaryproofs_${addr.toLowerCase()}`) || '[]'); } catch { return []; }
}
function saveProof(addr: string, p: LocalProof) {
  const all = loadProofs(addr);
  all.unshift(p);
  localStorage.setItem(`cp_salaryproofs_${addr.toLowerCase()}`, JSON.stringify(all.slice(0, 50)));
}

const PRESET_LABELS = [
  'Income ≥ $30K/yr (rental verification)',
  'Income ≥ $50K/yr (credit check)',
  'Income ≥ $100K/yr (premium DeFi)',
  'Income ≥ 1 ETH/month',
  'DAO voting weight proof',
];

export function SalaryProof() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { isReady: isFheReady, encrypt, getEncryptable } = useCofhe();
  const { decryptHandle } = useTwoPhaseDecrypt();
  const { addToast } = useToastStore();

  const [activeTab, setActiveTab] = useState<'record' | 'prove' | 'history'>('record');

  // Record income
  const [incomeAmount, setIncomeAmount] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordLogs, setRecordLogs] = useState<string[]>([]);
  const [recordDone, setRecordDone] = useState(false);

  // Create proof
  const [threshold, setThreshold]   = useState('');
  const [proofLabel, setProofLabel] = useState('');
  const [isProving, setIsProving]   = useState(false);
  const [proveLogs, setProveLogs]   = useState<string[]>([]);
  const [proveDone, setProveDone]   = useState(false);
  const [latestProofId, setLatestProofId] = useState('');
  const [proofResult, setProofResult] = useState<boolean | null>(null);

  const proofs = address ? loadProofs(address) : [];

  const { data: hasRecord } = useReadContract({
    address: SALARY_PROOF_ADDRESS,
    abi: SALARY_PROOF_ABI as any,
    functionName: 'hasIncomeRecord',
    args: [address],
    query: { enabled: !!address && isDeployed },
  });

  const addRLog = useCallback((m: string) => setRecordLogs(p => [...p, m]), []);
  const addPLog = useCallback((m: string) => setProveLogs(p => [...p, m]), []);

  const handleRecordIncome = async () => {
    if (!isDeployed) { addToast('error', 'Contract not deployed'); return; }
    if (!address || !isFheReady) { addToast('error', !address ? 'Connect wallet' : 'FHE not ready'); return; }
    if (!incomeAmount) { addToast('error', 'Enter income amount'); return; }

    setIsRecording(true);
    setRecordLogs([]);

    try {
      addRLog('> Encrypting income amount with FHE...');
      addRLog('>   Income stored as euint64 — only you can decrypt it');
      const Encryptable = getEncryptable();
      if (!Encryptable) throw new Error('Encryptable not available');

      const [encIncome] = await encrypt(
        [Encryptable.uint64(parseEther(incomeAmount))],
        (step: string, ctx?: any) => {
          if (ctx?.isStart) addRLog(`>   ${step}...`);
          if (ctx?.isEnd)   addRLog(`>   ✓ ${step}`);
        }
      );

      const toTuple = (r: any) => {
        const ctHash = BigInt(r?.ctHash ?? r?.data?.ctHash ?? 0);
        if (ctHash === 0n) throw new Error('FHE encryption failed: invalid handle');
        return { ctHash, securityZone: r?.securityZone ?? r?.data?.securityZone ?? 0, utype: r?.utype ?? r?.data?.utype ?? 5, signature: r?.signature ?? r?.data?.signature ?? '0x' };
      };

      addRLog('> ✓ Encryption complete — storing on SalaryProof contract');

      const txHash = await writeContractAsync({
        address: SALARY_PROOF_ADDRESS,
        abi: SALARY_PROOF_ABI as any,
        functionName: 'recordIncome',
        args: [toTuple(encIncome)],
      });

      addRLog(`> Transaction: ${txHash.slice(0, 14)}...`);
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addRLog(`> ✓ Confirmed at block ${receipt.blockNumber}`);
      addRLog('>   FHE ACL: only YOU can decrypt your income — FHE.allowSender');
      addRLog('>   Contract uses FHE.gte for comparisons without revealing the value');

      setRecordDone(true);
      addToast('success', 'Income recorded — encrypted on-chain');
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Failed';
      addRLog(`> ✗ ${msg.slice(0, 80)}`);
      addToast('error', msg.slice(0, 80));
    } finally {
      setIsRecording(false);
    }
  };

  const handleCreateProof = async () => {
    if (!isDeployed) { addToast('error', 'Contract not deployed'); return; }
    if (!address || !isFheReady) { addToast('error', !address ? 'Connect wallet' : 'FHE not ready'); return; }
    if (!threshold) { addToast('error', 'Enter proof threshold'); return; }
    if (!proofLabel) { addToast('error', 'Enter a label for this proof'); return; }

    setIsProving(true);
    setProveLogs([]);
    setProofResult(null);

    try {
      addPLog(`> Creating salary proof: ${proofLabel}`);
      addPLog(`> Threshold: ${threshold} ETH`);
      addPLog('>   FHE.gte(income, threshold) → ebool (allowPublic)');

      // Phase 1: selfProveSalary
      const txHash = await writeContractAsync({
        address: SALARY_PROOF_ADDRESS,
        abi: SALARY_PROOF_ABI as any,
        functionName: 'selfProveSalary',
        args: [parseEther(threshold), proofLabel],
      });

      addPLog(`> Phase 1 tx: ${txHash.slice(0, 14)}...`);
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addPLog(`> ✓ Phase 1 confirmed (block ${receipt.blockNumber})`);

      let proofId = '0x';
      for (const log of receipt.logs) {
        try {
          const { args } = (await import('viem')).decodeEventLog({
            abi: SALARY_PROOF_ABI as any,
            eventName: 'ProofRequested',
            data: log.data,
            topics: log.topics,
          });
          if ((args as any).proofId) { proofId = (args as any).proofId; break; }
        } catch {}
      }

      addPLog(`> ✓ Proof ID: ${proofId.slice(0, 16)}...`);

      // Read ebool handle
      addPLog('> Reading encrypted result handle...');
      const handle = await publicClient!.readContract({
        address: SALARY_PROOF_ADDRESS,
        abi: [{ name: 'getEncryptedProofResult', type: 'function', stateMutability: 'view', inputs: [{ name: '_proofId', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] }] as const,
        functionName: 'getEncryptedProofResult',
        args: [proofId as `0x${string}`],
      });

      // Phase 2: decrypt + publish
      addPLog('> Decrypting via Threshold Network...');
      const { plaintext, signature } = await decryptHandle(BigInt(handle as bigint));
      addPLog(`> ✓ Result: income ≥ threshold = ${plaintext}`);

      addPLog('> Publishing proof on-chain (Phase 2)...');
      const publishTx = await writeContractAsync({
        address: SALARY_PROOF_ADDRESS,
        abi: SALARY_PROOF_ABI as any,
        functionName: 'publishProof',
        args: [proofId as `0x${string}`, plaintext, signature],
      });

      addPLog(`> Phase 2 tx: ${publishTx.slice(0, 14)}...`);
      await publicClient!.waitForTransactionReceipt({ hash: publishTx });
      addPLog(`> ✓ Proof published on-chain`);
      addPLog(`>   getProof("${proofId.slice(0, 10)}...") → result=${plaintext}`);
      addPLog('>   Verifiers can check this proof without knowing your income');

      if (address) {
        saveProof(address, { proofId, threshold, label: proofLabel, createdAt: Date.now(), txHash });
      }
      setLatestProofId(proofId);
      setProofResult(plaintext);
      setProveDone(true);
      addToast('success', `Proof published: income ≥ threshold = ${plaintext}`);
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Failed';
      addPLog(`> ✗ ${msg.slice(0, 80)}`);
      addToast('error', msg.slice(0, 80));
    } finally {
      setIsProving(false);
    }
  };

  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Salary Proof</h1>
        <p className="text-text-secondary">Prove "income ≥ X" without revealing your actual income — FHE-powered</p>
      </div>

      {/* Info */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <Shield className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs text-text-secondary space-y-1">
          <p><span className="text-primary font-bold">FHE.gte proof</span> — income stored as encrypted euint64. Proof = on-chain boolean "income ≥ threshold: true/false". No amount, no history, no identity beyond the boolean.</p>
          <p>Use cases: <span className="text-white">DeFi collateral</span> · <span className="text-white">rental applications</span> · <span className="text-white">DAO voting weight</span> · <span className="text-white">KYC-less income verification</span></p>
        </div>
      </div>

      {!isDeployed && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-400">Contract pending deployment. Run <code className="font-mono">npx hardhat run scripts/deploy-salary.cts --network eth-sepolia</code></p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-border-default">
        {(['record', 'prove', 'history'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`relative px-6 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === tab ? 'text-primary' : 'text-text-muted hover:text-text-secondary'}`}
          >
            {tab === 'record' ? 'Record Income' : tab === 'prove' ? 'Create Proof' : `Proofs${proofs.length ? ` (${proofs.length})` : ''}`}
            {activeTab === tab && <motion.div layoutId="salary-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Record Income */}
        {activeTab === 'record' && (
          <motion.div key="record" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-lg space-y-6">
            {hasRecord && (
              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-center gap-3">
                <CheckCircle className="w-4 h-4 text-primary shrink-0" />
                <p className="text-sm text-primary">Income record exists on-chain. You can update it or create proofs.</p>
              </div>
            )}
            <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
              <h2 className="text-xl font-bold text-white">Record Encrypted Income</h2>
              <p className="text-sm text-text-secondary">
                Your income is stored as <code className="font-mono text-primary">euint64</code> on-chain.
                Only you can decrypt it. The contract uses it for FHE.gte comparisons without ever revealing the value.
              </p>
              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Annual Income (ETH equivalent)</label>
                <input
                  type="number" min="0" step="0.001" placeholder="e.g. 1.5 ETH"
                  value={incomeAmount} onChange={e => setIncomeAmount(e.target.value)}
                  className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none"
                />
                <p className="text-xs text-text-muted">FHE-encrypted. Etherscan shows only a ciphertext handle, not this value.</p>
              </div>

              {recordLogs.length > 0 && <FheTerminal logs={recordLogs} active={isRecording} />}

              {recordDone ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-primary">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-bold">Income recorded successfully</span>
                  </div>
                  <Button className="w-full gap-2" onClick={() => setActiveTab('prove')}>
                    Create Proof Now <Shield className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <Button className="w-full h-12 gap-2" onClick={handleRecordIncome}
                  disabled={isRecording || !isDeployed || !isFheReady || !incomeAmount}>
                  {isRecording ? <><RefreshCw className="w-4 h-4 animate-spin" /> Recording...</> : <><Lock className="w-4 h-4" /> Record Income (Encrypted)</>}
                </Button>
              )}
            </div>
          </motion.div>
        )}

        {/* Create Proof */}
        {activeTab === 'prove' && (
          <motion.div key="prove" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-lg space-y-6">
            <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
              <h2 className="text-xl font-bold text-white">Create Salary Proof</h2>
              <p className="text-sm text-text-secondary">
                The proof computes <code className="font-mono text-primary">FHE.gte(income, threshold)</code> on-chain.
                The result — a boolean — is made publicly verifiable via <code className="font-mono text-primary">FHE.allowPublic</code>.
              </p>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Threshold (ETH)</label>
                <input type="number" min="0" step="0.001" placeholder="e.g. 1.0 ETH"
                  value={threshold} onChange={e => setThreshold(e.target.value)}
                  className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                <p className="text-xs text-text-muted">Plaintext threshold stored in proof metadata so verifiers know what was proven.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Proof Label</label>
                <div className="space-y-2">
                  <input type="text" placeholder="e.g. Income ≥ $50K/yr" value={proofLabel} onChange={e => setProofLabel(e.target.value)}
                    className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                  <div className="flex flex-wrap gap-2">
                    {PRESET_LABELS.map(l => (
                      <button key={l} onClick={() => setProofLabel(l)}
                        className="text-xs px-2 py-1 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-secondary hover:text-white transition-colors border border-border-default">
                        {l.slice(0, 28)}…
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {proveLogs.length > 0 && <FheTerminal logs={proveLogs} active={isProving} />}

              {proveDone && latestProofId ? (
                <div className="space-y-3">
                  <div className={`p-4 rounded-2xl border flex items-center gap-3 ${proofResult ? 'border-primary/20 bg-primary/5' : 'border-red-500/20 bg-red-500/5'}`}>
                    {proofResult ? <CheckCircle className="w-5 h-5 text-primary shrink-0" /> : <XCircle className="w-5 h-5 text-red-400 shrink-0" />}
                    <div>
                      <p className={`text-sm font-bold ${proofResult ? 'text-primary' : 'text-red-400'}`}>
                        Income ≥ {threshold} ETH: <span className="font-mono">{proofResult ? 'true' : 'false'}</span>
                      </p>
                      <p className="text-xs text-text-secondary">Proof published on-chain. Verifiable without revealing income.</p>
                    </div>
                  </div>
                  <div className="p-3 bg-surface-2 rounded-xl flex items-center justify-between">
                    <code className="text-xs font-mono text-primary">{latestProofId.slice(0, 20)}...</code>
                    <button onClick={() => { navigator.clipboard.writeText(latestProofId); addToast('success', 'Copied'); }} className="p-1.5 text-text-muted hover:text-primary transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                  </div>
                  <p className="text-xs text-text-muted">Share this ID. Anyone calls <code className="font-mono">getProof(id)</code> on-chain to verify.</p>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => { setProveDone(false); setProveLogs([]); setProofResult(null); setLatestProofId(''); }}>New Proof</Button>
                    <Button className="flex-1" onClick={() => setActiveTab('history')}>View History</Button>
                  </div>
                </div>
              ) : (
                <Button className="w-full h-12 gap-2" onClick={handleCreateProof}
                  disabled={isProving || !isDeployed || !isFheReady || !threshold || !proofLabel}>
                  {isProving ? <><RefreshCw className="w-4 h-4 animate-spin" /> Creating & publishing...</> : <><TrendingUp className="w-4 h-4" /> Create Proof</>}
                </Button>
              )}
            </div>
          </motion.div>
        )}

        {/* History */}
        {activeTab === 'history' && (
          <motion.div key="history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {proofs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-6 bg-surface-1 border border-border-default rounded-[32px]">
                <FileCheck className="w-16 h-16 text-text-dim" />
                <div className="text-center space-y-2">
                  <p className="text-xl font-bold text-white">No proofs yet</p>
                  <p className="text-text-secondary">Record income and create your first salary proof</p>
                </div>
                <Button onClick={() => setActiveTab('record')}>Record Income</Button>
              </div>
            ) : (
              <div className="bg-surface-1 border border-border-default rounded-[32px] overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Proof ID</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Label</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Threshold</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Date</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest text-right">Tx</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {proofs.map(p => (
                      <tr key={p.proofId} className="hover:bg-surface-2 transition-colors">
                        <td className="px-8 py-5 font-mono text-sm text-primary">{p.proofId.slice(0, 14)}...</td>
                        <td className="px-8 py-5 text-sm text-white max-w-xs truncate">{p.label}</td>
                        <td className="px-8 py-5 text-sm text-text-secondary">{p.threshold} ETH</td>
                        <td className="px-8 py-5 text-xs text-text-secondary">{new Date(p.createdAt).toLocaleDateString('en-US')}</td>
                        <td className="px-8 py-5 text-right">
                          <a href={`https://sepolia.etherscan.io/tx/${p.txHash}`} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-text-muted hover:text-primary transition-colors">↗ Etherscan</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
