// Simple contract (plaintext amounts — MVP fallback)
export const CIPHERPAY_SIMPLE_ADDRESS = '0xa84607842BBb8b9871E3A64FD9a5AFEb8d2C9aBE' as const;

// FHE contract (encrypted amounts via Fhenix CoFHE)
export const CIPHERPAY_FHE_ADDRESS = '0x39655b5171577e91AFB57d86a48c6D39D51f20eb' as const;

// Use FHE contract as primary
export const CIPHERPAY_ADDRESS = CIPHERPAY_FHE_ADDRESS;

// InEuint64 tuple type for FHE encrypted inputs
const InEuint64Tuple = {
  type: 'tuple',
  components: [
    { name: 'ctHash', type: 'uint256' },
    { name: 'securityZone', type: 'uint8' },
    { name: 'utype', type: 'uint8' },
    { name: 'signature', type: 'bytes' },
  ],
} as const;

export const CIPHERPAY_ABI = [
  // Create invoice with FHE-encrypted amount
  {
    name: 'createInvoice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_encryptedAmount', ...InEuint64Tuple },
      { name: '_recipient', type: 'address' },
      { name: '_invoiceType', type: 'uint8' },
      { name: '_deadline', type: 'uint256' },
      { name: '_unlockBlock', type: 'uint256' },
      { name: '_salt', type: 'bytes32' },
      { name: '_memo', type: 'string' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  // Pay invoice with FHE-encrypted payment amount
  {
    name: 'payInvoice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_invoiceHash', type: 'bytes32' },
      { name: '_encryptedPayment', ...InEuint64Tuple },
    ],
    outputs: [],
  },
  // Settle invoice (multipay only, creator)
  {
    name: 'settleInvoice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [],
  },
  // Cancel invoice (creator only)
  {
    name: 'cancelInvoice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [],
  },
  // Get invoice public metadata (no permit required)
  {
    name: 'getInvoice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'invoiceType', type: 'uint8' },
      { name: 'status', type: 'uint8' },
      { name: 'deadline', type: 'uint256' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'createdBlock', type: 'uint256' },
      { name: 'unlockBlock', type: 'uint256' },
    ],
  },
  // Get encrypted amount handle (requires permit to decrypt off-chain)
  {
    name: 'getEncryptedAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Get encrypted collected handle (multipay, requires permit)
  {
    name: 'getEncryptedCollected',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Get invoice memo
  {
    name: 'getInvoiceMemo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'string' }],
  },
  // Get payer count (public)
  {
    name: 'getPayerCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Get invoices user has paid (as payer)
  {
    name: 'getPaidInvoices',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_user', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  // Get user invoices (as creator)
  {
    name: 'getUserInvoices',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_user', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  // Check if address has paid
  {
    name: 'checkHasPaid',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: '_invoiceHash', type: 'bytes32' },
      { name: '_payer', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  // Events
  {
    name: 'InvoiceCreated',
    type: 'event',
    inputs: [
      { name: 'invoiceHash', type: 'bytes32', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'invoiceType', type: 'uint8', indexed: false },
      { name: 'recipient', type: 'address', indexed: false },
      { name: 'deadline', type: 'uint256', indexed: false },
      { name: 'unlockBlock', type: 'uint256', indexed: false },
      { name: 'memo', type: 'string', indexed: false },
    ],
  },
  {
    name: 'InvoicePaid',
    type: 'event',
    inputs: [
      { name: 'invoiceHash', type: 'bytes32', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
    ],
  },
  {
    name: 'InvoiceSettled',
    type: 'event',
    inputs: [{ name: 'invoiceHash', type: 'bytes32', indexed: true }],
  },
  {
    name: 'InvoiceCancelled',
    type: 'event',
    inputs: [{ name: 'invoiceHash', type: 'bytes32', indexed: true }],
  },
] as const;

export const INVOICE_TYPE_MAP: Record<number, string> = {
  0: 'standard',
  1: 'multi-pay',
  2: 'recurring',
  3: 'vesting',
  4: 'batch',
};

export const INVOICE_STATUS_MAP: Record<number, string> = {
  0: 'open',
  1: 'settled',
  2: 'cancelled',
};
