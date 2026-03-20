import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying CipherPayFHE with account:', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Account balance:', ethers.formatEther(balance), 'ETH');

  const Factory = await ethers.getContractFactory('CipherPayFHE');
  console.log('Deploying CipherPayFHE...');

  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log('CipherPayFHE deployed to:', address);
  console.log('');
  console.log('Update src/config/contract.ts with:');
  console.log(`export const CIPHERPAY_FHE_ADDRESS = '${address}' as const;`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
