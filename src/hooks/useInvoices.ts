import { useEffect, useState, useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { CIPHERPAY_ADDRESS, CIPHERPAY_SIMPLE_ADDRESS, CIPHERPAY_ABI, INVOICE_TYPE_MAP, INVOICE_STATUS_MAP } from '../config/contract';
import { useContractStatus } from './useContractStatus';
import { formatEther } from 'viem';
import type { Invoice } from '../store/useInvoiceStore';

export function useInvoices() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { isDeployed } = useContractStatus();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    if (!address || !publicClient || !isDeployed) {
      setInvoices([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get invoices from BOTH contracts (FHE + Simple)
      let createdHashes: `0x${string}`[] = [];
      let paidHashes: `0x${string}`[] = [];

      for (const contractAddr of [CIPHERPAY_ADDRESS, CIPHERPAY_SIMPLE_ADDRESS]) {
        try {
          const created = await publicClient.readContract({
            address: contractAddr, abi: CIPHERPAY_ABI as any,
            functionName: 'getUserInvoices', args: [address],
          } as any) as `0x${string}`[];
          createdHashes = [...createdHashes, ...(created || [])];
        } catch {}
        try {
          const paid = await publicClient.readContract({
            address: contractAddr, abi: CIPHERPAY_ABI as any,
            functionName: 'getPaidInvoices', args: [address],
          } as any) as `0x${string}`[];
          paidHashes = [...paidHashes, ...(paid || [])];
        } catch {}
      }

      // Merge and deduplicate
      const hashSet = new Set<string>();
      const hashes: `0x${string}`[] = [];
      for (const h of [...(createdHashes || []), ...(paidHashes || [])]) {
        if (!hashSet.has(h)) {
          hashSet.add(h);
          hashes.push(h);
        }
      }

      if (hashes.length === 0) {
        setInvoices([]);
        setIsLoading(false);
        return;
      }

      // Fetch each invoice's details (try both contracts)
      const invoicePromises = hashes.map(async (hash) => {
        try {
          let data: any[] | null = null;
          // Try FHE contract (bool hasRecipient) then Simple (address recipient)
          const simpleGetInvoiceAbi = [{ name: 'getInvoice', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: 'creator', type: 'address' }, { name: 'recipient', type: 'address' }, { name: 'invoiceType', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'deadline', type: 'uint256' }, { name: 'createdAt', type: 'uint256' }, { name: 'createdBlock', type: 'uint256' }, { name: 'unlockBlock', type: 'uint256' }] }] as const;
          const contracts = [
            { address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any },
            { address: CIPHERPAY_SIMPLE_ADDRESS, abi: simpleGetInvoiceAbi as any },
          ];
          for (const c of contracts) {
            try {
              const result = await publicClient.readContract({
                address: c.address, abi: c.abi,
                functionName: 'getInvoice', args: [hash],
              }) as unknown as any[];
              if ((result[0] as string) !== '0x0000000000000000000000000000000000000000') {
                data = result;
                break;
              }
            } catch {}
          }
          if (!data) return null;

          const creator = data[0] as string;
          const secondField = data[1];
          const isFheFormat = typeof secondField === 'boolean';
          const recipient = isFheFormat ? '0x0000000000000000000000000000000000000000' : (data[1] as string);
          const invoiceType = Number(data[2]);
          const status = Number(data[3]);
          const deadline = Number(data[4]);
          const createdAt = Number(data[5]);
          const createdBlock = Number(data[6]);
          const unlockBlock = Number(data[7]);

          const typeStr = (INVOICE_TYPE_MAP[invoiceType] || 'standard') as Invoice['type'];
          const statusStr = (INVOICE_STATUS_MAP[status] || 'open') as Invoice['status'];

          // Amount is FHE-encrypted — show as hidden by default
          // Requires permit + decryptForView to reveal
          let amountStr = '••••••';
          let encryptedAmountHandle: bigint | undefined;
          try {
            const handle = await publicClient.readContract({
              address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
              functionName: 'getEncryptedAmount', args: [hash],
            }) as bigint;
            encryptedAmountHandle = handle;
            // Amount stays hidden — reveal only via permit
          } catch {
            // Might be Simple contract — try plaintext
            try {
              const simpleAmountAbi = [{ name: 'getInvoiceAmount', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] }] as const;
              const amountRaw = await publicClient.readContract({
                address: CIPHERPAY_SIMPLE_ADDRESS, abi: simpleAmountAbi as any,
                functionName: 'getInvoiceAmount', args: [hash],
              }) as bigint;
              if (amountRaw > 0n) amountStr = formatEther(amountRaw);
            } catch {}
          }

          // Read memo from contract (try both)
          let memoStr = '';
          for (const addr of [CIPHERPAY_SIMPLE_ADDRESS, CIPHERPAY_ADDRESS]) {
            try {
              const memo = await publicClient.readContract({
                address: addr, abi: CIPHERPAY_ABI as any,
                functionName: 'getInvoiceMemo', args: [hash],
              }) as string;
              if (memo) { memoStr = memo; break; }
            } catch {}
          }

          // Multi-pay: try to get collected data from both contracts
          let totalCollected = '0';
          let targetAmount = amountStr;
          let payerCount = 0;
          let collectedPercent = 0;
          if (invoiceType === 1) { // multi-pay
            // Try getInvoiceCollected from Simple contract (has plaintext data)
            const collectedAbi = [{ name: 'getInvoiceCollected', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: 'collected', type: 'uint256' }, { name: 'target', type: 'uint256' }, { name: 'payerCount', type: 'uint256' }] }] as const;
            for (const addr of [CIPHERPAY_SIMPLE_ADDRESS, CIPHERPAY_ADDRESS]) {
              try {
                const collected = await publicClient.readContract({
                  address: addr, abi: collectedAbi as any,
                  functionName: 'getInvoiceCollected', args: [hash],
                }) as [bigint, bigint, bigint];
                totalCollected = formatEther(collected[0]);
                targetAmount = formatEther(collected[1]);
                payerCount = Number(collected[2]);
                const target = Number(targetAmount);
                collectedPercent = target > 0 ? Math.min(100, (Number(totalCollected) / target) * 100) : 0;
                break;
              } catch {}
            }
          }

          const inv: Invoice = {
            id: hash.slice(0, 10),
            hash: hash,
            type: typeStr,
            status: statusStr,
            createdAt: createdAt > 0 ? new Date(createdAt * 1000).toISOString() : new Date().toISOString(),
            amount: amountStr,
            seller: creator.slice(0, 6) + '...' + creator.slice(-4),
            recipient: recipient === '0x0000000000000000000000000000000000000000'
              ? 'Anyone'
              : recipient.slice(0, 6) + '...' + recipient.slice(-4),
            memo: memoStr,
            blockNumber: createdBlock,
            creator: creator,
            deadline: deadline > 0 ? deadline : undefined,
            unlockHeight: unlockBlock > 0 ? unlockBlock : undefined,
            encryptedAmountCt: encryptedAmountHandle,
            totalCollected: invoiceType === 1 ? totalCollected : undefined,
            targetAmount: invoiceType === 1 ? targetAmount : undefined,
            payerCount: invoiceType === 1 ? payerCount : undefined,
            collectedPercent: invoiceType === 1 ? collectedPercent : undefined,
          };

          return inv;
        } catch (err) {
          console.warn(`[useInvoices] Failed to fetch invoice ${hash}:`, err);
          return null;
        }
      });

      const results = await Promise.all(invoicePromises);
      const valid = results.filter(Boolean) as Invoice[];

      // Sort by block number descending (newest first)
      valid.sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0));

      setInvoices(valid);
    } catch (err: any) {
      console.error('[useInvoices] Failed to fetch invoices:', err);
      setError(err.message || 'Failed to load invoices');
      setInvoices([]);
    } finally {
      setIsLoading(false);
    }
  }, [address, publicClient, isDeployed]);

  // Fetch on mount and when address changes
  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  return {
    invoices,
    isLoading,
    error,
    refetch: fetchInvoices,
  };
}

// Hook to fetch a single invoice by hash (for Pay page, Explorer search)
export function useInvoice(hash: string | undefined) {
  const publicClient = usePublicClient();
  const { isDeployed } = useContractStatus();
  const [invoice, setInvoice] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hash || !publicClient || !isDeployed) {
      setIsLoading(false);
      return;
    }

    async function fetch() {
      setIsLoading(true);
      try {
        const data = await publicClient!.readContract({
          address: CIPHERPAY_ADDRESS,
          abi: CIPHERPAY_ABI as any,
          functionName: 'getInvoice',
          args: [hash as `0x${string}`],
        }) as unknown as any[];

        const creator = data[0] as string;
        if (creator === '0x0000000000000000000000000000000000000000') {
          setError('Invoice not found');
          setInvoice(null);
        } else {
          setInvoice({
            creator,
            recipient: data[1],
            invoiceType: Number(data[2]),
            status: Number(data[3]),
            deadline: BigInt(data[4] || 0),
            createdAt: BigInt(data[5] || 0),
            createdBlock: BigInt(data[6] || 0),
            unlockBlock: BigInt(data[7] || 0),
          });
          setError(null);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load invoice');
        setInvoice(null);
      } finally {
        setIsLoading(false);
      }
    }

    fetch();
  }, [hash, publicClient, isDeployed]);

  return { invoice, isLoading, error };
}
