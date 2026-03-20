import { useMemo } from 'react';
import { CIPHERPAY_ADDRESS } from '../config/contract';

/**
 * Checks if the CipherPay contract is deployed (address is not zero).
 * Returns helper flags for UI elements to show disabled state.
 */
export function useContractStatus() {
  const isDeployed = useMemo(() => {
    return CIPHERPAY_ADDRESS !== '0x0000000000000000000000000000000000000000' as `0x${string}`;
  }, []);

  const warnIfNotDeployed = (functionName: string) => {
    if (!isDeployed) {
      console.warn(`[CipherPay] Contract function ${functionName} not yet available`);
    }
    return isDeployed;
  };

  return { isDeployed, warnIfNotDeployed };
}
