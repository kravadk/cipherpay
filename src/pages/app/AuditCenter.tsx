import { motion, AnimatePresence } from 'framer-motion';
import {
  FileSearch, Plus, X, CheckCircle, AlertTriangle, Shield,
  Lock, Unlock, Clock, RefreshCw, Copy, Eye, Trash2, UserCheck
} from 'lucide-react';
import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { Button } from '../../components/Button';
import { FheTerminal } from '../../components/FheTerminal';
import { useToastStore } from '../../components/ToastContainer';
import { useCofhe } from '../../hooks/useCofhe';
import { AUDIT_CENTER_ADDRESS, AUDIT_CENTER_ABI, CIPHERPAY_ADDRESS, CIPHERPAY_ABI } from '../../config/contract';

const isDeployed = AUDIT_CENTER_ADDRESS !== '0x0000000000000000000000000000000000000000';

interface AuditPackage {
  packageId: string;
  auditor: string;
  label: string;
  expiresAt: number;
  invoiceCount: number;
  scopeBitmap: number;
  txHash: string;
  createdAt: number;
}

function loadPackages(addr: string): AuditPackage[] {
  try { return JSON.parse(localStorage.getItem(`cp_auditpkgs_${addr.toLowerCase()}`) || '[]'); } catch { return []; }
}
function savePackage(addr: string, p: AuditPackage) {
  const all = loadPackages(addr);
  all.unshift(p);
  localStorage.setItem(`cp_auditpkgs_${addr.toLowerCase()}`, JSON.stringify(all.slice(0, 50)));
}

const SCOPE_LABELS = ['Amounts', 'Recipients', 'Tax data'];
const SCOPE_DESC   = ['Decrypt invoice amounts', 'Decrypt recipient addresses', 'Decrypt tax calculations'];

function scopeToString(bitmap: number): string {
  return [0, 1, 2].filter(i => (bitmap >> i) & 1).map(i => SCOPE_LABELS[i]).join(' + ') || 'None';
}

export function AuditCenter() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToastStore();

  const { decrypt, getFheTypes } = useCofhe();

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as 'packages' | 'create' | 'auditor') || 'packages';
  const setActiveTab = (tab: 'packages' | 'create' | 'auditor') => setSearchParams(p => { p.set('tab', tab); return p; }, { replace: true });

  // Auditor view state
  const [auditorPkgId, setAuditorPkgId]       = useState('');
  const [auditorInvHash, setAuditorInvHash]   = useState('');
  const [auditorField, setAuditorField]       = useState(0);
  const [isGranting, setIsGranting]           = useState(false);
  const [grantDone, setGrantDone]             = useState(false);
  const [decryptedValue, setDecryptedValue]   = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting]       = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createLogs, setCreateLogs] = useState<string[]>([]);
  const [createDone, setCreateDone] = useState(false);

  // Form state
  const [auditorAddr, setAuditorAddr]     = useState('');
  const [packageLabel, setPackageLabel]   = useState('');
  const [expiryDays, setExpiryDays]       = useState('30');
  const [scopeBitmap, setScopeBitmap]     = useState(0b001); // amounts only by default
  const [invoiceHashInput, setInvoiceHashInput] = useState('');
  const [invoiceHashes, setInvoiceHashes] = useState<string[]>([]);

  const packages = address ? loadPackages(address) : [];
  const addLog = useCallback((m: string) => setCreateLogs(p => [...p, m]), []);

  const addInvoiceHash = () => {
    const h = invoiceHashInput.trim();
    if (!h.startsWith('0x') || h.length !== 66) { addToast('error', 'Invalid invoice hash (0x + 64 hex chars)'); return; }
    if (invoiceHashes.includes(h)) { addToast('error', 'Already added'); return; }
    if (invoiceHashes.length >= 500) { addToast('error', 'Max 500 invoices per package'); return; }
    setInvoiceHashes(p => [...p, h]);
    setInvoiceHashInput('');
  };

  const toggleScope = (bit: number) => setScopeBitmap(p => p ^ (1 << bit));

  const handleCreate = async () => {
    if (!isDeployed) { addToast('error', 'Contract not deployed'); return; }
    if (!address) { addToast('error', 'Connect wallet'); return; }
    if (!auditorAddr.startsWith('0x') || auditorAddr.length !== 42) { addToast('error', 'Invalid auditor address'); return; }
    if (invoiceHashes.length === 0) { addToast('error', 'Add at least one invoice hash'); return; }
    if (scopeBitmap === 0) { addToast('error', 'Select at least one scope field'); return; }
    if (!packageLabel) { addToast('error', 'Enter a label'); return; }

    setIsCreating(true);
    setCreateLogs([]);

    try {
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + parseInt(expiryDays) * 86400);

      addLog(`> Creating audit package: "${packageLabel}"`);
      addLog(`>   Auditor: ${auditorAddr.slice(0, 10)}...`);
      addLog(`>   Invoices: ${invoiceHashes.length}`);
      addLog(`>   Scope: ${scopeToString(scopeBitmap)}`);
      addLog(`>   Expires: ${new Date(Number(expiresAt) * 1000).toLocaleDateString('en-US')}`);

      const txHash = await writeContractAsync({
        address: AUDIT_CENTER_ADDRESS,
        abi: AUDIT_CENTER_ABI as any,
        functionName: 'createAuditPackage',
        args: [
          invoiceHashes as `0x${string}`[],
          auditorAddr as `0x${string}`,
          expiresAt,
          scopeBitmap,
          packageLabel,
        ],
      });

      addLog(`> Transaction: ${txHash.slice(0, 14)}...`);
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addLog(`> ✓ Confirmed at block ${receipt.blockNumber}`);

      let packageId = '0x';
      for (const log of receipt.logs) {
        try {
          const { args } = (await import('viem')).decodeEventLog({
            abi: AUDIT_CENTER_ABI as any,
            eventName: 'AuditGranted',
            data: log.data,
            topics: log.topics,
          });
          if ((args as any).packageId) { packageId = (args as any).packageId; break; }
        } catch {}
      }

      addLog(`> ✓ Package ID: ${packageId.slice(0, 16)}...`);
      addLog('>   Auditor can now call requestAuditDecrypt() to get FHE.allow() access');
      addLog('>   Access limited to scoped fields + expiry window');

      savePackage(address, {
        packageId,
        auditor: auditorAddr,
        label: packageLabel,
        expiresAt: Number(expiresAt),
        invoiceCount: invoiceHashes.length,
        scopeBitmap,
        txHash,
        createdAt: Date.now(),
      });

      setCreateDone(true);
      addToast('success', 'Audit package created');
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Failed';
      addLog(`> ✗ ${msg.slice(0, 80)}`);
      addToast('error', msg.slice(0, 80));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Audit Center</h1>
        <p className="text-text-secondary">Scoped, time-limited disclosure permits for FHE-encrypted invoice data</p>
      </div>

      {/* Info */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <FileSearch className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs text-text-secondary space-y-1">
          <p><span className="text-primary font-bold">Scoped audit packages</span> — grant an auditor time-limited access to decrypt specific fields (amounts, recipients, or tax data) on selected invoices. Access expires automatically. Full audit trail on-chain.</p>
          <p>Example: accountant gets amounts only for Q1 invoices, no recipient addresses, expires in 30 days.</p>
        </div>
      </div>

      {!isDeployed && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-400">Contract pending deployment. Run <code className="font-mono">npx hardhat run scripts/deploy-audit.cts --network eth-sepolia</code></p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-border-default">
        {(['packages', 'create', 'auditor'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`relative px-6 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === tab ? 'text-primary' : 'text-text-muted hover:text-text-secondary'}`}
          >
            {tab === 'packages' ? `Packages${packages.length ? ` (${packages.length})` : ''}` : tab === 'create' ? 'Create Package' : 'Auditor View'}
            {activeTab === tab && <motion.div layoutId="audit-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Packages list */}
        {activeTab === 'packages' && (
          <motion.div key="packages" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {packages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-6 bg-surface-1 border border-border-default rounded-[32px]">
                <FileSearch className="w-16 h-16 text-text-dim" />
                <div className="text-center space-y-2">
                  <p className="text-xl font-bold text-white">No audit packages</p>
                  <p className="text-text-secondary">Create a scoped disclosure package for your auditor</p>
                </div>
                <Button onClick={() => setActiveTab('create')}>Create Package</Button>
              </div>
            ) : (
              <div className="space-y-4">
                {packages.map(p => (
                  <div key={p.packageId} className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-white">{p.label}</h3>
                        <p className="text-xs text-text-secondary font-mono mt-1">{p.auditor.slice(0, 10)}...{p.auditor.slice(-6)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {Date.now() < p.expiresAt * 1000 ? (
                          <span className="px-2 py-1 rounded-md border border-primary/20 bg-primary/10 text-primary text-xs font-bold">Active</span>
                        ) : (
                          <span className="px-2 py-1 rounded-md border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-bold">Expired</span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-text-muted text-xs uppercase tracking-widest mb-1">Scope</p>
                        <p className="text-white">{scopeToString(p.scopeBitmap)}</p>
                      </div>
                      <div>
                        <p className="text-text-muted text-xs uppercase tracking-widest mb-1">Invoices</p>
                        <p className="text-white">{p.invoiceCount}</p>
                      </div>
                      <div>
                        <p className="text-text-muted text-xs uppercase tracking-widest mb-1">Expires</p>
                        <p className="text-white">{new Date(p.expiresAt * 1000).toLocaleDateString('en-US')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 pt-2 border-t border-border-default">
                      <code className="text-xs font-mono text-primary flex-1 truncate">{p.packageId.slice(0, 20)}...</code>
                      <button onClick={() => navigator.clipboard.writeText(p.packageId)} className="p-1.5 text-text-muted hover:text-primary rounded-lg hover:bg-surface-2 transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                      <a href={`https://sepolia.etherscan.io/tx/${p.txHash}`} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-text-muted hover:text-primary transition-colors">↗ Etherscan</a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* Create Package */}
        {activeTab === 'create' && (
          <motion.div key="create" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-2xl space-y-6">
            {createDone ? (
              <div className="flex flex-col items-center text-center space-y-6 py-16 bg-surface-1 border border-border-default rounded-[32px]">
                <div className="w-20 h-20 bg-primary/10 rounded-[24px] flex items-center justify-center">
                  <CheckCircle className="w-10 h-10 text-primary" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-white">Package Created</h2>
                  <p className="text-text-secondary">Auditor can now decrypt scoped fields within the expiry window</p>
                </div>
                <div className="p-4 bg-surface-2 rounded-2xl text-left w-full max-w-sm space-y-2">
                  <p className="text-xs text-text-secondary">✓ FHE.allow(handle, auditor) granted per request</p>
                  <p className="text-xs text-text-secondary">✓ Access bounded by scope bitmap + expiry</p>
                  <p className="text-xs text-text-secondary">✓ Full audit trail via AuditAccessed events</p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => { setCreateDone(false); setCreateLogs([]); setInvoiceHashes([]); setAuditorAddr(''); setPackageLabel(''); }}>Create Another</Button>
                  <Button onClick={() => setActiveTab('packages')}>View Packages</Button>
                </div>
              </div>
            ) : (
              <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
                <h2 className="text-xl font-bold text-white">New Audit Package</h2>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Label</label>
                  <input type="text" placeholder="e.g. Q1 2026 Tax Audit"
                    value={packageLabel} onChange={e => setPackageLabel(e.target.value)}
                    className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Auditor Address</label>
                  <input type="text" placeholder="0x..."
                    value={auditorAddr} onChange={e => setAuditorAddr(e.target.value)}
                    className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none" />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Expiry (days)</label>
                  <input type="number" min="1" max="365" value={expiryDays} onChange={e => setExpiryDays(e.target.value)}
                    className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                </div>

                {/* Scope */}
                <div className="space-y-3">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Scope (fields auditor can decrypt)</label>
                  <div className="space-y-2">
                    {[0, 1, 2].map(bit => (
                      <button key={bit} onClick={() => toggleScope(bit)}
                        className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${
                          (scopeBitmap >> bit) & 1
                            ? 'border-primary/40 bg-primary/5 text-white'
                            : 'border-border-default bg-surface-2 text-text-secondary hover:border-border-muted'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {(scopeBitmap >> bit) & 1 ? <Unlock className="w-4 h-4 text-primary" /> : <Lock className="w-4 h-4" />}
                          <div className="text-left">
                            <p className="text-sm font-bold">{SCOPE_LABELS[bit]}</p>
                            <p className="text-xs text-text-muted">{SCOPE_DESC[bit]}</p>
                          </div>
                        </div>
                        <div className={`w-4 h-4 rounded-full border-2 ${(scopeBitmap >> bit) & 1 ? 'bg-primary border-primary' : 'border-border-default'}`} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Invoice hashes */}
                <div className="space-y-3">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Invoice Hashes ({invoiceHashes.length}/500)</label>
                  <div className="flex gap-2">
                    <input type="text" placeholder="0x..."
                      value={invoiceHashInput} onChange={e => setInvoiceHashInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addInvoiceHash()}
                      className="flex-1 h-10 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none" />
                    <Button variant="outline" size="sm" onClick={addInvoiceHash}><Plus className="w-4 h-4" /></Button>
                  </div>
                  {invoiceHashes.length > 0 && (
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {invoiceHashes.map((h, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs font-mono text-text-secondary">
                          <span className="flex-1">{h.slice(0, 20)}...</span>
                          <button onClick={() => setInvoiceHashes(p => p.filter((_, j) => j !== i))} className="p-1 text-red-500/50 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {createLogs.length > 0 && <FheTerminal logs={createLogs} active={isCreating} />}

                <Button className="w-full h-12 gap-2" onClick={handleCreate}
                  disabled={isCreating || !isDeployed || invoiceHashes.length === 0 || !auditorAddr || !packageLabel || scopeBitmap === 0}>
                  {isCreating ? <><RefreshCw className="w-4 h-4 animate-spin" /> Creating...</> : <><Shield className="w-4 h-4" /> Create Audit Package</>}
                </Button>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Auditor View ──────────────────────────────────────────────────── */}
        {activeTab === 'auditor' && (
          <motion.div key="auditor" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-lg space-y-6">
            <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
              <h2 className="text-xl font-bold text-white">Auditor — Request Decrypt Access</h2>
              <p className="text-sm text-text-secondary">
                Enter the package ID you received from the invoice creator. Select the invoice and field to audit.
                The contract grants <code className="font-mono text-primary">FHE.allow(handle, you)</code> — then decrypt via permit.
              </p>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Package ID</label>
                <input type="text" placeholder="0x..." value={auditorPkgId} onChange={e => { setAuditorPkgId(e.target.value); setGrantDone(false); setDecryptedValue(null); }}
                  className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none" />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Invoice Hash</label>
                <input type="text" placeholder="0x..." value={auditorInvHash} onChange={e => setAuditorInvHash(e.target.value)}
                  className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none" />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Field to Audit</label>
                <div className="grid grid-cols-3 gap-2">
                  {[{ label: 'Amount', bit: 0 }, { label: 'Recipient', bit: 1 }, { label: 'Tax', bit: 2 }].map(f => (
                    <button key={f.bit} onClick={() => setAuditorField(f.bit)}
                      className={`p-3 rounded-xl border text-sm font-bold transition-all ${auditorField === f.bit ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border-default bg-surface-2 text-text-secondary hover:text-white'}`}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 1: Request decrypt access */}
              {!grantDone && (
                <Button className="w-full h-12 gap-2"
                  disabled={isGranting || !isDeployed || !auditorPkgId || !auditorInvHash}
                  onClick={async () => {
                    if (!address) { addToast('error', 'Connect wallet'); return; }
                    setIsGranting(true);
                    try {
                      // Read the FHE handle for the requested field from CipherPayFHE
                      const fieldFn = auditorField === 0 ? 'getEncryptedAmount' : auditorField === 1 ? 'getEncryptedRecipient' : 'getEncryptedTax';
                      const handle = await publicClient!.readContract({
                        address: CIPHERPAY_ADDRESS,
                        abi: CIPHERPAY_ABI as any,
                        functionName: fieldFn,
                        args: [auditorInvHash as `0x${string}`],
                      });

                      if (!handle || BigInt(handle as any) === 0n) {
                        addToast('error', 'Handle not found — check invoice hash'); return;
                      }

                      // requestAuditDecrypt grants FHE.allow(handle, you)
                      const txHash = await writeContractAsync({
                        address: AUDIT_CENTER_ADDRESS,
                        abi: AUDIT_CENTER_ABI as any,
                        functionName: 'requestAuditDecrypt',
                        args: [auditorPkgId as `0x${string}`, auditorInvHash as `0x${string}`, auditorField, BigInt(handle as any)],
                      });
                      await publicClient!.waitForTransactionReceipt({ hash: txHash });
                      setGrantDone(true);
                      addToast('success', 'FHE.allow granted — you can now decrypt this field');
                    } catch (err: any) {
                      const msg = err?.shortMessage || err?.message || 'Failed';
                      addToast('error', msg.includes('Not the auditor') ? 'You are not the auditor for this package' :
                                       msg.includes('Package expired') ? 'Package has expired' :
                                       msg.includes('Field not in scope') ? 'This field is not in your audit scope' :
                                       msg.slice(0, 60));
                    } finally {
                      setIsGranting(false);
                    }
                  }}>
                  {isGranting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Requesting...</> : <><UserCheck className="w-4 h-4" /> Request FHE.allow Grant</>}
                </Button>
              )}

              {/* Step 2: Decrypt */}
              {grantDone && (
                <div className="space-y-4">
                  <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl">
                    <p className="text-sm text-primary font-bold">FHE.allow granted ✓</p>
                    <p className="text-xs text-text-secondary mt-1">You can now decrypt this field using your EIP-712 permit.</p>
                  </div>
                  {decryptedValue ? (
                    <div className="p-4 bg-surface-2 rounded-2xl">
                      <p className="text-xs text-text-muted uppercase tracking-widest mb-2">Decrypted {['Amount', 'Recipient', 'Tax'][auditorField]}</p>
                      <p className="text-lg font-bold text-white font-mono">{decryptedValue}</p>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full gap-2" disabled={isDecrypting}
                      onClick={async () => {
                        setIsDecrypting(true);
                        try {
                          const fieldFn = auditorField === 0 ? 'getEncryptedAmount' : auditorField === 1 ? 'getEncryptedRecipient' : 'getEncryptedTax';
                          const handle = await publicClient!.readContract({
                            address: CIPHERPAY_ADDRESS,
                            abi: CIPHERPAY_ABI as any,
                            functionName: fieldFn,
                            args: [auditorInvHash as `0x${string}`],
                          });
                          const FheTypes = getFheTypes();
                          if (!FheTypes) throw new Error('FheTypes not available');
                          const fheType = auditorField === 1 ? FheTypes.Address : FheTypes.Uint64;
                          const val = await decrypt(BigInt(handle as any), fheType);
                          const { formatEther } = await import('viem');
                          const display = auditorField === 1 ? String(val) : `${formatEther(BigInt(String(val)))} ETH`;
                          setDecryptedValue(display);
                          addToast('success', 'Decrypted via EIP-712 permit');
                        } catch (err: any) {
                          addToast('error', (err?.shortMessage || err?.message || 'Decrypt failed').slice(0, 60));
                        } finally {
                          setIsDecrypting(false);
                        }
                      }}>
                      {isDecrypting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Decrypting...</> : <><Eye className="w-4 h-4" /> Decrypt via Permit</>}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
