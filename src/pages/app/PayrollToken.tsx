import { motion, AnimatePresence } from 'framer-motion';
import { Coins, Send, Lock, RefreshCw, Eye, AlertTriangle, Users } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccount, useWriteContract, usePublicClient, useReadContract } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { Button } from '../../components/Button';
import { FheTerminal } from '../../components/FheTerminal';
import { useToastStore } from '../../components/ToastContainer';
import { useCofhe } from '../../hooks/useCofhe';
import { PAYROLL_TOKEN_ADDRESS } from '../../config/contract';

// ConfidentialPayrollToken is an FHERC-20: balances are euint64, decimals = 6.
// Amounts must use parseUnits(x, 6) — parseEther (18 decimals) overflows euint64.
const isDeployed = PAYROLL_TOKEN_ADDRESS !== '0x0000000000000000000000000000000000000000';
const DECIMALS = 6;

const IN_EUINT64 = {
  name: 'encryptedAmount', type: 'tuple', components: [
    { name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' },
    { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' },
  ],
} as const;

const PAYROLL_TOKEN_ABI = [
  { name: 'name',        type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol',      type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'issuer',      type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'holderCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf',   type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'mint',        type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, IN_EUINT64], outputs: [] },
  { name: 'transfer',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, IN_EUINT64], outputs: [] },
] as const;

type Tab = 'balance' | 'send' | 'mint';

function toTuple(r: any) {
  const ctHash = BigInt(r?.ctHash ?? r?.data?.ctHash ?? 0);
  if (ctHash === 0n) throw new Error('FHE encryption failed: invalid handle');
  return {
    ctHash,
    securityZone: r?.securityZone ?? r?.data?.securityZone ?? 0,
    utype:        r?.utype ?? r?.data?.utype ?? 5,
    signature:    r?.signature ?? r?.data?.signature ?? '0x',
  };
}

export function PayrollToken() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { isReady: isFheReady, encrypt, decrypt, getEncryptable, getFheTypes } = useCofhe();
  const { addToast } = useToastStore();

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as Tab) || 'balance';
  const setActiveTab = (tab: Tab) => setSearchParams(p => { p.set('tab', tab); return p; }, { replace: true });

  const { data: tokenName }   = useReadContract({ address: PAYROLL_TOKEN_ADDRESS, abi: PAYROLL_TOKEN_ABI, functionName: 'name',   query: { enabled: isDeployed } });
  const { data: tokenSymbol } = useReadContract({ address: PAYROLL_TOKEN_ADDRESS, abi: PAYROLL_TOKEN_ABI, functionName: 'symbol', query: { enabled: isDeployed } });
  const { data: issuer }      = useReadContract({ address: PAYROLL_TOKEN_ADDRESS, abi: PAYROLL_TOKEN_ABI, functionName: 'issuer', query: { enabled: isDeployed } });
  const { data: holders }     = useReadContract({ address: PAYROLL_TOKEN_ADDRESS, abi: PAYROLL_TOKEN_ABI, functionName: 'holderCount', query: { enabled: isDeployed } });
  const { data: balanceHandle, refetch: refetchBalance } = useReadContract({
    address: PAYROLL_TOKEN_ADDRESS, abi: PAYROLL_TOKEN_ABI, functionName: 'balanceOf',
    args: [address as `0x${string}`], query: { enabled: !!address && isDeployed },
  });

  const isIssuer = !!address && !!issuer && address.toLowerCase() === (issuer as string).toLowerCase();

  // Balance reveal
  const [balance, setBalance] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);

  // Send / Mint
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount]       = useState('');
  const [busy, setBusy]           = useState(false);
  const [logs, setLogs]           = useState<string[]>([]);
  const addLog = useCallback((m: string) => setLogs(p => [...p, m]), []);

  const handleReveal = async () => {
    if (!balanceHandle || !isFheReady) { addToast('error', !isFheReady ? 'FHE not ready' : 'No balance handle'); return; }
    setIsRevealing(true);
    try {
      const FheTypes = getFheTypes();
      if (!FheTypes) throw new Error('FheTypes not available');
      const value = await decrypt(BigInt(balanceHandle as bigint), FheTypes.Uint64);
      setBalance(formatUnits(BigInt(value as any), DECIMALS));
      addToast('success', 'Balance decrypted');
    } catch (err: any) {
      addToast('error', (err?.shortMessage || err?.message || 'Decrypt failed').slice(0, 70));
    } finally {
      setIsRevealing(false);
    }
  };

  const submit = async (kind: 'send' | 'mint') => {
    if (!isDeployed) { addToast('error', 'Token not deployed'); return; }
    if (!address || !isFheReady) { addToast('error', !address ? 'Connect wallet' : 'FHE not ready'); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) { addToast('error', 'Enter a valid recipient address'); return; }
    if (!amount || Number(amount) <= 0) { addToast('error', 'Enter an amount'); return; }

    setBusy(true);
    setLogs([]);
    try {
      const Encryptable = getEncryptable();
      if (!Encryptable) throw new Error('Encryptable not available');

      addLog(`> ${kind === 'mint' ? 'Minting' : 'Transferring'} ${amount} ${tokenSymbol || 'cpUSD'} (confidential)`);
      addLog('>   Amount encrypted as euint64 — invisible on Etherscan');

      const [enc] = await encrypt(
        [Encryptable.uint64(parseUnits(amount, DECIMALS))],
        (step: string, ctx?: any) => {
          if (ctx?.isStart) addLog(`>   ${step}...`);
          if (ctx?.isEnd)   addLog(`>   ✓ ${step}`);
        },
      );

      addLog('> ✓ Encryption complete — submitting transaction');
      const txHash = await writeContractAsync({
        address: PAYROLL_TOKEN_ADDRESS,
        abi: PAYROLL_TOKEN_ABI,
        functionName: kind,
        args: [recipient as `0x${string}`, toTuple(enc)],
      });

      addLog(`> Transaction: ${txHash.slice(0, 14)}...`);
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      addLog(`> ✓ Confirmed at block ${receipt.blockNumber}`);
      addLog('>   FHE ACL: recipient + issuer can decrypt the new balance — no one else');

      addToast('success', kind === 'mint' ? 'Tokens minted (encrypted)' : 'Transfer sent (encrypted)');
      setRecipient('');
      setAmount('');
      await refetchBalance();
      setBalance(null);
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Failed';
      addLog(`> ✗ ${msg.slice(0, 80)}`);
      addToast('error', msg.slice(0, 80));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Payroll Token</h1>
        <p className="text-text-secondary">
          {(tokenName as string) || 'CipherPay USD'} ({(tokenSymbol as string) || 'cpUSD'}) — a confidential stablecoin where every balance is an FHE ciphertext
        </p>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <Coins className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs text-text-secondary space-y-1">
          <p><span className="text-primary font-bold">FHERC-20 confidential token</span> — balances stored as <code className="font-mono">euint64</code>. Real payroll pays salaries in a stablecoin, not volatile ETH; this is CipherPay's on-Sepolia payout asset.</p>
          <p>Transfers clamp to the available balance via <code className="font-mono">FHE.select</code> — a payment never reverts in a way that leaks whether you had enough.</p>
        </div>
      </div>

      {!isDeployed && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-400">Token pending deployment. Run <code className="font-mono">npx hardhat run scripts/deploy-payroll-token.cts --network eth-sepolia</code></p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-border-default">
        {(['balance', 'send', 'mint'] as const).map(tab => {
          if (tab === 'mint' && !isIssuer) return null;
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`relative px-6 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === tab ? 'text-primary' : 'text-text-muted hover:text-text-secondary'}`}
            >
              {tab === 'balance' ? 'My Balance' : tab === 'send' ? 'Send' : 'Mint (Issuer)'}
              {activeTab === tab && <motion.div layoutId="payroll-token-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'balance' && (
          <motion.div key="balance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-lg space-y-6">
            <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Your Encrypted Balance</h2>
                <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary flex items-center gap-1">
                  <Users className="w-3 h-3" /> {holders != null ? `${holders} holders` : '—'}
                </span>
              </div>
              <div className="p-6 bg-surface-2 rounded-2xl text-center">
                <p className="text-3xl font-bold text-white">
                  {balance ?? '••••••'} <span className="text-base text-text-muted">{(tokenSymbol as string) || 'cpUSD'}</span>
                </p>
                {!balance && (
                  <p className="text-xs text-primary mt-2 flex items-center justify-center gap-1">
                    <Lock className="w-3 h-3" /> Encrypted — reveal with an EIP-712 permit
                  </p>
                )}
              </div>
              <Button className="w-full gap-2" onClick={handleReveal} disabled={isRevealing || !isFheReady || !balanceHandle}>
                {isRevealing ? <><RefreshCw className="w-4 h-4 animate-spin" /> Decrypting...</> : <><Eye className="w-4 h-4" /> Reveal Balance</>}
              </Button>
              <p className="text-xs text-text-muted text-center">
                The balance handle is public, but only you and the issuer hold the FHE permission to decrypt it.
              </p>
            </div>
          </motion.div>
        )}

        {(activeTab === 'send' || activeTab === 'mint') && (
          <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-lg space-y-6">
            <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6">
              <h2 className="text-xl font-bold text-white">
                {activeTab === 'mint' ? 'Mint Confidential Tokens' : 'Send Confidential Tokens'}
              </h2>
              <p className="text-sm text-text-secondary">
                {activeTab === 'mint'
                  ? 'As the issuer, mint encrypted tokens to a recipient — typically to fund a payroll run.'
                  : 'Transfer tokens with an FHE-encrypted amount. The amount is never visible on-chain.'}
              </p>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Recipient address</label>
                <input
                  type="text" placeholder="0x..." value={recipient} onChange={e => setRecipient(e.target.value)}
                  className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm font-mono focus:border-primary/40 focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Amount ({(tokenSymbol as string) || 'cpUSD'})</label>
                <input
                  type="number" min="0" step="0.01" placeholder="e.g. 2500.00"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  className="w-full h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-white text-sm focus:border-primary/40 focus:outline-none"
                />
                <p className="text-xs text-text-muted">Encrypted as euint64 — Etherscan shows only a ciphertext handle.</p>
              </div>

              {logs.length > 0 && <FheTerminal logs={logs} active={busy} />}

              <Button className="w-full h-12 gap-2" onClick={() => submit(activeTab === 'mint' ? 'mint' : 'send')}
                disabled={busy || !isDeployed || !isFheReady || !recipient || !amount}>
                {busy
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Encrypting & submitting...</>
                  : activeTab === 'mint'
                    ? <><Coins className="w-4 h-4" /> Mint (Encrypted)</>
                    : <><Send className="w-4 h-4" /> Send (Encrypted)</>}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
