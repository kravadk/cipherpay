const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying PayrollAnchor with account:', deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log('Account balance:', hre.ethers.formatEther(balance), 'ETH');

  const Factory = await hre.ethers.getContractFactory('PayrollAnchor');
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log('PayrollAnchor deployed to:', address);
  console.log('');
  console.log('Update src/config/contract.ts with:');
  console.log(`export const PAYROLL_ANCHOR_ADDRESS = '${address}' as const;`);
}

main().catch((error: any) => { console.error(error); process.exitCode = 1; });
