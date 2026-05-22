# cipherpay-sdk

Confidential payroll & payments SDK for [CipherPay](https://cipherpayy.vercel.app) on
Fhenix FHE. Run encrypted payroll, charge invoices, relay webhooks, and drop a pay button
into a React app — every amount stays encrypted as an FHE ciphertext on-chain.

## Install

```bash
npm install cipherpay-sdk
```

Peer dependencies: `@cofhe/sdk` and `viem` are required; `react` and `wagmi` are only
needed for the React hooks (`cipherpay-sdk/react`).

## Run a confidential payroll (Node / server)

```ts
import { CipherPay } from 'cipherpay-sdk';

const cp = new CipherPay({
  rpcUrl:     process.env.SEPOLIA_RPC_URL!,
  privateKey: process.env.PAYER_PRIVATE_KEY!, // employer / DAO treasury key
});

const result = await cp.runPayroll({
  memo: 'April Payroll',
  recipients: [
    { address: '0xAbc...', amount: '2500.00' },
    { address: '0xDef...', amount: '1800.00' },
  ],
  onProgress: (step) => console.log(step), // initTfhe → encrypting → submitting → confirming
});

console.log('Payroll batch tx:', result.txHash);
```

Each salary is FHE-encrypted before it reaches the chain. The batch is created in one
`BatchCipher` transaction; each recipient can later claim and decrypt **only their own
row** — no recipient, and no on-chain observer, sees another person's amount.

## Charge a single invoice

```ts
await cp.charge({ invoiceId: '0x...', amount: '0.01' });
```

## Webhooks

```ts
import { CipherPay, CipherPayWebhooks } from 'cipherpay-sdk';

new CipherPayWebhooks({
  rpcUrl:   process.env.SEPOLIA_RPC_URL!,
  endpoint: 'https://my-app.com/webhooks/cipherpay',
  secret:   process.env.CIPHERPAY_WEBHOOK_SECRET!,
}).start();

// In your webhook handler — verify the signature before trusting the payload:
const ok = CipherPay.verifyWebhook(rawBody, req.headers['x-cipherpay-signature'], secret);
```

`verifyWebhook` recomputes `HMAC-SHA256(secret, rawBody)` and compares it in constant time.

## React hook

```tsx
import { useCheckout } from 'cipherpay-sdk/react';

function PayButton({ invoiceHash }: { invoiceHash: string }) {
  const { pay, status, txHash } = useCheckout(invoiceHash);
  return (
    <button onClick={() => pay({ amount: '0.01' })} disabled={status !== 'idle'}>
      {status === 'encrypting' ? 'Encrypting…' : 'Pay with CipherPay'}
    </button>
  );
}
```

The hook must render inside a wagmi `<WagmiProvider>`.

## Build from source

```bash
npm install
npm run build   # tsc → dist/
```

## License

MIT
