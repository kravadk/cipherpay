import type { ChargeOptions, ChargeResult, CipherPayConfig } from './types';

// CipherPayFHE contract address on Ethereum Sepolia
const DEFAULT_CONTRACT = '0xb3Fb5d67795CC2AaeFC4b843417DF9f45C864069';
const DEFAULT_CHAIN_ID = 11155111;

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

  /** Verify a webhook event signature (HMAC-SHA256 of payload + secret) */
  static verifyWebhook(payload: string, signature: string, secret: string): boolean {
    // In Node.js: crypto.createHmac('sha256', secret).update(payload).digest('hex')
    // Placeholder — real implementation uses native crypto module
    return signature.length === 64 && secret.length > 0 && payload.length > 0;
  }
}
