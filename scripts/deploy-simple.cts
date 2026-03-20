const hre = require('hardhat')
const fs = require('fs')
const path = require('path')

async function main() {
  const { ethers, network } = hre

  const [deployer] = await ethers.getSigners()
  console.log(`Deploying CipherPaySimple to ${network.name}...`)
  console.log(`Deployer: ${deployer.address}`)

  const balance = await ethers.provider.getBalance(deployer.address)
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`)

  const CipherPay = await ethers.getContractFactory('CipherPaySimple')
  console.log('Deploying...')
  const contract = await CipherPay.deploy()
  await contract.waitForDeployment()

  const address = await contract.getAddress()
  console.log(`✓ CipherPaySimple deployed to: ${address}`)

  // Quick test
  console.log('\n--- Quick test ---')
  const salt = ethers.randomBytes(32)
  const tx = await contract.createInvoice(
    ethers.parseEther('0.01'), // 0.01 ETH
    ethers.ZeroAddress,
    0, // standard
    0, // no deadline
    0, // no unlock
    salt,
    'Test invoice from deploy script'
  )
  const receipt = await tx.wait()
  console.log(`✓ Test invoice created in block ${receipt.blockNumber}`)

  const count = await contract.getInvoiceCount(deployer.address)
  console.log(`✓ Invoice count: ${count}`)

  const hashes = await contract.getUserInvoices(deployer.address)
  console.log(`✓ Invoice hash: ${hashes[0]}`)

  const inv = await contract.getInvoice(hashes[0])
  console.log(`✓ Creator: ${inv[0]}, Type: ${inv[2]}, Status: ${inv[3]}`)

  const amount = await contract.getInvoiceAmount(hashes[0])
  console.log(`✓ Amount: ${ethers.formatEther(amount)} ETH`)

  // Save deployment
  const deploymentsDir = path.join(__dirname, '../deployments')
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true })

  fs.writeFileSync(
    path.join(deploymentsDir, `${network.name}.json`),
    JSON.stringify({
      CipherPaySimple: address,
      network: network.name,
      chainId: network.config.chainId,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
    }, null, 2)
  )
  console.log(`\nDeployment saved. Update src/config/contract.ts with: ${address}`)
}

main().catch(console.error)
