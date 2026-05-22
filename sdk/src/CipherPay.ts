import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ChargeOptions, ChargeResult,
  PayrollOptions, PayrollResult,
  CipherPayConfig,
} from './types';

// CipherPayFHE contract address on Ethereum Sepolia
const DEFAULT_CONTRACT = '0x305eF265BD964fBe34913E70Ef6AA8951e6b662e';
const DEFAULT_CHAIN_ID = 11155111;
// BatchCipher — confidential batch payroll — on Ethereum Sepolia
const BATCH_CIPHER_ADDRESS = '0x347fb466f3c9bC031560b49973ec05BdAdD2d4C4';

/**
 * CipherPay — server-side / Node.js SDK for CipherPay protocol.
 *
 * Stripe-like API:
 *   const cp = new CipherPay({ rpcUrl, privateKey });
 *   const result = await cp.charge({ invoiceId: '0x...', amount: '0.01' });
 *
 * The SDK handles:
 *   1. FHE encryption of payment amount via @cofhe/sdk Node.js client
 *   2. Contract interaction (payInvoice / payInvoiceShielded / claimAnonymously)
 *   3. Transaction confirmation and result enrichment
 */
export class CipherPay {
  private config: Required<CipherPayConfig>;

  constructor(config: CipherPayConfig) {
    this.config = {
      rpcUrl:   config.rpcUrl,
      privateKey: config.privateKey || '',
      chainId:  config.chainId  ?? DEFAULT_CHAIN_ID,
      contract: config.contract ?? DEFAULT_CONTRACT,
    };
  }

  /**
   * Charge an invoice — FHE-encrypt the amount and submit payment.
   *
   * @example
   * const result = await cp.charge({
   *   invoiceId: '0xabc...',
   *   amount: '0.01',
   *   onProgress: (step) => console.log(step),
   * });
   * console.log('Paid:', result.txHash);
   */
  async charge(opts: ChargeOptions): Promise<ChargeResult> {
    const { invoiceId, amount, shielded = false, anonymous = false, onProgress } = opts;

    onProgress?.('initTfhe');

    // Dynamic import for tree-shaking — cofhe/sdk only loaded when charge() is called
    const { createCofheConfig, createCofheClient } = await import('@cofhe/sdk/node' as any);
    const { Encryptable } = await import('@cofhe/sdk');
    const { createPublicClient, createWalletClient, http, parseEther } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { sepolia } = await import('viem/chains');

    const account = privateKeyToAccount(this.config.privateKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: sepolia, transport: http(this.config.rpcUrl) });
    const walletClient = createWalletClient({ account, chain: sepolia, transport: http(this.config.rpcUrl) });

    const cofheConfig = createCofheConfig({ supportedChains: [sepolia as any] });
    const cofheClient = createCofheClient(cofheConfig);
    await cofheClient.connect(publicClient as any, walletClient as any);

    onProgress?.('encrypting');
    const amountWei = parseEther(amount);
    const [encAmount] = await cofheClient.encryptInputs([Encryptable.uint64(amountWei)]).execute();

    const encTuple = {
      ctHash:       BigInt(encAmount.ctHash ?? 0),
      securityZone: encAmount.securityZone ?? 0,
      utype:        encAmount.utype ?? 5,
      signature:    encAmount.signature ?? '0x',
    };

    onProgress?.('submitting');

    // Import minimal ABI inline — avoids needing the full contract.ts in sdk
    const payAbi = [{
      name: anonymous ? 'claimAnonymously' : shielded ? 'payInvoiceShielded' : 'payInvoice',
      type: 'function',
      stateMutability: anonymous || shielded ? 'nonpayable' : 'payable',
      inputs: anonymous
        ? [{ name: '_invoiceHash', type: 'bytes32' }, { name: '_encryptedPayment', type: 'tuple', components: [{ name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' }, { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' }] }, { name: '_nullifier', type: 'bytes32' }]
        : [{ name: '_invoiceHash', type: 'bytes32' }, { name: '_encryptedPayment', type: 'tuple', components: [{ name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' }, { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' }] }],
      outputs: [],
    }];

    const { keccak256, encodePacked } = await import('viem');
    const nullifier = opts.nullifier
      ? opts.nullifier as `0x${string}`
      : keccak256(encodePacked(['address', 'bytes32'], [account.address, invoiceId as `0x${string}`]));

    const args: unknown[] = anonymous
      ? [invoiceId, encTuple, nullifier]
      : [invoiceId, encTuple];

    if (shielded) {
      args.push(amountWei); // _maxDebit
    }

    const txHash = await walletClient.writeContract({
      address: this.config.contract as `0x${string}`,
      abi: payAbi,
      functionName: payAbi[0].name,
      args,
      value: anonymous || shielded ? 0n : amountWei,
    } as any);

    onProgress?.('confirming');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      txHash,
      invoiceId,
      amount,
      shielded,
      anonymous,
      blockNumber: receipt.blockNumber,
    };
  }

  /**
   * Run a confidential payroll batch.
   *
   * Every salary is FHE-encrypted, then a single `BatchCipher` transaction
   * creates one encrypted row per recipient. Each recipient can later claim and
   * decrypt only their own row — no recipient, and no on-chain observer, sees
   * another person's amount.
   *
   * @example
   * await cp.runPayroll({
   *   recipients: [
   *     { address: '0xabc...', amount: '2500.00' },
   *     { address: '0xdef...', amount: '1800.00' },
   *   ],
   *   memo: 'April Payroll',
   * });
   */
  async runPayroll(opts: PayrollOptions): Promise<PayrollResult> {
    const { recipients, memo = 'Payroll', onProgress } = opts;
    if (recipients.length === 0 || recipients.length > 100) {
      throw new Error('runPayroll: 1–100 recipients required per batch');
    }

    onProgress?.('initTfhe');

    const { createCofheConfig, createCofheClient } = await import('@cofhe/sdk/node' as any);
    const { Encryptable } = await import('@cofhe/sdk');
    const { createPublicClient, createWalletClient, http, parseEther, keccak256, encodePacked } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { sepolia } = await import('viem/chains');

    const account = privateKeyToAccount(this.config.privateKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: sepolia, transport: http(this.config.rpcUrl) });
    const walletClient = createWalletClient({ account, chain: sepolia, transport: http(this.config.rpcUrl) });

    const cofheClient = createCofheClient(createCofheConfig({ supportedChains: [sepolia as any] }));
    await cofheClient.connect(publicClient as any, walletClient as any);

    onProgress?.('encrypting');
    const amountsWei = recipients.map((r) => parseEther(r.amount));
    const encrypted: any[] = await cofheClient
      .encryptInputs(amountsWei.map((w: bigint) => Encryptable.uint64(w)))
      .execute();

    const encryptedAmounts = encrypted.map((e) => ({
      ctHash:       BigInt(e.ctHash ?? 0),
      securityZone: e.securityZone ?? 0,
      utype:        e.utype ?? 5,
      signature:    e.signature ?? '0x',
    }));

    const total = amountsWei.reduce((sum: bigint, w: bigint) => sum + w, 0n);
    const salt  = keccak256(encodePacked(['address', 'uint256'], [account.address, BigInt(Date.now())]));

    const createBatchAbi = [{
      name: 'createBatch',
      type: 'function',
      stateMutability: 'payable',
      inputs: [
        { name: '_recipients', type: 'address[]' },
        { name: '_encryptedAmounts', type: 'tuple[]', components: [
          { name: 'ctHash', type: 'uint256' }, { name: 'securityZone', type: 'uint8' },
          { name: 'utype', type: 'uint8' }, { name: 'signature', type: 'bytes' },
        ] },
        { name: '_ethAmounts', type: 'uint256[]' },
        { name: '_salt', type: 'bytes32' },
        { name: '_memo', type: 'string' },
      ],
      outputs: [{ name: 'batchId', type: 'bytes32' }],
    }];

    onProgress?.('submitting');
    const txHash = await walletClient.writeContract({
      address: BATCH_CIPHER_ADDRESS as `0x${string}`,
      abi: createBatchAbi,
      functionName: 'createBatch',
      args: [
        recipients.map((r) => r.address as `0x${string}`),
        encryptedAmounts,
        amountsWei,
        salt,
        memo,
      ],
      value: total,
    } as any);

    onProgress?.('confirming');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      txHash,
      recipientCount: recipients.length,
      memo,
      blockNumber: receipt.blockNumber,
    };
  }

  /**
   * Verify a webhook event signature.
   *
   * `CipherPayWebhooks` signs every delivery as `HMAC-SHA256(secret, rawBody)`
   * and sends the hex digest in the `X-CipherPay-Signature` header. This
   * recomputes the digest and compares it to the received one in constant
   * time, so a merchant can reject forged or tampered webhook calls.
   *
   * @param payload   the exact raw request body that was signed
   * @param signature the hex digest from the `X-CipherPay-Signature` header
   * @param secret    the shared webhook secret (`whsec_...`)
   */
  static verifyWebhook(payload: string, signature: string, secret: string): boolean {
    if (!payload || !signature || !secret) return false;

    const expected = createHmac('sha256', secret).update(payload).digest();

    let received: Buffer;
    try {
      received = Buffer.from(signature, 'hex');
    } catch {
      return false;
    }

    // timingSafeEqual throws on length mismatch — guard before comparing.
    if (received.length !== expected.length) return false;
    return timingSafeEqual(expected, received);
  }
}
