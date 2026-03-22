const hre = require('hardhat')

async function main() {
  const { ethers } = hre
  const [deployer] = await ethers.getSigners()
  const FHE_ADDRESS = '0x0D3904d08FF6C5937f9d44A4667a830d4ff2C5cb'

  console.log('Deploying InvoiceMetrics...')
  const Factory = await ethers.getContractFactory('InvoiceMetrics')
  const contract = await Factory.deploy(FHE_ADDRESS)
  await contract.waitForDeployment()
  const addr = await contract.getAddress()
  console.log('InvoiceMetrics deployed to:', addr)
}

main().catch(console.error)
