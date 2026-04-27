const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying FeeModule with account:', deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log('Account balance:', hre.ethers.formatEther(balance), 'ETH');

  const Factory = await hre.ethers.getContractFactory('FeeModule');
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log('FeeModule deployed to:', address);
  console.log('');
  console.log('Update src/config/contract.ts with:');
  console.log(`export const FEE_MODULE_ADDRESS = '${address}' as const;`);
}

main().catch((error: any) => { console.error(error); process.exitCode = 1; });
