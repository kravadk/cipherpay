import { motion } from 'framer-motion';
import { ShieldCheck, ExternalLink, CheckCircle2, FlaskConical, Lock, Eye } from 'lucide-react';
import {
  CIPHERPAY_FHE_ADDRESS, CIPHERPAY_SIMPLE_ADDRESS, PAYMENT_PROOF_ADDRESS,
  SHARED_INVOICE_ADDRESS, INVOICE_METRICS_ADDRESS, BATCH_CIPHER_ADDRESS,
  CIPHER_DROP_ADDRESS, MILESTONE_ESCROW_ADDRESS, RECURRING_SCHEDULER_ADDRESS,
  SALARY_PROOF_ADDRESS, AUDIT_CENTER_ADDRESS, DAO_TREASURY_ADDRESS,
  FEE_MODULE_ADDRESS, PAYROLL_ANCHOR_ADDRESS, PAYROLL_TOKEN_ADDRESS,
} from '../../config/contract';

const SCAN = 'https://sepolia.etherscan.io/address/';

interface Row { name: string; address: string; role: string; }

const PAYROLL: Row[] = [
  { name: 'BatchCipher',              address: BATCH_CIPHER_ADDRESS,        role: 'Batch payout — per-row FHE.allow' },
  { name: 'RecurringScheduler',       address: RECURRING_SCHEDULER_ADDRESS, role: 'Recurring payroll — encrypted schedule' },
  { name: 'SalaryProof',              address: SALARY_PROOF_ADDRESS,        role: 'Prove income ≥ X without revealing it' },
  { name: 'AuditCenter',              address: AUDIT_CENTER_ADDRESS,        role: 'Scoped, time-limited audit disclosure' },
  { name: 'DAOTreasury',              address: DAO_TREASURY_ADDRESS,        role: 'Encrypted DAO budget + vote tallies' },
  { name: 'ConfidentialPayrollToken', address: PAYROLL_TOKEN_ADDRESS,       role: 'FHERC-20 confidential payout token' },
  { name: 'PayrollAnchor',            address: PAYROLL_ANCHOR_ADDRESS,      role: 'Merkle anchor for invoice-existence proofs' },
  { name: 'FeeModule',                address: FEE_MODULE_ADDRESS,          role: 'Encrypted platform fee rate' },
];

const INVOICING: Row[] = [
  { name: 'CipherPayFHE',    address: CIPHERPAY_FHE_ADDRESS,    role: 'Invoice engine — encrypted amounts, anon claim' },
  { name: 'CipherPaySimple', address: CIPHERPAY_SIMPLE_ADDRESS, role: 'Fallback — real ETH escrow, vesting' },
  { name: 'PaymentProof',    address: PAYMENT_PROOF_ADDRESS,    role: 'On-chain encrypted payment receipts' },
  { name: 'SharedInvoice',   address: SHARED_INVOICE_ADDRESS,   role: 'Bill splitting with encrypted shares' },
  { name: 'InvoiceMetrics',  address: INVOICE_METRICS_ADDRESS,  role: 'Encrypted per-user analytics' },
  { name: 'CipherDrop',      address: CIPHER_DROP_ADDRESS,      role: 'FHE-gated airdrop' },
  { name: 'MilestoneEscrow', address: MILESTONE_ESCROW_ADDRESS, role: 'Chained FHE.select milestone tiers' },
];

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function ContractTable({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-text-muted uppercase tracking-widest">{title}</h3>
      <div className="bg-surface-1 border border-border-default rounded-2xl overflow-hidden">
        {rows.map((r, i) => (
          <a
            key={r.name}
            href={`${SCAN}${r.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-surface-2 transition-colors ${i > 0 ? 'border-t border-border-default' : ''}`}
          >
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">{r.name}</p>
              <p className="text-xs text-text-muted truncate">{r.role}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <code className="text-xs font-mono text-primary">{short(r.address)}</code>
              <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

export function Proof() {
  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Proof</h1>
        <p className="text-text-secondary">
          Every CipherPay contract is live and verifiable on Ethereum Sepolia. Nothing here is a mock.
        </p>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs text-text-secondary space-y-1">
          <p><span className="text-primary font-bold">15 contracts deployed</span> on Ethereum Sepolia — every address below links to Etherscan. The app reads these same addresses from <code className="font-mono">src/config/contract.ts</code>.</p>
          <p>FHE state (amounts, recipients, balances) is real CoFHE ciphertext — the on-chain handles are public, the values are not.</p>
        </div>
      </div>

      {/* Test coverage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: <FlaskConical className="w-5 h-5 text-primary" />, title: 'E2E suite', body: 'scripts/e2e-test.cts + test-all-flows.cts — 67 on-chain tests exercising every contract against the live deployment.' },
          { icon: <Lock className="w-5 h-5 text-primary" />, title: 'Real FHE', body: 'Encryption runs through @cofhe/sdk (TFHE + ZK proof). Contracts compute on euint64 ciphertext — verify the FHE ops on Etherscan.' },
          { icon: <Eye className="w-5 h-5 text-primary" />, title: 'Permit-gated reveal', body: 'Amounts decrypt only with an EIP-712 permit via the CoFHE Threshold Network — try it on any encrypted balance.' },
        ].map(card => (
          <div key={card.title} className="bg-surface-1 border border-border-default rounded-2xl p-5 space-y-2">
            {card.icon}
            <p className="text-sm font-bold text-white">{card.title}</p>
            <p className="text-xs text-text-secondary leading-relaxed">{card.body}</p>
          </div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
      >
        <ContractTable title="Payroll layer" rows={PAYROLL} />
        <ContractTable title="Invoicing & primitives" rows={INVOICING} />
      </motion.div>

      <div className="bg-surface-1 border border-border-default rounded-2xl p-5 flex items-start gap-3">
        <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-text-secondary">
          To reproduce: <code className="font-mono text-primary">npx hardhat run scripts/deploy-all.cts --network eth-sepolia</code> redeploys
          every contract, and <code className="font-mono text-primary">scripts/test-all-flows.cts</code> runs the on-chain suite against the result.
          Deployment addresses are recorded in <code className="font-mono">deployments/eth-sepolia.json</code>.
        </p>
      </div>
    </div>
  );
}
