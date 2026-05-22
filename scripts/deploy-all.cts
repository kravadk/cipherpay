/**
 * deploy-all — redeploy every CipherPay contract from the current PRIVATE_KEY.
 *
 * Run:
 *   TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/deploy-all.cts \
 *     --network eth-sepolia --config hardhat.config.cts
 *
 * Order matters: PaymentProof and InvoiceMetrics take the CipherPayFHE address
 * in their constructor. Addresses are written to deployments/<network>.json
 * after every successful deploy, so a mid-run failure still records progress.
 */
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();

  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  if (balance === 0n) {
    console.error('Deployer has 0 ETH — fund this address on Sepolia, then re-run.');
    process.exit(1);
  }

  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  const outFile = path.join(deploymentsDir, `${network.name}.json`);

  const deployed: Record<string, string> = {};
  const save = () => fs.writeFileSync(outFile, JSON.stringify({
    network:   network.name,
    chainId:   Number(network.config.chainId),
    deployer:  deployer.address,
    timestamp: new Date().toISOString(),
    contracts: deployed,
  }, null, 2));

  async function deploy(name: string, args: any[] = []): Promise<string> {
    process.stdout.write(`Deploying ${name} ... `);
    const factory = await ethers.getContractFactory(name);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    deployed[name] = address;
    save();
    console.log(address);
    return address;
  }

  // 1. Core invoice engine — PaymentProof + InvoiceMetrics reference it.
  const fhe = await deploy('CipherPayFHE');

  // 2. Wave 1 contracts.
  await deploy('CipherPaySimple');
  await deploy('PaymentProof', [fhe]);
  await deploy('SharedInvoice');
  await deploy('InvoiceMetrics', [fhe]);

  // 3. Wave 3 payroll layers.
  await deploy('BatchCipher');
  await deploy('CipherDrop');
  await deploy('MilestoneEscrow');
  await deploy('RecurringScheduler');

  // 4. Wave 4 compliance layers.
  await deploy('SalaryProof');
  await deploy('AuditCenter');
  await deploy('DAOTreasury');

  // 5. Wave 5 + new payroll contracts.
  await deploy('FeeModule');
  await deploy('PayrollAnchor');
  await deploy('ConfidentialPayrollToken', ['CipherPay USD', 'cpUSD']);

  console.log(`\n=== All ${Object.keys(deployed).length} contracts deployed ===`);
  console.log(`Saved to deployments/${network.name}.json\n`);
  console.log('--- Paste into src/config/contract.ts ---');
  const line = (k: string, v: string) => console.log(`export const ${k} = '${v}' as const;`);
  line('CIPHERPAY_SIMPLE_ADDRESS',    deployed.CipherPaySimple);
  line('CIPHERPAY_FHE_ADDRESS',       deployed.CipherPayFHE);
  line('PAYMENT_PROOF_ADDRESS',       deployed.PaymentProof);
  line('SHARED_INVOICE_ADDRESS',      deployed.SharedInvoice);
  line('INVOICE_METRICS_ADDRESS',     deployed.InvoiceMetrics);
  line('BATCH_CIPHER_ADDRESS',        deployed.BatchCipher);
  line('CIPHER_DROP_ADDRESS',         deployed.CipherDrop);
  line('MILESTONE_ESCROW_ADDRESS',    deployed.MilestoneEscrow);
  line('RECURRING_SCHEDULER_ADDRESS', deployed.RecurringScheduler);
  line('SALARY_PROOF_ADDRESS',        deployed.SalaryProof);
  line('AUDIT_CENTER_ADDRESS',        deployed.AuditCenter);
  line('DAO_TREASURY_ADDRESS',        deployed.DAOTreasury);
  line('FEE_MODULE_ADDRESS',          deployed.FeeModule);
  line('PAYROLL_ANCHOR_ADDRESS',      deployed.PayrollAnchor);
  line('PAYROLL_TOKEN_ADDRESS',       deployed.ConfidentialPayrollToken);
}

main().catch((error: any) => { console.error(error); process.exitCode = 1; });
