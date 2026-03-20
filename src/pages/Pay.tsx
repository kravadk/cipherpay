import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Clock, Lock, Loader2, ExternalLink, Copy, AlertTriangle, Users } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { useContractStatus } from '../hooks/useContractStatus';
import { FHENIX_EXPLORER_URL } from '../config/fhenix';
import { CIPHERPAY_ADDRESS, CIPHERPAY_ABI, CIPHERPAY_SIMPLE_ADDRESS, INVOICE_TYPE_MAP } from '../config/contract';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { WalletModal } from '../components/WalletModal';
import { formatEther, parseEther } from 'viem';
import { useEthPrice } from '../hooks/useEthPrice';
import { AmountInput } from '../components/AmountInput';
import { useCofhe } from '../hooks/useCofhe';

type PayStatus = 'idle' | 'loading' | 'ready' | 'paying' | 'success' | 'error' | 'not-found';

export function Pay() {
  const { hash } = useParams<{ hash: string }>();
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient();
  const { isDeployed } = useContractStatus();
  const { writeContractAsync } = useWriteContract();
  const { ethToUsd, price } = useEthPrice();
  const { isReady: isFheReady, encrypt, getEncryptable } = useCofhe();

  const [payStatus, setPayStatus] = useState<PayStatus>('loading');
  const [invoice, setInvoice] = useState<any>(null);
  const [invoiceAmount, setInvoiceAmount] = useState<string | null>(null);
  const [collected, setCollected] = useState<{ collected: string; target: string; payerCount: number } | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [payLogs, setPayLogs] = useState<string[]>([]);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  const addLog = (log: string) => setPayLogs(prev => [...prev, log]);

  const isMultiPay = invoice?.invoiceType === 1;

  // Load invoice data
  useEffect(() => {
    if (!publicClient || !hash || !isDeployed) {
      if (!isDeployed) setPayStatus('not-found');
      return;
    }

    async function loadInvoice() {
      try {
        const data = await publicClient!.readContract({
          address: CIPHERPAY_ADDRESS,
          abi: CIPHERPAY_ABI as any,
          functionName: 'getInvoice',
          args: [hash as `0x${string}`],
        }) as unknown as any[];

        const creator = data[0] as string;
        if (creator === '0x0000000000000000000000000000000000000000') {
          setPayStatus('not-found');
          return;
        }

        const invoiceData = {
          creator,
          recipient: data[1] as string,
          invoiceType: Number(data[2]),
          status: Number(data[3]),
          deadline: BigInt(data[4] || 0),
          createdAt: BigInt(data[5] || 0),
          createdBlock: BigInt(data[6] || 0),
          unlockBlock: BigInt(data[7] || 0),
        };
        setInvoice(invoiceData);

        // Amount is FHE-encrypted — show as hidden
        // Try to get encrypted handle (FHE contract)
        try {
          const handle = await publicClient!.readContract({
            address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
            functionName: 'getEncryptedAmount', args: [hash as `0x${string}`],
          }) as bigint;
          // Amount is encrypted — cannot show plaintext without permit
          setInvoiceAmount(null);
        } catch {
          // Fallback: try Simple contract's plaintext amount
          try {
            const { CIPHERPAY_SIMPLE_ADDRESS } = await import('../config/contract');
            const simpleAbi = [{ name: 'getInvoiceAmount', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] }] as const;
            const amountRaw = await publicClient!.readContract({
              address: CIPHERPAY_SIMPLE_ADDRESS, abi: simpleAbi as any,
              functionName: 'getInvoiceAmount', args: [hash as `0x${string}`],
            }) as bigint;
            setInvoiceAmount(formatEther(amountRaw));
          } catch {}
        }

        // Read payer count (public on FHE contract)
        try {
          const count = await publicClient!.readContract({
            address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
            functionName: 'getPayerCount', args: [hash as `0x${string}`],
          }) as bigint;
          setCollected({
            collected: '••••••',
            target: '••••••',
            payerCount: Number(count),
          });
        } catch {
          // Fallback: try Simple contract
          try {
            const { CIPHERPAY_SIMPLE_ADDRESS } = await import('../config/contract');
            const simpleAbi = [{ name: 'getInvoiceCollected', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: 'collected', type: 'uint256' }, { name: 'target', type: 'uint256' }, { name: 'payerCount', type: 'uint256' }] }] as const;
            const collectedData = await publicClient!.readContract({
              address: CIPHERPAY_SIMPLE_ADDRESS, abi: simpleAbi as any,
              functionName: 'getInvoiceCollected', args: [hash as `0x${string}`],
            }) as unknown as any[];
            setCollected({
              collected: formatEther(BigInt(collectedData[0])),
              target: formatEther(BigInt(collectedData[1])),
              payerCount: Number(collectedData[2]),
            });
          } catch {}
        }

        setPayStatus(isConnected ? 'ready' : 'idle');
      } catch (err) {
        console.error('[Pay] Failed to load invoice:', err);
        setPayStatus('not-found');
      }
    }

    loadInvoice();
  }, [publicClient, hash, isDeployed, isConnected]);

  useEffect(() => {
    if (isConnected && invoice && payStatus === 'idle') setPayStatus('ready');
  }, [isConnected, invoice]);

  const typeLabel = invoice ? INVOICE_TYPE_MAP[invoice.invoiceType] || 'unknown' : '';
  const usdAmount = invoiceAmount && price ? ethToUsd(parseFloat(invoiceAmount)) : null;

  const recipientRestricted = invoice?.recipient && invoice.recipient !== '0x0000000000000000000000000000000000000000';
  const isAuthorizedPayer = !recipientRestricted || invoice?.recipient?.toLowerCase() === address?.toLowerCase();
  const isCreator = invoice?.creator?.toLowerCase() === address?.toLowerCase();

  // For multipay: payer count is public, amounts are encrypted
  const progressPct = 0; // Cannot calculate without decryption
  const remaining = 0;

  const handlePay = async () => {
    if (!address || !hash || !publicClient) return;

    setPayStatus('paying');
    setPayLogs([]);
    setPayError(null);

    try {
      const amountToPay = isMultiPay ? payAmount : (invoiceAmount || payAmount);
      if (!amountToPay || parseFloat(amountToPay) <= 0) {
        throw new Error('Please enter a valid amount');
      }

      const amountWei = parseEther(amountToPay);
      addLog(`> Payment: ${amountToPay} ETH`);

      // Try FHE encryption first
      let encryptedPayment: any = null;
      let useFhe = false;

      if (isFheReady) {
        addLog('> Encrypting payment with FHE...');
        try {
          const Encryptable = getEncryptable();
          if (Encryptable) {
            const [encrypted] = await encrypt([Encryptable.uint64(amountWei)]);
            encryptedPayment = encrypted;
            useFhe = true;
            addLog('> ✓ Payment encrypted');
          }
        } catch (fheErr: any) {
          addLog(`> ⚠ FHE: ${fheErr.message?.slice(0, 50) || 'encryption failed'}`);
        }
      }

      let tx: `0x${string}`;

      if (useFhe && encryptedPayment) {
        // FHE contract: send InEuint64 tuple
        addLog('> Submitting encrypted payment...');
        const encTuple = {
          ctHash: BigInt(encryptedPayment.ctHash || encryptedPayment.data?.ctHash || 0),
          securityZone: encryptedPayment.securityZone ?? encryptedPayment.data?.securityZone ?? 0,
          utype: encryptedPayment.utype ?? encryptedPayment.data?.utype ?? 5,
          signature: encryptedPayment.signature ?? encryptedPayment.data?.signature ?? '0x',
        };
        tx = await writeContractAsync({
          address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
          functionName: 'payInvoice',
          args: [hash as `0x${string}`, encTuple],
        });
      } else {
        // Simple contract fallback: send plaintext uint256
        addLog('> Submitting payment (Simple contract)...');
        const simplePayAbi = [{
          name: 'payInvoice', type: 'function', stateMutability: 'nonpayable',
          inputs: [{ name: '_invoiceHash', type: 'bytes32' }, { name: '_paymentAmount', type: 'uint256' }],
          outputs: [],
        }] as const;
        tx = await writeContractAsync({
          address: CIPHERPAY_SIMPLE_ADDRESS, abi: simplePayAbi as any,
          functionName: 'payInvoice',
          args: [hash as `0x${string}`, amountWei],
        });
      }

      addLog(`> Transaction: ${tx.slice(0, 14)}...`);
      addLog('> Awaiting confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === 'reverted') throw new Error('Transaction reverted');
      addLog(`> ✓ Confirmed in block ${receipt.blockNumber}`);
      setTxHash(tx);
      setPayStatus('success');
    } catch (err: any) {
      console.error('[Pay] Error:', err);
      const msg = err.shortMessage || err.message || 'Payment failed';
      let userMsg = msg;
      if (msg.includes('User rejected') || msg.includes('denied')) userMsg = 'Transaction cancelled by user';
      else if (msg.includes('Not authorized')) userMsg = 'You are not authorized to pay this invoice.';
      else if (msg.includes('not open') || msg.includes('Not open')) userMsg = 'This invoice is no longer open.';
      else if (msg.includes('Deadline passed')) userMsg = 'The deadline has passed.';
      else if (msg.includes('Still locked')) userMsg = 'This invoice is still locked (vesting).';
      else if (msg.includes('insufficient funds')) userMsg = 'Insufficient ETH for gas.';
      else if (msg.includes('reverted')) userMsg = 'Transaction reverted.';
      addLog(`> ✗ ${userMsg}`);
      setPayError(userMsg);
      setPayStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      <div className="px-8 py-6">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center rotate-45">
            <div className="w-3 h-3 bg-black rounded-sm -rotate-45" />
          </div>
          <span className="text-sm font-bold text-white tracking-tight">CipherPay · Pay</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-[480px] bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-8">

          {payStatus === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-text-secondary">Loading invoice...</p>
            </div>
          )}

          {payStatus === 'not-found' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <AlertTriangle className="w-12 h-12 text-yellow-500" />
              <h2 className="text-xl font-bold text-white">Invoice Not Found</h2>
              <p className="text-xs font-mono text-text-muted break-all text-center">{hash}</p>
            </div>
          )}

          {invoice && payStatus !== 'loading' && payStatus !== 'not-found' && (
            <>
              <div className="space-y-6">
                <h1 className="text-3xl font-bold text-white">Pay Invoice</h1>

                <div className="space-y-4 p-6 bg-surface-2 border border-border-default rounded-2xl">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Invoice #</span>
                    <span className="text-xs font-mono text-text-secondary">{hash?.slice(0, 10)}...{hash?.slice(-6)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Type</span>
                    <span className={`text-xs font-bold uppercase px-2 py-1 rounded-md border ${
                      isMultiPay ? 'bg-blue-500/10 border-blue-500/20 text-blue-500' : 'bg-surface-3 border-border-default text-white'
                    }`}>{typeLabel}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Status</span>
                    <div className="flex items-center gap-2">
                      {invoice.status === 0 ? <><Clock className="w-3.5 h-3.5 text-secondary" /><span className="text-xs font-bold text-secondary uppercase">Open</span></>
                        : invoice.status === 1 ? <><CheckCircle className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-bold text-primary uppercase">Settled</span></>
                        : <><XCircle className="w-3.5 h-3.5 text-text-muted" /><span className="text-xs font-bold text-text-muted uppercase">Cancelled</span></>}
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Creator</span>
                    <span className="text-xs font-mono text-text-secondary">{invoice.creator.slice(0, 6)}...{invoice.creator.slice(-4)}</span>
                  </div>
                </div>

                {/* Amount */}
                <div className="p-5 bg-surface-2 border border-border-default rounded-2xl">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-secondary">Target Amount</span>
                    <div className="text-right">
                      {invoiceAmount ? (
                        <>
                          <span className="text-2xl font-bold text-white">{invoiceAmount}</span>
                          <span className="text-lg text-text-muted ml-2">ETH</span>
                          {usdAmount !== null && <p className="text-xs text-text-muted mt-1">≈ ${usdAmount.toFixed(2)} USD</p>}
                        </>
                      ) : (
                        <span className="text-lg font-bold tracking-widest text-text-muted">•••••• ETH</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Multipay progress */}
                {isMultiPay && collected && (
                  <div className="p-5 bg-blue-500/5 border border-blue-500/20 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-blue-500" />
                        <span className="text-sm font-bold text-blue-400">Multi Pay Progress</span>
                      </div>
                      <span className="text-xs text-text-muted">{collected.payerCount} payer{collected.payerCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="w-full h-3 bg-surface-3 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPct}%` }}
                        className="h-full bg-blue-500 rounded-full"
                      />
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-blue-400 font-bold">{collected.collected} ETH collected</span>
                      <span className="text-text-muted">{remaining.toFixed(6)} ETH remaining</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              {invoice.status === 0 && (
                <>
                  {!isConnected && payStatus !== 'paying' && payStatus !== 'success' && (
                    <Button className="w-full h-14 text-lg" onClick={() => setIsWalletModalOpen(true)}>
                      Connect Wallet to Pay
                    </Button>
                  )}

                  {payStatus === 'ready' && (
                    <div className="space-y-4">
                      {!isAuthorizedPayer && (
                        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl">
                          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
                          <p className="text-sm text-red-300">This invoice is assigned to a different address.</p>
                        </div>
                      )}
                      {isCreator && !isMultiPay && (
                        <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl">
                          <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                          <p className="text-sm text-yellow-300">You are the creator. Share the payment link with the payer.</p>
                        </div>
                      )}

                      {/* Amount input — always shown since FHE amounts are encrypted */}
                      <AmountInput
                        value={payAmount}
                        onChange={setPayAmount}
                        label={isMultiPay ? 'Your Contribution' : 'Payment Amount'}
                        placeholder={invoiceAmount || '0.01'}
                      />
                      <Button className="w-full h-14 text-lg" onClick={handlePay}
                        disabled={!isAuthorizedPayer || !payAmount || parseFloat(payAmount) <= 0}>
                        {!isAuthorizedPayer ? 'Not Authorized' : isMultiPay ? `Contribute ${payAmount || '...'} ETH →` : `Pay ${payAmount || '...'} ETH →`}
                      </Button>
                    </div>
                  )}

                  {payStatus === 'paying' && (
                    <div className="p-4 bg-black rounded-xl font-mono text-xs space-y-1 max-h-40 overflow-y-auto">
                      {payLogs.map((log, i) => (
                        <p key={i} className={log.includes('✓') ? 'text-primary' : log.includes('✗') ? 'text-red-400' : 'text-text-secondary'}>{log}</p>
                      ))}
                      <motion.div animate={{ opacity: [1, 0] }} transition={{ duration: 0.8, repeat: Infinity }} className="inline-block w-2 h-4 bg-primary ml-1" />
                    </div>
                  )}

                  {payStatus === 'error' && (
                    <div className="space-y-4">
                      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl space-y-2">
                        <p className="text-sm font-bold text-red-400">Payment Failed</p>
                        <p className="text-xs text-red-300">{payError}</p>
                      </div>
                      <Button className="w-full" onClick={() => setPayStatus('ready')}>Try Again</Button>
                    </div>
                  )}

                  {payStatus === 'success' && txHash && (
                    <div className="space-y-6">
                      <div className="flex flex-col items-center text-center space-y-4">
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}>
                          <CheckCircle className="w-16 h-16 text-primary" />
                        </motion.div>
                        <h2 className="text-2xl font-bold text-white">
                          {isMultiPay ? 'Contribution Sent!' : 'Payment Successful!'}
                        </h2>
                        {isMultiPay && (
                          <p className="text-sm text-text-secondary">
                            Your contribution of {payAmount} ETH has been recorded. The creator will settle when the target is reached.
                          </p>
                        )}
                      </div>
                      <div className="p-4 bg-surface-2 border border-border-default rounded-2xl space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-text-muted">Transaction</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-text-secondary">{txHash.slice(0, 10)}...</span>
                            <button onClick={() => navigator.clipboard.writeText(txHash)} className="text-text-muted hover:text-primary"><Copy className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        <a href={`${FHENIX_EXPLORER_URL}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-primary hover:underline">
                          View on Etherscan <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  )}
                </>
              )}

              {invoice.status === 1 && (
                <div className="flex flex-col items-center gap-3 p-6 bg-primary/5 border border-primary/20 rounded-2xl">
                  <CheckCircle className="w-8 h-8 text-primary" />
                  <p className="text-sm text-text-secondary">This invoice has been settled</p>
                </div>
              )}

              {invoice.status === 2 && (
                <div className="p-4 bg-surface-2 border border-border-default rounded-2xl text-center">
                  <p className="text-sm text-text-secondary">This invoice was cancelled</p>
                </div>
              )}
            </>
          )}
        </motion.div>
      </div>

      <div className="px-8 py-6 text-center">
        <p className="text-[10px] text-text-muted uppercase tracking-widest">◆ CipherPay · Privacy by default on Ethereum Sepolia</p>
      </div>

      <WalletModal isOpen={isWalletModalOpen} onClose={() => setIsWalletModalOpen(false)} />
    </div>
  );
}
