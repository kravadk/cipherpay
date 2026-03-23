import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Shield, Settings, History, Eye, EyeOff, Copy, Download, QrCode,
  Lock, CheckCircle, Clock, ArrowRight, ExternalLink, Plus, X, AlertTriangle, ChevronDown
} from 'lucide-react';
import { useState, useRef } from 'react';
import { CipherCard } from '../../components/CipherCard';
import { useWalletStore, useInvoiceStore } from '../../store/useInvoiceStore';
import { useAccount } from 'wagmi';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '../../components/Button';
import { EncryptedAmount } from '../../components/EncryptedAmount';
import { useToastStore } from '../../components/ToastContainer';
import { DatePicker } from '../../components/DatePicker';
import { useInvoices } from '../../hooks/useInvoices';
import { useContractStatus } from '../../hooks/useContractStatus';

export function Identity() {
  const { permitActive, setPermitActive } = useWalletStore();
  const { address } = useAccount();
  const { revealAmounts, toggleReveal } = useInvoiceStore();
  const { invoices } = useInvoices();
  const { addToast } = useToastStore();
  const { isDeployed } = useContractStatus();
  const [activeTab, setActiveTab] = useState('History');
  const [showPermitDetails, setShowPermitDetails] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditStep, setAuditStep] = useState(1);
  const [auditScope, setAuditScope] = useState<Set<string>>(new Set());
  const [auditExpiry, setAuditExpiry] = useState('');
  const [selectedInvoiceForAudit, setSelectedInvoiceForAudit] = useState('');
  const [generatedPackage, setGeneratedPackage] = useState<any>(null);
  const [txFilter, setTxFilter] = useState<'all' | 'sent' | 'received'>('all');

  const tabs = ['History', 'Settings', 'Audit Packages'];

  const handleCopyAddress = () => {
    if (address) { navigator.clipboard.writeText(address); addToast('success', 'Address copied!'); }
  };

  const handleDownloadCard = async () => {
    try {
      const cardEl = document.querySelector('[data-cipher-card]') as HTMLElement;
      if (!cardEl) { addToast('error', 'Card element not found'); return; }
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(cardEl, { backgroundColor: '#0a0a0a', scale: 2 });
      const link = document.createElement('a');
      link.download = `cipherpay-card-${address?.slice(0, 8)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      addToast('success', 'Card downloaded!');
    } catch {
      addToast('error', 'Download failed — html2canvas not available');
    }
  };

  const [showQRModal, setShowQRModal] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);
  const payUrl = `${window.location.origin}/profile/${address}`;

  const handleShareQR = () => {
    setShowQRModal(true);
  };

  const handleDownloadQR = () => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, 512, 512);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 56, 56, 400, 400);
      // Add label
      ctx.fillStyle = '#B7FC72';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('CipherPay', 256, 490);
      const link = document.createElement('a');
      link.download = `cipherpay-qr-${address?.slice(0, 8)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      addToast('success', 'QR code downloaded!');
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  };

  const handleTogglePermit = async () => {
    if (!revealAmounts) {
      addToast('info', 'Permit system requires CoFHE SDK (Wave 2)');
    }
    toggleReveal();
  };

  const handleRotateKey = async () => {
    addToast('info', 'Permit rotation requires CoFHE SDK (Wave 2)');
  };

  const handleClearPermits = () => {
    setPermitActive(false);
    if (revealAmounts) toggleReveal();
    addToast('success', 'All permits cleared');
  };

  const handleGeneratePackage = async () => {
    const pkg = {
      version: '1.0',
      invoiceHash: selectedInvoiceForAudit,
      scope: [...auditScope],
      expiry: new Date(auditExpiry).getTime(),
      issuer: address,
      createdAt: Date.now(),
    };
    // Generate audit key from crypto random (not Math.random)
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const auditKey = '0x' + Array.from(randomBytes, b => b.toString(16).padStart(2, '0')).join('');
    setGeneratedPackage({ package: pkg, key: auditKey });
    setAuditStep(3);
    addToast('success', 'Audit package generated');
  };

  // Audit packages from localStorage
  const auditPackages: { ref: string; created: string; expiry: string; scope: string; status: 'Active' | 'Expired' }[] = [];

  return (
    <div className="space-y-12">
      {/* Header: Card + Info */}
      <div className="flex flex-col md:flex-row items-center gap-12">
        <div className="shrink-0">
          <CipherCard address={address || '0x0000...0000'} onQrClick={handleShareQR} />
        </div>
        <div className="flex-1 space-y-6 text-center md:text-left">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-white tracking-tight">My Identity</h1>
            <p className="text-text-secondary">Manage your Fhenix encryption settings and audit packages</p>
          </div>
          <div className="flex flex-wrap justify-center md:justify-start gap-4">
            <Button variant="outline" size="sm" className="gap-2" onClick={handleCopyAddress}>
              <Copy className="w-4 h-4" /> Copy Address
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={handleDownloadCard}>
              <Download className="w-4 h-4" /> Download Card
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={handleShareQR}>
              <QrCode className="w-4 h-4" /> Share QR
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="space-y-8">
        <div className="flex items-center gap-4 border-b border-border-default overflow-x-auto no-scrollbar">
          {tabs.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`relative px-6 py-4 text-sm font-bold uppercase tracking-widest transition-colors whitespace-nowrap ${
                activeTab === tab ? 'text-primary' : 'text-text-muted hover:text-text-secondary'
              }`}>
              {tab}
              {activeTab === tab && <motion.div layoutId="identity-tab-pill" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* HISTORY TAB */}
          {activeTab === 'History' && (
            <motion.div key="history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <History className="w-5 h-5 text-text-secondary" />
                  <h2 className="text-xl font-bold text-white">Transaction History</h2>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    {(['all', 'sent', 'received'] as const).map(f => (
                      <button key={f} onClick={() => setTxFilter(f)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                          txFilter === f ? 'bg-primary text-black' : 'text-text-muted hover:text-text-secondary'
                        }`}>{f}</button>
                    ))}
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleTogglePermit} className="gap-2">
                    {revealAmounts ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    {revealAmounts ? 'Hide Amounts' : 'Reveal Amounts'}
                  </Button>
                </div>
              </div>

              <div className="bg-surface-1 border border-border-default rounded-[32px] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border-default">
                        <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Hash</th>
                        <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Type</th>
                        <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Direction</th>
                        <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Date</th>
                        <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Amount</th>
                        <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {invoices.length > 0 ? invoices.map((invoice) => (
                        <tr key={invoice.id} className="group hover:bg-surface-2 transition-colors">
                          <td className="px-8 py-5">
                            <span className="text-sm font-mono text-text-secondary group-hover:text-white transition-colors">{invoice.hash.slice(0, 12)}...</span>
                          </td>
                          <td className="px-8 py-5">
                            <span className="text-xs font-bold text-text-primary uppercase tracking-widest px-2 py-1 bg-surface-2 rounded-md border border-border-default">{invoice.type}</span>
                          </td>
                          <td className="px-8 py-5">
                            <span className="text-primary">↑ Sent</span>
                          </td>
                          <td className="px-8 py-5">
                            <span className="text-xs text-text-secondary">{new Date(invoice.createdAt).toLocaleDateString('en-US')}</span>
                          </td>
                          <td className="px-8 py-5">
                            <EncryptedAmount amount={invoice.amount} />
                          </td>
                          <td className="px-8 py-5 text-right">
                            <Button variant="ghost" size="sm">View</Button>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={6} className="px-8 py-16 text-center text-text-muted">No transactions yet</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === 'Settings' && (
            <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-2xl space-y-8">
              <div className="flex items-center gap-3">
                <Settings className="w-5 h-5 text-text-secondary" />
                <h2 className="text-xl font-bold text-white">Encryption Settings</h2>
              </div>

              <div className="space-y-4">
                {/* Toggle amounts */}
                <div className="p-6 bg-surface-1 border border-border-default rounded-3xl flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-white">Show Encrypted Amounts</p>
                    <p className="text-xs text-text-secondary">Reveal amounts globally across all tables</p>
                    <p className="text-xs text-text-dim">Requires wallet signature (permit)</p>
                  </div>
                  <button onClick={handleTogglePermit}
                    className={`w-12 h-6 rounded-full transition-colors relative ${revealAmounts ? 'bg-primary' : 'bg-surface-3'}`}>
                    <motion.div animate={{ x: revealAmounts ? 26 : 2 }}
                      className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-sm" />
                  </button>
                </div>

                {/* MasterKey Status */}
                <div className="p-6 bg-surface-1 border border-border-default rounded-3xl flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-white">MasterKey Status</p>
                    <div className="flex items-center gap-2">
                      {permitActive ? (
                        <><CheckCircle className="w-3.5 h-3.5 text-primary" /><p className="text-xs text-primary font-bold uppercase tracking-widest">Active ✓</p></>
                      ) : (
                        <><Clock className="w-3.5 h-3.5 text-text-muted" /><p className="text-xs text-text-muted font-bold uppercase tracking-widest">Not Set</p></>
                      )}
                    </div>
                  </div>
                  {permitActive ? (
                    <Button variant="outline" size="sm" onClick={handleRotateKey}>Rotate Key</Button>
                  ) : (
                    <Button variant="primary" size="sm" onClick={() => { setPermitActive(true, Date.now() + 86400000); addToast('success', 'Permit created'); }}>Setup Permit</Button>
                  )}
                </div>

                {/* Permit Details (expandable) */}
                {permitActive && (
                  <div className="p-6 bg-surface-1 border border-border-default rounded-3xl space-y-4">
                    <button onClick={() => setShowPermitDetails(!showPermitDetails)} className="w-full flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Active Permit Details</p>
                      <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${showPermitDetails ? 'rotate-180' : ''}`} />
                    </button>
                    {showPermitDetails && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="space-y-3 pt-4 border-t border-border-default">
                        <div className="flex justify-between text-sm">
                          <span className="text-text-muted">Type</span><span className="text-white">self</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-muted">Issued</span><span className="text-white">{new Date().toLocaleDateString('en-US')}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-muted">Expires</span><span className="text-white">{new Date(Date.now() + 86400000).toLocaleDateString('en-US')}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-muted">Chain</span><span className="text-white">Ethereum Sepolia</span>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}

                {/* Clear All Permits */}
                <div className="p-6 bg-surface-1 border border-border-default rounded-3xl flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-white">Clear All Permits</p>
                    <p className="text-xs text-text-secondary">Remove all stored permits</p>
                  </div>
                  <Button variant="outline" size="sm" className="!border-red-500/30 !text-red-500 hover:!bg-red-500/10" onClick={handleClearPermits}>Clear</Button>
                </div>
              </div>
            </motion.div>
          )}

          {/* AUDIT PACKAGES TAB */}
          {activeTab === 'Audit Packages' && (
            <motion.div key="audit" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-text-secondary" />
                  <h2 className="text-xl font-bold text-white">Audit Packages</h2>
                </div>
                <Button variant="primary" size="sm" className="gap-2" onClick={() => { setShowAuditModal(true); setAuditStep(1); setGeneratedPackage(null); }}>
                  <Plus className="w-4 h-4" /> Generate Package
                </Button>
              </div>

              <div className="bg-surface-1 border border-border-default rounded-[32px] overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Invoice Ref</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Created</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Expiry</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Scope</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Status</th>
                      <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {auditPackages.map((pkg, i) => (
                      <tr key={i} className="group hover:bg-surface-2 transition-colors">
                        <td className="px-8 py-5"><span className="text-sm font-mono text-white">{pkg.ref}</span></td>
                        <td className="px-8 py-5"><span className="text-xs text-text-secondary">{pkg.created}</span></td>
                        <td className="px-8 py-5"><span className="text-xs text-text-secondary">{pkg.expiry}</span></td>
                        <td className="px-8 py-5"><span className="text-xs text-text-secondary">{pkg.scope}</span></td>
                        <td className="px-8 py-5">
                          <span className={`px-2 py-1 rounded-md border text-xs font-bold uppercase tracking-widest ${
                            pkg.status === 'Active' ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-surface-2 border-border-default text-text-muted'
                          }`}>{pkg.status}</span>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" size="sm" className="gap-1"><Copy className="w-3.5 h-3.5" /> Copy Key</Button>
                            <Button variant="ghost" size="sm" className="gap-1"><ExternalLink className="w-3.5 h-3.5" /> View</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Audit Modal */}
      <AnimatePresence>
        {showAuditModal && (
          <div className="fixed inset-0 z-[10010] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowAuditModal(false)} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-surface-1 border border-border-default rounded-[32px] p-8 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-white">Generate Audit Package</h3>
                <button onClick={() => setShowAuditModal(false)} className="p-2 rounded-full hover:bg-surface-2 text-text-secondary"><X className="w-5 h-5" /></button>
              </div>

              {auditStep === 1 && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Select Invoice</label>
                    <select value={selectedInvoiceForAudit} onChange={(e) => setSelectedInvoiceForAudit(e.target.value)}
                      className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white focus:outline-none appearance-none">
                      <option value="">Choose an invoice...</option>
                      {invoices.map(inv => <option key={inv.id} value={inv.hash}>{inv.hash.slice(0, 12)}... ({inv.type})</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Scope</label>
                    <div className="space-y-2">
                      {['Amount', 'Recipient', 'Memo'].map(s => (
                        <label key={s} className="flex items-center gap-3 p-3 bg-surface-2 rounded-xl cursor-pointer hover:bg-surface-3 transition-colors">
                          <input type="checkbox" checked={auditScope.has(s)} onChange={() => {
                            const next = new Set(auditScope); if (next.has(s)) next.delete(s); else next.add(s); setAuditScope(next);
                          }} className="rounded" />
                          <span className="text-sm text-white">{s}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Expiry</label>
                    <div className="flex gap-2">
                      {[7, 30, 90].map(d => (
                        <button key={d} onClick={() => setAuditExpiry(new Date(Date.now() + d * 86400000).toISOString().split('T')[0])}
                          className="px-3 py-2 bg-surface-2 rounded-lg text-xs text-text-secondary hover:bg-surface-3 border border-border-default">{d} days</button>
                      ))}
                    </div>
                    <DatePicker
                      value={auditExpiry}
                      onChange={setAuditExpiry}
                      minDate={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                      placeholder="Select expiry date"
                    />
                  </div>
                  <Button className="w-full" onClick={handleGeneratePackage}
                    disabled={!selectedInvoiceForAudit || auditScope.size === 0 || !auditExpiry}>
                    Generate Package
                  </Button>
                </div>
              )}

              {auditStep === 3 && generatedPackage && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Audit Package</label>
                    <div className="p-4 bg-black rounded-xl font-mono text-xs text-text-secondary overflow-x-auto max-h-48">
                      <pre>{JSON.stringify(generatedPackage.package, null, 2)}</pre>
                    </div>
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => { navigator.clipboard.writeText(JSON.stringify(generatedPackage.package)); addToast('success', 'Package copied'); }}>
                      <Copy className="w-3.5 h-3.5" /> Copy Package
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Audit Key</label>
                    <div className="p-4 bg-black rounded-xl font-mono text-xs text-primary break-all">{generatedPackage.key}</div>
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => { navigator.clipboard.writeText(generatedPackage.key); addToast('success', 'Audit key copied'); }}>
                      <Copy className="w-3.5 h-3.5" /> Copy Audit Key
                    </Button>
                  </div>
                  <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-500">Share these only with your trusted auditor. The Audit Package + Audit Key together authorize decryption. Both are required.</p>
                  </div>
                  <Button variant="outline" className="w-full" onClick={() => setShowAuditModal(false)}>Close</Button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* QR Code Modal */}
      <AnimatePresence>
        {showQRModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowQRModal(false)}
              className="fixed inset-0 z-[10010] bg-black/70 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed inset-0 z-[10011] flex items-center justify-center p-4"
            >
              <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 max-w-sm w-full space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-white">Payment QR Code</h3>
                  <button onClick={() => setShowQRModal(false)} className="p-2 rounded-lg hover:bg-surface-2 text-text-muted">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div ref={qrRef} className="flex justify-center p-6 bg-white rounded-2xl">
                  <QRCodeSVG
                    value={payUrl}
                    size={240}
                    bgColor="#ffffff"
                    fgColor="#0a0a0a"
                    level="H"
                    includeMargin={false}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-text-muted text-center">Scan to pay to your address</p>
                  <div className="p-3 bg-surface-2 rounded-xl">
                    <p className="text-xs font-mono text-text-secondary text-center break-all">{payUrl}</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 gap-2" onClick={() => {
                    navigator.clipboard.writeText(payUrl);
                    addToast('success', 'QR link copied!');
                  }}>
                    <Copy className="w-4 h-4" /> Copy Link
                  </Button>
                  <Button variant="primary" className="flex-1 gap-2" onClick={handleDownloadQR}>
                    <Download className="w-4 h-4" /> Download QR
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
