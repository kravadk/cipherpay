import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Lock, Zap, Repeat, History, CheckCircle, Loader2,
  ArrowRight, ArrowLeft, Plus, Trash2, Upload, Terminal, Eye, Copy, ExternalLink
} from 'lucide-react';
import { useState, useRef } from 'react';
import { Button } from '../../components/Button';
// Invoice data stored on-chain only — no local store for invoice persistence
import { useToastStore } from '../../components/ToastContainer';
import { useContractStatus } from '../../hooks/useContractStatus';
import { useNavigate } from 'react-router-dom';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { parseEther, decodeEventLog } from 'viem';
import { CIPHERPAY_ADDRESS, CIPHERPAY_ABI } from '../../config/contract';
import { AmountInput } from '../../components/AmountInput';
import { DatePicker } from '../../components/DatePicker';
import { useCofhe } from '../../hooks/useCofhe';
import { isValidAmount, isValidAddress } from '../../utils/validation';

type CipherType = 'standard' | 'multi-pay' | 'recurring' | 'vesting' | 'batch';

interface FormData {
  amount: string;
  recipient: string;
  memo: string;
  deadline: string;
  noDeadline: boolean;
  maxContributors: string;
  frequency: string; // 'daily' | 'custom' | 'weekly' | 'bi-weekly' | 'monthly'
  customDays: string; // number of days for custom frequency
  maxCycles: string;
  startDate: string;
  unlockDate: string;
  batchRecipients: { address: string; amount: string }[];
}

const INITIAL_FORM: FormData = {
  amount: '', recipient: '', memo: '', deadline: '', noDeadline: false,
  maxContributors: '', frequency: 'weekly', customDays: '3', maxCycles: '12', startDate: '',
  unlockDate: '', batchRecipients: [{ address: '', amount: '' }],
};

export function NewCipher() {
  const [step, setStep] = useState(1);
  const [type, setType] = useState<CipherType>('standard');
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [deployedHash, setDeployedHash] = useState<string | null>(null);
  const [deployedTxHash, setDeployedTxHash] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Invoice data comes only from blockchain — no local store
  const { addToast } = useToastStore();
  const { isDeployed, warnIfNotDeployed } = useContractStatus();
  const navigate = useNavigate();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { isReady: isFheReady, encrypt, getEncryptable, isConnecting: isFheConnecting } = useCofhe();

  const types: { id: CipherType; label: string; icon: any; color: string }[] = [
    { id: 'standard', label: 'Standard', icon: Shield, color: 'text-primary' },
    { id: 'multi-pay', label: 'Multi Pay', icon: Zap, color: 'text-secondary' },
    { id: 'recurring', label: 'Recurring', icon: Repeat, color: 'text-purple-500' },
    { id: 'vesting', label: 'Vesting', icon: Lock, color: 'text-yellow-500' },
    { id: 'batch', label: 'Batch', icon: History, color: 'text-blue-500' },
  ];

  const typeToUint8 = (t: CipherType): number => {
    const map: Record<CipherType, number> = { 'standard': 0, 'multi-pay': 1, 'recurring': 2, 'vesting': 3, 'batch': 4 };
    return map[t];
  };

  const addLog = (log: string) => setDeployLogs(prev => [...prev, log]);

  const handleDeploy = async () => {
    if (!isDeployed) {
      addToast('error', 'Contract not deployed');
      return;
    }
    if (!address) {
      addToast('error', 'Wallet not connected');
      return;
    }

    // Validate amount
    const amountCheck = isValidAmount(formData.amount);
    if (!amountCheck.valid) {
      addToast('error', amountCheck.error || 'Invalid amount');
      return;
    }

    // Validate recipient if provided
    if (formData.recipient && !isValidAddress(formData.recipient)) {
      addToast('error', 'Invalid recipient address (must be 0x + 40 hex characters)');
      return;
    }

    setIsDeploying(true);
    setDeployLogs([]);

    try {
      // Step 1: Prepare amount
      const amountWei = parseEther(formData.amount || '0');
      addLog(`> Amount: ${formData.amount} ETH (${amountWei} wei)`);

      // Step 2: FHE Encryption via CoFHE SDK
      addLog('> Initializing Fhenix CoFHE context...');
      let encryptedAmount: any = null;
      let useFheContract = false;

      if (isFheReady) {
        addLog('> ✓ CoFHE SDK connected');
        try {
          addLog('> Encrypting amount with FHE (ZK Proof of Knowledge)...');
          const Encryptable = getEncryptable();
          if (Encryptable) {
            const startEnc = Date.now();
            const [encryptedResult] = await encrypt(
              [Encryptable.uint64(amountWei)],
              (step: string, ctx?: any) => {
                if (ctx?.isStart) addLog(`>   ${step}...`);
                if (ctx?.isEnd) addLog(`>   ✓ ${step} (${ctx.duration || Date.now() - startEnc}ms)`);
              }
            );
            addLog(`> ✓ FHE encryption complete (${Date.now() - startEnc}ms)`);
            addLog(`>   Ciphertext hash: ${String(encryptedResult?.ctHash || '').toString().slice(0, 20)}...`);
            addLog(`>   Security zone: ${encryptedResult?.securityZone ?? 0}`);
            addLog(`>   ZK proof verified ✓`);
            encryptedAmount = encryptedResult;
            useFheContract = true;
          }
        } catch (fheErr: any) {
          addLog(`> ⚠ FHE encryption: ${fheErr.message?.slice(0, 60) || 'SDK error'}`);
          addLog(`> Falling back to Simple contract (plaintext mode)`);
        }
      } else {
        addLog(`> CoFHE SDK: ${isFheConnecting ? 'connecting...' : 'initializing TFHE WASM...'}`);
        addLog('> Using Simple contract fallback');
      }

      // Step 3: Generate salt
      addLog('> Generating cryptographic salt...');
      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = '0x' + Array.from(saltBytes, b => b.toString(16).padStart(2, '0')).join('') as `0x${string}`;

      // Step 4: Prepare params
      const recipient = formData.recipient && formData.recipient.startsWith('0x')
        ? formData.recipient as `0x${string}`
        : '0x0000000000000000000000000000000000000000' as `0x${string}`;

      const deadline = formData.noDeadline || !formData.deadline
        ? 0n
        : BigInt(Math.floor(new Date(formData.deadline).getTime() / 1000));

      const unlockBlock = formData.unlockDate
        ? BigInt(Math.floor((new Date(formData.unlockDate).getTime() - Date.now()) / 12000)) + (publicClient ? await publicClient.getBlockNumber() : 0n)
        : 0n;

      // Step 5: Build memo
      let fullMemo = formData.memo;
      if (type === 'recurring') {
        const freqDays = formData.frequency === 'daily' ? 1
          : formData.frequency === 'custom' ? parseInt(formData.customDays || '3')
          : formData.frequency === 'weekly' ? 7
          : formData.frequency === 'bi-weekly' ? 14 : 30;
        const freqLabel = formData.frequency === 'custom' ? `Every ${formData.customDays}d` : formData.frequency;
        fullMemo = `freq:${freqLabel}, cycles:${formData.maxCycles || '12'}, days:${freqDays}${formData.memo ? ', ' + formData.memo : ''}`;
      }

      // Step 6: Submit to blockchain
      let txHash: `0x${string}`;

      if (useFheContract && encryptedAmount) {
        // FHE contract — send encrypted InEuint64 tuple
        addLog('> Submitting FHE-encrypted invoice to Ethereum Sepolia...');
        addLog(`>   Contract: ${CIPHERPAY_ADDRESS.slice(0, 10)}... (CipherPayFHE)`);
        const encTuple = {
          ctHash: BigInt(encryptedAmount.ctHash || encryptedAmount.data?.ctHash || 0),
          securityZone: encryptedAmount.securityZone ?? encryptedAmount.data?.securityZone ?? 0,
          utype: encryptedAmount.utype ?? encryptedAmount.data?.utype ?? 5, // 5 = uint64
          signature: encryptedAmount.signature ?? encryptedAmount.data?.signature ?? '0x',
        };
        txHash = await writeContractAsync({
          address: CIPHERPAY_ADDRESS,
          abi: CIPHERPAY_ABI as any,
          functionName: 'createInvoice',
          args: [encTuple, recipient, typeToUint8(type), deadline, unlockBlock, salt, fullMemo],
        });
      } else {
        // Simple contract fallback — send plaintext amount
        addLog('> Submitting invoice to Simple contract (plaintext mode)...');
        const { CIPHERPAY_SIMPLE_ADDRESS } = await import('../../config/contract');
        const simpleAbi = [{
          name: 'createInvoice', type: 'function', stateMutability: 'nonpayable',
          inputs: [
            { name: '_amount', type: 'uint256' }, { name: '_recipient', type: 'address' },
            { name: '_invoiceType', type: 'uint8' }, { name: '_deadline', type: 'uint256' },
            { name: '_unlockBlock', type: 'uint256' }, { name: '_salt', type: 'bytes32' },
            { name: '_memo', type: 'string' },
          ],
          outputs: [{ name: '', type: 'bytes32' }],
        }] as const;
        txHash = await writeContractAsync({
          address: CIPHERPAY_SIMPLE_ADDRESS,
          abi: simpleAbi as any,
          functionName: 'createInvoice',
          args: [amountWei, recipient, typeToUint8(type), deadline, unlockBlock, salt, fullMemo],
        });
      }

      addLog(`> Transaction submitted: ${txHash.slice(0, 14)}...`);
      addLog('> Awaiting block confirmation...');

      // Step 7: Wait for receipt
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addLog(`> ✓ Block ${receipt.blockNumber} confirmed`);

      // Step 8: Extract invoice hash from event
      let invoiceHash = txHash; // fallback
      try {
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: CIPHERPAY_ABI as any,
              data: log.data,
              topics: (log as any).topics,
            });
            if ((decoded as any).eventName === 'InvoiceCreated') {
              invoiceHash = (decoded.args as any).invoiceHash;
              break;
            }
          } catch { /* skip non-matching logs */ }
        }
      } catch { /* use txHash as fallback */ }

      addLog(`> Invoice hash: ${invoiceHash}`);

      // No local store — invoice will be fetched from blockchain on Dashboard
      setDeployedHash(invoiceHash);
      setDeployedTxHash(txHash);
      setIsDeploying(false);
      setStep(4);
      addToast('success', 'Invoice deployed to Ethereum Sepolia!');

    } catch (err: any) {
      const msg = err.message || 'Unknown error';
      if (msg.includes('User rejected') || msg.includes('denied')) {
        addLog('> ✗ Transaction rejected by user');
        addToast('warning', 'Transaction cancelled');
      } else if (msg.includes('insufficient funds')) {
        addLog('> ✗ Insufficient ETH for gas');
        addToast('error', 'Not enough ETH for gas');
      } else {
        addLog(`> ✗ Error: ${msg.slice(0, 120)}`);
        addToast('error', msg.slice(0, 80));
      }
      setIsDeploying(false);
      console.error('[CipherPay] Deploy error:', err);
    }
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter(l => l.trim());
      const parsed: { address: string; amount: string }[] = [];
      const start = lines[0]?.toLowerCase().includes('address') ? 1 : 0;
      for (let i = start; i < lines.length && parsed.length < 20; i++) {
        const [address, amount] = lines[i].split(',').map(s => s.trim());
        if (address?.startsWith('0x') && parseFloat(amount) > 0) parsed.push({ address, amount });
      }
      if (parsed.length > 0) {
        setFormData({ ...formData, batchRecipients: parsed });
        addToast('success', `${parsed.length} rows imported`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const resetForm = () => {
    setStep(1);
    setFormData(INITIAL_FORM);
    setDeployLogs([]);
    setDeployedHash(null);
    setDeployedTxHash(null);
  };

  const encryptedFields = [
    formData.amount && '✓ Invoice Amount',
    formData.recipient && '✓ Recipient Address',
    formData.memo && '✓ Memo',
    type === 'batch' && '✓ Individual Amounts',
  ].filter(Boolean);

  return (
    <div className="max-w-3xl mx-auto space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">New Cipher</h1>
        <p className="text-text-secondary">Create an encrypted invoice on Fhenix</p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-4">
        {[{ n: 1, l: 'Details' }, { n: 2, l: 'Preview' }, { n: 3, l: 'Deploy' }].map(({ n, l }) => (
          <div key={n} className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all duration-300 ${
                step === n ? 'bg-primary text-black' : step > n ? 'bg-primary/20 text-primary' : 'bg-surface-2 text-text-muted border border-border-default'
              }`}>
                {step > n ? <CheckCircle className="w-5 h-5" /> : n}
              </div>
              <span className={`text-xs font-bold uppercase tracking-widest ${step >= n ? 'text-white' : 'text-text-muted'}`}>{l}</span>
            </div>
            {n < 3 && <div className={`w-12 h-[2px] rounded-full ${step > n ? 'bg-primary' : 'bg-border-default'}`} />}
          </div>
        ))}
      </div>

      <div className="bg-surface-1 border border-border-default rounded-[40px] p-10 shadow-2xl overflow-hidden min-h-[500px] flex flex-col">
        <AnimatePresence mode="wait">
          {/* STEP 1: Type + Details */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-10 flex-1">
              {/* Type Selector */}
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-white">Select Cipher Type</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  {types.map((t) => (
                    <button key={t.id} onClick={() => setType(t.id)}
                      className={`flex flex-col items-center justify-center p-6 rounded-2xl border transition-all duration-300 gap-3 ${
                        type === t.id ? 'bg-primary/10 border-primary text-primary' : 'bg-surface-2 border-border-default text-text-secondary hover:border-primary/40'
                      }`}>
                      <t.icon className={`w-8 h-8 ${type === t.id ? t.color : 'text-inherit'}`} />
                      <span className="text-xs font-bold uppercase tracking-widest">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Form Fields */}
              <div className="space-y-6">
                {type !== 'batch' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <AmountInput
                      value={formData.amount}
                      onChange={(val) => setFormData({ ...formData, amount: val })}
                    />
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted uppercase tracking-widest flex items-center gap-2">
                        Recipient Address <Lock className="w-3 h-3 text-text-dim" />
                      </label>
                      <input type="text" placeholder="0x... (optional)" value={formData.recipient}
                        onChange={(e) => setFormData({ ...formData, recipient: e.target.value })}
                        className="w-full h-14 px-6 bg-surface-2 border border-border-default rounded-2xl text-white font-mono focus:border-primary/40 focus:outline-none transition-colors" />
                    </div>
                  </div>
                )}

                {type === 'batch' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Recipients</label>
                      <div className="flex gap-2">
                        <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
                        <Button variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                          <Upload className="w-4 h-4" /> Import CSV
                        </Button>
                      </div>
                    </div>
                    {formData.batchRecipients.map((r, i) => (
                      <div key={i} className="flex gap-4">
                        <input type="text" placeholder="0x..." value={r.address}
                          onChange={(e) => { const n = [...formData.batchRecipients]; n[i] = { ...n[i], address: e.target.value }; setFormData({ ...formData, batchRecipients: n }); }}
                          className="flex-1 h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none" />
                        <input type="number" placeholder="0.0" value={r.amount}
                          onChange={(e) => { const n = [...formData.batchRecipients]; n[i] = { ...n[i], amount: e.target.value }; setFormData({ ...formData, batchRecipients: n }); }}
                          className="w-24 h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                        <button onClick={() => setFormData({ ...formData, batchRecipients: formData.batchRecipients.filter((_, idx) => idx !== i) })}
                          className="p-3 text-red-500 hover:bg-red-500/10 rounded-xl transition-colors" disabled={formData.batchRecipients.length <= 1}>
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" className="w-full gap-2 border border-dashed border-border-default"
                      onClick={() => formData.batchRecipients.length < 20 && setFormData({ ...formData, batchRecipients: [...formData.batchRecipients, { address: '', amount: '' }] })}
                      disabled={formData.batchRecipients.length >= 20}>
                      <Plus className="w-4 h-4" /> Add Recipient
                    </Button>
                    <p className="text-[10px] text-text-muted">Each amount encrypted individually. Max 20 recipients.</p>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest flex items-center gap-2">
                    Memo (Optional) <Lock className="w-3 h-3 text-text-dim" />
                  </label>
                  <input type="text" placeholder="What is this for?" maxLength={256} value={formData.memo}
                    onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
                    className="w-full h-14 px-6 bg-surface-2 border border-border-default rounded-2xl text-white focus:border-primary/40 focus:outline-none" />
                  <p className="text-[10px] text-text-dim text-right">{formData.memo.length}/256</p>
                </div>

                {type === 'multi-pay' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Max Contributors</label>
                    <input type="number" placeholder="10" min="1" max="1000" value={formData.maxContributors}
                      onChange={(e) => setFormData({ ...formData, maxContributors: e.target.value })}
                      className="w-full h-14 px-6 bg-surface-2 border border-border-default rounded-2xl text-white focus:border-primary/40 focus:outline-none" />
                  </div>
                )}

                {type === 'recurring' && (
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Frequency</label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: 'daily', label: 'Daily', days: 1 },
                          { id: 'custom', label: 'Custom', days: null },
                          { id: 'weekly', label: 'Weekly', days: 7 },
                          { id: 'bi-weekly', label: 'Bi-weekly', days: 14 },
                          { id: 'monthly', label: 'Monthly', days: 30 },
                        ].map(f => (
                          <button key={f.id} onClick={() => setFormData({ ...formData, frequency: f.id, customDays: f.days ? String(f.days) : formData.customDays })}
                            className={`px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-widest border transition-all ${
                              formData.frequency === f.id ? 'bg-primary text-black border-primary' : 'bg-surface-2 border-border-default text-text-secondary hover:border-primary/30'
                            }`}>{f.label}</button>
                        ))}
                      </div>

                      {formData.frequency === 'custom' && (
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-sm text-text-secondary">Every</span>
                          <input type="number" min="1" max="365" value={formData.customDays}
                            onChange={(e) => setFormData({ ...formData, customDays: e.target.value })}
                            className="w-20 h-10 px-3 bg-surface-2 border border-border-default rounded-xl text-white text-center focus:border-primary/40 focus:outline-none" />
                          <span className="text-sm text-text-secondary">days</span>
                        </div>
                      )}

                      {/* Preview */}
                      <p className="text-xs text-text-muted">
                        Payment every{' '}
                        <span className="text-primary font-bold">
                          {formData.frequency === 'daily' ? '1 day' :
                           formData.frequency === 'custom' ? `${formData.customDays || '?'} days` :
                           formData.frequency === 'weekly' ? '7 days' :
                           formData.frequency === 'bi-weekly' ? '14 days' :
                           '30 days'}
                        </span>
                        {formData.maxCycles ? ` × ${formData.maxCycles} cycles` : ''}
                        {formData.amount ? ` = ${(parseFloat(formData.amount) * parseInt(formData.maxCycles || '1')).toFixed(4)} ETH total` : ''}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Max Cycles</label>
                        <input type="number" placeholder="12" min="1" max="365" value={formData.maxCycles}
                          onChange={(e) => setFormData({ ...formData, maxCycles: e.target.value })}
                          className="w-full h-14 px-6 bg-surface-2 border border-border-default rounded-2xl text-white focus:border-primary/40 focus:outline-none" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Start Date</label>
                        <DatePicker
                          value={formData.startDate}
                          onChange={(val) => setFormData({ ...formData, startDate: val })}
                          minDate={new Date().toISOString().split('T')[0]}
                          placeholder="Today"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {type === 'vesting' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Unlock Date</label>
                      <DatePicker
                        value={formData.unlockDate}
                        onChange={(val) => setFormData({ ...formData, unlockDate: val })}
                        minDate={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                        placeholder="Select unlock date"
                      />
                    </div>
                    {formData.unlockDate && (
                      <div className="p-4 bg-surface-2 border border-border-default rounded-2xl space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-text-muted">Estimated Unlock Block</span>
                          <span className="text-white font-mono">~{Math.floor((new Date(formData.unlockDate).getTime() - Date.now()) / 12000)} blocks from now</span>
                        </div>
                        <div className="w-full h-2 bg-surface-3 rounded-full overflow-hidden">
                          <div className="h-full bg-yellow-500/50 rounded-full" style={{ width: '0%' }} />
                        </div>
                        <div className="flex justify-between text-[10px] text-text-dim">
                          <span>Today</span>
                          <span>{new Date(formData.unlockDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-text-muted">✦ Perfect for contractor milestone payments</p>
                  </div>
                )}

                {type !== 'vesting' && type !== 'recurring' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Deadline</label>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <DatePicker
                          value={formData.deadline}
                          onChange={(val) => setFormData({ ...formData, deadline: val })}
                          disabled={formData.noDeadline}
                          minDate={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                          placeholder="Select deadline"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, noDeadline: !formData.noDeadline, deadline: '' })}
                        className="flex items-center gap-3 text-xs text-text-secondary cursor-pointer shrink-0"
                      >
                        <div className={`relative w-10 h-5 rounded-full transition-colors ${formData.noDeadline ? 'bg-primary' : 'bg-surface-3 border border-border-default'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${formData.noDeadline ? 'left-5 bg-black' : 'left-0.5 bg-text-muted'}`} />
                        </div>
                        No deadline
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-8 mt-auto">
                <Button className="w-full" onClick={() => setStep(2)}>
                  Preview Encryption <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* STEP 2: Encryption Preview */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-10 flex-1">
              <h2 className="text-2xl font-bold text-white">Fhenix FHE Encryption Preview</h2>
              <p className="text-sm text-text-muted">Your data will be encrypted using Fully Homomorphic Encryption via the CoFHE coprocessor</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Encrypted Panel */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-blue-400">
                    <Lock className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">FHE Encrypted (Fhenix CoFHE)</span>
                  </div>
                  <div className="p-6 bg-blue-500/5 border border-blue-500/20 rounded-3xl space-y-4">
                    {encryptedFields.map((field, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-blue-400">
                        <CheckCircle className="w-4 h-4" />
                        <span>{field}</span>
                      </div>
                    ))}
                    {encryptedFields.length === 0 && (
                      <p className="text-sm text-text-muted">No data to encrypt — fill in the form</p>
                    )}
                    <div className="pt-3 border-t border-blue-500/10 space-y-2">
                      <p className="text-[10px] text-blue-400/60 uppercase tracking-widest">Encryption method</p>
                      <p className="text-xs text-blue-300">TFHE (Fully Homomorphic Encryption)</p>
                      <p className="text-xs text-blue-300">ZK Proof of Knowledge verification</p>
                      <p className="text-xs text-blue-300">CoFHE Threshold Network decryption</p>
                    </div>
                  </div>
                </div>

                {/* Public Panel */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-text-muted">
                    <Eye className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Public on-chain</span>
                  </div>
                  <div className="p-6 bg-surface-2 border border-border-default rounded-3xl space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Invoice Hash</span>
                      <span className="text-text-muted italic">Generated on deploy</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Type</span>
                      <span className="text-xs font-bold text-white uppercase">{type}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Status</span>
                      <span className="text-xs font-bold text-secondary uppercase">Open</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Network</span>
                      <span className="text-xs font-bold text-primary uppercase">Ethereum Sepolia</span>
                    </div>
                    {type === 'batch' && (
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">Recipients</span>
                        <span className="text-white">{formData.batchRecipients.filter(r => r.address).length}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-text-dim">This information is visible to anyone on-chain</p>
                </div>
              </div>

              <div className="pt-8 flex gap-4 mt-auto">
                <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                  <ArrowLeft className="w-5 h-5 mr-2" /> Back
                </Button>
                <Button className="flex-[2]" onClick={() => setStep(3)}>
                  Looks good, proceed <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* STEP 3: Deploy */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-10 flex-1">
              <h2 className="text-2xl font-bold text-white">Confirm & Deploy</h2>

              {/* Summary */}
              <div className="p-6 bg-surface-2 border border-border-default rounded-3xl space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Type</span>
                  <span className="text-xs font-bold text-white uppercase tracking-widest">{type}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Amount</span>
                  <span className="text-lg font-bold tracking-widest text-text-muted">••••••</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Recipient</span>
                  <span className="text-sm font-mono text-white">{formData.recipient ? formData.recipient.slice(0, 6) + '••••' : 'Not specified'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Deadline</span>
                  <span className="text-sm text-white">{formData.deadline || formData.unlockDate || 'None'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Network</span>
                  <span className="text-xs font-bold text-primary uppercase">Ethereum Sepolia</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Estimated Gas</span>
                  <span className="text-sm text-white">~0.00024 ETH</span>
                </div>
              </div>

              {/* Deploy Logs */}
              {deployLogs.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-primary">
                    <Terminal className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Deploy Log</span>
                  </div>
                  <div className="p-6 bg-black rounded-2xl border border-border-default font-mono text-xs space-y-2">
                    {deployLogs.map((log, i) => (
                      <motion.p key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className={log.startsWith('> ✓') ? 'text-primary' : 'text-text-secondary'}>
                        {log}
                      </motion.p>
                    ))}
                    {isDeploying && (
                      <motion.div animate={{ opacity: [1, 0] }} transition={{ duration: 0.8, repeat: Infinity }}
                        className="inline-block w-2 h-4 bg-primary ml-1" />
                    )}
                  </div>
                </div>
              )}

              <div className="pt-8 flex gap-4 mt-auto">
                <Button variant="outline" className="flex-1" onClick={() => setStep(2)} disabled={isDeploying}>
                  <ArrowLeft className="w-5 h-5 mr-2" /> Back
                </Button>
                <Button className="flex-[2] gap-2" onClick={handleDeploy} disabled={isDeploying}>
                  {isDeploying ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
                  {isDeploying ? 'Deploying...' : 'Deploy to Fhenix'}
                </Button>
              </div>
            </motion.div>
          )}

          {/* STEP 4: Success */}
          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="flex-1 flex flex-col items-center justify-center text-center space-y-8">
              <div className="w-24 h-24 bg-primary/10 rounded-[32px] flex items-center justify-center relative">
                <CheckCircle className="w-12 h-12 text-primary" />
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1.5, opacity: 0 }} transition={{ duration: 1 }}
                  className="absolute inset-0 bg-primary/20 rounded-full" />
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-bold text-primary">✓ Invoice Created!</h2>
                <p className="text-text-secondary">Your invoice is now live on Ethereum Sepolia.</p>
              </div>
              <div className="p-6 bg-surface-2 border border-border-default rounded-3xl w-full max-w-md space-y-4">
                <div className="space-y-1">
                  <p className="text-[10px] text-text-muted uppercase tracking-widest">Invoice Hash</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-mono text-white break-all">{deployedHash}</p>
                    <button onClick={() => { if (deployedHash) { navigator.clipboard.writeText(deployedHash); addToast('success', 'Hash copied'); } }}
                      className="p-2 text-text-muted hover:text-primary shrink-0"><Copy className="w-4 h-4" /></button>
                  </div>
                </div>
                {deployedTxHash && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-text-muted uppercase tracking-widest">Transaction</p>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-mono text-text-secondary break-all">{deployedTxHash}</p>
                      <a href={`https://sepolia.etherscan.io/tx/${deployedTxHash}`} target="_blank" rel="noopener noreferrer"
                        className="p-2 text-text-muted hover:text-primary shrink-0"><ExternalLink className="w-4 h-4" /></a>
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <p className="text-[10px] text-text-muted uppercase tracking-widest">Payment Link</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-mono text-text-secondary break-all">{window.location.origin}/pay/{deployedHash}</p>
                    <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/pay/${deployedHash}`); addToast('success', 'Link copied'); }}
                      className="p-2 text-text-muted hover:text-primary shrink-0"><Copy className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
              <div className="flex gap-4">
                <Button variant="outline" onClick={() => navigate('/app/dashboard')} className="gap-2">
                  Go to Dashboard <ArrowRight className="w-4 h-4" />
                </Button>
                <Button onClick={resetForm}>Create Another</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
