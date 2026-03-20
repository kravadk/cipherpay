import { useEffect, useState, useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { CIPHERPAY_ADDRESS, CIPHERPAY_ABI, INVOICE_TYPE_MAP, INVOICE_STATUS_MAP } from '../config/contract';
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
      // Get invoices created by user
      const createdHashes = await publicClient.readContract({
        address: CIPHERPAY_ADDRESS,
        abi: CIPHERPAY_ABI as any,
        functionName: 'getUserInvoices',
        args: [address],
      } as any) as `0x${string}`[];

      // Get invoices user has paid
      let paidHashes: `0x${string}`[] = [];
      try {
        paidHashes = await publicClient.readContract({
          address: CIPHERPAY_ADDRESS,
          abi: CIPHERPAY_ABI as any,
          functionName: 'getPaidInvoices',
          args: [address],
        } as any) as `0x${string}`[];
      } catch { /* getPaidInvoices may not exist on older contract */ }

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

      // Fetch each invoice's details
      const invoicePromises = hashes.map(async (hash) => {
        try {
          const data = await publicClient.readContract({
            address: CIPHERPAY_ADDRESS,
            abi: CIPHERPAY_ABI as any,
            functionName: 'getInvoice',
            args: [hash],
          }) as unknown as any[];

          const creator = data[0] as string;
          const recipient = data[1] as string;
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
              const amountRaw = await publicClient.readContract({
                address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
                functionName: 'getInvoiceAmount', args: [hash],
              }) as bigint;
              amountStr = formatEther(amountRaw);
            } catch {}
          }

          // Read memo from contract
          let memoStr = '';
          try {
            memoStr = await publicClient.readContract({
              address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
              functionName: 'getInvoiceMemo', args: [hash],
            }) as string;
          } catch {}

          // Multi-pay: payer count is public, amounts are encrypted
          let totalCollected = '••••••';
          let targetAmount = amountStr;
          let payerCount = 0;
          let collectedPercent = 0;
          if (invoiceType === 1) { // multi-pay
            try {
              const count = await publicClient.readContract({
                address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
                functionName: 'getPayerCount', args: [hash],
              }) as bigint;
              payerCount = Number(count);
            } catch {
              // Try old contract format
              try {
                const collected = await publicClient.readContract({
                  address: CIPHERPAY_ADDRESS, abi: CIPHERPAY_ABI as any,
                  functionName: 'getInvoiceCollected', args: [hash],
                }) as [bigint, bigint, bigint];
                totalCollected = formatEther(collected[0]);
                targetAmount = formatEther(collected[1]);
                payerCount = Number(collected[2]);
                const target = Number(targetAmount);
                collectedPercent = target > 0 ? Math.min(100, (Number(totalCollected) / target) * 100) : 0;
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
