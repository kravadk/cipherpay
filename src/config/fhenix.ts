import { defineChain } from 'viem';
import { sepolia } from 'viem/chains';

// CipherPay uses Ethereum Sepolia with CoFHE coprocessor
export const CIPHERPAY_CHAIN = sepolia;

// Re-export for backward compatibility
export const FHENIX_TESTNET = CIPHERPAY_CHAIN;
export const FHENIX_CHAIN_ID = 11155111;
export const FHENIX_EXPLORER_URL = 'https://sepolia.etherscan.io';
