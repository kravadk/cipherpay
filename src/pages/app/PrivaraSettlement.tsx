import { motion, AnimatePresence } from 'framer-motion';
import { Globe, RefreshCw, ArrowLeftRight, AlertTriangle, Layers } from 'lucide-react';
import { useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccount, useWalletClient, useChainId, useSwitchChain } from 'wagmi';
import { arbitrumSepolia } from 'viem/chains';
import { Button } from '../../components/Button';
import { FheTerminal } from '../../components/FheTerminal';
import { useToastStore } from '../../components/ToastContainer';

// Privara / ReineiraOS settlement runs on Arbitrum Sepolia — its escrow,
// confidential-USDC and CCTP contracts are already deployed there, so this
// page integrates the @reineira-os/sdk against that live testnet deployment.
type Tab = 'pay' | 'redeem';

export function PrivaraSettlement() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { addToast } = useToastStore();

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as Tab) || 'pay';
  const setActiveTab = (t: Tab) => setSearchParams(p => { p.set('tab', t); return p; }, { replace: true });

  const onArbitrum = chainId === arbitrumSepolia.id;
  const sdkRef = useRef<any>(null);

  const [recipient, setRecipient]       = useState('');
  const [amount, setAmount]             = useState('');
  const [escrowIdInput, setEscrowId]    = useState('');
  const [busy, setBusy]                 = useState(false);
  const [logs, setLogs]                 = useState<string[]>([]);
  const addLog = useCallback((m: string) => setLogs(p => [...p, m]), []);

  // Build the Reineira SDK once, from the connected wallet (viem -> ethers signer).
  const getSdk = async () => {
    if (sdkRef.current) return sdkRef.current;
    if (!walletClient) throw new Error('Wallet not connected');
    const { ReineiraSDK, walletClientToSigner } = await import('@reineira-os/sdk');
    const signer = await walletClientToSigner(walletClient as any);
    sdkRef.current = ReineiraSDK.create({
      network: 'testnet',                                  // testnet = Arbitrum Sepolia
      signer,
      onFHEInit: (s: string) => addLog(`>   FHE ${s}`),
    });
    return sdkRef.current;
  };

  const handlePay = async () => {
    if (!onArbitrum) { addToast('error', 'Switch to Arbitrum Sepolia first'); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) { addToast('error', 'Enter a valid recipient address'); return; }
    if (!amount || Number(amount) <= 0) { addToast('error', 'Enter an amount'); return; }

    setBusy(true);
    setLogs([]);
    try {
      addLog(`> Creating a confidential Privara escrow for ${amount} cUSDC`);
      const sdk = await getSdk();
      const escrow = await sdk.escrow.create({ amount: sdk.usdc(amount), owner: recipient });
      addLog(`> ✓ Escrow #${escrow.id} created — ${(escrow.createTx?.hash || '').slice(0, 16)}…`);

      addLog('> Funding escrow — auto-approving cUSDC operator…');
      const res = await escrow.fund(sdk.usdc(amount), { autoApprove: true });
      addLog(`> ✓ Funded — ${res.tx.hash.slice(0, 16)}…`);
      addLog(`>   The recipient can now redeem escrow #${escrow.id} to confidential USDC`);

      addToast('success', `Privara escrow #${escrow.id} created & funded`);
      setRecipient('');
      setAmount('');
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Failed';
      addLog(`> ✗ ${msg.slice(0, 100)}`);
      addToast('error', msg.slice(0, 80));
    } finally {
      setBusy(false);
    }
  };

  const handleRedeem = async () => {
    if (!onArbitrum) { addToast('error', 'Switch to Arbitrum Sepolia first'); return; }
    if (!/^\d+$/.test(escrowIdInput)) { addToast('error', 'Enter a numeric escrow ID'); return; }

    setBusy(true);
    setLogs([]);
    try {
      addLog(`> Redeeming Privara escrow #${escrowIdInput}`);
      const sdk = await getSdk();
      const escrow = sdk.escrow.get(BigInt(escrowIdInput));
      const tx = await escrow.redeem();
      addLog(`> ✓ Redeemed — ${tx.hash.slice(0, 16)}…`);
      addLog('>   Funds settled as confidential USDC on Arbitrum');
      addToast('success', `Escrow #${escrowIdInput} redeemed`);
      setEscrowId('');
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Failed';
      addLog(`> ✗ ${msg.slice(0, 100)}`);
      addToast('error', msg.slice(0, 80));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Privara Settlement</h1>
        <p className="text-text-secondary">
          Settle payroll through Privara confidential escrows on Arbitrum — a second, cross-chain payout rail
        </p>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <Layers className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs text-text-secondary space-y-1">
          <p><span className="text-primary font-bold">Privara / ReineiraOS</span> provides confidential settlement on Arbitrum — FHE-encrypted escrows in confidential USDC. CipherPay uses it as a complementary payout rail alongside the Sepolia payroll stack.</p>
          <p>Flow: create an escrow for an employee → fund it with cUSDC → the employee redeems. Amounts stay encrypted end-to-end. Funding the escrow requires <span className="text-white">confidential USDC</span> and <span className="text-white">ETH for gas</span> on Arbitrum Sepolia.</p>
        </div>
      </div>

      {/* Network guard */}
      {!onArbitrum && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
            <p className="text-sm text-yellow-400">
              Privara settlement runs on <span className="font-bold">Arbitrum Sepolia</span>. Your wallet is on another network.
            </p>
          </div>
          <Button
            variant="outline" size="sm" className="gap-2 shrink-0"
            onClick={() => switchChain({ chainId: arbitrumSepolia.id })}
            disabled={isSwitching}
          >
            {isSwitching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
            Switch to Arbitrum Sepolia
          </Button>
        </div>
      )}

      {onArbitrum && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs text-primary font-bold">Connected to Arbitrum Sepolia</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-border-default">
        {(['pay', 'redeem'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`relative px-6 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === tab ? 'text-primary' : 'text-text-muted hover:text-text-secondary'}`}
          >
            {tab === 'pay' ? 'Create & Fund' : 'Redeem'}
            {activeTab === tab && <motion.div layoutId="privara-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'pay' && (
          <motion.div key="pay" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-lg space-y-6">
            <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
              <h2 className="text-xl font-bold text-white">Create &amp; Fund a Payroll Escrow</h2>
              <p className="text-sm text-text-secondary">
                Creates a Privara escrow owned by the employee and funds it with confidential USDC in one flow.
              </p>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Employee address</label>
                <input
                  type="text" placeholder="0x..." value={recipient} onChange={e => setRecipient(e.target.value)}
                  className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Amount (cUSDC)</label>
                <input
                  type="number" min="0" step="0.01" placeholder="e.g. 2500.00"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none"
                />
                <p className="text-xs text-text-muted">Settled in confidential USDC — the amount is FHE-encrypted on Arbitrum.</p>
              </div>

              {logs.length > 0 && <FheTerminal logs={logs} active={busy} />}

              <Button className="w-full h-12 gap-2" onClick={handlePay}
                disabled={busy || !onArbitrum || !address || !recipient || !amount}>
                {busy ? <><RefreshCw className="w-4 h-4 animate-spin" /> Settling via Privara…</> : <><Layers className="w-4 h-4" /> Create &amp; Fund Escrow</>}
              </Button>
            </div>
          </motion.div>
        )}

        {activeTab === 'redeem' && (
          <motion.div key="redeem" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-lg space-y-6">
            <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
              <h2 className="text-xl font-bold text-white">Redeem a Payroll Escrow</h2>
              <p className="text-sm text-text-secondary">
                As the escrow owner (employee), redeem your funded escrow to confidential USDC.
              </p>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Escrow ID</label>
                <input
                  type="text" inputMode="numeric" placeholder="e.g. 42"
                  value={escrowIdInput} onChange={e => setEscrowId(e.target.value.trim())}
                  className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none"
                />
                <p className="text-xs text-text-muted">The employer shares this ID after creating the escrow.</p>
              </div>

              {logs.length > 0 && <FheTerminal logs={logs} active={busy} />}

              <Button className="w-full h-12 gap-2" onClick={handleRedeem}
                disabled={busy || !onArbitrum || !address || !escrowIdInput}>
                {busy ? <><RefreshCw className="w-4 h-4 animate-spin" /> Redeeming…</> : <><ArrowLeftRight className="w-4 h-4" /> Redeem Escrow</>}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
