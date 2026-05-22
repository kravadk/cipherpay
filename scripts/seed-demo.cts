/**
 * seed-demo — populate the live deployment with a few demo payroll invoices,
 * so the app (Explorer / Dashboard) and the contracts are not empty.
 *
 * Uses CipherPaySimple (plaintext amounts) — no CoFHE coprocessor needed, so
 * this is a fast, low-gas seed. The app's useInvoices hook reads CipherPaySimple
 * alongside the FHE contract, so these show up in the UI.
 *
 * Run:
 *   TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/seed-demo.cts \
 *     --network eth-sepolia --config hardhat.config.cts
 */
const hre = require('hardhat');

// CipherPaySimple on Ethereum Sepolia (see src/config/contract.ts).
const CIPHERPAY_SIMPLE = '0x5F4999829D57f714497343f5677e66e6A56238E3';

const DEMO_INVOICES = [
  { amount: '0.02',  memo: 'April payroll — senior engineer' },
  { amount: '0.015', memo: 'April payroll — product designer' },
  { amount: '0.008', memo: 'Contractor payout — security audit' },
  { amount: '0.05',  memo: 'DAO contributor grant — Q2' },
];

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();

  console.log('Seeding demo invoices from:', deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance:', ethers.formatEther(balance), 'ETH\n');
  if (balance === 0n) {
    console.error('Deployer has 0 ETH — fund it on Sepolia first.');
    process.exit(1);
  }

  const contract = await ethers.getContractAt('CipherPaySimple', CIPHERPAY_SIMPLE);

  for (const inv of DEMO_INVOICES) {
    const salt = ethers.hexlify(ethers.randomBytes(32));
    // Fetch a fresh pending nonce per tx — avoids stale-cache "nonce too low".
    const nonce = await ethers.provider.getTransactionCount(deployer.address, 'pending');
    process.stdout.write(`Creating "${inv.memo}" (${inv.amount} ETH) ... `);
    const tx = await contract.createInvoice(
      ethers.parseEther(inv.amount),
      ethers.ZeroAddress, // open invoice — any payer
      0,                  // type 0 = standard
      0,                  // no deadline
      0,                  // no unlock block
      salt,
      inv.memo,
      { nonce },
    );
    const receipt = await tx.wait();
    console.log(`block ${receipt.blockNumber}  tx ${receipt.hash.slice(0, 16)}…`);
  }

  const count = await contract.getInvoiceCount(deployer.address);
  console.log(`\nDone — ${DEMO_INVOICES.length} demo invoices created.`);
  console.log(`Total invoices for ${deployer.address}: ${count}`);
}

main().catch((error: any) => { console.error(error); process.exitCode = 1; });
