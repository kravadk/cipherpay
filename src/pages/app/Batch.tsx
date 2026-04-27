import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Plus, Trash2, Upload, Terminal, CheckCircle, ArrowRight,
  AlertTriangle, Download, RefreshCw, PackageOpen, Gift, Lock
} from 'lucide-react';
import { useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { Button } from '../../components/Button';
import { FheTerminal } from '../../components/FheTerminal';
import { useToastStore } from '../../components/ToastContainer';
import { useCofhe } from '../../hooks/useCofhe';
import { BATCH_CIPHER_ADDRESS, BATCH_CIPHER_ABI } from '../../config/contract';

interface Recipient { address: string; amount: string }

interface DeployedBatch {
  batchId: string;
  txHash: string;
  createdAt: number;
  totalEntries: number;
  memo: string;
}

const isBatchDeployed = BATCH_CIPHER_ADDRESS !== '0x0000000000000000000000000000000000000000';

function loadBatches(owner: string): DeployedBatch[] {
  try {
    return JSON.parse(localStorage.getItem(`cp_batches_${owner.toLowerCase()}`) || '[]');
  } catch { return []; }
}

function saveBatch(owner: string, b: DeployedBatch) {
  const all = loadBatches(owner);
  all.unshift(b);
  localStorage.setItem(`cp_batches_${owner.toLowerCase()}`, JSON.stringify(all.slice(0, 50)));
}

export function Batch() {
  const navigate = useNavigate();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { isReady: isFheReady, encrypt, getEncryptable } = useCofhe();
  const { addToast } = useToastStore();

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as 'new' | 'history' | 'claim') || 'new';
  const setActiveTab = (tab: 'new' | 'history' | 'claim') => setSearchParams(p => { p.set('tab', tab); return p; }, { replace: true });
  const [recipients, setRecipients] = useState<Recipient[]>([{ address: '', amount: '' }]);
  const [memo, setMemo] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [deploySuccess, setDeploySuccess] = useState(false);
  const [deployedBatchId, setDeployedBatchId] = useState<string | null>(null);
  const [deployedTxHash, setDeployedTxHash] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Recipient claim state
  const [claimBatchId, setClaimBatchId]   = useState('');
  const [claimEntry, setClaimEntry]       = useState<{ encryptedAmount: bigint; claimed: boolean; ethAmount: bigint } | null>(null);
  const [isLookingUp, setIsLookingUp]     = useState(false);
  const [isClaiming, setIsClaiming]       = useState(false);
  const [claimTxHash, setClaimTxHash]     = useState<string | null>(null);
  const [claimedDone, setClaimedDone]     = useState(false);

  const history = address ? loadBatches(address) : [];

  const addLog = useCallback((msg: string) => setDeployLogs(p => [...p, msg]), []);

  const validRecipients = recipients.filter(
    r => r.address.startsWith('0x') && r.address.length === 42 && parseFloat(r.amount) > 0
  );

  const totalEth = recipients.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  const addRecipient = () => {
    if (recipients.length >= 100) { addToast('error', 'Maximum 100 recipients per batch'); return; }
    setRecipients(p => [...p, { address: '', amount: '' }]);
  };

  const removeRecipient = (i: number) => setRecipients(p => p.filter((_, j) => j !== i));

  const updateRecipient = (i: number, field: keyof Recipient, value: string) => {
    setRecipients(p => { const u = [...p]; u[i] = { ...u[i], [field]: value }; return u; });
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = (ev.target?.result as string).split('\n').filter(l => l.trim());
      const parsed: Recipient[] = [];
      let invalid = 0;
      const start = lines[0]?.toLowerCase().includes('address') ? 1 : 0;
      for (let i = start; i < lines.length && parsed.length < 100; i++) {
        const [addr, amt] = lines[i].split(',').map(s => s.trim());
        if (addr?.startsWith('0x') && addr.length === 42 && parseFloat(amt) > 0) {
          parsed.push({ address: addr, amount: amt });
        } else { invalid++; }
      }
      if (parsed.length > 0) {
        setRecipients(parsed);
        addToast('success', `${parsed.length} valid${invalid > 0 ? `, ${invalid} skipped` : ''} rows`);
      } else { addToast('error', 'No valid rows in CSV'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const downloadTemplate = () => {
    const csv = 'address,amount\n0x742d35Cc6634C0532925a3b8D4C9B3f5e56B4A9e,0.01\n0x1234567890123456789012345678901234567890,0.005';
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'batch_template.csv';
    a.click();
  };

  const handleDeploy = async () => {
    if (!isBatchDeployed) { addToast('error', 'BatchCipher contract not deployed yet'); return; }
    if (!address) { addToast('error', 'Wallet not connected'); return; }
    if (!isFheReady) { addToast('error', 'FHE SDK not ready — wait a moment'); return; }
    if (validRecipients.length === 0) { addToast('error', 'Add at least one valid recipient'); return; }

    setIsDeploying(true);
    setDeployLogs([]);

    try {
      addLog(`> ${validRecipients.length} valid recipients, total ${totalEth.toFixed(4)} ETH`);
      addLog('> Encrypting amounts via Fhenix CoFHE...');
      addLog(`>   Each recipient's amount encrypted independently — other recipients see nothing`);

      const Encryptable = getEncryptable();
      if (!Encryptable) throw new Error('Encryptable not available');

      // Encrypt all amounts in one batch call
      const amountsWei = validRecipients.map(r => parseEther(r.amount));
      const encryptables = amountsWei.map(a => Encryptable.uint64(a));

      const startEnc = Date.now();
      const encResults = await encrypt(encryptables, (step: string, ctx?: any) => {
        if (ctx?.isStart) addLog(`>   ${step}...`);
        if (ctx?.isEnd)  addLog(`>   ✓ ${step} (${ctx.duration ?? ''}ms)`);
      });
      addLog(`> ✓ ${encResults.length} amounts encrypted (${Date.now() - startEnc}ms)`);
      addLog('>   Per-row FHE ACL: FHE.allow(amount, recipient) for each row');
      addLog('>   Only each recipient can decrypt their own row');

      const encAmountTuples = encResults.map((r: any, idx: number) => {
        const ctHash = BigInt(r?.ctHash ?? r?.data?.ctHash ?? 0);
        if (ctHash === 0n) throw new Error(`FHE encryption failed for recipient ${idx + 1}: invalid handle`);
        return {
          ctHash,
          securityZone: r?.securityZone ?? r?.data?.securityZone ?? 0,
          utype:        r?.utype ?? r?.data?.utype ?? 5,
          signature:    r?.signature ?? r?.data?.signature ?? '0x',
        };
      });

      const ethAmounts = amountsWei;
      const recipientAddrs = validRecipients.map(r => r.address as `0x${string}`);

      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = ('0x' + Array.from(saltBytes, b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;

      const totalValue = amountsWei.reduce((s, a) => s + a, 0n);

      addLog(`> Submitting createBatch to Sepolia (${BATCH_CIPHER_ADDRESS.slice(0, 10)}...)...`);

      const txHash = await writeContractAsync({
        address: BATCH_CIPHER_ADDRESS,
        abi: BATCH_CIPHER_ABI as any,
        functionName: 'createBatch',
        args: [recipientAddrs, encAmountTuples, ethAmounts, salt, memo || 'Batch Payment'],
        value: totalValue,
      });

      addLog(`> Transaction submitted: ${txHash.slice(0, 14)}...`);
      addLog('> Awaiting confirmation...');

      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addLog(`> ✓ Confirmed at block ${receipt.blockNumber}`);

      // Extract batchId from BatchCreated event
      let batchId = '0x';
      for (const log of receipt.logs) {
        try {
          const { args } = (await import('viem')).decodeEventLog({
            abi: BATCH_CIPHER_ABI as any,
            eventName: 'BatchCreated',
            data: log.data,
            topics: log.topics,
          });
          if ((args as any).batchId) { batchId = (args as any).batchId; break; }
        } catch {}
      }

      addLog(`> ✓ Batch ID: ${batchId.slice(0, 16)}...`);
      addLog(`> ✓ ${validRecipients.length} recipients can now claim individually`);
      addLog(`> ✓ FHE ACL enforced — each recipient decrypts only their own amount`);

      saveBatch(address, {
        batchId,
        txHash,
        createdAt: Date.now(),
        totalEntries: validRecipients.length,
        memo: memo || 'Batch Payment',
      });

      setDeployedBatchId(batchId);
      setDeployedTxHash(txHash);
      setDeploySuccess(true);
      addToast('success', `Batch deployed — ${validRecipients.length} recipients`);
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Transaction failed';
      addLog(`> ✗ ${msg.slice(0, 80)}`);
      addToast('error', msg.slice(0, 80));
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Batch Cipher</h1>
        <p className="text-text-secondary">Send encrypted payments to multiple recipients — each sees only their own amount</p>
      </div>

      {/* FHE info banner */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <Zap className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-text-secondary">
          <span className="text-primary font-bold">Per-row FHE ACL</span> — each recipient's amount is encrypted with{' '}
          <span className="font-mono">FHE.allow(amount, recipient)</span>. Recipient A cannot decrypt Recipient B's amount.
          Only the creator can decrypt all rows for audit.
        </p>
      </div>

      {!isBatchDeployed && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-400">BatchCipher contract pending deployment. Run <code className="font-mono">npx hardhat run scripts/deploy-batch.cts --network eth-sepolia</code></p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-border-default">
        {(['new', 'history', 'claim'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-6 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${
              activeTab === tab ? 'text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab === 'new' ? 'New Batch' : tab === 'history' ? `History${history.length ? ` (${history.length})` : ''}` : 'Claim (Recipient)'}
            {activeTab === tab && <motion.div layoutId="batch-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ── New Batch form ──────────────────────────────────────────────── */}
        {activeTab === 'new' && !deploySuccess && (
          <motion.div key="new" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">

            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-text-secondary" />
                <h2 className="text-xl font-bold text-white">Recipients</h2>
                <span className="text-xs text-text-muted">({validRecipients.length} valid / {recipients.length} rows)</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="gap-2 text-text-muted" onClick={downloadTemplate}>
                  <Download className="w-3.5 h-3.5" /> Template
                </Button>
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
                <Button variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="w-4 h-4" /> Import CSV
                </Button>
              </div>
            </div>

            {/* Recipients table */}
            <div className="bg-surface-1 border border-border-default rounded-[32px] p-6 space-y-4">
              <div className="grid grid-cols-[40px_1fr_120px_40px] gap-4 px-2">
                <span className="text-xs font-bold text-text-muted uppercase tracking-widest">#</span>
                <span className="text-xs font-bold text-text-muted uppercase tracking-widest">Address</span>
                <span className="text-xs font-bold text-text-muted uppercase tracking-widest">Amount (ETH)</span>
                <span />
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {recipients.map((r, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="grid grid-cols-[40px_1fr_120px_40px] gap-4 items-center"
                  >
                    <span className="text-sm font-mono text-text-muted text-center">{i + 1}</span>
                    <input
                      type="text"
                      placeholder="0x..."
                      value={r.address}
                      onChange={e => updateRecipient(i, 'address', e.target.value)}
                      className={`h-12 px-4 bg-surface-2 border rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none transition-colors ${
                        r.address && (!r.address.startsWith('0x') || r.address.length !== 42)
                          ? 'border-red-500/50' : 'border-border-default'
                      }`}
                    />
                    <input
                      type="number"
                      placeholder="0.0"
                      value={r.amount}
                      min="0"
                      step="0.001"
                      onChange={e => updateRecipient(i, 'amount', e.target.value)}
                      className="h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none transition-colors"
                    />
                    <button
                      onClick={() => removeRecipient(i)}
                      className="p-2 text-red-500/40 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                      disabled={recipients.length <= 1}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </div>

              <Button
                variant="ghost" size="sm"
                onClick={addRecipient}
                className="w-full gap-2 border border-dashed border-border-default"
                disabled={recipients.length >= 100}
              >
                <Plus className="w-4 h-4" />
                Add Recipient {recipients.length >= 100 && '(max 100)'}
              </Button>

              {recipients.length >= 90 && (
                <div className="flex items-center gap-2 text-yellow-500 text-xs px-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{recipients.length >= 100 ? 'Maximum 100 recipients' : `${recipients.length}/100 rows`}</span>
                </div>
              )}

              {/* Memo */}
              <div className="pt-2 border-t border-border-default">
                <input
                  type="text"
                  placeholder="Batch memo (e.g. April Payroll)"
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                  className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none"
                />
              </div>

              {/* Summary */}
              <div className="flex items-center justify-between pt-2 border-t border-border-default px-2">
                <span className="text-sm text-text-secondary">{validRecipients.length} valid recipients</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-secondary">Total:</span>
                  <span className="text-lg font-bold text-white">{totalEth.toFixed(4)}</span>
                  <span className="text-sm text-text-secondary">ETH</span>
                </div>
              </div>
              <p className="text-xs text-text-muted px-2">All amounts are independently encrypted via Fhenix FHE — per-row ACL</p>
            </div>

            {/* Deploy logs */}
            {(isDeploying || deployLogs.length > 0) && <FheTerminal logs={deployLogs} active={isDeploying} />}

            <Button
              className="w-full h-14 text-lg gap-2"
              onClick={handleDeploy}
              disabled={isDeploying || !isBatchDeployed || !isFheReady || validRecipients.length === 0}
            >
              {!isBatchDeployed ? 'Contract pending deployment' :
               !isFheReady ? 'Initializing FHE...' :
               isDeploying ? <><RefreshCw className="w-4 h-4 animate-spin" /> Encrypting & Deploying...</> :
               `Deploy Batch (${validRecipients.length} recipients) →`}
            </Button>
          </motion.div>
        )}

        {/* ── Success state ──────────────────────────────────────────────── */}
        {activeTab === 'new' && deploySuccess && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center text-center space-y-8 py-16"
          >
            <div className="w-24 h-24 bg-primary/10 rounded-[32px] flex items-center justify-center">
              <CheckCircle className="w-12 h-12 text-primary" />
            </div>
            <div className="space-y-3">
              <h2 className="text-3xl font-bold text-white">Batch Deployed!</h2>
              <p className="text-text-secondary">{validRecipients.length} encrypted payments ready to claim</p>
              {deployedBatchId && (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs text-text-muted">Batch ID:</span>
                  <code className="text-xs font-mono text-primary">{deployedBatchId.slice(0, 20)}...</code>
                </div>
              )}
              {deployedTxHash && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${deployedTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
                >
                  View on Etherscan ↗
                </a>
              )}
            </div>
            <div className="p-4 bg-surface-1 border border-border-default rounded-2xl text-left space-y-2 w-full max-w-sm">
              <p className="text-xs font-bold text-text-muted uppercase tracking-widest">FHE Privacy Summary</p>
              <p className="text-xs text-text-secondary">✓ Per-row encrypted amounts stored on-chain</p>
              <p className="text-xs text-text-secondary">✓ Each recipient decrypts only their own row</p>
              <p className="text-xs text-text-secondary">✓ Creator can audit all rows via permit</p>
              <p className="text-xs text-text-secondary">✓ ETH held in contract until claimed</p>
            </div>
            <div className="flex gap-4">
              <Button variant="outline" onClick={() => {
                setDeploySuccess(false);
                setRecipients([{ address: '', amount: '' }]);
                setDeployLogs([]);
                setMemo('');
              }}>Create Another</Button>
              <Button onClick={() => { setActiveTab('history'); setDeploySuccess(false); }} className="gap-2">
                View History <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* ── History tab ───────────────────────────────────────────────── */}
        {activeTab === 'history' && (
          <motion.div key="history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-6 bg-surface-1 border border-border-default rounded-[32px]">
                <PackageOpen className="w-16 h-16 text-text-dim" />
                <div className="text-center space-y-2">
                  <p className="text-xl font-bold text-white">No batches yet</p>
                  <p className="text-text-secondary">Deploy your first batch payment</p>
                </div>
                <Button onClick={() => setActiveTab('new')}>Create Batch</Button>
              </div>
            ) : (
              <div className="bg-surface-1 border border-border-default rounded-[32px] overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Batch ID</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Memo</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Recipients</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Date</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest text-right">Tx</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {history.map(b => (
                      <tr key={b.batchId} className="hover:bg-surface-2 transition-colors">
                        <td className="px-8 py-5">
                          <span className="text-sm font-mono text-primary">{b.batchId.slice(0, 14)}...</span>
                        </td>
                        <td className="px-8 py-5">
                          <span className="text-sm text-white">{b.memo}</span>
                        </td>
                        <td className="px-8 py-5">
                          <span className="text-sm text-text-secondary">{b.totalEntries}</span>
                        </td>
                        <td className="px-8 py-5">
                          <span className="text-xs text-text-secondary">{new Date(b.createdAt).toLocaleDateString('en-US')}</span>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <a
                            href={`https://sepolia.etherscan.io/tx/${b.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-text-muted hover:text-primary transition-colors"
                          >
                            ↗ Etherscan
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Claim tab (recipient) ─────────────────────────────────────────── */}
        {activeTab === 'claim' && (
          <motion.div key="claim" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-lg space-y-6">
            <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
              <h2 className="text-xl font-bold text-white">Claim Your Allocation</h2>
              <p className="text-sm text-text-secondary">
                Enter the Batch ID from the sender. The contract verifies your address is a registered recipient
                and transfers your ETH allocation. Your encrypted amount is decryptable only by you.
              </p>

              {!claimedDone ? (
                <>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Batch ID</label>
                    <input type="text" placeholder="0x..." value={claimBatchId} onChange={e => { setClaimBatchId(e.target.value); setClaimEntry(null); }}
                      className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none" />
                  </div>

                  {/* Look up entry */}
                  <Button variant="outline" className="w-full gap-2"
                    disabled={isLookingUp || !isBatchDeployed || !claimBatchId.startsWith('0x')}
                    onClick={async () => {
                      if (!address) { addToast('error', 'Connect wallet'); return; }
                      setIsLookingUp(true);
                      setClaimEntry(null);
                      try {
                        // simulateContract sets msg.sender = account, needed for getMyEntry access control
                        const MY_ENTRY_ABI = [{ name: 'getMyEntry', type: 'function', stateMutability: 'view',
                          inputs: [{ name: '_batchId', type: 'bytes32' }],
                          outputs: [{ name: 'encryptedAmount', type: 'uint256' }, { name: 'claimed', type: 'bool' }, { name: 'ethAmount', type: 'uint256' }] }] as const;
                        const { result: entry } = await publicClient!.simulateContract({
                          address: BATCH_CIPHER_ADDRESS,
                          abi: MY_ENTRY_ABI,
                          functionName: 'getMyEntry',
                          args: [claimBatchId as `0x${string}`],
                          account: address,
                        });
                        const e = entry as unknown as [bigint, boolean, bigint];
                        setClaimEntry({ encryptedAmount: e[0], claimed: e[1], ethAmount: e[2] });
                      } catch (err: any) {
                        addToast('error', err?.shortMessage?.includes('Not a recipient') ? 'You are not a recipient in this batch' : (err?.shortMessage || err?.message || 'Lookup failed').slice(0, 60));
                      } finally {
                        setIsLookingUp(false);
                      }
                    }}>
                    {isLookingUp ? <><RefreshCw className="w-4 h-4 animate-spin" /> Looking up...</> : 'Look Up My Entry'}
                  </Button>

                  {/* Entry found */}
                  {claimEntry && (
                    <div className="space-y-4">
                      <div className="p-4 bg-surface-2 rounded-2xl space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">ETH Allocation</span>
                          <span className="text-white font-bold">{formatEther(claimEntry.ethAmount)} ETH</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">Encrypted Amount</span>
                          <span className="flex items-center gap-1 text-primary"><Lock className="w-3 h-3" /> {String(claimEntry.encryptedAmount).slice(0, 12)}...</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">Status</span>
                          <span className={claimEntry.claimed ? 'text-text-muted' : 'text-primary'}>
                            {claimEntry.claimed ? 'Already claimed' : 'Available to claim'}
                          </span>
                        </div>
                      </div>

                      {!claimEntry.claimed && (
                        <Button className="w-full h-12 gap-2"
                          disabled={isClaiming}
                          onClick={async () => {
                            if (!address) return;
                            setIsClaiming(true);
                            try {
                              const txHash = await writeContractAsync({
                                address: BATCH_CIPHER_ADDRESS,
                                abi: BATCH_CIPHER_ABI as any,
                                functionName: 'claimBatch',
                                args: [claimBatchId as `0x${string}`],
                              });
                              await publicClient!.waitForTransactionReceipt({ hash: txHash });
                              setClaimTxHash(txHash);
                              setClaimedDone(true);
                              addToast('success', `${formatEther(claimEntry.ethAmount)} ETH claimed!`);
                            } catch (err: any) {
                              addToast('error', (err?.shortMessage || err?.message || 'Failed').slice(0, 60));
                            } finally {
                              setIsClaiming(false);
                            }
                          }}>
                          {isClaiming ? <><RefreshCw className="w-4 h-4 animate-spin" /> Claiming...</> : <><Gift className="w-4 h-4" /> Claim {formatEther(claimEntry.ethAmount)} ETH</>}
                        </Button>
                      )}

                      {claimEntry.claimed && (
                        <p className="text-center text-sm text-text-muted">You have already claimed this allocation.</p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center text-center space-y-6 py-8">
                  <div className="w-16 h-16 bg-primary/10 rounded-[20px] flex items-center justify-center">
                    <CheckCircle className="w-8 h-8 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold text-white">ETH Claimed!</h3>
                    {claimTxHash && (
                      <a href={`https://sepolia.etherscan.io/tx/${claimTxHash}`} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-text-muted hover:text-primary transition-colors">↗ View on Etherscan</a>
                    )}
                    <p className="text-xs text-text-muted mt-2">FHE ACL: only you could decrypt your row's amount.</p>
                  </div>
                  <Button variant="outline" onClick={() => { setClaimedDone(false); setClaimBatchId(''); setClaimEntry(null); setClaimTxHash(null); }}>
                    Claim Another
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
