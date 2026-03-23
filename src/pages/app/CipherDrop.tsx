import { motion, AnimatePresence } from 'framer-motion';
import { Gift, Plus, Upload, Share2, Eye, X, CheckCircle, ArrowRight, Terminal, Copy, QrCode } from 'lucide-react';
import { useState, useRef } from 'react';
import { Button } from '../../components/Button';
import { useContractStatus } from '../../hooks/useContractStatus';
import { DatePicker } from '../../components/DatePicker';
import { useToastStore } from '../../components/ToastContainer';

interface Campaign {
  id: string;
  name: string;
  hash: string;
  status: 'active' | 'expired' | 'closed';
  claimed: number;
  total: number;
  expiry: string;
}

const DEMO_CAMPAIGNS: Campaign[] = [];

export function CipherDrop() {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'payouts'>('campaigns');
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [recipients, setRecipients] = useState<{ address: string; amount: string }[]>([{ address: '', amount: '' }]);
  const [campaignName, setCampaignName] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [merkleRoot, setMerkleRoot] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [deploySuccess, setDeploySuccess] = useState(false);
  const [campaigns] = useState<Campaign[]>(DEMO_CAMPAIGNS);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isDeployed } = useContractStatus();
  const { addToast } = useToastStore();

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter(l => l.trim());
      const parsed: { address: string; amount: string }[] = [];
      const start = lines[0]?.toLowerCase().includes('address') ? 1 : 0;
      for (let i = start; i < lines.length && parsed.length < 500; i++) {
        const [address, amount] = lines[i].split(',').map(s => s.trim());
        if (address?.startsWith('0x') && address.length === 42 && parseFloat(amount) > 0) {
          parsed.push({ address, amount });
        }
      }
      if (parsed.length > 0) {
        setRecipients(parsed);
        addToast('success', `${parsed.length} recipients loaded`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const generateMerkleRoot = async () => {
    setIsGenerating(true);
    // Real Merkle tree: hash each (address, amount) leaf with keccak256
    const { keccak256, encodePacked } = await import('viem');
    const leaves = recipients
      .filter(r => r.address && r.amount)
      .map(r => keccak256(encodePacked(['address', 'uint256'], [r.address as `0x${string}`, BigInt(r.amount)])));
    // Simple Merkle root: iteratively hash pairs
    let layer = [...leaves].sort();
    while (layer.length > 1) {
      const next: `0x${string}`[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = layer[i + 1] || left;
        const pair = left < right ? left + right.slice(2) : right + left.slice(2);
        next.push(keccak256(pair as `0x${string}`));
      }
      layer = next;
    }
    setMerkleRoot(layer[0] || '0x');
    setIsGenerating(false);
  };

  const handleDeploy = async () => {
    addToast('info', 'CipherDrop contract deployment coming in Wave 2');
    setDeployLogs(['> CipherDrop.sol not yet deployed on Sepolia', '> Merkle root generated locally: ' + (merkleRoot?.slice(0, 20) + '...')]);
  };

  return (
    <div className="space-y-12">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-white tracking-tight">Cipher Drop</h1>
          <p className="text-text-secondary">Create private distribution campaigns with Merkle proofs</p>
        </div>
        <Button variant="primary" size="sm" className="gap-2" onClick={() => { setShowWizard(true); setWizardStep(1); setDeploySuccess(false); }}>
          <Plus className="w-4 h-4" /> New Campaign
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-border-default">
        {(['campaigns', 'payouts'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-6 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${
              activeTab === tab ? 'text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab === 'campaigns' ? 'Campaigns' : 'Payouts'}
            {activeTab === tab && (
              <motion.div layoutId="drop-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Campaigns Grid */}
      {activeTab === 'campaigns' && !showWizard && (
        <div>
          {campaigns.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {campaigns.map((campaign) => (
                <div key={campaign.id} className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
                  <div className="flex justify-between items-start">
                    <h3 className="text-lg font-bold text-white">{campaign.name}</h3>
                    <span className={`px-2 py-1 rounded-md border text-xs font-bold uppercase tracking-widest ${
                      campaign.status === 'active' ? 'bg-primary/10 border-primary/20 text-primary' :
                      campaign.status === 'expired' ? 'bg-red-500/10 border-red-500/20 text-red-500' :
                      'bg-surface-2 border-border-default text-text-muted'
                    }`}>{campaign.status}</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-text-secondary">
                      <span>{campaign.claimed} / {campaign.total} claimed</span>
                      <span>{Math.round((campaign.claimed / campaign.total) * 100)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-3 rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${(campaign.claimed / campaign.total) * 100}%` }} />
                    </div>
                  </div>
                  <p className="text-xs text-text-muted">Expires {new Date(campaign.expiry).toLocaleDateString('en-US')}</p>
                  <div className="flex gap-2 pt-2 border-t border-border-default">
                    <Button variant="ghost" size="sm" className="flex-1 gap-1"><Share2 className="w-3.5 h-3.5" /> Share</Button>
                    <Button variant="ghost" size="sm" className="flex-1 gap-1"><Eye className="w-3.5 h-3.5" /> View</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 space-y-6 bg-surface-1 border border-border-default rounded-[32px]">
              <Gift className="w-16 h-16 text-text-dim" />
              <div className="text-center space-y-2">
                <p className="text-xl font-bold text-white">No campaigns yet</p>
                <p className="text-text-secondary">Create your first Cipher Drop campaign</p>
              </div>
              <Button variant="primary" onClick={() => { setShowWizard(true); setWizardStep(1); }}>
                Create Campaign
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Payouts Tab */}
      {activeTab === 'payouts' && (
        <div className="flex flex-col items-center justify-center py-20 space-y-4 bg-surface-1 border border-border-default rounded-[32px]">
          <p className="text-text-muted">No payouts recorded yet</p>
        </div>
      )}

      {/* Wizard Modal */}
      <AnimatePresence>
        {showWizard && (
          <div className="fixed inset-0 z-[10010] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowWizard(false)} />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-surface-1 border border-border-default rounded-[32px] p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-8"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white">New Campaign</h2>
                <button onClick={() => setShowWizard(false)} className="p-2 rounded-full hover:bg-surface-2 text-text-secondary"><X className="w-5 h-5" /></button>
              </div>

              {/* Step indicator */}
              <div className="flex items-center gap-4">
                {[1, 2, 3].map((s) => (
                  <div key={s} className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                      wizardStep === s ? 'bg-primary text-black' : wizardStep > s ? 'bg-primary/20 text-primary' : 'bg-surface-2 text-text-muted'
                    }`}>{wizardStep > s ? <CheckCircle className="w-4 h-4" /> : s}</div>
                    {s < 3 && <div className={`w-8 h-[2px] rounded-full ${wizardStep > s ? 'bg-primary' : 'bg-border-default'}`} />}
                  </div>
                ))}
              </div>

              {/* Step 1: Recipients */}
              {wizardStep === 1 && (
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-white">Step 1 — Recipients</h3>
                  <div className="flex gap-3">
                    <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="w-4 h-4" /> Upload CSV
                    </Button>
                  </div>
                  <div className="space-y-3 max-h-60 overflow-y-auto">
                    {recipients.map((r, i) => (
                      <div key={i} className="flex gap-3">
                        <input type="text" placeholder="0x..." value={r.address} onChange={(e) => {
                          const u = [...recipients]; u[i] = { ...u[i], address: e.target.value }; setRecipients(u);
                        }} className="flex-1 h-10 px-3 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none" />
                        <input type="number" placeholder="0.0" value={r.amount} onChange={(e) => {
                          const u = [...recipients]; u[i] = { ...u[i], amount: e.target.value }; setRecipients(u);
                        }} className="w-24 h-10 px-3 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none" />
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-text-secondary">{recipients.filter(r => r.address).length} recipients loaded</p>
                  <Button className="w-full" onClick={() => { generateMerkleRoot(); setWizardStep(2); }}>Next →</Button>
                </div>
              )}

              {/* Step 2: Merkle Root */}
              {wizardStep === 2 && (
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-white">Step 2 — Merkle Root Generation</h3>
                  <div className="p-6 bg-surface-2 border border-border-default rounded-2xl space-y-4">
                    <p className="text-sm text-text-secondary">Your recipient list will be converted to a Merkle tree. Only the root hash is stored on-chain. No individual addresses are revealed publicly.</p>
                    {isGenerating ? (
                      <div className="flex items-center gap-3 text-primary">
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
                        <span className="text-sm">Generating Merkle tree...</span>
                      </div>
                    ) : merkleRoot && (
                      <div className="space-y-3">
                        <div className="p-3 bg-black rounded-xl">
                          <p className="text-xs font-mono text-primary break-all">{merkleRoot}</p>
                        </div>
                        <div className="space-y-1 text-xs text-text-secondary">
                          <p>✓ Recipient addresses: NOT stored on-chain</p>
                          <p>✓ Individual amounts: NOT stored on-chain</p>
                          <p>◆ Root hash: PUBLIC</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => setWizardStep(1)}>Back</Button>
                    <Button className="flex-[2]" onClick={() => setWizardStep(3)} disabled={!merkleRoot}>Next →</Button>
                  </div>
                </div>
              )}

              {/* Step 3: Settings & Deploy */}
              {wizardStep === 3 && !deploySuccess && (
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-white">Step 3 — Campaign Settings</h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Campaign Name (optional)</label>
                      <input type="text" placeholder="My Distribution" value={campaignName} onChange={(e) => setCampaignName(e.target.value)}
                        className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white focus:border-primary/40 focus:outline-none" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Expiry Date</label>
                      <DatePicker
                        value={expiryDate}
                        onChange={setExpiryDate}
                        minDate={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                        placeholder="Select expiry date"
                      />
                    </div>
                  </div>

                  {deployLogs.length > 0 && (
                    <div className="p-4 bg-black rounded-xl font-mono text-xs space-y-1">
                      {deployLogs.map((log, i) => (
                        <p key={i} className={log.includes('✓') ? 'text-primary' : 'text-text-secondary'}>{log}</p>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => setWizardStep(2)}>Back</Button>
                    <Button className="flex-[2]" onClick={handleDeploy} disabled={!isDeployed || !expiryDate}>
                      {!isDeployed ? 'Contract not deployed' : 'Deploy Campaign'}
                    </Button>
                  </div>
                </div>
              )}

              {wizardStep === 3 && deploySuccess && (
                <div className="flex flex-col items-center text-center space-y-6 py-8">
                  <CheckCircle className="w-16 h-16 text-primary" />
                  <h3 className="text-2xl font-bold text-white">Campaign Deployed!</h3>
                  <Button onClick={() => setShowWizard(false)}>Close</Button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
