import { useEffect, useState, useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { CIPHERPAY_ADDRESS, CIPHERPAY_ABI, CIPHERPAY_SIMPLE_ADDRESS } from '../config/contract';
import { useInvoices } from './useInvoices';

export interface Notification {
  id: string;
  type: 'payment_received' | 'invoice_settled' | 'invoice_cancelled' | 'invoice_paid' | 'vesting_unlocked';
  title: string;
  message: string;
  invoiceHash: string;
  txHash?: string;
  blockNumber: bigint;
  timestamp: number;
  read: boolean;
}

/**
 * Fetches notifications from blockchain events.
 * No local storage — re-fetches from chain on every mount.
 */
export function useNotifications() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { invoices } = useInvoices();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [readHashes, setReadHashes] = useState<Set<string>>(new Set());

  const markAsRead = useCallback((id: string) => {
    setReadHashes(prev => new Set([...prev, id]));
  }, []);

  const markAllAsRead = useCallback(() => {
    setReadHashes(prev => {
      const next = new Set(prev);
      notifications.forEach(n => next.add(n.id));
      return next;
    });
  }, [notifications]);

  const fetchNotifications = useCallback(async () => {
    if (!address || !publicClient) return;

    setIsLoading(true);
    const notifs: Notification[] = [];

    try {
      // Get current block for reference
      const currentBlock = await publicClient.getBlockNumber();
      // Look back ~7 days of blocks (12s per block on Sepolia)
      const fromBlock = currentBlock > 50400n ? currentBlock - 50400n : 0n;

      // Fetch InvoicePaid events where user's invoices got paid
      const myInvoiceHashes = invoices
        .filter(inv => inv.creator?.toLowerCase() === address.toLowerCase())
        .map(inv => inv.hash as `0x${string}`);

      if (myInvoiceHashes.length > 0) {
        for (const contractAddr of [CIPHERPAY_ADDRESS, CIPHERPAY_SIMPLE_ADDRESS]) {
          try {
            const paidLogs = await publicClient.getLogs({
              address: contractAddr,
              event: {
                type: 'event',
                name: 'InvoicePaid',
                inputs: [
                  { name: 'invoiceHash', type: 'bytes32', indexed: true },
                  { name: 'payer', type: 'address', indexed: true },
                ],
              },
              fromBlock,
              toBlock: 'latest',
            });

            for (const log of paidLogs) {
              const hash = (log.args as any)?.invoiceHash;
              const payer = (log.args as any)?.payer;
              if (!hash || !payer) continue;

              // Only show if it's OUR invoice being paid by someone else
              if (myInvoiceHashes.includes(hash) && payer.toLowerCase() !== address.toLowerCase()) {
                const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
                notifs.push({
                  id: `paid-${log.transactionHash}-${log.logIndex}`,
                  type: 'payment_received',
                  title: 'Payment Received',
                  message: `${payer.slice(0, 6)}...${payer.slice(-4)} paid your invoice ${hash.slice(0, 10)}...`,
                  invoiceHash: hash,
                  txHash: log.transactionHash,
                  blockNumber: log.blockNumber,
                  timestamp: Number(block.timestamp) * 1000,
                  read: false,
                });
              }
            }
          } catch { /* contract may not exist */ }
        }
      }

      // Fetch InvoiceSettled events for invoices user is involved in
      const allMyHashes = invoices.map(inv => inv.hash as `0x${string}`);
      for (const contractAddr of [CIPHERPAY_ADDRESS, CIPHERPAY_SIMPLE_ADDRESS]) {
        try {
          const settledLogs = await publicClient.getLogs({
            address: contractAddr,
            event: {
              type: 'event',
              name: 'InvoiceSettled',
              inputs: [
                { name: 'invoiceHash', type: 'bytes32', indexed: true },
              ],
            },
            fromBlock,
            toBlock: 'latest',
          });

          for (const log of settledLogs) {
            const hash = (log.args as any)?.invoiceHash;
            if (!hash || !allMyHashes.includes(hash)) continue;
            const inv = invoices.find(i => i.hash === hash);

            const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
            notifs.push({
              id: `settled-${log.transactionHash}-${log.logIndex}`,
              type: 'invoice_settled',
              title: 'Invoice Settled',
              message: `Invoice ${hash.slice(0, 10)}... has been settled`,
              invoiceHash: hash,
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
              timestamp: Number(block.timestamp) * 1000,
              read: false,
            });
          }
        } catch {}
      }

      // Fetch InvoiceCancelled events
      for (const contractAddr of [CIPHERPAY_ADDRESS, CIPHERPAY_SIMPLE_ADDRESS]) {
        try {
          const cancelledLogs = await publicClient.getLogs({
            address: contractAddr,
            event: {
              type: 'event',
              name: 'InvoiceCancelled',
              inputs: [
                { name: 'invoiceHash', type: 'bytes32', indexed: true },
              ],
            },
            fromBlock,
            toBlock: 'latest',
          });

          for (const log of cancelledLogs) {
            const hash = (log.args as any)?.invoiceHash;
            if (!hash || !allMyHashes.includes(hash)) continue;

            const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
            notifs.push({
              id: `cancelled-${log.transactionHash}-${log.logIndex}`,
              type: 'invoice_cancelled',
              title: 'Invoice Cancelled',
              message: `Invoice ${hash.slice(0, 10)}... was cancelled`,
              invoiceHash: hash,
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
              timestamp: Number(block.timestamp) * 1000,
              read: false,
            });
          }
        } catch {}
      }

      // Check vesting unlock
      for (const inv of invoices) {
        if (inv.type === 'vesting' && inv.unlockHeight && BigInt(inv.unlockHeight) <= currentBlock && inv.status === 'open') {
          notifs.push({
            id: `unlock-${inv.hash}`,
            type: 'vesting_unlocked',
            title: 'Vesting Unlocked',
            message: `Invoice ${inv.hash.slice(0, 10)}... is now unlocked and ready for payment`,
            invoiceHash: inv.hash,
            blockNumber: BigInt(inv.unlockHeight),
            timestamp: Date.now(),
            read: false,
          });
        }
      }

      // Sort by timestamp descending
      notifs.sort((a, b) => b.timestamp - a.timestamp);

      // Apply read state
      const withReadState = notifs.map(n => ({
        ...n,
        read: readHashes.has(n.id),
      }));

      setNotifications(withReadState);
      setUnreadCount(withReadState.filter(n => !n.read).length);
    } catch (err) {
      console.warn('[useNotifications] Error fetching:', err);
    } finally {
      setIsLoading(false);
    }
  }, [address, publicClient, invoices, readHashes]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  return {
    notifications,
    isLoading,
    unreadCount,
    markAsRead,
    markAllAsRead,
    refetch: fetchNotifications,
  };
}
