// Simple contract (plaintext amounts — MVP fallback)
export const CIPHERPAY_SIMPLE_ADDRESS = '0xF3A15EC0FAE753D6BEC3AAB3aEB2d72824c0713F' as const;

// FHE contract (encrypted amounts via Fhenix CoFHE)
export const CIPHERPAY_FHE_ADDRESS = '0xBd81E4649A52583d497A0e27CBd47a6127Ecb267' as const;

// Module contracts
export const PAYMENT_PROOF_ADDRESS = '0x54C22cdF7B65E64C75EeEF565E775503C7657293' as const;
export const SHARED_INVOICE_ADDRESS = '0xd12eAcAD8FD0cd82894d819f4fb5e4E9168eB746' as const;
export const INVOICE_METRICS_ADDRESS = '0x02ae50D014Ed6E627Aacd92A7E8C057F662b25eF' as const;

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

// InEaddress tuple type for FHE encrypted addresses
const InEaddressTuple = {
  type: 'tuple',
  components: [
    { name: 'ctHash', type: 'uint256' },
    { name: 'securityZone', type: 'uint8' },
    { name: 'utype', type: 'uint8' },
    { name: 'signature', type: 'bytes' },
  ],
} as const;

export const CIPHERPAY_ABI = [
  // Create invoice with FHE-encrypted amount and encrypted recipient
  {
    name: 'createInvoice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_encryptedAmount', ...InEuint64Tuple },
      { name: '_encryptedRecipient', ...InEaddressTuple },
      { name: '_recipient', type: 'address' },
      { name: '_hasRecipient', type: 'bool' },
      { name: '_invoiceType', type: 'uint8' },
      { name: '_deadline', type: 'uint256' },
      { name: '_unlockBlock', type: 'uint256' },
      { name: '_salt', type: 'bytes32' },
      { name: '_memo', type: 'string' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  // Pay invoice with FHE-encrypted payment + ETH
  {
    name: 'payInvoice',
    type: 'function',
    stateMutability: 'payable',
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
      { name: 'hasRecipient', type: 'bool' },
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
  // Async decrypt — two-phase pattern
  {
    name: 'requestFullyPaidCheck',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getFullyPaidResult',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [
      { name: 'isPaid', type: 'bool' },
      { name: 'decrypted', type: 'bool' },
    ],
  },
  // Events
  {
    name: 'InvoiceCreated',
    type: 'event',
    inputs: [
      { name: 'invoiceHash', type: 'bytes32', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'invoiceType', type: 'uint8', indexed: false },
      { name: 'hasRecipient', type: 'bool', indexed: false },
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

// Simple contract ABI extensions (pause, resume, claim, amount queries)
export const SIMPLE_EXTRA_ABI = [
  { name: 'pauseInvoice', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [] },
  { name: 'resumeInvoice', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [] },
  { name: 'claimVesting', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [] },
  { name: 'getInvoiceAmount', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getInvoiceCollected', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: 'collected', type: 'uint256' }, { name: 'target', type: 'uint256' }, { name: 'payerCount', type: 'uint256' }] },
  { name: 'payInvoice', type: 'function', stateMutability: 'payable', inputs: [{ name: '_invoiceHash', type: 'bytes32' }, { name: '_paymentAmount', type: 'uint256' }], outputs: [] },
  { name: 'payInvoiceFull', type: 'function', stateMutability: 'payable', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [] },
  // Recurring escrow
  { name: 'depositRecurring', type: 'function', stateMutability: 'payable', inputs: [{ name: '_invoiceHash', type: 'bytes32' }, { name: '_intervalSeconds', type: 'uint256' }, { name: '_totalPeriods', type: 'uint256' }], outputs: [] },
  { name: 'claimRecurring', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [] },
  { name: 'getRecurringSchedule', type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: 'intervalSeconds', type: 'uint256' }, { name: 'totalPeriods', type: 'uint256' }, { name: 'claimedPeriods', type: 'uint256' }, { name: 'startTimestamp', type: 'uint256' }, { name: 'perPeriodAmount', type: 'uint256' }, { name: 'claimableNow', type: 'uint256' }] },
  // Events
  { name: 'RecurringDeposited', type: 'event', inputs: [{ name: 'invoiceHash', type: 'bytes32', indexed: true }, { name: 'payer', type: 'address', indexed: true }, { name: 'totalAmount', type: 'uint256', indexed: false }, { name: 'periods', type: 'uint256', indexed: false }, { name: 'interval', type: 'uint256', indexed: false }] },
  { name: 'RecurringClaimed', type: 'event', inputs: [{ name: 'invoiceHash', type: 'bytes32', indexed: true }, { name: 'creator', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'periodsClaimedSoFar', type: 'uint256', indexed: false }] },
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
  3: 'paused',
};
