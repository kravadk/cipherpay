import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Plus, Trash2, Upload, Terminal, CheckCircle, ArrowRight, AlertTriangle } from 'lucide-react';
import { useState, useRef } from 'react';
import { Button } from '../../components/Button';
import type { Invoice } from '../../store/useInvoiceStore';
import { useContractStatus } from '../../hooks/useContractStatus';
import { useInvoices } from '../../hooks/useInvoices';
import { useToastStore } from '../../components/ToastContainer';

export function Batch() {
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [recipients, setRecipients] = useState<{ address: string; amount: string }[]>([
    { address: '', amount: '' },
  ]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [deploySuccess, setDeploySuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isDeployed, warnIfNotDeployed } = useContractStatus();
  const { addToast } = useToastStore();
  const { invoices } = useInvoices();

  const batchInvoices = invoices.filter(i => i.type === 'batch');

  const addRecipient = () => {
    if (recipients.length >= 20) {
      addToast('error', 'Maximum 20 recipients per batch');
      return;
    }
    setRecipients([...recipients, { address: '', amount: '' }]);
  };

  const removeRecipient = (index: number) => {
    setRecipients(recipients.filter((_, i) => i !== index));
  };

  const updateRecipient = (index: number, field: 'address' | 'amount', value: string) => {
    const updated = [...recipients];
    updated[index] = { ...updated[index], [field]: value };
    setRecipients(updated);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter(l => l.trim());
      const parsed: { address: string; amount: string }[] = [];
      let invalidCount = 0;

      // Skip header if present
      const start = lines[0]?.toLowerCase().includes('address') ? 1 : 0;
      for (let i = start; i < lines.length && parsed.length < 20; i++) {
        const [address, amount] = lines[i].split(',').map(s => s.trim());
        if (address?.startsWith('0x') && address.length === 42 && parseFloat(amount) > 0) {
          parsed.push({ address, amount });
        } else {
          invalidCount++;
        }
      }

      if (parsed.length > 0) {
        setRecipients(parsed);
        addToast('success', `${parsed.length} valid${invalidCount > 0 ? `, ${invalidCount} invalid` : ''} rows imported`);
      } else {
        addToast('error', 'No valid rows found in CSV');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDeploy = async () => {
    if (!warnIfNotDeployed('createInvoice')) {
      addToast('error', 'Contract not deployed');
      return;
    }

    const valid = recipients.filter(r => r.address.startsWith('0x') && r.address.length === 42 && parseFloat(r.amount) > 0);
    if (valid.length === 0) {
      addToast('error', 'No valid recipients to deploy');
      return;
    }

    setIsDeploying(true);
    setDeployLogs([]);

    const chunks = [];
    for (let i = 0; i < valid.length; i += 32) {
      chunks.push(valid.slice(i, i + 32));
    }

    setDeployLogs(prev => [...prev, '> Batch deployment requires batch contract (coming in Wave 2)']);
    setDeployLogs(prev => [...prev, `> ${chunks.length} chunk(s), ${valid.length} total recipients`]);
    setDeployLogs(prev => [...prev, '> ⚠ Use New Cipher → Standard to create individual invoices for now']);

    setIsDeploying(false);
    addToast('info', 'Batch contract coming in Wave 2. Use Standard invoices for now.');
  };

  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Batch Cipher</h1>
        <p className="text-text-secondary">Pay multiple recipients privately in one transaction</p>
      </div>

      {/* Tab Selector */}
      <div className="flex items-center gap-4 border-b border-border-default">
        {(['new', 'history'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-6 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${
              activeTab === tab ? 'text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab === 'new' ? 'New Batch' : 'Batch History'}
            {activeTab === tab && (
              <motion.div layoutId="batch-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'new' && !deploySuccess && (
          <motion.div
            key="new"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            {/* Recipients Table Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-text-secondary" />
                <h2 className="text-xl font-bold text-white">Recipients</h2>
              </div>
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleCsvUpload}
                />
                <Button variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="w-4 h-4" /> Import CSV
                </Button>
              </div>
            </div>

            {/* Recipients Table */}
            <div className="bg-surface-1 border border-border-default rounded-[32px] p-6 space-y-4">
              {/* Header */}
              <div className="grid grid-cols-[40px_1fr_120px_40px] gap-4 px-2">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">#</span>
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Address</span>
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Amount (ETH)</span>
                <span />
              </div>

              {/* Rows */}
              {recipients.map((r, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="grid grid-cols-[40px_1fr_120px_40px] gap-4 items-center"
                >
                  <span className="text-sm font-mono text-text-muted text-center">{i + 1}</span>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={r.address}
                    onChange={(e) => updateRecipient(i, 'address', e.target.value)}
                    className="h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none transition-colors"
                  />
                  <input
                    type="number"
                    placeholder="0.0"
                    value={r.amount}
                    onChange={(e) => updateRecipient(i, 'amount', e.target.value)}
                    className="h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none transition-colors"
                  />
                  <button
                    onClick={() => removeRecipient(i)}
                    className="p-2 text-red-500/50 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                    disabled={recipients.length <= 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </motion.div>
              ))}

              <Button variant="ghost" size="sm" onClick={addRecipient} className="w-full gap-2 border border-dashed border-border-default" disabled={recipients.length >= 20}>
                <Plus className="w-4 h-4" /> Add Recipient
              </Button>

              {/* Warnings */}
              {recipients.length >= 18 && (
                <div className="flex items-center gap-2 text-yellow-500 text-xs px-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{recipients.length >= 20 ? 'Maximum 20 recipients reached' : `Approaching limit (${recipients.length}/20)`}</span>
                </div>
              )}

              {/* Summary */}
              <div className="flex items-center justify-between pt-4 border-t border-border-default px-2">
                <span className="text-sm text-text-secondary">{recipients.filter(r => r.address && r.amount).length} recipients</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-secondary">Total:</span>
                  <span className="text-lg font-bold text-white">
                    {recipients.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0).toFixed(4)}
                  </span>
                  <span className="text-sm text-text-secondary">ETH</span>
                </div>
              </div>

              <p className="text-[10px] text-text-muted px-2">All amounts are independently encrypted via Fhenix FHE</p>
            </div>

            {/* Deploy Logs */}
            {isDeploying && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-primary">
                  <Terminal className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Deploy Log</span>
                </div>
                <div className="p-6 bg-black rounded-2xl border border-border-default font-mono text-xs space-y-2">
                  {deployLogs.map((log, i) => (
                    <motion.p
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={log.startsWith('> ✓') ? 'text-primary' : 'text-text-secondary'}
                    >
                      {log}
                    </motion.p>
                  ))}
                  <motion.div animate={{ opacity: [1, 0] }} transition={{ duration: 0.8, repeat: Infinity }} className="inline-block w-2 h-4 bg-primary ml-1" />
                </div>
              </div>
            )}

            <Button className="w-full h-14 text-lg gap-2" onClick={handleDeploy} disabled={isDeploying || !isDeployed}>
              {!isDeployed ? 'Contract not deployed' : isDeploying ? 'Deploying...' : 'Deploy Batch →'}
            </Button>
          </motion.div>
        )}

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
            <div className="space-y-2">
              <h2 className="text-3xl font-bold text-white">Batch Deployed!</h2>
              <p className="text-text-secondary">All payments have been encrypted and submitted.</p>
            </div>
            <div className="flex gap-4">
              <Button variant="outline" onClick={() => { setDeploySuccess(false); setRecipients([{ address: '', amount: '' }]); setDeployLogs([]); }}>
                Create Another
              </Button>
              <Button onClick={() => window.location.href = '/app/dashboard'} className="gap-2">
                Go to Dashboard <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {activeTab === 'history' && (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <div className="bg-surface-1 border border-border-default rounded-[32px] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="px-8 py-5 text-[10px] font-bold text-text-muted uppercase tracking-widest">Batch Hash</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-text-muted uppercase tracking-widest">Date</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-text-muted uppercase tracking-widest">Recipients</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-text-muted uppercase tracking-widest">Status</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-text-muted uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {batchInvoices.length > 0 ? batchInvoices.map((invoice) => (
                      <tr key={invoice.id} className="group hover:bg-surface-2 transition-colors">
                        <td className="px-8 py-5">
                          <span className="text-sm font-mono text-text-secondary">{invoice.hash.slice(0, 12)}...</span>
                        </td>
                        <td className="px-8 py-5">
                          <span className="text-xs text-text-secondary">{new Date(invoice.createdAt).toLocaleDateString('en-US')}</span>
                        </td>
                        <td className="px-8 py-5">
                          <span className="text-sm text-white">{invoice.recipientCount ?? '—'}</span>
                        </td>
                        <td className="px-8 py-5">
                          <span className={`px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-widest ${
                            invoice.status === 'settled' ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-secondary/10 border-secondary/20 text-secondary'
                          }`}>{invoice.status}</span>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <Button variant="ghost" size="sm">View</Button>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={5} className="px-8 py-16 text-center">
                          <p className="text-text-muted">No batch payments yet</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
