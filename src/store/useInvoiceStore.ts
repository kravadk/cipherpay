import { create } from 'zustand';

// Invoice type — used across components for type safety
// All invoice DATA comes from blockchain via useInvoices() hook
export interface Invoice {
  id: string;
  hash: string;
  type: 'standard' | 'multi-pay' | 'recurring' | 'vesting' | 'batch';
  status: 'open' | 'settled' | 'cancelled' | 'locked' | 'paused';
  createdAt: string;
  amount: string;
  seller: string;
  recipient: string;
  memo: string;
  blockNumber: number;
  nextPaymentDate?: string;
  cyclesLeft?: number;
  unlockDate?: string;
  creator?: string;
  timestamp?: number;
  deadline?: number;
  unlockHeight?: number;
  recipientCount?: number;
  encryptedAmountCt?: bigint;
  revealedAmount?: string;
  isAmountRevealed?: boolean;
  totalCollected?: string;
  targetAmount?: string;
  payerCount?: number;
  collectedPercent?: number;
}

// UI-only state — no invoice data stored here
// All invoice data comes from blockchain via useInvoices() hook
interface UIState {
  revealAmounts: boolean;
  toggleReveal: () => void;
}

export const useInvoiceStore = create<UIState>((set) => ({
  revealAmounts: false,
  toggleReveal: () => set((state) => ({ revealAmounts: !state.revealAmounts })),
}));

// Permit state — tracks whether user has signed an FHE permit this session
interface WalletState {
  permitActive: boolean;
  permitExpiry: number | null;
  setPermitActive: (active: boolean, expiry?: number) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  permitActive: false,
  permitExpiry: null,
  setPermitActive: (active, expiry) => set({
    permitActive: active,
    permitExpiry: expiry ?? null,
  }),
}));
