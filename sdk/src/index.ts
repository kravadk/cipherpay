/**
 * @cipherpay/sdk
 *
 * Stripe-like API for FHE-encrypted private payments via CipherPay.
 *
 * Quick start:
 *   const cp = new CipherPay({ rpcUrl: 'https://...', privateKey: '0x...' });
 *   await cp.charge({ invoiceId: '0x...', amount: '0.01', currency: 'ETH' });
 *
 * Webhook server:
 *   CipherPay.webhooks.listen(port, secret, handler);
 *
 * React hook:
 *   import { useCheckout } from '@cipherpay/sdk/react';
 *   const { pay, status, txHash } = useCheckout(invoiceHash);
 */

export { CipherPay }            from './CipherPay';
export { useCheckout }          from './hooks/useCheckout';
export { useShieldedBalance }   from './hooks/useShieldedBalance';
export { CipherPayWebhooks }    from './webhooks';
export type {
  ChargeOptions,
  ChargeResult,
  CheckoutState,
  WebhookEvent,
  InvoiceType,
} from './types';
