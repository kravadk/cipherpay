import { useCallback } from 'react';
import { useToastStore } from '../components/ToastContainer';

const ERROR_MESSAGES: Record<string, string> = {
  ZkPackFailed: 'Too many items to encrypt at once. Try splitting into smaller batches.',
  FetchKeysFailed: 'Failed to fetch encryption keys. Check your network connection.',
  ProveFailed: 'ZK proof generation failed. Please retry.',
  VerifyFailed: 'Proof verification failed. The data may be invalid.',
  DecryptFailed: 'Decryption failed. Ensure your permit is valid.',
  PermitExpired: 'Your permit has expired. Please re-sign to continue.',
  PermitNotFound: 'No active permit found. Please sign a permit first.',
  NotConnected: 'Wallet not connected. Please connect your wallet.',
  WrongChain: 'Wrong network. Please switch to Ethereum Sepolia (Chain ID: 11155111).',
  UserRejected: 'Transaction cancelled by user.',
  InsufficientFunds: 'Insufficient ETH balance for this transaction.',
};

export function useFhenixError() {
  const { addToast } = useToastStore();

  const handleError = useCallback((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error) {
      const err = error as { code: string | number; message?: string };

      // User rejected transaction (MetaMask code 4001)
      if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
        addToast('error', ERROR_MESSAGES.UserRejected);
        return;
      }

      // CofheError with string code
      if (typeof err.code === 'string' && err.code in ERROR_MESSAGES) {
        addToast('error', ERROR_MESSAGES[err.code]);
        return;
      }
    }

    if (error instanceof Error) {
      // Check for known error patterns in the message
      for (const [key, message] of Object.entries(ERROR_MESSAGES)) {
        if (error.message.toLowerCase().includes(key.toLowerCase())) {
          addToast('error', message);
          return;
        }
      }

      addToast('error', error.message.length > 100 ? error.message.slice(0, 100) + '...' : error.message);
      return;
    }

    addToast('error', 'An unexpected error occurred. Please try again.');
    console.error('[CipherPay] Unhandled error:', error);
  }, [addToast]);

  return { handleError };
}
