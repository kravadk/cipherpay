/**
 * useShieldedBalance — React hook for CipherPay shielded balance management.
 *
 * @example
 * const { balance, deposit, withdraw, isDepositing } = useShieldedBalance();
 *
 * // Deposit 0.01 ETH into shielded pool
 * await deposit('0.01');
 *
 * // Withdraw 0.005 ETH back to wallet
 * await withdraw('0.005');
 */

import { useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { parseEther, formatEther } from 'viem';

// Import from the app's contract config
const CIPHERPAY_FHE_ADDRESS = '0xb3Fb5d67795CC2AaeFC4b843417DF9f45C864069' as const;

const SHIELDED_ABI = [
  { name: 'depositShielded',  type: 'function', stateMutability: 'payable',    inputs: [],                                        outputs: [] },
  { name: 'withdrawShielded', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_amount', type: 'uint256' }],     outputs: [] },
  { name: 'shieldedBalance',  type: 'function', stateMutability: 'view',       inputs: [{ name: '', type: 'address' }],            outputs: [{ name: '', type: 'uint256' }] },
] as const;

export function useShieldedBalance() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const { data: balanceRaw, refetch } = useReadContract({
    address: CIPHERPAY_FHE_ADDRESS,
    abi:     SHIELDED_ABI,
    functionName: 'shieldedBalance',
    args:    [address as `0x${string}`],
    query:   { enabled: !!address },
  });

  const balance = balanceRaw ? formatEther(balanceRaw as bigint) : '0';

  const deposit = useCallback(async (amountEth: string) => {
    const txHash = await writeContractAsync({
      address:      CIPHERPAY_FHE_ADDRESS,
      abi:          SHIELDED_ABI,
      functionName: 'depositShielded',
      value:        parseEther(amountEth),
    });
    await publicClient!.waitForTransactionReceipt({ hash: txHash });
    await refetch();
    return txHash;
  }, [writeContractAsync, publicClient, refetch]);

  const withdraw = useCallback(async (amountEth: string) => {
    const txHash = await writeContractAsync({
      address:      CIPHERPAY_FHE_ADDRESS,
      abi:          SHIELDED_ABI,
      functionName: 'withdrawShielded',
      args:         [parseEther(amountEth)],
    });
    await publicClient!.waitForTransactionReceipt({ hash: txHash });
    await refetch();
    return txHash;
  }, [writeContractAsync, publicClient, refetch]);

  return { balance, deposit, withdraw, refetch };
}
