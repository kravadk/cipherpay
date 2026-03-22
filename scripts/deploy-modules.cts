/**
 * Deploy PaymentProof + SharedInvoice modules
 * Run: TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/deploy-modules.cts --network eth-sepolia --config hardhat.config.cts
 */
const hre = require('hardhat')

async function main() {
  const { ethers } = hre
  const [deployer] = await ethers.getSigners()
  console.log('Deploying with:', deployer.address)
  console.log('Balance:', ethers.formatEther(await deployer.provider.getBalance(deployer.address)), 'ETH')

  // FHE contract address (for PaymentProof to reference)
  const FHE_CONTRACT = '0xdfB25efBB57fa6D5E5C6645F5Fa453C3f6CD7837'

  // Deploy PaymentProof
  console.log('\nDeploying PaymentProof...')
  const ProofFactory = await ethers.getContractFactory('PaymentProof')
  const proof = await ProofFactory.deploy(FHE_CONTRACT)
  await proof.waitForDeployment()
  const proofAddr = await proof.getAddress()
  console.log('PaymentProof deployed to:', proofAddr)

  // Deploy SharedInvoice
  console.log('\nDeploying SharedInvoice...')
  const SharedFactory = await ethers.getContractFactory('SharedInvoice')
  const shared = await SharedFactory.deploy()
  await shared.waitForDeployment()
  const sharedAddr = await shared.getAddress()
  console.log('SharedInvoice deployed to:', sharedAddr)

  console.log('\n--- Summary ---')
  console.log('PaymentProof:', proofAddr)
  console.log('SharedInvoice:', sharedAddr)
  console.log('\nAdd to src/config/contract.ts:')
  console.log(`export const PAYMENT_PROOF_ADDRESS = '${proofAddr}' as const;`)
  console.log(`export const SHARED_INVOICE_ADDRESS = '${sharedAddr}' as const;`)
}

main().catch(console.error)
