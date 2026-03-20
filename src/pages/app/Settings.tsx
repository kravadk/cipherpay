import { motion } from 'framer-motion';
import {
  Globe, Info, ExternalLink, Copy, CheckCircle,
  User, Shield, Key, Eye, EyeOff, LogOut, Wallet,
  Bell, FileText, Link2, Hash, Sliders, DollarSign, Clock
} from 'lucide-react';
import { useState } from 'react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { useAccount, useBalance, useDisconnect } from 'wagmi';
import { Button } from '../../components/Button';
import { useWalletStore } from '../../store/useInvoiceStore';
import { useInvoices } from '../../hooks/useInvoices';
import { useToastStore } from '../../components/ToastContainer';
import { CIPHERPAY_ADDRESS, CIPHERPAY_FHE_ADDRESS, CIPHERPAY_SIMPLE_ADDRESS } from '../../config/contract';
import { FHENIX_EXPLORER_URL } from '../../config/fhenix';
import { useCofhe } from '../../hooks/useCofhe';

export function Settings() {
  const { address, chainId, connector } = useAccount();
  const { data: balanceData } = useBalance({ address });
  const { disconnect } = useDisconnect();
  const { permitActive, permitExpiry, setPermitActive } = useWalletStore();
  const { invoices, refetch: refetchInvoices } = useInvoices();
  const { addToast } = useToastStore();
  const { isReady: isFheReady, isConnecting: isFheConnecting, error: fheError, getOrCreateSelfPermit, removeActivePermit } = useCofhe();
  const [showFullAddress, setShowFullAddress] = useState(false);
  const { revealAmounts, toggleReveal } = useInvoiceStore();
  const [defaultCurrency, setDefaultCurrency] = useState<'ETH' | 'USD'>('ETH');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [showTestnetWarning, setShowTestnetWarning] = useState(true);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    addToast('success', `${label} copied`);
  };

  const handleSignPermit = async () => {
    try {
      addToast('info', 'Sign the permit in your wallet...');
      await getOrCreateSelfPermit();
      setPermitActive(true, Date.now() + 24 * 60 * 60 * 1000);
      addToast('success', 'Permit signed — you can now decrypt amounts');
    } catch (err: any) {
      if (err.message?.includes('User rejected')) {
        addToast('warning', 'Permit signature rejected');
      } else {
        addToast('error', err.message || 'Failed to sign permit');
      }
    }
  };

  const handleRevokePermit = async () => {
    try {
      await removeActivePermit();
      setPermitActive(false);
      addToast('success', 'Permit revoked — amounts hidden');
    } catch {
      setPermitActive(false);
      addToast('success', 'Permit revoked');
    }
  };

  // Stats from blockchain
  const totalInvoices = invoices.length;
  const sentInvoices = invoices.filter(i => i.creator?.toLowerCase() === address?.toLowerCase()).length;
  const receivedInvoices = totalInvoices - sentInvoices;
  const settledInvoices = invoices.filter(i => i.status === 'settled').length;
  const openInvoices = invoices.filter(i => i.status === 'open').length;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Settings</h1>
        <p className="text-text-secondary">Account, encryption, and network configuration</p>
      </div>

      {/* Account */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="bg-surface-1 border border-border-default rounded-[24px] p-8 space-y-6">
        <div className="flex items-center gap-3">
          <User className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-white">Account</h2>
        </div>

        <div className="flex items-center gap-5 p-5 bg-surface-2 rounded-2xl border border-border-default">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-lg font-bold text-primary">
            {address?.slice(2, 4).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-mono text-white truncate">
                {showFullAddress ? address : `${address?.slice(0, 10)}...${address?.slice(-8)}`}
              </p>
              <button onClick={() => setShowFullAddress(!showFullAddress)} className="text-text-muted hover:text-primary transition-colors shrink-0">
                {showFullAddress ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => handleCopy(address || '', 'Address')} className="text-text-muted hover:text-primary transition-colors shrink-0">
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-text-muted flex items-center gap-1">
                <Wallet className="w-3 h-3" /> {connector?.name || 'Unknown'}
              </span>
              <span className="text-xs text-text-muted">•</span>
              <span className="text-xs text-primary font-bold">
                {balanceData ? `${Number((balanceData as any).formatted ?? '0').toFixed(4)} ${balanceData.symbol}` : '...'}
              </span>
            </div>
          </div>
          <a href={`${FHENIX_EXPLORER_URL}/address/${address}`} target="_blank" rel="noopener noreferrer"
            className="p-2 rounded-lg hover:bg-surface-3 text-text-muted hover:text-primary transition-colors">
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {/* Stats from blockchain */}
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Total', value: totalInvoices },
            { label: 'Sent', value: sentInvoices },
            { label: 'Received', value: receivedInvoices },
            { label: 'Open', value: openInvoices },
            { label: 'Settled', value: settledInvoices },
          ].map((s) => (
            <div key={s.label} className="text-center p-3 bg-surface-2 rounded-xl border border-border-default">
              <p className="text-xl font-bold text-white">{s.value}</p>
              <p className="text-[10px] text-text-muted uppercase tracking-widest mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        <button onClick={() => disconnect()}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-red-500 hover:bg-red-500/10 rounded-xl border border-red-500/20 transition-colors">
          <LogOut className="w-4 h-4" /> Disconnect Wallet
        </button>
      </motion.div>

      {/* FHE Encryption & Permits */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="bg-surface-1 border border-border-default rounded-[24px] p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Key className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-white">FHE Encryption & Permits</h2>
        </div>

        {/* CoFHE SDK Status */}
        <div className="flex items-center justify-between p-4 bg-surface-2 rounded-2xl border border-border-default">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isFheReady ? 'bg-blue-500 animate-pulse' : isFheConnecting ? 'bg-yellow-500 animate-pulse' : 'bg-text-muted'}`} />
            <div>
              <p className="text-sm font-medium text-white">
                CoFHE SDK: {isFheReady ? 'Ready' : isFheConnecting ? 'Connecting...' : 'Standby'}
              </p>
              <p className="text-xs text-text-muted">
                {isFheReady ? 'TFHE encryption available — invoices will be FHE-encrypted'
                  : fheError ? `Error: ${fheError.slice(0, 60)}`
                  : 'SDK initializes when wallet is connected to Sepolia'}
              </p>
            </div>
          </div>
          <span className={`text-[9px] font-bold px-2 py-1 rounded ${
            isFheReady ? 'bg-blue-500/20 text-blue-400' : isFheConnecting ? 'bg-yellow-500/20 text-yellow-400' : 'bg-surface-3 text-text-dim'
          }`}>{isFheReady ? 'ACTIVE' : isFheConnecting ? 'LOADING' : 'STANDBY'}</span>
        </div>

        {/* Permit Status + Actions */}
        <div className="p-4 bg-surface-2 rounded-2xl border border-border-default space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${permitActive ? 'bg-primary animate-pulse' : 'bg-text-muted'}`} />
              <div>
                <p className="text-sm font-medium text-white">{permitActive ? 'Decryption Permit Active' : 'No Active Permit'}</p>
                <p className="text-xs text-text-muted">
                  {permitActive && permitExpiry
                    ? `Expires ${new Date(permitExpiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                    : 'Sign a permit to decrypt encrypted invoice amounts'}
                </p>
              </div>
            </div>
            {permitActive ? (
              <Button variant="ghost" size="sm" onClick={handleRevokePermit} className="text-red-500 hover:bg-red-500/10">
                Revoke
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={handleSignPermit} disabled={!isFheReady}>
                Sign Permit
              </Button>
            )}
          </div>
        </div>

        {/* Encryption Details */}
        <div className="space-y-3">
          <div className="flex items-center justify-between py-3 border-b border-border-default">
            <span className="text-sm text-text-secondary">Encryption Type</span>
            <span className="text-sm text-white flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-primary" /> Fully Homomorphic (TFHE)
            </span>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-border-default">
            <span className="text-sm text-text-secondary">Coprocessor</span>
            <span className="text-sm text-white">CoFHE by Fhenix</span>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-border-default">
            <span className="text-sm text-text-secondary">Encrypted Types</span>
            <span className="text-sm font-mono text-white">euint64, InEuint64</span>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-border-default">
            <span className="text-sm text-text-secondary">Permit Type</span>
            <span className="text-sm text-white">EIP-712 Signature</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-text-secondary">Access Control</span>
            <span className="text-sm text-white">FHE.allowSender / FHE.allow</span>
          </div>
        </div>
      </motion.div>

      {/* Network & Contracts */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="bg-surface-1 border border-border-default rounded-[24px] p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-white">Network & Contracts</h2>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between py-3 border-b border-border-default">
            <span className="text-sm text-text-secondary">Network</span>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-sm font-bold text-white">Ethereum Sepolia</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-border-default">
            <span className="text-sm text-text-secondary">Chain ID</span>
            <span className="text-sm font-mono text-white">{chainId || 11155111}</span>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-border-default">
            <span className="text-sm text-text-secondary">RPC</span>
            <span className="text-xs font-mono text-text-muted">rpc.ankr.com/eth_sepolia</span>
          </div>

          {/* FHE Contract */}
          <div className="flex items-center justify-between py-3 border-b border-border-default">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-primary" />
              <span className="text-sm text-text-secondary">CipherPayFHE</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-text-secondary">{CIPHERPAY_FHE_ADDRESS.slice(0, 8)}...{CIPHERPAY_FHE_ADDRESS.slice(-6)}</span>
              <button onClick={() => handleCopy(CIPHERPAY_FHE_ADDRESS, 'FHE contract')} className="text-text-muted hover:text-primary"><Copy className="w-3 h-3" /></button>
              <a href={`${FHENIX_EXPLORER_URL}/address/${CIPHERPAY_FHE_ADDRESS}`} target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-primary"><ExternalLink className="w-3 h-3" /></a>
            </div>
          </div>

          {/* Simple Contract */}
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-sm text-text-secondary">CipherPaySimple</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-3 text-text-dim">FALLBACK</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-text-dim">{CIPHERPAY_SIMPLE_ADDRESS.slice(0, 8)}...{CIPHERPAY_SIMPLE_ADDRESS.slice(-6)}</span>
              <button onClick={() => handleCopy(CIPHERPAY_SIMPLE_ADDRESS, 'Simple contract')} className="text-text-muted hover:text-primary"><Copy className="w-3 h-3" /></button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Preferences */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
        className="bg-surface-1 border border-border-default rounded-[24px] p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Sliders className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-white">Preferences</h2>
        </div>

        <div className="space-y-4">
          {/* Auto-reveal amounts */}
          <div className="flex items-center justify-between p-4 bg-surface-2 rounded-2xl border border-border-default">
            <div className="flex items-center gap-3">
              <Eye className="w-4 h-4 text-text-muted" />
              <div>
                <p className="text-sm text-white">Auto-reveal Amounts</p>
                <p className="text-xs text-text-muted">Show decrypted amounts across all tables (requires permit)</p>
              </div>
            </div>
            <button onClick={() => {
              if (!revealAmounts && !permitActive) {
                handleSignPermit().then(() => toggleReveal());
              } else {
                toggleReveal();
              }
            }}
              className={`relative w-11 h-6 rounded-full transition-colors ${revealAmounts ? 'bg-primary' : 'bg-surface-3 border border-border-default'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full transition-transform ${revealAmounts ? 'translate-x-[22px] bg-black' : 'translate-x-[2px] bg-text-muted'}`} />
            </button>
          </div>

          {/* Default currency display */}
          <div className="flex items-center justify-between p-4 bg-surface-2 rounded-2xl border border-border-default">
            <div className="flex items-center gap-3">
              <DollarSign className="w-4 h-4 text-text-muted" />
              <div>
                <p className="text-sm text-white">Default Currency Display</p>
                <p className="text-xs text-text-muted">Show amounts in ETH or USD equivalent</p>
              </div>
            </div>
            <div className="flex items-center bg-surface-3 rounded-lg border border-border-default">
              <button onClick={() => setDefaultCurrency('ETH')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${defaultCurrency === 'ETH' ? 'bg-primary text-black' : 'text-text-muted hover:text-white'}`}>
                ETH
              </button>
              <button onClick={() => setDefaultCurrency('USD')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${defaultCurrency === 'USD' ? 'bg-primary text-black' : 'text-text-muted hover:text-white'}`}>
                USD
              </button>
            </div>
          </div>

          {/* Auto-refresh invoices */}
          <div className="flex items-center justify-between p-4 bg-surface-2 rounded-2xl border border-border-default">
            <div className="flex items-center gap-3">
              <Clock className="w-4 h-4 text-text-muted" />
              <div>
                <p className="text-sm text-white">Auto-refresh Data</p>
                <p className="text-xs text-text-muted">Automatically refresh invoice data from blockchain</p>
              </div>
            </div>
            <button onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative w-11 h-6 rounded-full transition-colors ${autoRefresh ? 'bg-primary' : 'bg-surface-3 border border-border-default'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full transition-transform ${autoRefresh ? 'translate-x-[22px] bg-black' : 'translate-x-[2px] bg-text-muted'}`} />
            </button>
          </div>

          {/* Compact mode */}
          <div className="flex items-center justify-between p-4 bg-surface-2 rounded-2xl border border-border-default">
            <div className="flex items-center gap-3">
              <Hash className="w-4 h-4 text-text-muted" />
              <div>
                <p className="text-sm text-white">Compact Hash Display</p>
                <p className="text-xs text-text-muted">Show shorter invoice hashes in tables (8 chars vs 12)</p>
              </div>
            </div>
            <button onClick={() => setCompactMode(!compactMode)}
              className={`relative w-11 h-6 rounded-full transition-colors ${compactMode ? 'bg-primary' : 'bg-surface-3 border border-border-default'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full transition-transform ${compactMode ? 'translate-x-[22px] bg-black' : 'translate-x-[2px] bg-text-muted'}`} />
            </button>
          </div>

          {/* Testnet warning banner */}
          <div className="flex items-center justify-between p-4 bg-surface-2 rounded-2xl border border-border-default">
            <div className="flex items-center gap-3">
              <Bell className="w-4 h-4 text-text-muted" />
              <div>
                <p className="text-sm text-white">Show Network Banner</p>
                <p className="text-xs text-text-muted">Display the network status strip at the top of app pages</p>
              </div>
            </div>
            <button onClick={() => setShowTestnetWarning(!showTestnetWarning)}
              className={`relative w-11 h-6 rounded-full transition-colors ${showTestnetWarning ? 'bg-primary' : 'bg-surface-3 border border-border-default'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full transition-transform ${showTestnetWarning ? 'translate-x-[22px] bg-black' : 'translate-x-[2px] bg-text-muted'}`} />
            </button>
          </div>
        </div>

        <p className="text-[10px] text-text-dim">Preferences are session-based and reset on page reload. Persistent preferences require a backend (Wave 2).</p>
      </motion.div>

      {/* Quick Actions */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="bg-surface-1 border border-border-default rounded-[24px] p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Link2 className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-white">Quick Actions</h2>
        </div>

        <div className="space-y-3">
          <button onClick={() => refetchInvoices()} className="w-full flex items-center justify-between p-4 bg-surface-2 rounded-2xl border border-border-default hover:border-primary/30 transition-colors group">
            <div className="flex items-center gap-3">
              <Hash className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors" />
              <div className="text-left">
                <p className="text-sm text-white">Refresh Invoices</p>
                <p className="text-xs text-text-muted">Re-fetch all invoice data from blockchain</p>
              </div>
            </div>
            <span className="text-xs text-text-dim">{totalInvoices} cached</span>
          </button>

          <button onClick={() => handleCopy(`${window.location.origin}/pay/`, 'Base URL')} className="w-full flex items-center justify-between p-4 bg-surface-2 rounded-2xl border border-border-default hover:border-primary/30 transition-colors group">
            <div className="flex items-center gap-3">
              <Link2 className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors" />
              <div className="text-left">
                <p className="text-sm text-white">Copy Payment Base URL</p>
                <p className="text-xs text-text-muted">Share this prefix + invoice hash for payments</p>
              </div>
            </div>
          </button>

          <a href={`${FHENIX_EXPLORER_URL}/address/${address}`} target="_blank" rel="noopener noreferrer"
            className="w-full flex items-center justify-between p-4 bg-surface-2 rounded-2xl border border-border-default hover:border-primary/30 transition-colors group">
            <div className="flex items-center gap-3">
              <ExternalLink className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors" />
              <div className="text-left">
                <p className="text-sm text-white">View on Etherscan</p>
                <p className="text-xs text-text-muted">See all transactions for your address</p>
              </div>
            </div>
          </a>
        </div>
      </motion.div>

      {/* About */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-surface-1 border border-border-default rounded-[24px] p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Info className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-white">About</h2>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-text-secondary">Version</span>
            <span className="text-sm font-mono text-white">1.0.0-beta (Wave 1)</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-text-secondary">SDK</span>
            <span className="text-sm font-mono text-white">@cofhe/sdk 0.4.0</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-text-secondary">Contracts</span>
            <span className="text-sm font-mono text-white">@fhenixprotocol/cofhe-contracts 0.1.0</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-text-secondary">Fhenix</span>
            <a href="https://fhenix.io" target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
              fhenix.io <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-text-secondary">Docs</span>
            <a href="https://cofhe-docs.fhenix.zone" target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
              cofhe-docs.fhenix.zone <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-text-secondary">Data Storage</span>
            <span className="text-sm text-white">100% on-chain (Ethereum Sepolia)</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
