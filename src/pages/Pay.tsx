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
import { useToastStore } from '../components/ToastContainer';
import { QRCodeSVG } from 'qrcode.react';

type PayStatus = 'idle' | 'loading' | 'ready' | 'paying' | 'success' | 'error' | 'not-found';

export function Pay() {
  const { hash } = useParams<{ hash: string }>();
  const [searchParams] = useState(() => new URLSearchParams(window.location.search));
  const urlAmount = searchParams.get('amount');
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient();
  const { isDeployed } = useContractStatus();
  const { writeContractAsync } = useWriteContract();
  const { ethToUsd, price } = useEthPrice();
  const { isReady: isFheReady, encrypt, getEncryptable } = useCofhe();
  const { addToast } = useToastStore();

  const [payStatus, setPayStatus] = useState<PayStatus>('loading');
  const [invoiceContract, setInvoiceContract] = useState<string>(CIPHERPAY_SIMPLE_ADDRESS);
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
        // Try FHE contract first, then Simple fallback
        let data: any[] | null = null;
        let activeContract = CIPHERPAY_ADDRESS;

        const simpleGetInvoiceAbi = [{ name: 'getInvoice', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: 'creator', type: 'address' }, { name: 'recipient', type: 'address' }, { name: 'invoiceType', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'deadline', type: 'uint256' }, { name: 'createdAt', type: 'uint256' }, { name: 'createdBlock', type: 'uint256' }, { name: 'unlockBlock', type: 'uint256' }] }] as const;
        const contracts = [
          { address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any },
          { address: CIPHERPAY_SIMPLE_ADDRESS, abi: simpleGetInvoiceAbi as any },
        ];
        for (const c of contracts) {
          try {
            const result = await publicClient!.readContract({
              address: c.address, abi: c.abi,
              functionName: 'getInvoice',
              args: [hash as `0x${string}`],
            }) as unknown as any[];
            const creator = result[0] as string;
            if (creator !== '0x0000000000000000000000000000000000000000') {
              data = result;
              activeContract = c.address;
              setInvoiceContract(c.address);
              break;
            }
          } catch { /* try next contract */ }
        }

        if (!data) {
          setPayStatus('not-found');
          return;
        }

        const creator = data[0] as string;
        const recipient = data[1] as string;

        // FHE contract returns (address, address, bool, uint8, uint8, ...)
        // Simple contract returns (address, address, uint8, uint8, ...)
        const thirdField = data[2];
        const isFheFormat = typeof thirdField === 'boolean';
        const invoiceData = {
          creator,
          recipient,
          hasRecipient: isFheFormat ? thirdField as boolean : recipient !== '0x0000000000000000000000000000000000000000',
          invoiceType: isFheFormat ? Number(data[3]) : Number(data[2]),
          status: isFheFormat ? Number(data[4]) : Number(data[3]),
          deadline: BigInt((isFheFormat ? data[5] : data[4]) || 0),
          createdAt: BigInt((isFheFormat ? data[6] : data[5]) || 0),
          createdBlock: BigInt((isFheFormat ? data[7] : data[6]) || 0),
          unlockBlock: BigInt((isFheFormat ? data[8] : data[7]) || 0),
        };
        setInvoice(invoiceData);

        // Try Simple contract first (plaintext amount), then FHE
        let knownAmount: string | null = null;
        try {
          const simpleAbi = [{ name: 'getInvoiceAmount', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] }] as const;
          const amountRaw = await publicClient!.readContract({
            address: CIPHERPAY_SIMPLE_ADDRESS, abi: simpleAbi as any,
            functionName: 'getInvoiceAmount', args: [hash as `0x${string}`],
          }) as bigint;
          if (amountRaw > 0n) {
            knownAmount = formatEther(amountRaw);
            setInvoiceAmount(knownAmount);
            setPayAmount(knownAmount);
          }
        } catch {}

        // If no plaintext amount found, use URL amount or try FHE handle
        if (!knownAmount && urlAmount && parseFloat(urlAmount) > 0) {
          knownAmount = urlAmount;
          setInvoiceAmount(urlAmount);
          setPayAmount(urlAmount);
        }
        if (!knownAmount) {
          try {
            await publicClient!.readContract({
              address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
              functionName: 'getEncryptedAmount', args: [hash as `0x${string}`],
            });
            // FHE — amount encrypted
            setInvoiceAmount(null);
          } catch {}
        }

        // Read collected data — try Simple first (has plaintext), then FHE
        const collectedAbi = [{ name: 'getInvoiceCollected', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: 'collected', type: 'uint256' }, { name: 'target', type: 'uint256' }, { name: 'payerCount', type: 'uint256' }] }] as const;
        for (const addr of [CIPHERPAY_SIMPLE_ADDRESS, CIPHERPAY_ADDRESS]) {
          try {
            const collectedData = await publicClient!.readContract({
              address: addr, abi: collectedAbi as any,
              functionName: 'getInvoiceCollected', args: [hash as `0x${string}`],
            }) as unknown as any[];
            if (Number(collectedData[1]) > 0) {
              setCollected({
                collected: formatEther(BigInt(collectedData[0])),
                target: formatEther(BigInt(collectedData[1])),
                payerCount: Number(collectedData[2]),
              });
              break;
            }
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

  // Vesting lock check
  const isVesting = invoice?.invoiceType === 3;
  const unlockBlock = invoice?.unlockBlock ? Number(invoice.unlockBlock) : 0;
  const [currentBlock, setCurrentBlock] = useState(0);
  const [blocksRemaining, setBlocksRemaining] = useState(0);
  const isLocked = isVesting && unlockBlock > 0 && currentBlock < unlockBlock;

  useEffect(() => {
    if (!publicClient || !isVesting || unlockBlock === 0) return;
    const checkBlock = async () => {
      const block = Number(await publicClient.getBlockNumber());
      setCurrentBlock(block);
      setBlocksRemaining(Math.max(0, unlockBlock - block));
    };
    checkBlock();
    const interval = setInterval(checkBlock, 12000); // check every block
    return () => clearInterval(interval);
  }, [publicClient, isVesting, unlockBlock]);

  // For multipay: calculate progress from collected data
  const collectedNum = collected ? parseFloat(collected.collected) : 0;
  const targetNum = collected ? parseFloat(collected.target) : 0;
  const progressPct = targetNum > 0 ? Math.min(100, (collectedNum / targetNum) * 100) : 0;
  const remaining = Math.max(0, targetNum - collectedNum);

  const handleClaimVesting = async () => {
    if (!address || !hash || !publicClient) return;
    setPayStatus('paying');
    setPayLogs([]);
    setPayError(null);
    try {
      addLog('> Claiming vesting funds...');
      const claimAbi = [{
        name: 'claimVesting', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [],
      }] as const;
      const tx = await writeContractAsync({
        address: CIPHERPAY_SIMPLE_ADDRESS, abi: claimAbi as any,
        functionName: 'claimVesting', args: [hash as `0x${string}`],
      });
      addLog(`> Transaction: ${tx.slice(0, 14)}...`);
      addLog('> Awaiting confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === 'reverted') throw new Error('Transaction reverted');
      addLog(`> ✓ Vesting claimed in block ${receipt.blockNumber}`);
      setTxHash(tx);
      setPayStatus('success');
      addToast('success', `Vesting claimed — ${invoiceAmount || ''} ETH received!`);
    } catch (err: any) {
      const msg = err.shortMessage || err.message || 'Claim failed';
      let userMsg = msg;
      if (msg.includes('User rejected') || msg.includes('denied')) userMsg = 'Transaction cancelled';
      else if (msg.includes('Still locked')) userMsg = 'Vesting is still locked — wait for unlock block';
      else if (msg.includes('Only recipient')) userMsg = 'Only the designated recipient can claim';
      else if (msg.includes('Not vesting')) userMsg = 'This invoice is not a vesting type';
      addLog(`> ✗ ${userMsg}`);
      setPayError(userMsg);
      setPayStatus('error');
      addToast('error', userMsg);
    }
  };

  const handlePay = async (overrideAmount?: string) => {
    if (!address || !hash || !publicClient) return;

    setPayStatus('paying');
    setPayLogs([]);
    setPayError(null);

    try {
      const amountToPay = overrideAmount || (isMultiPay ? payAmount : (invoiceAmount || payAmount));
      if (!amountToPay || parseFloat(amountToPay) <= 0) {
        throw new Error('Please enter a valid amount');
      }

      const amountWei = parseEther(amountToPay);
      addLog(`> Payment: ${amountToPay} ETH`);

      let tx: `0x${string}`;
      const isSimpleInvoice = invoiceContract === CIPHERPAY_SIMPLE_ADDRESS;

      if (isSimpleInvoice) {
        addLog(`> Sending ${amountToPay} ETH...`);
        const simplePayAbi = [{
          name: 'payInvoice', type: 'function', stateMutability: 'payable',
          inputs: [{ name: '_invoiceHash', type: 'bytes32' }, { name: '_paymentAmount', type: 'uint256' }],
          outputs: [],
        }] as const;
        tx = await writeContractAsync({
          address: CIPHERPAY_SIMPLE_ADDRESS, abi: simplePayAbi as any,
          functionName: 'payInvoice',
          args: [hash as `0x${string}`, amountWei],
          value: amountWei,
        } as any);
      } else {
        // Encrypt payment with FHE
        addLog('> Encrypting payment with FHE...');
        let encryptedPayment: any = null;

        if (isFheReady) {
          try {
            const Encryptable = getEncryptable();
            if (Encryptable) {
              const [encrypted] = await encrypt([Encryptable.uint64(amountWei)]);
              encryptedPayment = encrypted;
              addLog('> ✓ Payment encrypted');
            }
          } catch (fheErr: any) {
            addLog(`> ⚠ FHE: ${fheErr.message?.slice(0, 50) || 'encryption failed'}`);
          }
        }

        if (!encryptedPayment) {
          throw new Error('Encryption service not ready. Please wait and try again.');
        }

        addLog(`> Sending ${amountToPay} ETH to contract...`);
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
          value: amountWei,
        } as any);
      }

      addLog(`> Transaction: ${tx.slice(0, 14)}...`);
      addLog('> Awaiting confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === 'reverted') throw new Error('Transaction reverted');
      addLog(`> ✓ Confirmed in block ${receipt.blockNumber}`);
      setTxHash(tx);
      setPayStatus('success');
      addToast('success', `Payment of ${amountToPay} ETH confirmed!`);
    } catch (err: any) {
      console.error('[Pay] Error:', err);
      const msg = err.shortMessage || err.message || 'Payment failed';
      let userMsg = msg;
      if (msg.includes('User rejected') || msg.includes('denied')) userMsg = 'Transaction cancelled by user';
      else if (msg.includes('Not authorized')) userMsg = 'You are not authorized to pay this invoice.';
      else if (msg.includes('not open') || msg.includes('Not open')) userMsg = 'This invoice is no longer open.';
      else if (msg.includes('Deadline passed')) userMsg = 'The deadline has passed.';
      else if (msg.includes('Still locked')) userMsg = 'This invoice is still locked (vesting).';
      else if (msg.includes('Insufficient balance')) userMsg = 'Insufficient balance — deposit ETH first.';
      else if (msg.includes('insufficient funds')) userMsg = 'Insufficient ETH for gas.';
      else if (msg.includes('reverted')) userMsg = 'Transaction reverted.';
      addLog(`> ✗ ${userMsg}`);
      setPayError(userMsg);
      setPayStatus('error');
      addToast('error', userMsg);
    }
  };

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      <div className="px-8 py-6 flex items-center justify-between">
        <a href="/app/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img src="/logo.png" alt="CipherPay" className="w-6 h-6 rounded-md" />
          <span className="text-sm font-bold text-white tracking-tight">CipherPay · Pay</span>
        </a>
        <a href="/app/dashboard" className="text-xs text-text-muted hover:text-primary transition-colors">
          ← Go to Dashboard
        </a>
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
                    <span className="text-xs font-bold text-text-muted uppercase tracking-widest">Invoice #</span>
                    <span className="text-xs font-mono text-text-secondary">{hash?.slice(0, 10)}...{hash?.slice(-6)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-text-muted uppercase tracking-widest">Type</span>
                    <span className={`text-xs font-bold uppercase px-2 py-1 rounded-md border ${
                      isMultiPay ? 'bg-blue-500/10 border-blue-500/20 text-blue-500' : 'bg-surface-3 border-border-default text-white'
                    }`}>{typeLabel}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-text-muted uppercase tracking-widest">Status</span>
                    <div className="flex items-center gap-2">
                      {invoice.status === 0 ? <><Clock className="w-3.5 h-3.5 text-secondary" /><span className="text-xs font-bold text-secondary uppercase">Open</span></>
                        : invoice.status === 1 ? <><CheckCircle className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-bold text-primary uppercase">Settled</span></>
                        : invoice.status === 3 ? <><Clock className="w-3.5 h-3.5 text-orange-500" /><span className="text-xs font-bold text-orange-500 uppercase">Paused</span></>
                        : <><XCircle className="w-3.5 h-3.5 text-text-muted" /><span className="text-xs font-bold text-text-muted uppercase">Cancelled</span></>}
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-text-muted uppercase tracking-widest">Creator</span>
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

                {/* Vesting lock status */}
                {isVesting && unlockBlock > 0 && (
                  <div className={`p-5 ${isLocked ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-primary/5 border-primary/20'} border rounded-2xl space-y-3`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Lock className={`w-4 h-4 ${isLocked ? 'text-yellow-500' : 'text-primary'}`} />
                        <span className={`text-sm font-bold ${isLocked ? 'text-yellow-400' : 'text-primary'}`}>
                          {isLocked ? 'Vesting Locked' : 'Unlocked — Ready to Pay'}
                        </span>
                      </div>
                    </div>
                    {isLocked ? (
                      <>
                        <div className="w-full h-3 bg-surface-3 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${unlockBlock > 0 ? Math.min(100, (currentBlock / unlockBlock) * 100) : 0}%` }}
                            className="h-full bg-yellow-500 rounded-full"
                          />
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-yellow-400 font-bold">{blocksRemaining} blocks remaining</span>
                          <span className="text-text-muted">~{Math.ceil(blocksRemaining * 12 / 60)} min</span>
                        </div>
                        <p className="text-xs text-text-muted">Block {currentBlock.toLocaleString()} / {unlockBlock.toLocaleString()}</p>
                      </>
                    ) : (
                      <p className="text-xs text-text-muted">Unlock block {unlockBlock.toLocaleString()} reached. Payment is now available.</p>
                    )}
                  </div>
                )}

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
                      {isCreator && !isMultiPay && !isVesting && (
                        <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl">
                          <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                          <p className="text-sm text-yellow-300">You are the creator. Share the payment link with the payer.</p>
                        </div>
                      )}
                      {isVesting && isCreator && (
                        <div className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/30 rounded-2xl">
                          <Lock className="w-5 h-5 text-blue-500 flex-shrink-0" />
                          <p className="text-sm text-blue-300">You funded this vesting invoice. Share the link with the recipient — they can claim after unlock.</p>
                        </div>
                      )}

                      {/* Amount input — hidden for vesting (pre-funded by creator) */}
                      {!isVesting && (<>
                        {/* Quick pay button for non-multipay when amount is known */}
                        {!isMultiPay && invoiceAmount && parseFloat(invoiceAmount) > 0 && (
                          <Button
                            className="w-full h-14 text-lg"
                            onClick={() => handlePay(invoiceAmount)}
                            disabled={!isAuthorizedPayer || isCreator}
                          >
                            {isCreator ? 'You are the creator' : !isAuthorizedPayer ? 'Not Authorized' : `Pay ${invoiceAmount} ETH →`}
                          </Button>
                        )}

                        {/* Manual amount input — shown for multipay always, for others when amount unknown */}
                        {(isMultiPay || !invoiceAmount || parseFloat(invoiceAmount) <= 0) && (<>
                        <AmountInput
                          value={payAmount}
                          onChange={setPayAmount}
                          label={isMultiPay ? 'Your Contribution' : 'Payment Amount'}
                          placeholder={invoiceAmount || '0.01'}
                        />
                        {/* Info when amount is unknown (FHE encrypted, no URL param) */}
                        {!isMultiPay && !invoiceAmount && (
                          <p className="text-xs text-text-muted">Amount is FHE-encrypted. Enter the amount agreed with the invoice creator.</p>
                        )}
                        </>)}
                        {/* Multi Pay: suggest remaining amount */}
                        {isMultiPay && collected && parseFloat(collected.target) > 0 && (
                          <div className="space-y-2">
                            {parseFloat(collected.collected) < parseFloat(collected.target) && (
                              <div className="flex flex-wrap gap-2">
                                {(() => {
                                  const rem = parseFloat(collected.target) - parseFloat(collected.collected);
                                  const suggestions = [
                                    { label: 'Remaining', value: rem },
                                    ...(rem > 0.002 ? [{ label: '50%', value: rem * 0.5 }] : []),
                                    ...(rem > 0.004 ? [{ label: '25%', value: rem * 0.25 }] : []),
                                  ];
                                  return suggestions.map(s => (
                                    <button key={s.label}
                                      onClick={() => setPayAmount(s.value.toFixed(6))}
                                      className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                                        payAmount === s.value.toFixed(6)
                                          ? 'bg-primary text-black border-primary'
                                          : 'bg-surface-2 border-border-default text-text-secondary hover:border-primary/30'
                                      }`}>
                                      {s.label} ({s.value.toFixed(4)} ETH)
                                    </button>
                                  ));
                                })()}
                              </div>
                            )}
                            {parseFloat(collected.collected) >= parseFloat(collected.target) && (
                              <p className="text-xs text-primary font-bold">Target reached — waiting for creator to settle</p>
                            )}
                          </div>
                        )}
                      </>)}
                      {isVesting ? (
                        <Button className="w-full h-14 text-lg" onClick={handleClaimVesting}
                          disabled={isLocked || !isAuthorizedPayer}>
                          {isLocked ? `Locked — ${blocksRemaining} blocks (~${Math.ceil(blocksRemaining * 12 / 60)} min)`
                            : !isAuthorizedPayer ? 'Only recipient can claim'
                            : `Claim ${invoiceAmount || '...'} ETH →`}
                        </Button>
                      ) : (isMultiPay || !invoiceAmount || parseFloat(invoiceAmount) <= 0) ? (
                        <Button className="w-full h-14 text-lg" onClick={() => handlePay()}
                          disabled={!isAuthorizedPayer || isCreator || !payAmount || parseFloat(payAmount) <= 0}>
                          {isCreator ? 'You are the creator'
                            : !isAuthorizedPayer ? 'Not Authorized'
                            : isMultiPay ? `Contribute ${payAmount || '...'} ETH →`
                            : `Pay ${payAmount || '...'} ETH →`}
                        </Button>
                      ) : null}
                    </div>
                  )}

                  {payStatus === 'paying' && (
                    <div className="space-y-4">
                      {/* Progress stepper */}
                      <div className="flex items-center justify-between px-2">
                        {[
                          { label: 'Encrypting', done: payLogs.some(l => l.includes('encrypted') || l.includes('Sending') || l.includes('Submitting')) },
                          { label: 'Submitting', done: payLogs.some(l => l.includes('Transaction:') || l.includes('Awaiting')) },
                          { label: 'Confirming', done: payLogs.some(l => l.includes('Confirmed') || l.includes('✓ Confirmed')) },
                        ].map((step, i, arr) => (
                          <div key={i} className="flex items-center gap-2 flex-1">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ${
                              step.done ? 'bg-primary' : i === 0 || arr[i-1]?.done ? 'bg-primary/20 border-2 border-primary' : 'bg-surface-3 border border-border-default'
                            }`}>
                              {step.done ? (
                                <motion.svg initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-4 h-4 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                                  <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3 }} d="M5 13l4 4L19 7" />
                                </motion.svg>
                              ) : (i === 0 || arr[i-1]?.done) ? (
                                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                              ) : (
                                <span className="text-xs text-text-dim font-bold">{i + 1}</span>
                              )}
                            </div>
                            <span className={`text-xs font-bold uppercase tracking-widest ${step.done ? 'text-primary' : 'text-text-muted'}`}>{step.label}</span>
                            {i < arr.length - 1 && <div className={`flex-1 h-px mx-2 ${step.done ? 'bg-primary' : 'bg-border-default'}`} />}
                          </div>
                        ))}
                      </div>
                      {/* Terminal logs */}
                      <div className="p-4 bg-black rounded-xl font-mono text-xs space-y-1 max-h-32 overflow-y-auto">
                        {payLogs.map((log, i) => (
                          <p key={i} className={log.includes('✓') ? 'text-primary' : log.includes('✗') ? 'text-red-400' : 'text-text-secondary'}>{log}</p>
                        ))}
                        <motion.div animate={{ opacity: [1, 0] }} transition={{ duration: 0.8, repeat: Infinity }} className="inline-block w-2 h-4 bg-primary ml-1" />
                      </div>
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
                      {/* Payment Receipt QR */}
                      <div className="flex justify-center p-4 bg-white rounded-2xl">
                        <QRCodeSVG
                          value={`${window.location.origin}/pay/${hash}?tx=${txHash}`}
                          size={140}
                          bgColor="white"
                          fgColor="black"
                          level="M"
                        />
                      </div>
                      <p className="text-xs text-text-dim text-center">Scan to verify this payment on-chain</p>

                      <div className="p-4 bg-surface-2 border border-border-default rounded-2xl space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-text-muted">Transaction</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-text-secondary">{txHash.slice(0, 10)}...</span>
                            <button onClick={() => { navigator.clipboard.writeText(txHash); addToast('success', 'TX hash copied'); }} className="text-text-muted hover:text-primary"><Copy className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-text-muted">Invoice</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-text-secondary">{hash?.slice(0, 10)}...</span>
                            <button onClick={() => { navigator.clipboard.writeText(hash || ''); addToast('success', 'Invoice hash copied'); }} className="text-text-muted hover:text-primary"><Copy className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        <a href={`${FHENIX_EXPLORER_URL}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-primary hover:underline">
                          View on Etherscan <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      <button onClick={() => {
                        const receiptUrl = `${window.location.origin}/pay/${hash}?tx=${txHash}`;
                        navigator.clipboard.writeText(receiptUrl);
                        addToast('success', 'Receipt link copied');
                      }} className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-primary hover:bg-primary/10 rounded-xl border border-primary/20 transition-colors">
                        <Copy className="w-4 h-4" /> Copy Receipt Link
                      </button>
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

              {invoice.status === 3 && (
                <div className="flex flex-col items-center gap-3 p-6 bg-orange-500/5 border border-orange-500/20 rounded-2xl">
                  <Clock className="w-8 h-8 text-orange-500" />
                  <p className="text-sm text-text-secondary">This invoice is paused by the creator</p>
                  <p className="text-xs text-text-muted">Payments are temporarily disabled</p>
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
        <p className="text-xs text-text-muted uppercase tracking-widest">◆ CipherPay · Privacy by default on Ethereum Sepolia</p>
      </div>

      <WalletModal isOpen={isWalletModalOpen} onClose={() => setIsWalletModalOpen(false)} />
    </div>
  );
}
