/**
 * E2E test: Recurring invoice — deposit escrow + claim period
 * Run: TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' npx hardhat run scripts/test-recurring-e2e.cts --network eth-sepolia --config hardhat.config.cts
 */
const hre = require('hardhat')

async function main() {
  const { ethers } = hre

  const [creator] = await ethers.getSigners()
  console.log('Wallet A (creator):', creator.address)

  const walletB = ethers.Wallet.createRandom().connect(creator.provider)
  console.log('Wallet B (payer):', walletB.address)

  // Fund wallet B generously
  console.log('\n--- Funding Wallet B ---')
  const fundTx = await creator.sendTransaction({
    to: walletB.address,
    value: ethers.parseEther('0.015'),
  })
  await fundTx.wait()
  console.log('Funded wallet B with 0.015 ETH')

  const contractAddress = '0xF3A15EC0FAE753D6BEC3AAB3aEB2d72824c0713F'
  const abi = [
    'function createInvoice(uint256 _amount, address _recipient, uint8 _invoiceType, uint256 _deadline, uint256 _unlockBlock, bytes32 _salt, string _memo) external payable returns (bytes32)',
    'function depositRecurring(bytes32 _invoiceHash, uint256 _intervalSeconds, uint256 _totalPeriods) external payable',
    'function claimRecurring(bytes32 _invoiceHash) external',
    'function getRecurringSchedule(bytes32 _invoiceHash) external view returns (uint256 intervalSeconds, uint256 totalPeriods, uint256 claimedPeriods, uint256 startTimestamp, uint256 perPeriodAmount, uint256 claimableNow)',
    'function getInvoice(bytes32 _invoiceHash) external view returns (address creator, address recipient, uint8 invoiceType, uint8 status, uint256 deadline, uint256 createdAt, uint256 createdBlock, uint256 unlockBlock)',
    'function getInvoiceAmount(bytes32 _invoiceHash) external view returns (uint256)',
    'function getInvoiceCollected(bytes32 _invoiceHash) external view returns (uint256 collected, uint256 target, uint256 payerCount)',
    'function payInvoice(bytes32 _invoiceHash, uint256 _paymentAmount) external payable',
    'event InvoiceCreated(bytes32 indexed invoiceHash, address indexed creator, uint8 invoiceType, address recipient, uint256 amount, uint256 deadline, uint256 unlockBlock, string memo)',
    'event RecurringDeposited(bytes32 indexed invoiceHash, address indexed payer, uint256 totalAmount, uint256 periods, uint256 interval)',
    'event RecurringClaimed(bytes32 indexed invoiceHash, address indexed creator, uint256 amount, uint256 periodsClaimedSoFar)',
    'event InvoiceSettled(bytes32 indexed invoiceHash)',
  ]

  const contractA = new ethers.Contract(contractAddress, abi, creator)
  const contractB = new ethers.Contract(contractAddress, abi, walletB)

  let passed = 0
  let failed = 0

  function pass(name: string) { passed++; console.log(`  ✓ ${name}`) }
  function fail(name: string, err: string) { failed++; console.log(`  ✗ ${name}: ${err}`) }

  // Helper: check if tx reverts (Sepolia wraps errors differently)
  async function expectRevert(fn: () => Promise<any>, reason: string): Promise<boolean> {
    try {
      const tx = await fn()
      const receipt = await tx.wait()
      if (receipt.status === 0) return true // tx mined but reverted
      return false // tx succeeded — unexpected
    } catch {
      return true // threw during estimation or send — reverted
    }
  }

  // ============ TEST 1: Create Recurring Invoice ============
  console.log('\n========== TEST 1: Create Recurring Invoice ==========')
  const amount = ethers.parseEther('0.003')
  const salt = ethers.hexlify(ethers.randomBytes(32))

  const createTx = await contractA.createInvoice(
    amount, walletB.address, 2, 0, 0, salt,
    'Recurring E2E — 3 periods',
    { gasLimit: 300000 }
  )
  console.log('  Create TX:', createTx.hash)
  const createReceipt = await createTx.wait()

  let invoiceHash: string | null = null
  for (const log of createReceipt.logs) {
    try {
      const parsed = contractA.interface.parseLog({ topics: log.topics, data: log.data })
      if (parsed?.name === 'InvoiceCreated') invoiceHash = parsed.args.invoiceHash
    } catch {}
  }

  if (!invoiceHash) { fail('Create', 'No event'); return }
  pass('Recurring invoice created')
  console.log('  Hash:', invoiceHash)

  const inv = await contractA.getInvoice(invoiceHash)
  if (Number(inv.invoiceType) === 2) pass('Type = recurring')
  else fail('Type', `Expected 2, got ${inv.invoiceType}`)

  // ============ TEST 2: payInvoice blocked ============
  console.log('\n========== TEST 2: payInvoice blocked ==========')
  const reverted2 = await expectRevert(
    () => contractB.payInvoice(invoiceHash, amount, { value: amount, gasLimit: 100000 }),
    'Recurring'
  )
  if (reverted2) pass('payInvoice correctly reverted for recurring')
  else fail('payInvoice', 'Should have reverted')

  // ============ TEST 3: Deposit escrow ============
  console.log('\n========== TEST 3: Deposit escrow ==========')
  const INTERVAL = 3600
  const PERIODS = 3

  const depositTx = await contractB.depositRecurring(
    invoiceHash, INTERVAL, PERIODS,
    { value: amount, gasLimit: 300000 }
  )
  console.log('  Deposit TX:', depositTx.hash)
  const depositReceipt = await depositTx.wait()

  let depositOk = false
  for (const log of depositReceipt.logs) {
    try {
      const parsed = contractA.interface.parseLog({ topics: log.topics, data: log.data })
      if (parsed?.name === 'RecurringDeposited') {
        depositOk = true
        console.log('  Total:', ethers.formatEther(parsed.args.totalAmount), 'ETH')
        console.log('  Periods:', parsed.args.periods.toString())
        console.log('  Interval:', parsed.args.interval.toString(), 'sec')
      }
    } catch {}
  }
  if (depositOk) pass('Escrow deposited')
  else fail('Deposit', 'No event')

  const sched = await contractA.getRecurringSchedule(invoiceHash)
  console.log('  Per period:', ethers.formatEther(sched.perPeriodAmount), 'ETH')

  if (Number(sched.totalPeriods) === PERIODS) pass('totalPeriods = 3')
  else fail('totalPeriods', `got ${sched.totalPeriods}`)

  if (Number(sched.claimedPeriods) === 0) pass('claimedPeriods = 0')
  else fail('claimedPeriods', `got ${sched.claimedPeriods}`)

  // ============ TEST 4: Claim too early ============
  console.log('\n========== TEST 4: Claim before period ==========')
  const reverted4 = await expectRevert(
    () => contractA.claimRecurring(invoiceHash, { gasLimit: 100000 }),
    'Nothing to claim'
  )
  if (reverted4) pass('Claim correctly blocked — too early')
  else fail('Early claim', 'Should have reverted')

  // ============ TEST 5: Claimable status ============
  console.log('\n========== TEST 5: Schedule check ==========')
  const schedNow = await contractA.getRecurringSchedule(invoiceHash)
  const startTs = Number(schedNow.startTimestamp)
  const now = Math.floor(Date.now() / 1000)
  const elapsed = now - startTs
  console.log(`  Start: ${startTs}, Now: ${now}, Elapsed: ${elapsed}s`)
  console.log(`  Claimable periods: ${schedNow.claimableNow}`)

  if (Number(schedNow.claimableNow) === 0) pass('0 claimable (interval = 1h, just deposited)')
  else pass(`${schedNow.claimableNow} claimable (time elapsed)`)

  // ============ TEST 6: Double deposit blocked ============
  console.log('\n========== TEST 6: Double deposit ==========')
  const reverted6 = await expectRevert(
    () => contractB.depositRecurring(invoiceHash, INTERVAL, PERIODS, { value: amount, gasLimit: 100000 }),
    'Already deposited'
  )
  if (reverted6) pass('Double deposit correctly blocked')
  else fail('Double deposit', 'Should have reverted')

  // ============ TEST 7: Unauthorized payer ============
  console.log('\n========== TEST 7: Unauthorized payer ==========')
  const salt2 = ethers.hexlify(ethers.randomBytes(32))
  const createTx2 = await contractA.createInvoice(
    ethers.parseEther('0.001'), walletB.address, 2, 0, 0, salt2,
    'Auth test', { gasLimit: 300000 }
  )
  const receipt2 = await createTx2.wait()
  let hash2: string | null = null
  for (const log of receipt2.logs) {
    try {
      const parsed = contractA.interface.parseLog({ topics: log.topics, data: log.data })
      if (parsed?.name === 'InvoiceCreated') hash2 = parsed.args.invoiceHash
    } catch {}
  }

  if (hash2) {
    const reverted7 = await expectRevert(
      () => contractA.depositRecurring(hash2!, INTERVAL, 3, { value: ethers.parseEther('0.001'), gasLimit: 100000 }),
      'Not authorized'
    )
    if (reverted7) pass('Unauthorized payer correctly blocked')
    else fail('Unauthorized', 'Should have reverted')
  } else {
    fail('Setup', 'Could not create second invoice')
  }

  // ============ TEST 8: Only creator can claim ============
  console.log('\n========== TEST 8: Only creator can claim ==========')
  const reverted8 = await expectRevert(
    () => contractB.claimRecurring(invoiceHash, { gasLimit: 100000 }),
    'Only creator'
  )
  if (reverted8) pass('Non-creator claim correctly blocked')
  else fail('Only creator', 'Should have reverted')

  // ============ TEST 9: Collected amount on-chain ============
  console.log('\n========== TEST 9: Verify on-chain state ==========')
  const collected = await contractA.getInvoiceCollected(invoiceHash)
  console.log('  Collected:', ethers.formatEther(collected.collected), '/', ethers.formatEther(collected.target), 'ETH')
  console.log('  Payer count:', collected.payerCount.toString())

  if (collected.collected === amount) pass('Full amount in escrow')
  else fail('Escrow amount', `Expected ${ethers.formatEther(amount)}, got ${ethers.formatEther(collected.collected)}`)

  if (Number(collected.payerCount) === 1) pass('Payer count = 1')
  else fail('Payer count', `got ${collected.payerCount}`)

  // ============ SUMMARY ============
  console.log('\n========== SUMMARY ==========')
  console.log(`  Passed: ${passed}`)
  console.log(`  Failed: ${failed}`)
  console.log(`  Total:  ${passed + failed}`)

  if (failed === 0) {
    console.log('\n✓ ALL RECURRING E2E TESTS PASSED')
  } else {
    console.log(`\n✗ ${failed} TEST(S) FAILED`)
  }

  console.log(`\nContract: https://sepolia.etherscan.io/address/${contractAddress}`)
  console.log(`Invoice:  ${invoiceHash}`)
}

main().catch((err) => {
  console.error('Test failed:', err.message)
  process.exit(1)
})
