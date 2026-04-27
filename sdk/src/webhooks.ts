/**
 * CipherPayWebhooks — relay on-chain CipherPay events to HTTPS endpoints.
 *
 * Merchants get order confirmation like Stripe webhooks.
 *
 * @example
 * const webhooks = new CipherPayWebhooks({
 *   rpcUrl: 'https://...',
 *   endpoint: 'https://my-store.com/webhooks/cipherpay',
 *   secret: 'whsec_...',
 * });
 *
 * webhooks.start();
 * // Listens to InvoicePaid, InvoiceSettled, AnonClaimSubmitted events
 * // POSTs signed JSON to your endpoint on each event
 */

import type { WebhookEvent } from './types';

interface WebhookConfig {
  rpcUrl:    string;
  endpoint:  string;
  secret:    string;
  contract?: string;
  fromBlock?: bigint;
}

const DEFAULT_CONTRACT = '0xb3Fb5d67795CC2AaeFC4b843417DF9f45C864069';

export class CipherPayWebhooks {
  private config: Required<WebhookConfig>;
  private running = false;

  constructor(config: WebhookConfig) {
    this.config = {
      rpcUrl:    config.rpcUrl,
      endpoint:  config.endpoint,
      secret:    config.secret,
      contract:  config.contract ?? DEFAULT_CONTRACT,
      fromBlock: config.fromBlock ?? 0n,
    };
  }

  /** Start watching for events and relaying to the webhook endpoint */
  async start() {
    if (this.running) return;
    this.running = true;

    const { createPublicClient, http, parseAbi } = await import('viem');
    const { sepolia } = await import('viem/chains');

    const client = createPublicClient({
      chain: sepolia,
      transport: http(this.config.rpcUrl),
    });

    const abi = parseAbi([
      'event InvoicePaid(bytes32 indexed invoiceHash, address indexed payer)',
      'event InvoiceSettled(bytes32 indexed invoiceHash)',
      'event InvoiceCancelled(bytes32 indexed invoiceHash)',
      'event AnonClaimSubmitted(bytes32 indexed invoiceHash, bytes32 indexed nullifier)',
    ]);

    client.watchContractEvent({
      address: this.config.contract as `0x${string}`,
      abi,
      onLogs: async (logs) => {
        for (const log of logs) {
          const event: WebhookEvent = {
            type: this._logToEventType(log.eventName),
            invoiceId: (log.args as any).invoiceHash ?? '',
            txHash: log.transactionHash ?? '',
            blockNumber: Number(log.blockNumber ?? 0),
            payer: (log.args as any).payer,
            timestamp: Date.now(),
          };
          await this._deliver(event);
        }
      },
    });
  }

  stop() {
    this.running = false;
  }

  private _logToEventType(name: string | undefined): WebhookEvent['type'] {
    const map: Record<string, WebhookEvent['type']> = {
      InvoicePaid:       'invoice.paid',
      InvoiceSettled:    'invoice.settled',
      InvoiceCancelled:  'invoice.cancelled',
      AnonClaimSubmitted: 'anon.claimed',
    };
    return map[name ?? ''] ?? 'invoice.paid';
  }

  private async _deliver(event: WebhookEvent) {
    const body = JSON.stringify(event);
    const sig  = await this._sign(body);

    try {
      await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CipherPay-Signature': sig,
          'X-CipherPay-Timestamp': String(event.timestamp),
        },
        body,
      });
    } catch (err) {
      console.error('[CipherPay Webhooks] Delivery failed:', err);
    }
  }

  private async _sign(payload: string): Promise<string> {
    // HMAC-SHA256 signature for webhook verification
    const { createHmac } = await import('crypto');
    return createHmac('sha256', this.config.secret).update(payload).digest('hex');
  }
}
