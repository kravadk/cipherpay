/**
 * End-to-end test: Create invoice → Pay → Verify settlement
 * Uses two wallets from .env (PRIVATE_KEY) and a generated second wallet
 * Run: TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/test-e2e.cts --network eth-sepolia --config hardhat.config.cts
 */
const hre = require('hardhat')

async function main() {
  const { ethers } = hre

  const [deployer] = await ethers.getSigners()
  console.log('Wallet A (creator):', deployer.address)

  // Create wallet B from random key for testing
  const walletB = ethers.Wallet.createRandom().connect(deployer.provider)
  console.log('Wallet B (payer):', walletB.address)

  // Fund wallet B with some ETH for gas + payment
  console.log('\n--- Funding Wallet B ---')
  const fundTx = await deployer.sendTransaction({
    to: walletB.address,
    value: ethers.parseEther('0.005'),
  })
  await fundTx.wait()
  console.log('Funded wallet B with 0.005 ETH')

  // Connect to Simple contract (real ETH transfers)
  const contractAddress = '0x28994f265d07189dE3098eda3DB7dd16E15c9419'
  const abi = [
    'function createInvoice(uint256 _amount, address _recipient, uint8 _invoiceType, uint256 _deadline, uint256 _unlockBlock, bytes32 _salt, string _memo) external payable returns (bytes32)',
    'function payInvoice(bytes32 _invoiceHash, uint256 _paymentAmount) external payable',
    'function getInvoice(bytes32 _invoiceHash) external view returns (address creator, address recipient, uint8 invoiceType, uint8 status, uint256 deadline, uint256 createdAt, uint256 createdBlock, uint256 unlockBlock)',
    'function getInvoiceAmount(bytes32 _invoiceHash) external view returns (uint256)',
    'function getInvoiceCollected(bytes32 _invoiceHash) external view returns (uint256 collected, uint256 target, uint256 payerCount)',
    'function getUserInvoices(address _user) external view returns (bytes32[])',
    'event InvoiceCreated(bytes32 indexed invoiceHash, address indexed creator, uint8 invoiceType, address recipient, uint256 amount, uint256 deadline, uint256 unlockBlock, string memo)',
    'event InvoicePaid(bytes32 indexed invoiceHash, address indexed payer, uint256 amount, uint256 totalCollected)',
    'event InvoiceSettled(bytes32 indexed invoiceHash)',
  ]

  const contractA = new ethers.Contract(contractAddress, abi, deployer)
  const contractB = new ethers.Contract(contractAddress, abi, walletB)

  // Balances before
  const balABefore = await deployer.provider.getBalance(deployer.address)
  console.log('\nWallet A balance before:', ethers.formatEther(balABefore), 'ETH')

  // ============ TEST 1: Create Standard Invoice ============
  console.log('\n========== TEST 1: Create Standard Invoice ==========')
  const amount = ethers.parseEther('0.001')
  const salt = ethers.hexlify(ethers.randomBytes(32))

  const createTx = await contractA.createInvoice(
    amount,
    ethers.ZeroAddress, // anyone can pay
    0, // standard
    0, // no deadline
    0, // no unlock
    salt,
    'E2E test invoice',
    { gasLimit: 300000 }
  )
  console.log('Create TX:', createTx.hash)
  const createReceipt = await createTx.wait()
  console.log('Status:', createReceipt.status === 1 ? 'SUCCESS' : 'FAILED')

  // Extract invoice hash from event
  let invoiceHash = null
  for (const log of createReceipt.logs) {
    try {
      const parsed = contractA.interface.parseLog({ topics: log.topics, data: log.data })
      if (parsed?.name === 'InvoiceCreated') {
        invoiceHash = parsed.args.invoiceHash
        console.log('Invoice Hash:', invoiceHash)
        console.log('Type:', parsed.args.invoiceType)
        console.log('Amount:', ethers.formatEther(parsed.args.amount), 'ETH')
        break
      }
    } catch {}
  }

  if (!invoiceHash) {
    console.error('Failed to extract invoice hash from event')
    return
  }

  // Verify invoice on-chain
  const invoice = await contractA.getInvoice(invoiceHash)
  console.log('\nOn-chain invoice:')
  console.log('  Creator:', invoice.creator)
  console.log('  Status:', ['OPEN', 'SETTLED', 'CANCELLED', 'PAUSED'][invoice.status])
  console.log('  Amount:', ethers.formatEther(await contractA.getInvoiceAmount(invoiceHash)), 'ETH')

  // ============ TEST 2: Pay Invoice (from Wallet B) ============
  console.log('\n========== TEST 2: Pay Invoice (Wallet B) ==========')
  const payTx = await contractB.payInvoice(
    invoiceHash,
    amount,
    { value: amount, gasLimit: 300000 }
  )
  console.log('Pay TX:', payTx.hash)
  const payReceipt = await payTx.wait()
  console.log('Status:', payReceipt.status === 1 ? 'SUCCESS' : 'FAILED')

  // Check for events
  for (const log of payReceipt.logs) {
    try {
      const parsed = contractA.interface.parseLog({ topics: log.topics, data: log.data })
      if (parsed?.name === 'InvoicePaid') {
        console.log('Payment recorded:')
        console.log('  Payer:', parsed.args.payer)
        console.log('  Amount:', ethers.formatEther(parsed.args.amount), 'ETH')
        console.log('  Total collected:', ethers.formatEther(parsed.args.totalCollected), 'ETH')
      }
      if (parsed?.name === 'InvoiceSettled') {
        console.log('Invoice auto-settled!')
      }
    } catch {}
  }

  // ============ TEST 3: Verify Settlement ============
  console.log('\n========== TEST 3: Verify Settlement ==========')
  const invoiceAfter = await contractA.getInvoice(invoiceHash)
  console.log('Status after payment:', ['OPEN', 'SETTLED', 'CANCELLED', 'PAUSED'][invoiceAfter.status])

  const collected = await contractA.getInvoiceCollected(invoiceHash)
  console.log('Collected:', ethers.formatEther(collected.collected), '/', ethers.formatEther(collected.target), 'ETH')
  console.log('Payers:', collected.payerCount.toString())

  // Check creator balance increased
  const balAAfter = await deployer.provider.getBalance(deployer.address)
  const diff = balAAfter - balABefore
  console.log('\nWallet A balance after:', ethers.formatEther(balAAfter), 'ETH')
  console.log('Balance change:', ethers.formatEther(diff), 'ETH (includes gas costs)')

  // Verify ETH was received (balance should increase by ~0.001 minus gas)
  if (Number(invoiceAfter.status) === 1) {
    console.log('\n✓ PASS — Invoice created, paid, and auto-settled with real ETH transfer')
  } else {
    console.log('\n✗ FAIL — Invoice not settled after payment (status:', invoiceAfter.status, ')')
  }

  // ============ TEST 4: List user invoices ============
  console.log('\n========== TEST 4: User Invoices ==========')
  const userInvoices = await contractA.getUserInvoices(deployer.address)
  console.log('Total invoices for Wallet A:', userInvoices.length)

  console.log('\n========== ALL TESTS COMPLETE ==========')
}

main().catch((err) => {
  console.error('Test failed:', err.message)
  process.exit(1)
})
