// Simple contract (plaintext amounts — MVP fallback)
export const CIPHERPAY_SIMPLE_ADDRESS = '0xF3A15EC0FAE753D6BEC3AAB3aEB2d72824c0713F' as const;

// FHE contract (encrypted amounts via Fhenix CoFHE)
export const CIPHERPAY_FHE_ADDRESS = '0xb3Fb5d67795CC2AaeFC4b843417DF9f45C864069' as const;

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
  // Async decrypt — two-phase pattern (FHE.decrypt deprecated April 13 2026)
  // Phase 1: requestFullyPaidCheck → FHE.allowPublic
  {
    name: 'requestFullyPaidCheck',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [],
  },
  // Phase 2: off-chain decryptForTx → on-chain publishPaidCheckResult
  {
    name: 'publishPaidCheckResult',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_invoiceHash', type: 'bytes32' },
      { name: '_plaintext', type: 'bool' },
      { name: '_signature', type: 'bytes' },
    ],
    outputs: [],
  },
  // Read stored result after phase 2
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
  // ── Wave 2: Shielded Balance Pool ────────────────────────────────────────
  // Pre-fund ETH bucket so actual pay tx has msg.value = 0
  {
    name: 'depositShielded',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'withdrawShielded',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_amount', type: 'uint256' }],
    outputs: [],
  },
  // Pay using pre-funded shielded balance (msg.value = 0)
  {
    name: 'payInvoiceShielded',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_invoiceHash', type: 'bytes32' },
      { name: '_encryptedPayment', ...InEuint64Tuple },
      { name: '_maxDebit', type: 'uint256' },
    ],
    outputs: [],
  },
  // Read shielded balance for an address
  {
    name: 'shieldedBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },

  // ── Wave 2: Anonymous Invoice Claim ──────────────────────────────────────
  // Enable anon mode on an existing invoice (creator only)
  {
    name: 'enableAnonClaim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [],
  },
  // Pay anonymously — nullifier stored instead of address
  {
    name: 'claimAnonymously',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_invoiceHash', type: 'bytes32' },
      { name: '_encryptedPayment', ...InEuint64Tuple },
      { name: '_nullifier', type: 'bytes32' },
    ],
    outputs: [],
  },
  // Creator sweeps anon pool after invoice is done
  {
    name: 'sweepAnonPool',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [],
  },
  // Check if anon claim is enabled for an invoice
  {
    name: 'anonEnabled',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  // Check if a nullifier was already used
  {
    name: 'anonNullifierUsed',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  // Read anon ETH pool balance for an invoice
  {
    name: 'anonEthPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
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
  {
    name: 'ShieldedDeposit',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'ShieldedWithdraw',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'AnonInvoiceEnabled',
    type: 'event',
    inputs: [{ name: 'invoiceHash', type: 'bytes32', indexed: true }],
  },
  {
    name: 'AnonClaimSubmitted',
    type: 'event',
    inputs: [
      { name: 'invoiceHash', type: 'bytes32', indexed: true },
      { name: 'nullifier', type: 'bytes32', indexed: true },
    ],
  },

  // ── FHE handle getters (encrypted, permit required) ──────────────────────
  { name: 'getEncryptedRecipient',    type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getEncryptedTax',          type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },

  // ── Platform aggregates (FHE.allowGlobal — no permit needed) ─────────────
  { name: 'getPlatformVolume',        type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getPlatformInvoiceCount',  type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },

  // ── Tax ───────────────────────────────────────────────────────────────────
  {
    name: 'setInvoiceTax',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }, { name: '_taxBps', type: 'uint64' }],
    outputs: [],
  },

  // ── Recurring escrow (FHE contract — same as CipherPayFHE) ───────────────
  {
    name: 'depositRecurring',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }, { name: '_intervalSeconds', type: 'uint256' }, { name: '_totalPeriods', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'claimRecurring',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getRecurringSchedule',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_invoiceHash', type: 'bytes32' }],
    outputs: [
      { name: 'intervalSeconds', type: 'uint256' }, { name: 'totalPeriods', type: 'uint256' },
      { name: 'claimedPeriods', type: 'uint256' }, { name: 'startTimestamp', type: 'uint256' },
      { name: 'perPeriodAmount', type: 'uint256' }, { name: 'claimableNow', type: 'uint256' },
    ],
  },

  // ── Breakdown items ───────────────────────────────────────────────────────
  {
    name: 'addBreakdownItem',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_invoiceHash', type: 'bytes32' },
      { name: '_label', type: 'string' },
      { name: '_encryptedPrice', type: 'tuple', components: [{ name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' }, { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' }] },
    ],
    outputs: [],
  },
  { name: 'breakdownCount',       type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getBreakdownLabel',    type: 'function', stateMutability: 'view', inputs: [{ name: '_invoiceHash', type: 'bytes32' }, { name: '_index', type: 'uint256' }], outputs: [{ name: '', type: 'string' }] },

  // ── Nonce helper ──────────────────────────────────────────────────────────
  { name: 'generateEncryptedNonce', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [{ name: '', type: 'uint256' }] },

  // ── Recurring events (FHE) ────────────────────────────────────────────────
  { name: 'RecurringDeposited', type: 'event', inputs: [{ name: 'invoiceHash', type: 'bytes32', indexed: true }, { name: 'payer', type: 'address', indexed: true }, { name: 'totalAmount', type: 'uint256', indexed: false }, { name: 'periods', type: 'uint256', indexed: false }, { name: 'interval', type: 'uint256', indexed: false }] },
  { name: 'RecurringClaimed',   type: 'event', inputs: [{ name: 'invoiceHash', type: 'bytes32', indexed: true }, { name: 'creator', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'periodsClaimedSoFar', type: 'uint256', indexed: false }] },
  { name: 'InvoicePaidShielded', type: 'event', inputs: [{ name: 'invoiceHash', type: 'bytes32', indexed: true }, { name: 'payer', type: 'address', indexed: true }] },
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
  4: 'donation',
};

export const INVOICE_STATUS_MAP: Record<number, string> = {
  0: 'open',
  1: 'settled',
  2: 'cancelled',
  3: 'paused',
};

// ── Wave 3 contract addresses ────────────────────────────────────────────────
export const BATCH_CIPHER_ADDRESS        = '0xD0A780aCEf824a26B8bfA772b068fa27D827e44B' as const;
export const CIPHER_DROP_ADDRESS         = '0xeF22AbFB0564b98fBa43d5317D30C6A57fF84425' as const;
export const MILESTONE_ESCROW_ADDRESS    = '0x6c546AA11565018436D0503DaD0751d12A18ff12' as const;
export const RECURRING_SCHEDULER_ADDRESS = '0xAB92E9Ef65532A0Ae4E157F5193f3A206335DE58' as const;

// ── Wave 4 contract addresses ────────────────────────────────────────────────
export const SALARY_PROOF_ADDRESS  = '0xA333Be9a1F92136873bC03Ff62292dCc85730206' as const;
export const AUDIT_CENTER_ADDRESS  = '0xA1dc239e041Eb1505e01B75A4E30ba04b776DE60' as const;
export const DAO_TREASURY_ADDRESS  = '0x834EAb3ef3238371A24A53A94407408c029299EC' as const;

// ── Wave 5 contract addresses ────────────────────────────────────────────────
export const FEE_MODULE_ADDRESS    = '0x4AF36795254bdF6aCA52f649468a9D596E7Ef13A' as const;

// ── BatchCipher ABI ───────────────────────────────────────────────────────────
export const BATCH_CIPHER_ABI = [
  {
    name: 'createBatch',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_recipients',      type: 'address[]' },
      { name: '_encryptedAmounts', type: 'tuple[]', components: [
        { name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' },
        { name: 'utype',  type: 'uint8'   }, { name: 'signature',    type: 'bytes'  },
      ]},
      { name: '_ethAmounts', type: 'uint256[]' },
      { name: '_salt',       type: 'bytes32'   },
      { name: '_memo',       type: 'string'    },
    ],
    outputs: [{ name: 'batchId', type: 'bytes32' }],
  },
  {
    name: 'claimBatch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_batchId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'cancelBatch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_batchId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getBatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_batchId', type: 'bytes32' }],
    outputs: [
      { name: 'creator',      type: 'address' },
      { name: 'createdAt',    type: 'uint256' },
      { name: 'totalEntries', type: 'uint256' },
      { name: 'claimedCount', type: 'uint256' },
      { name: 'cancelled',    type: 'bool'    },
      { name: 'memo',         type: 'string'  },
    ],
  },
  {
    name: 'getEntryCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_batchId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getMyEntry',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_batchId', type: 'bytes32' }],
    outputs: [
      { name: 'encryptedAmount', type: 'uint256' },
      { name: 'claimed',         type: 'bool'    },
      { name: 'ethAmount',       type: 'uint256' },
    ],
  },
  {
    name: 'getAllEntries',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_batchId', type: 'bytes32' }],
    outputs: [
      { name: 'recipients', type: 'address[]' },
      { name: 'claimed',    type: 'bool[]'    },
      { name: 'ethAmounts', type: 'uint256[]' },
    ],
  },
  {
    name: 'recipientIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }, { name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  { name: 'BatchCreated',      type: 'event', inputs: [{ name: 'batchId', type: 'bytes32', indexed: true }, { name: 'creator', type: 'address', indexed: true }, { name: 'totalEntries', type: 'uint256', indexed: false }, { name: 'memo', type: 'string', indexed: false }] },
  { name: 'BatchEntryClaimed', type: 'event', inputs: [{ name: 'batchId', type: 'bytes32', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'index', type: 'uint256', indexed: false }] },
  { name: 'BatchCancelled',    type: 'event', inputs: [{ name: 'batchId', type: 'bytes32', indexed: true }] },
] as const;

// ── CipherDrop ABI ────────────────────────────────────────────────────────────
export const CIPHER_DROP_ABI = [
  {
    name: 'createDrop',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_encryptedMinBalance',  type: 'tuple', components: [{ name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' }, { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' }] },
      { name: '_encryptedClaimAmount', type: 'tuple', components: [{ name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' }, { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' }] },
      { name: '_slots', type: 'uint256' },
      { name: '_salt',  type: 'bytes32' },
      { name: '_memo',  type: 'string'  },
    ],
    outputs: [{ name: 'dropId', type: 'bytes32' }],
  },
  {
    name: 'requestEligibilityCheck',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_dropId',          type: 'bytes32' },
      { name: '_claimerBalance',  type: 'tuple', components: [{ name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' }, { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' }] },
      { name: '_nullifier',       type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'claimDrop',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_dropId',    type: 'bytes32' },
      { name: '_nullifier', type: 'bytes32' },
      { name: '_plaintext', type: 'bool'    },
      { name: '_signature', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'closeDrop',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_dropId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getDrop',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_dropId', type: 'bytes32' }],
    outputs: [
      { name: 'creator',        type: 'address' },
      { name: 'remainingSlots', type: 'uint256' },
      { name: 'ethPerClaim',    type: 'uint256' },
      { name: 'active',         type: 'bool'    },
      { name: 'createdAt',      type: 'uint256' },
      { name: 'memo',           type: 'string'  },
    ],
  },
  {
    name: 'getEncryptedMinBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_dropId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getEncryptedClaimAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_dropId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'nullifierState',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }, { name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  { name: 'DropCreated',                  type: 'event', inputs: [{ name: 'dropId', type: 'bytes32', indexed: true }, { name: 'creator', type: 'address', indexed: true }, { name: 'slots', type: 'uint256', indexed: false }, { name: 'memo', type: 'string', indexed: false }] },
  { name: 'EligibilityCheckRequested',    type: 'event', inputs: [{ name: 'dropId', type: 'bytes32', indexed: true }, { name: 'nullifier', type: 'bytes32', indexed: true }] },
  { name: 'DropClaimed',                  type: 'event', inputs: [{ name: 'dropId', type: 'bytes32', indexed: true }, { name: 'nullifier', type: 'bytes32', indexed: true }] },
  { name: 'DropRejected',                 type: 'event', inputs: [{ name: 'dropId', type: 'bytes32', indexed: true }, { name: 'nullifier', type: 'bytes32', indexed: true }] },
  { name: 'DropClosed',                   type: 'event', inputs: [{ name: 'dropId', type: 'bytes32', indexed: true }] },
  // Phase-2 getter: read stored eligibility ebool handle
  { name: 'getEligibilityResult', type: 'function', stateMutability: 'view', inputs: [{ name: '_dropId', type: 'bytes32' }, { name: '_nullifier', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

// ── MilestoneEscrow ABI ───────────────────────────────────────────────────────
const InEuint64T = { type: 'tuple', components: [{ name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' }, { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' }] } as const;

export const MILESTONE_ESCROW_ABI = [
  {
    name: 'createEscrow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_beneficiary',     type: 'address'  },
      { name: '_encryptedTotal',  ...InEuint64T },
      { name: '_encryptedQ1',     ...InEuint64T },
      { name: '_encryptedQ2',     ...InEuint64T },
      { name: '_encryptedQ3',     ...InEuint64T },
      { name: '_salt',            type: 'bytes32'  },
      { name: '_memo',            type: 'string'   },
    ],
    outputs: [{ name: 'id', type: 'bytes32' }],
  },
  {
    name: 'fundMilestone',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_id',               type: 'bytes32' },
      { name: '_encryptedPayment', ...InEuint64T  },
    ],
    outputs: [],
  },
  {
    name: 'releaseMilestone',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_id', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'cancelEscrow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_id', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getEscrow',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_id', type: 'bytes32' }],
    outputs: [
      { name: 'creator',             type: 'address' },
      { name: 'beneficiary',         type: 'address' },
      { name: 'ethHeld',             type: 'uint256' },
      { name: 'releasedMilestones',  type: 'uint256' },
      { name: 'active',              type: 'bool'    },
      { name: 'createdAt',           type: 'uint256' },
      { name: 'memo',                type: 'string'  },
    ],
  },
  { name: 'getEncryptedTier',      type: 'function', stateMutability: 'view', inputs: [{ name: '_id', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getEncryptedCollected', type: 'function', stateMutability: 'view', inputs: [{ name: '_id', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getEncryptedTotal',     type: 'function', stateMutability: 'view', inputs: [{ name: '_id', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'EscrowCreated',    type: 'event', inputs: [{ name: 'id', type: 'bytes32', indexed: true }, { name: 'creator', type: 'address', indexed: true }, { name: 'beneficiary', type: 'address', indexed: true }, { name: 'memo', type: 'string', indexed: false }] },
  { name: 'MilestoneFunded',  type: 'event', inputs: [{ name: 'id', type: 'bytes32', indexed: true }, { name: 'funder', type: 'address', indexed: true }, { name: 'ethAmount', type: 'uint256', indexed: false }] },
  { name: 'MilestoneReleased',type: 'event', inputs: [{ name: 'id', type: 'bytes32', indexed: true }, { name: 'milestoneNumber', type: 'uint256', indexed: false }, { name: 'ethReleased', type: 'uint256', indexed: false }] },
  { name: 'EscrowCancelled',  type: 'event', inputs: [{ name: 'id', type: 'bytes32', indexed: true }] },
] as const;

// ── RecurringScheduler ABI ────────────────────────────────────────────────────
const InEuint8T = { type: 'tuple', components: [{ name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' }, { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' }] } as const;

export const RECURRING_SCHEDULER_ABI = [
  {
    name: 'createSchedule',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_beneficiary',         type: 'address'  },
      { name: '_encryptedFrequency',  ...InEuint8T  },
      { name: '_encryptedAmount',     ...InEuint64T },
      { name: '_totalPeriods',        type: 'uint256'  },
      { name: '_blockInterval',       type: 'uint256'  },
      { name: '_salt',                type: 'bytes32'  },
      { name: '_memo',                type: 'string'   },
    ],
    outputs: [{ name: 'id', type: 'bytes32' }],
  },
  {
    name: 'triggerPayment',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_id', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'publishPaymentResult',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_id',        type: 'bytes32' },
      { name: '_plaintext', type: 'bool'    },
      { name: '_signature', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'cancelSchedule',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_id', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getSchedule',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_id', type: 'bytes32' }],
    outputs: [
      { name: 'creator',        type: 'address' },
      { name: 'beneficiary',    type: 'address' },
      { name: 'totalPeriods',   type: 'uint256' },
      { name: 'claimedPeriods', type: 'uint256' },
      { name: 'ethPerPeriod',   type: 'uint256' },
      { name: 'ethEscrowed',    type: 'uint256' },
      { name: 'active',         type: 'bool'    },
      { name: 'createdAt',      type: 'uint256' },
      { name: 'memo',           type: 'string'  },
    ],
  },
  { name: 'getEncryptedFrequency', type: 'function', stateMutability: 'view', inputs: [{ name: '_id', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getEncryptedNextDue',   type: 'function', stateMutability: 'view', inputs: [{ name: '_id', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getEncryptedAmount',    type: 'function', stateMutability: 'view', inputs: [{ name: '_id', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'ScheduleCreated',   type: 'event', inputs: [{ name: 'id', type: 'bytes32', indexed: true }, { name: 'creator', type: 'address', indexed: true }, { name: 'beneficiary', type: 'address', indexed: true }, { name: 'totalPeriods', type: 'uint256', indexed: false }, { name: 'memo', type: 'string', indexed: false }] },
  { name: 'PaymentTriggered',  type: 'event', inputs: [{ name: 'id', type: 'bytes32', indexed: true }] },
  { name: 'PaymentExecuted',   type: 'event', inputs: [{ name: 'id', type: 'bytes32', indexed: true }, { name: 'periodsClaimedSoFar', type: 'uint256', indexed: false }, { name: 'ethPaid', type: 'uint256', indexed: false }] },
  { name: 'ScheduleCompleted', type: 'event', inputs: [{ name: 'id', type: 'bytes32', indexed: true }] },
  { name: 'ScheduleCancelled', type: 'event', inputs: [{ name: 'id', type: 'bytes32', indexed: true }] },
  // Phase-2 getter: isDue ebool handle
  { name: 'getIsDueResult', type: 'function', stateMutability: 'view', inputs: [{ name: '_id', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

// ── SalaryProof ABI ───────────────────────────────────────────────────────────
export const SALARY_PROOF_ABI = [
  {
    name: 'recordIncome',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_encryptedIncome', type: 'tuple', components: [{ name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' }, { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' }] }],
    outputs: [],
  },
  {
    name: 'selfProveSalary',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_threshold', type: 'uint256' }, { name: '_label', type: 'string' }],
    outputs: [{ name: 'proofId', type: 'bytes32' }],
  },
  {
    name: 'requestVerifierProof',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_subject', type: 'address' }, { name: '_threshold', type: 'uint256' }, { name: '_label', type: 'string' }],
    outputs: [{ name: 'proofId', type: 'bytes32' }],
  },
  {
    name: 'publishProof',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_proofId', type: 'bytes32' }, { name: '_plaintext', type: 'bool' }, { name: '_signature', type: 'bytes' }],
    outputs: [],
  },
  {
    name: 'getProof',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_proofId', type: 'bytes32' }],
    outputs: [
      { name: 'subject', type: 'address' }, { name: 'verifier', type: 'address' },
      { name: 'threshold', type: 'uint256' }, { name: 'thresholdLabel', type: 'string' },
      { name: 'requestedAt', type: 'uint256' }, { name: 'resultReady', type: 'bool' }, { name: 'result', type: 'bool' },
    ],
  },
  { name: 'getSubjectProofs', type: 'function', stateMutability: 'view', inputs: [{ name: '_subject', type: 'address' }], outputs: [{ name: '', type: 'bytes32[]' }] },
  { name: 'hasIncomeRecord', type: 'function', stateMutability: 'view', inputs: [{ name: '_subject', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'getIncomeRecordedAt', type: 'function', stateMutability: 'view', inputs: [{ name: '_subject', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'IncomeRecorded',  type: 'event', inputs: [{ name: 'subject', type: 'address', indexed: true }, { name: 'recordedAt', type: 'uint256', indexed: false }] },
  { name: 'ProofRequested',  type: 'event', inputs: [{ name: 'proofId', type: 'bytes32', indexed: true }, { name: 'subject', type: 'address', indexed: true }, { name: 'verifier', type: 'address', indexed: true }, { name: 'threshold', type: 'uint256', indexed: false }, { name: 'thresholdLabel', type: 'string', indexed: false }] },
  { name: 'ProofPublished',  type: 'event', inputs: [{ name: 'proofId', type: 'bytes32', indexed: true }, { name: 'result', type: 'bool', indexed: false }] },
] as const;

// ── AuditCenter ABI ───────────────────────────────────────────────────────────
export const AUDIT_CENTER_ABI = [
  {
    name: 'createAuditPackage',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_invoiceHashes', type: 'bytes32[]' },
      { name: '_auditor',       type: 'address'   },
      { name: '_expiresAt',     type: 'uint256'   },
      { name: '_scopeBitmap',   type: 'uint8'     },
      { name: '_label',         type: 'string'    },
    ],
    outputs: [{ name: 'packageId', type: 'bytes32' }],
  },
  {
    name: 'requestAuditDecrypt',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_packageId',   type: 'bytes32' },
      { name: '_invoiceHash', type: 'bytes32' },
      { name: '_field',       type: 'uint8'   },
      { name: '_encHandle',   type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'revokeAuditPackage',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_packageId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getPackage',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_packageId', type: 'bytes32' }],
    outputs: [
      { name: 'creator', type: 'address' }, { name: 'auditor', type: 'address' },
      { name: 'expiresAt', type: 'uint256' }, { name: 'scopeBitmap', type: 'uint8' },
      { name: 'createdAt', type: 'uint256' }, { name: 'revoked', type: 'bool' },
      { name: 'label', type: 'string' }, { name: 'invoiceCount', type: 'uint256' },
    ],
  },
  {
    name: 'isAuditAllowed',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_packageId', type: 'bytes32' }, { name: '_auditor', type: 'address' }, { name: '_invoiceHash', type: 'bytes32' }, { name: '_field', type: 'uint8' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  { name: 'getPackageInvoices', type: 'function', stateMutability: 'view', inputs: [{ name: '_packageId', type: 'bytes32' }], outputs: [{ name: '', type: 'bytes32[]' }] },
  { name: 'AuditGranted',   type: 'event', inputs: [{ name: 'packageId', type: 'bytes32', indexed: true }, { name: 'creator', type: 'address', indexed: true }, { name: 'auditor', type: 'address', indexed: true }, { name: 'expiresAt', type: 'uint256', indexed: false }, { name: 'scopeBitmap', type: 'uint8', indexed: false }, { name: 'label', type: 'string', indexed: false }] },
  { name: 'AuditAccessed',  type: 'event', inputs: [{ name: 'packageId', type: 'bytes32', indexed: true }, { name: 'auditor', type: 'address', indexed: true }, { name: 'invoiceHash', type: 'bytes32', indexed: true }, { name: 'field', type: 'uint8', indexed: false }] },
  { name: 'AuditRevoked',   type: 'event', inputs: [{ name: 'packageId', type: 'bytes32', indexed: true }] },
] as const;

// ── DAOTreasury ABI ───────────────────────────────────────────────────────────
export const DAO_TREASURY_ABI = [
  {
    name: 'createProposal',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_encryptedBudget', type: 'tuple', components: [{ name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' }, { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' }] },
      { name: '_title',                  type: 'string'  },
      { name: '_description',            type: 'string'  },
      { name: '_recipient',              type: 'address' },
      { name: '_quorum',                 type: 'uint256' },
      { name: '_voteDurationSeconds',    type: 'uint256' },
      { name: '_salt',                   type: 'bytes32' },
    ],
    outputs: [{ name: 'proposalId', type: 'bytes32' }],
  },
  {
    name: 'vote',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_proposalId', type: 'bytes32' }, { name: '_inFavor', type: 'bool' }],
    outputs: [],
  },
  {
    name: 'requestQuorumCheck',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_proposalId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'publishQuorumResult',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_proposalId', type: 'bytes32' }, { name: '_plaintext', type: 'bool' }, { name: '_signature', type: 'bytes' }],
    outputs: [],
  },
  {
    name: 'executeProposal',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: '_proposalId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'addMember',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_member', type: 'address' }],
    outputs: [],
  },
  {
    name: 'getProposal',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_id', type: 'bytes32' }],
    outputs: [
      { name: 'creator', type: 'address' }, { name: 'title', type: 'string' },
      { name: 'description', type: 'string' }, { name: 'recipient', type: 'address' },
      { name: 'quorum', type: 'uint256' }, { name: 'voteDeadline', type: 'uint256' },
      { name: 'status', type: 'uint8' }, { name: 'createdAt', type: 'uint256' },
      { name: 'ethFunded', type: 'uint256' },
    ],
  },
  { name: 'members',             type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'memberCount',         type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'hasVoted',            type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }, { name: '', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'getMemberProposals',  type: 'function', stateMutability: 'view', inputs: [{ name: '_m', type: 'address' }], outputs: [{ name: '', type: 'bytes32[]' }] },
  { name: 'getEncryptedBudget',  type: 'function', stateMutability: 'view', inputs: [{ name: '_id', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'ProposalCreated',    type: 'event', inputs: [{ name: 'proposalId', type: 'bytes32', indexed: true }, { name: 'creator', type: 'address', indexed: true }, { name: 'title', type: 'string', indexed: false }, { name: 'voteDeadline', type: 'uint256', indexed: false }] },
  { name: 'Voted',              type: 'event', inputs: [{ name: 'proposalId', type: 'bytes32', indexed: true }, { name: 'voter', type: 'address', indexed: true }, { name: 'inFavor', type: 'bool', indexed: false }] },
  { name: 'ProposalFinalized',  type: 'event', inputs: [{ name: 'proposalId', type: 'bytes32', indexed: true }, { name: 'passed', type: 'bool', indexed: false }] },
  { name: 'ProposalExecuted',   type: 'event', inputs: [{ name: 'proposalId', type: 'bytes32', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'ethAmount', type: 'uint256', indexed: false }] },
  { name: 'MemberAdded',        type: 'event', inputs: [{ name: 'member', type: 'address', indexed: true }] },
  // Phase-2 getter: quorum result ebool handle
  { name: 'getEncryptedQuorumResult', type: 'function', stateMutability: 'view', inputs: [{ name: '_id', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

// ── FeeModule ABI ─────────────────────────────────────────────────────────────
export const FEE_MODULE_ABI = [
  {
    name: 'setFeeRate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_encryptedFeeBps', type: 'tuple', components: [{ name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' }, { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' }] }],
    outputs: [],
  },
  {
    name: 'collectFee',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: '_encryptedAmount', type: 'tuple', components: [{ name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' }, { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' }] }],
    outputs: [{ name: 'netHandle', type: 'uint256' }],
  },
  { name: 'requestRevenueSweep', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    name: 'publishSweepResult',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_plaintextRevenue', type: 'uint256' }, { name: '_signature', type: 'bytes' }],
    outputs: [],
  },
  { name: 'sweepPending',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'getPlatformRevenue', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getEncryptedFeeBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'owner',              type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'FeeRateUpdated',     type: 'event', inputs: [{ name: 'updatedAt', type: 'uint256', indexed: false }] },
  { name: 'FeeCollected',       type: 'event', inputs: [{ name: 'ethNet', type: 'uint256', indexed: false }] },
  { name: 'RevenueSweepRequested', type: 'event', inputs: [{ name: 'requestedAt', type: 'uint256', indexed: false }] },
  { name: 'RevenueSweepExecuted',  type: 'event', inputs: [{ name: 'amount', type: 'uint256', indexed: false }] },
] as const;
