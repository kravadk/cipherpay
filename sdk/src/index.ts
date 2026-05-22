/**
 * cipherpay-sdk
 *
 * Confidential payroll & payments SDK for CipherPay on Fhenix FHE.
 *
 * Node / server entry. React hooks are in the 'cipherpay-sdk/react' subpath.
 *
 * Run a confidential payroll:
 *   const cp = new CipherPay({ rpcUrl: 'https://...', privateKey: '0x...' });
 *   await cp.runPayroll({
 *     recipients: [
 *       { address: '0x...', amount: '2500.00' },
 *       { address: '0x...', amount: '1800.00' },
 *     ],
 *     memo: 'April Payroll',
 *   });
 *
 * Charge a single invoice:
 *   await cp.charge({ invoiceId: '0x...', amount: '0.01' });
 *
 * Relay on-chain events to a webhook endpoint:
 *   new CipherPayWebhooks({ rpcUrl, endpoint, secret }).start();
 */

export { CipherPay }         from './CipherPay';
export { CipherPayWebhooks } from './webhooks';
export type {
  ChargeOptions,
  ChargeResult,
  PayrollOptions,
  PayrollRecipient,
  PayrollResult,
  CheckoutState,
  CheckoutStatus,
  WebhookEvent,
  InvoiceType,
  CipherPayConfig,
} from './types';
