import { motion, AnimatePresence } from 'framer-motion';
import {
  Landmark, Plus, ThumbsUp, ThumbsDown, CheckCircle, XCircle,
  Clock, RefreshCw, AlertTriangle, Lock, Users, Terminal, Vote,
  Play, Zap, DollarSign
} from 'lucide-react';
import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient, useReadContract } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { Button } from '../../components/Button';
import { FheTerminal } from '../../components/FheTerminal';
import { useToastStore } from '../../components/ToastContainer';
import { useCofhe } from '../../hooks/useCofhe';
import { useTwoPhaseDecrypt } from '../../hooks/useTwoPhaseDecrypt';
import { DAO_TREASURY_ADDRESS, DAO_TREASURY_ABI } from '../../config/contract';

const isDeployed = DAO_TREASURY_ADDRESS !== '0x0000000000000000000000000000000000000000';

const STATUS_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'Voting',   color: 'bg-blue-500/10 border-blue-500/20 text-blue-400' },
  1: { label: 'Passed',   color: 'bg-primary/10 border-primary/20 text-primary' },
  2: { label: 'Rejected', color: 'bg-red-500/10 border-red-500/20 text-red-400' },
  3: { label: 'Executed', color: 'bg-surface-3 border-border-default text-text-muted' },
};

interface LocalProposal {
  proposalId: string;
  title: string;
  description: string;
  recipient: string;
  quorum: number;
  status: number;
  createdAt: number;
  txHash: string;
  ethFunded: string;
  voteDeadline: number;
}

function loadProposals(addr: string): LocalProposal[] {
  try { return JSON.parse(localStorage.getItem(`cp_dao_${addr.toLowerCase()}`) || '[]'); } catch { return []; }
}
function saveProposal(addr: string, p: LocalProposal) {
  const all = loadProposals(addr);
  all.unshift(p);
  localStorage.setItem(`cp_dao_${addr.toLowerCase()}`, JSON.stringify(all.slice(0, 50)));
}
function updateProposalStatus(addr: string, proposalId: string, status: number) {
  const all = loadProposals(addr);
  const idx = all.findIndex(p => p.proposalId === proposalId);
  if (idx >= 0) { all[idx].status = status; }
  localStorage.setItem(`cp_dao_${addr.toLowerCase()}`, JSON.stringify(all));
}

export function DAOTreasury() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { isReady: isFheReady, encrypt, getEncryptable } = useCofhe();
  const { decryptHandle } = useTwoPhaseDecrypt();
  const { addToast } = useToastStore();

  const [activeTab, setActiveTab] = useState<'proposals' | 'create' | 'members'>('proposals');
  const [isCreating, setIsCreating] = useState(false);
  const [createLogs, setCreateLogs] = useState<string[]>([]);
  const [createDone, setCreateDone] = useState(false);

  // Create form
  const [title, setTitle]       = useState('');
  const [description, setDesc]  = useState('');
  const [recipient, setRecipient] = useState('');
  const [budgetEth, setBudgetEth] = useState('');
  const [fundEth, setFundEth]   = useState('');
  const [quorum, setQuorum]     = useState('3');
  const [voteDays, setVoteDays] = useState('7');

  // Per-proposal action state
  const [votingId, setVotingId]       = useState('');
  const [checkingId, setCheckingId]   = useState('');
  const [executingId, setExecutingId] = useState('');
  const [actionLog, setActionLog]     = useState<Record<string, string[]>>({});
  const [executeEth, setExecuteEth]   = useState<Record<string, string>>({});

  const [proposals, setProposals] = useState<LocalProposal[]>(() => address ? loadProposals(address) : []);

  const { data: isMember } = useReadContract({
    address: DAO_TREASURY_ADDRESS,
    abi: DAO_TREASURY_ABI as any,
    functionName: 'members',
    args: [address],
    query: { enabled: !!address && isDeployed },
  });

  const { data: memberCount } = useReadContract({
    address: DAO_TREASURY_ADDRESS,
    abi: DAO_TREASURY_ABI as any,
    functionName: 'memberCount',
    query: { enabled: !!address && isDeployed },
  });

  const addLog = useCallback((m: string) => setCreateLogs(p => [...p, m]), []);
  const addALog = useCallback((id: string, m: string) => setActionLog(p => ({ ...p, [id]: [...(p[id] || []), m] })), []);

  const refreshProposals = () => {
    if (address) setProposals(loadProposals(address));
  };

  // ── Create Proposal ──────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!isDeployed) { addToast('error', 'Contract not deployed'); return; }
    if (!address || !isFheReady) { addToast('error', !address ? 'Connect wallet' : 'FHE not ready'); return; }
    if (!title || !recipient || !budgetEth) { addToast('error', 'Fill all required fields'); return; }

    setIsCreating(true);
    setCreateLogs([]);

    try {
      const Encryptable = getEncryptable();
      if (!Encryptable) throw new Error('Encryptable not available');

      addLog('> Encrypting budget amount via FHE...');
      const [encBudget] = await encrypt(
        [Encryptable.uint64(parseEther(budgetEth))],
        (step: string, ctx?: any) => {
          if (ctx?.isStart) addLog(`>   ${step}...`);
          if (ctx?.isEnd)   addLog(`>   ✓ ${step}`);
        }
      );

      addLog('> ✓ Budget encrypted as euint64 — proposal amount hidden');

      const toTuple = (r: any) => {
        const ctHash = BigInt(r?.ctHash ?? r?.data?.ctHash ?? 0);
        if (ctHash === 0n) throw new Error('FHE encryption failed: invalid handle');
        return { ctHash, securityZone: r?.securityZone ?? r?.data?.securityZone ?? 0, utype: r?.utype ?? r?.data?.utype ?? 5, signature: r?.signature ?? r?.data?.signature ?? '0x' };
      };

      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = ('0x' + Array.from(saltBytes, b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
      const fundValue = fundEth ? parseEther(fundEth) : 0n;

      addLog(`> Creating proposal: "${title}"`);
      const txHash = await writeContractAsync({
        address: DAO_TREASURY_ADDRESS,
        abi: DAO_TREASURY_ABI as any,
        functionName: 'createProposal',
        args: [toTuple(encBudget), title, description, recipient as `0x${string}`, BigInt(quorum), BigInt(parseInt(voteDays) * 86400), salt],
        value: fundValue,
      });

      addLog(`> Transaction: ${txHash.slice(0, 14)}...`);
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addLog(`> ✓ Confirmed (block ${receipt.blockNumber})`);

      let proposalId = '0x';
      for (const log of receipt.logs) {
        try {
          const { args } = (await import('viem')).decodeEventLog({
            abi: DAO_TREASURY_ABI as any,
            eventName: 'ProposalCreated',
            data: log.data,
            topics: log.topics,
          });
          if ((args as any).proposalId) { proposalId = (args as any).proposalId; break; }
        } catch {}
      }

      addLog(`> ✓ Proposal ID: ${proposalId.slice(0, 16)}...`);
      addLog('>   Vote tallies: FHE.add(votesFor, 1) per vote — hidden during voting');
      addLog('>   Outcome: FHE.gte(votesFor, quorum) after deadline');

      const newP: LocalProposal = {
        proposalId, title, description, recipient,
        quorum: parseInt(quorum), status: 0, createdAt: Date.now(), txHash,
        ethFunded: fundEth || '0',
        voteDeadline: Math.floor(Date.now() / 1000) + parseInt(voteDays) * 86400,
      };
      saveProposal(address, newP);
      setProposals(loadProposals(address));
      setCreateDone(true);
      addToast('success', 'Proposal created');
    } catch (err: any) {
      addLog(`> ✗ ${(err?.shortMessage || err?.message || 'Failed').slice(0, 80)}`);
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 80));
    } finally {
      setIsCreating(false);
    }
  };

  // ── Vote ─────────────────────────────────────────────────────────────────────
  const handleVote = async (proposalId: string, inFavor: boolean) => {
    if (!isDeployed || !address) return;
    setVotingId(proposalId + (inFavor ? '_for' : '_against'));
    try {
      const txHash = await writeContractAsync({
        address: DAO_TREASURY_ADDRESS,
        abi: DAO_TREASURY_ABI as any,
        functionName: 'vote',
        args: [proposalId as `0x${string}`, inFavor],
      });
      await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addToast('success', `Vote ${inFavor ? 'for' : 'against'} submitted — tally encrypted via FHE.add`);
    } catch (err: any) {
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 60));
    } finally {
      setVotingId('');
    }
  };

  // ── Request Quorum Check + publish (two-phase) ───────────────────────────────
  const handleCheckQuorum = async (p: LocalProposal) => {
    if (!isDeployed || !address) return;
    setCheckingId(p.proposalId);
    setActionLog(prev => ({ ...prev, [p.proposalId]: [] }));

    try {
      addALog(p.proposalId, '> Requesting quorum check (Phase 1)...');
      addALog(p.proposalId, '>   FHE.gte(votesFor, quorum) → ebool');

      const tx1 = await writeContractAsync({
        address: DAO_TREASURY_ADDRESS,
        abi: DAO_TREASURY_ABI as any,
        functionName: 'requestQuorumCheck',
        args: [p.proposalId as `0x${string}`],
      });

      addALog(p.proposalId, `> Phase 1 tx: ${tx1.slice(0, 14)}...`);
      await publicClient!.waitForTransactionReceipt({ hash: tx1 });
      addALog(p.proposalId, '> ✓ Phase 1 confirmed');

      // Read handle
      addALog(p.proposalId, '> Reading quorum result handle...');
      const handle = await publicClient!.readContract({
        address: DAO_TREASURY_ADDRESS,
        abi: [{ name: 'getEncryptedQuorumResult', type: 'function', stateMutability: 'view', inputs: [{ name: '_id', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] }] as const,
        functionName: 'getEncryptedQuorumResult',
        args: [p.proposalId as `0x${string}`],
      });

      addALog(p.proposalId, '> Decrypting via Threshold Network...');
      const { plaintext, signature } = await decryptHandle(BigInt(handle as bigint));
      addALog(p.proposalId, `> ✓ Result: quorum reached = ${plaintext}`);

      addALog(p.proposalId, '> Publishing quorum result (Phase 2)...');
      const tx2 = await writeContractAsync({
        address: DAO_TREASURY_ADDRESS,
        abi: DAO_TREASURY_ABI as any,
        functionName: 'publishQuorumResult',
        args: [p.proposalId as `0x${string}`, plaintext, signature],
      });

      addALog(p.proposalId, `> Phase 2 tx: ${tx2.slice(0, 14)}...`);
      await publicClient!.waitForTransactionReceipt({ hash: tx2 });
      addALog(p.proposalId, `> ✓ Proposal ${plaintext ? 'PASSED' : 'REJECTED'}`);

      const newStatus = plaintext ? 1 : 2;
      updateProposalStatus(address, p.proposalId, newStatus);
      setProposals(loadProposals(address));
      addToast('success', `Proposal ${plaintext ? 'passed' : 'rejected'}`);
    } catch (err: any) {
      addALog(p.proposalId, `> ✗ ${(err?.shortMessage || err?.message || 'Failed').slice(0, 80)}`);
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 60));
    } finally {
      setCheckingId('');
    }
  };

  // ── Execute ──────────────────────────────────────────────────────────────────
  const handleExecute = async (p: LocalProposal) => {
    if (!isDeployed || !address) return;
    setExecutingId(p.proposalId);
    try {
      const ethVal = executeEth[p.proposalId] ? parseEther(executeEth[p.proposalId]) : 0n;
      const txHash = await writeContractAsync({
        address: DAO_TREASURY_ADDRESS,
        abi: DAO_TREASURY_ABI as any,
        functionName: 'executeProposal',
        args: [p.proposalId as `0x${string}`],
        value: ethVal,
      });
      await publicClient!.waitForTransactionReceipt({ hash: txHash });
      updateProposalStatus(address, p.proposalId, 3);
      setProposals(loadProposals(address));
      addToast('success', 'Proposal executed — ETH sent to recipient');
    } catch (err: any) {
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 60));
    } finally {
      setExecutingId('');
    }
  };

  // ── Add Member ───────────────────────────────────────────────────────────────
  const [memberToAdd, setMemberToAdd]       = useState('');
  const [isAddingMember, setIsAddingMember] = useState(false);

  const handleAddMember = async () => {
    if (!isDeployed || !address) return;
    if (!memberToAdd.startsWith('0x') || memberToAdd.length !== 42) { addToast('error', 'Invalid address'); return; }
    setIsAddingMember(true);
    try {
      const txHash = await writeContractAsync({
        address: DAO_TREASURY_ADDRESS,
        abi: DAO_TREASURY_ABI as any,
        functionName: 'addMember',
        args: [memberToAdd as `0x${string}`],
      });
      await publicClient!.waitForTransactionReceipt({ hash: txHash });
      setMemberToAdd('');
      addToast('success', 'Member added');
    } catch (err: any) {
      addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 60));
    } finally {
      setIsAddingMember(false);
    }
  };

  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">DAO Treasury</h1>
        <p className="text-text-secondary">Encrypted budget proposals — vote tallies and allocations hidden via FHE</p>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <Landmark className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-text-secondary">
          <span className="text-primary font-bold">FHE governance</span> — budgets as <code className="font-mono">euint64</code>, votes as <code className="font-mono">euint32</code> via <code className="font-mono">FHE.add</code>.
          Quorum: <code className="font-mono">FHE.gte(votesFor, quorum)</code> — two-phase decrypt decides outcome.
        </p>
      </div>

      {!isDeployed && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-400">Run <code className="font-mono">npx hardhat run scripts/deploy-dao.cts --network eth-sepolia</code></p>
        </div>
      )}

      {isDeployed && isMember === false && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
          <Users className="w-4 h-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-400">You are not a DAO member. Ask the owner to add you.</p>
        </div>
      )}

      {isDeployed && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Members', value: memberCount ? String(memberCount) : '—' },
            { label: 'Proposals', value: String(proposals.length) },
            { label: 'Your status', value: isMember ? '✓ Member' : 'Non-member' },
          ].map(s => (
            <div key={s.label} className="bg-surface-1 border border-border-default rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{s.value}</p>
              <p className="text-xs text-text-muted uppercase tracking-widest mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-border-default">
        {(['proposals', 'create', 'members'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`relative px-6 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === tab ? 'text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
            {tab === 'proposals' ? `Proposals${proposals.length ? ` (${proposals.length})` : ''}` : tab === 'create' ? 'New Proposal' : 'Members'}
            {activeTab === tab && <motion.div layoutId="dao-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ── Proposals ───────────────────────────────────────────────────────── */}
        {activeTab === 'proposals' && (
          <motion.div key="proposals" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {proposals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-6 bg-surface-1 border border-border-default rounded-[32px]">
                <Landmark className="w-16 h-16 text-text-dim" />
                <div className="text-center space-y-2">
                  <p className="text-xl font-bold text-white">No proposals</p>
                  <p className="text-text-secondary">Create the first encrypted DAO proposal</p>
                </div>
                <Button onClick={() => setActiveTab('create')}>Create Proposal</Button>
              </div>
            ) : (
              <div className="space-y-4">
                {proposals.map(p => {
                  const s = STATUS_LABELS[p.status] || STATUS_LABELS[0];
                  const isVoting = p.status === 0;
                  const deadlinePassed = Date.now() > p.voteDeadline * 1000;
                  const canCheckQuorum = isVoting && deadlinePassed && p.proposalId === checkingId || (!checkingId && isVoting && deadlinePassed);
                  const logs = actionLog[p.proposalId] || [];

                  return (
                    <div key={p.proposalId} className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-lg font-bold text-white">{p.title}</h3>
                          {p.description && <p className="text-sm text-text-secondary mt-1">{p.description}</p>}
                        </div>
                        <span className={`px-2 py-1 rounded-md border text-xs font-bold uppercase tracking-widest ${s.color}`}>{s.label}</span>
                      </div>

                      <div className="grid grid-cols-4 gap-4 text-sm">
                        <div><p className="text-text-muted text-xs mb-1">Budget</p><p className="text-primary flex items-center gap-1"><Lock className="w-3 h-3" /> Encrypted</p></div>
                        <div><p className="text-text-muted text-xs mb-1">Quorum</p><p className="text-white">{p.quorum} votes</p></div>
                        <div><p className="text-text-muted text-xs mb-1">Funded</p><p className="text-white">{p.ethFunded} ETH</p></div>
                        <div><p className="text-text-muted text-xs mb-1">Deadline</p><p className={`text-sm ${deadlinePassed ? 'text-yellow-400' : 'text-white'}`}>{new Date(p.voteDeadline * 1000).toLocaleDateString('en-US')}</p></div>
                      </div>

                      {/* Voting buttons */}
                      {isVoting && !deadlinePassed && isMember && (
                        <div className="flex items-center gap-3 pt-2 border-t border-border-default">
                          <span className="text-xs text-text-muted">Vote:</span>
                          <Button variant="outline" size="sm" className="gap-2 flex-1"
                            disabled={!!votingId}
                            onClick={() => handleVote(p.proposalId, true)}>
                            {votingId === p.proposalId + '_for' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5 text-primary" />}
                            For
                          </Button>
                          <Button variant="outline" size="sm" className="gap-2 flex-1"
                            disabled={!!votingId}
                            onClick={() => handleVote(p.proposalId, false)}>
                            {votingId === p.proposalId + '_against' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ThumbsDown className="w-3.5 h-3.5 text-red-400" />}
                            Against
                          </Button>
                        </div>
                      )}

                      {/* Check quorum button — after deadline */}
                      {isVoting && deadlinePassed && (
                        <div className="space-y-3 pt-2 border-t border-border-default">
                          <p className="text-xs text-yellow-400 flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5" /> Vote period ended — check quorum result
                          </p>
                          <Button className="w-full gap-2" size="sm"
                            disabled={checkingId === p.proposalId}
                            onClick={() => handleCheckQuorum(p)}>
                            {checkingId === p.proposalId
                              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Checking...</>
                              : <><Zap className="w-4 h-4" /> Check Quorum (Two-Phase FHE Decrypt)</>}
                          </Button>
                          {logs.length > 0 && <FheTerminal logs={logs} active={checkingId === p.proposalId} />}
                        </div>
                      )}

                      {/* Execute button */}
                      {p.status === 1 && (
                        <div className="space-y-3 pt-2 border-t border-border-default">
                          <p className="text-xs text-primary flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5" /> Proposal passed — execute to send ETH</p>
                          <div className="flex gap-2">
                            <input type="number" min="0" step="0.001" placeholder="ETH to send (or pre-funded)"
                              value={executeEth[p.proposalId] || ''} onChange={e => setExecuteEth(prev => ({ ...prev, [p.proposalId]: e.target.value }))}
                              className="flex-1 h-10 px-3 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                            <Button className="px-6 gap-2" disabled={executingId === p.proposalId} onClick={() => handleExecute(p)}>
                              {executingId === p.proposalId ? <RefreshCw className="w-4 h-4 animate-spin" /> : <><DollarSign className="w-4 h-4" /> Execute</>}
                            </Button>
                          </div>
                          <p className="text-xs text-text-muted">Sends ETH to <code className="font-mono">{p.recipient.slice(0, 10)}...</code></p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {/* ── Create ──────────────────────────────────────────────────────────── */}
        {activeTab === 'create' && (
          <motion.div key="create" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-2xl space-y-6">
            {createDone ? (
              <div className="flex flex-col items-center text-center space-y-6 py-16 bg-surface-1 border border-border-default rounded-[32px]">
                <div className="w-20 h-20 bg-primary/10 rounded-[24px] flex items-center justify-center"><CheckCircle className="w-10 h-10 text-primary" /></div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-white">Proposal Created</h2>
                  <p className="text-text-secondary">Members can now vote — encrypted tallies via FHE.add</p>
                </div>
                <div className="p-4 bg-surface-2 rounded-2xl text-left w-full max-w-sm space-y-2">
                  <p className="text-xs text-text-secondary">✓ Budget encrypted as euint64</p>
                  <p className="text-xs text-text-secondary">✓ Votes counted via FHE.add(votesFor, 1)</p>
                  <p className="text-xs text-text-secondary">✓ FHE.gte(votesFor, quorum) decides outcome</p>
                  <p className="text-xs text-text-secondary">✓ Two-phase publishDecryptResult for finalization</p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => { setCreateDone(false); setCreateLogs([]); setTitle(''); setDesc(''); setRecipient(''); setBudgetEth(''); setFundEth(''); }}>Create Another</Button>
                  <Button onClick={() => { setActiveTab('proposals'); refreshProposals(); }}>View Proposals</Button>
                </div>
              </div>
            ) : (
              <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
                <h2 className="text-xl font-bold text-white">New Proposal</h2>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Title</label>
                  <input type="text" placeholder="Fund development milestone Q2" value={title} onChange={e => setTitle(e.target.value)}
                    className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Description</label>
                  <textarea placeholder="Proposal details..." value={description} onChange={e => setDesc(e.target.value)}
                    className="w-full h-24 px-4 py-3 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none resize-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Recipient Address</label>
                  <input type="text" placeholder="0x..." value={recipient} onChange={e => setRecipient(e.target.value)}
                    className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Budget ETH <span className="text-primary">(encrypted)</span></label>
                    <input type="number" min="0" step="0.001" placeholder="0.1" value={budgetEth} onChange={e => setBudgetEth(e.target.value)}
                      className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Fund Now (ETH)</label>
                    <input type="number" min="0" step="0.001" placeholder="0 (optional)" value={fundEth} onChange={e => setFundEth(e.target.value)}
                      className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Quorum (votes)</label>
                    <input type="number" min="1" value={quorum} onChange={e => setQuorum(e.target.value)}
                      className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Vote Period (days)</label>
                    <input type="number" min="1" value={voteDays} onChange={e => setVoteDays(e.target.value)}
                      className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                  </div>
                </div>
                {createLogs.length > 0 && <FheTerminal logs={createLogs} active={isCreating} />}
                <Button className="w-full h-12 gap-2" onClick={handleCreate}
                  disabled={isCreating || !isDeployed || !isFheReady || !title || !recipient || !budgetEth}>
                  {isCreating ? <><RefreshCw className="w-4 h-4 animate-spin" /> Encrypting & Creating...</> : <><Lock className="w-4 h-4" /> Create Proposal</>}
                </Button>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Members ─────────────────────────────────────────────────────────── */}
        {activeTab === 'members' && (
          <motion.div key="members" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-lg space-y-6">
            <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
              <h2 className="text-xl font-bold text-white">DAO Members</h2>
              <div className="p-4 bg-surface-2 rounded-2xl flex items-center justify-between">
                <span className="text-text-secondary text-sm">Total members</span>
                <span className="text-white font-bold text-2xl">{memberCount ? String(memberCount) : '—'}</span>
              </div>
              <div className="space-y-3">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Add Member (owner only)</label>
                <div className="flex gap-2">
                  <input type="text" placeholder="0x..." value={memberToAdd} onChange={e => setMemberToAdd(e.target.value)}
                    className="flex-1 h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none" />
                  <Button className="px-6" onClick={handleAddMember} disabled={isAddingMember || !memberToAdd}>
                    {isAddingMember ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
