const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying RecurringScheduler with account:', deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log('Account balance:', hre.ethers.formatEther(balance), 'ETH');

  const Factory = await hre.ethers.getContractFactory('RecurringScheduler');
  console.log('Deploying RecurringScheduler...');

  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log('RecurringScheduler deployed to:', address);
  console.log('');
  console.log('Update src/config/contract.ts with:');
  console.log(`export const RECURRING_SCHEDULER_ADDRESS = '${address}' as const;`);
}

main().catch((error: any) => {
  console.error(error);
  process.exitCode = 1;
});
