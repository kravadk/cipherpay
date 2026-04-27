export type InvoiceType = 'standard' | 'multipay' | 'recurring' | 'vesting' | 'donation' | 'batch';

export interface ChargeOptions {
  invoiceId:   string;       // 0x invoice hash from CipherPayFHE
  amount:      string;       // ETH amount as string, e.g. "0.01"
  currency?:   'ETH';        // Only ETH for now
  shielded?:   boolean;      // Use shielded balance (msg.value=0) if available
  anonymous?:  boolean;      // Use anon claim (nullifier-based, no address on-chain)
  nullifier?:  string;       // Custom nullifier for anon mode (auto-generated if omitted)
  onProgress?: (step: string, ctx?: Record<string, unknown>) => void;
}

export interface ChargeResult {
  txHash:    string;
  invoiceId: string;
  amount:    string;
  shielded:  boolean;
  anonymous: boolean;
  blockNumber?: bigint;
}

export type CheckoutStatus =
  | 'idle'
  | 'initializing_fhe'
  | 'encrypting'
  | 'awaiting_signature'
  | 'submitting'
  | 'confirming'
  | 'success'
  | 'error';

export interface CheckoutState {
  status:     CheckoutStatus;
  error:      string | null;
  txHash:     string | null;
  blockNumber: bigint | null;
  pay:        (opts?: Partial<ChargeOptions>) => Promise<ChargeResult>;
}

export interface WebhookEvent {
  type:      'invoice.paid' | 'invoice.settled' | 'invoice.cancelled' | 'anon.claimed';
  invoiceId: string;
  txHash:    string;
  blockNumber: number;
  payer?:    string; // undefined for anon claims
  timestamp: number;
}

export interface CipherPayConfig {
  rpcUrl:      string;
  privateKey?: string;       // For server-side SDK usage
  chainId?:    number;       // Default: 11155111 (Sepolia)
  contract?:   string;       // CipherPayFHE address override
}
