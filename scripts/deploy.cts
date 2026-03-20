const hre = require('hardhat')
const fs = require('fs')
const path = require('path')

async function main() {
  const { ethers, network } = hre

  const [deployer] = await ethers.getSigners()
  console.log(`Deploying CipherPay to ${network.name}...`)
  console.log(`Deployer: ${deployer.address}`)

  const balance = await ethers.provider.getBalance(deployer.address)
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`)

  if (balance === 0n) {
    console.error('No ETH balance! Get testnet ETH from faucet first.')
    process.exit(1)
  }

  const CipherPay = await ethers.getContractFactory('CipherPay')
  console.log('Deploying...')
  const cipherPay = await CipherPay.deploy()
  await cipherPay.waitForDeployment()

  const address = await cipherPay.getAddress()
  console.log(`✓ CipherPay deployed to: ${address}`)

  // Save deployment
  const deploymentsDir = path.join(__dirname, '../deployments')
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true })
  }

  const deploymentData = {
    CipherPay: address,
    network: network.name,
    chainId: network.config.chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  }

  fs.writeFileSync(
    path.join(deploymentsDir, `${network.name}.json`),
    JSON.stringify(deploymentData, null, 2)
  )

  console.log(`Deployment saved to deployments/${network.name}.json`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
