/**
 * E2E test: CipherPayFHE on Sepolia
 * Tests: create invoice, pay invoice, verify encryption, auto-settle, cancel
 * Run: npx hardhat run scripts/test-fhe-e2e.cts --network eth-sepolia --config hardhat.config.cts
 */
const hre = require('hardhat')

async function main() {
  const { ethers } = hre

  // Wallets
  const [walletA] = await ethers.getSigners()
  const walletB = new ethers.Wallet(process.env.PRIVATE_KEY_B!, walletA.provider)
  console.log('Wallet A (creator):', walletA.address)
  console.log('Wallet B (payer):  ', walletB.address)

  const balA = await ethers.provider.getBalance(walletA.address)
  const balB = await ethers.provider.getBalance(walletB.address)
  console.log('Balance A:', ethers.formatEther(balA), 'ETH')
  console.log('Balance B:', ethers.formatEther(balB), 'ETH')

  // Contract
  const CONTRACT = '0x11B9d10bc7Cf5970dE860D8d52674329b7A791C4'
  const abi = [
    'function createInvoice(tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) _encryptedAmount, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) _encryptedRecipient, bool _hasRecipient, uint8 _invoiceType, uint256 _deadline, uint256 _unlockBlock, bytes32 _salt, string _memo) external returns (bytes32)',
    'function payInvoice(bytes32 _invoiceHash, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) _encryptedPayment) external payable',
    'function settleInvoice(bytes32 _invoiceHash) external',
    'function cancelInvoice(bytes32 _invoiceHash) external',
    'function getInvoice(bytes32 _invoiceHash) external view returns (address creator, bool hasRecipient, uint8 invoiceType, uint8 status, uint256 deadline, uint256 createdAt, uint256 createdBlock, uint256 unlockBlock)',
    'function getEncryptedAmount(bytes32 _invoiceHash) external view returns (uint256)',
    'function getEncryptedCollected(bytes32 _invoiceHash) external view returns (uint256)',
    'function getInvoiceMemo(bytes32 _invoiceHash) external view returns (string)',
    'function getPayerCount(bytes32 _invoiceHash) external view returns (uint256)',
    'function getUserInvoices(address _user) external view returns (bytes32[])',
    'function getPaidInvoices(address _user) external view returns (bytes32[])',
    'function checkHasPaid(bytes32 _invoiceHash, address _payer) external view returns (bool)',
    'function getEncryptedRecipient(bytes32 _invoiceHash) external view returns (uint256)',
    'event InvoiceCreated(bytes32 indexed invoiceHash, address indexed creator, uint8 invoiceType, bool hasRecipient, uint256 deadline, uint256 unlockBlock, string memo)',
    'event InvoicePaid(bytes32 indexed invoiceHash, address indexed payer)',
    'event InvoiceSettled(bytes32 indexed invoiceHash)',
    'event InvoiceCancelled(bytes32 indexed invoiceHash)',
  ]

  const contractA = new ethers.Contract(CONTRACT, abi, walletA)
  const contractB = new ethers.Contract(CONTRACT, abi, walletB)

  // Initialize CoFHE SDK
  console.log('\n--- Initializing CoFHE SDK ---')
  const { cofhejs, Encryptable } = require('cofhejs/node')

  const initResult = await cofhejs.initializeWithEthers({
    ethersProvider: walletA.provider,
    ethersSigner: walletA,
    environment: 'TESTNET',
  })
  console.log('CoFHE init:', initResult.success ? 'OK' : initResult.error)

  let passed = 0
  let failed = 0
  function pass(name: string) { passed++; console.log(`  \u2713 ${name}`) }
  function fail(name: string, err: string) { failed++; console.log(`  \u2717 ${name}: ${err}`) }

  async function expectRevert(fn: () => Promise<any>): Promise<boolean> {
    try {
      const tx = await fn()
      const receipt = await tx.wait()
      return receipt.status === 0
    } catch {
      return true
    }
  }

  // ========== TEST 1: Create Standard Invoice ==========
  console.log('\n========== TEST 1: Create Standard Invoice ==========')

  const invoiceAmount = ethers.parseEther('0.001')
  const salt = ethers.hexlify(ethers.randomBytes(32))

  // Encrypt amount
  console.log('  Encrypting amount...')
  const encResult = await cofhejs.encrypt([
    Encryptable.uint64(invoiceAmount),
    Encryptable.address(walletB.address),
  ])
  if (!encResult.data) {
    console.error('Encryption failed:', encResult.error)
    return
  }
  const [encAmount, encRecipient] = encResult.data
  console.log('  Encrypted amount ctHash:', encAmount.ctHash?.toString()?.slice(0, 20) + '...')
  console.log('  Encrypted recipient ctHash:', encRecipient.ctHash?.toString()?.slice(0, 20) + '...')
  pass('FHE encryption succeeded')

  // Create
  const createTx = await contractA.createInvoice(
    encAmount, encRecipient, true, 0, 0, 0, salt, 'E2E FHE test',
    { gasLimit: 800000 }
  )
  console.log('  TX:', createTx.hash)
  const createReceipt = await createTx.wait()

  let invoiceHash: string | null = null
  for (const log of createReceipt.logs) {
    try {
      const parsed = contractA.interface.parseLog({ topics: log.topics, data: log.data })
      if (parsed?.name === 'InvoiceCreated') invoiceHash = parsed.args.invoiceHash
    } catch {}
  }

  if (!invoiceHash) { fail('Create', 'No InvoiceCreated event'); return }
  pass('Invoice created')
  console.log('  Hash:', invoiceHash)

  // ========== TEST 2: Verify Invoice On-chain ==========
  console.log('\n========== TEST 2: Verify Invoice On-chain ==========')

  const inv = await contractA.getInvoice(invoiceHash)
  if (inv.creator === walletA.address) pass('Creator matches')
  else fail('Creator', `Expected ${walletA.address}, got ${inv.creator}`)

  if (inv.hasRecipient === true) pass('hasRecipient = true')
  else fail('hasRecipient', `got ${inv.hasRecipient}`)

  if (Number(inv.invoiceType) === 0) pass('Type = standard')
  else fail('Type', `got ${inv.invoiceType}`)

  if (Number(inv.status) === 0) pass('Status = open')
  else fail('Status', `got ${inv.status}`)

  const memo = await contractA.getInvoiceMemo(invoiceHash)
  if (memo === 'E2E FHE test') pass('Memo matches')
  else fail('Memo', `got "${memo}"`)

  // ========== TEST 3: Verify Encryption (amounts not readable) ==========
  console.log('\n========== TEST 3: Verify FHE Encryption ==========')

  const encAmountHandle = await contractA.getEncryptedAmount(invoiceHash)
  console.log('  encryptedAmount handle:', encAmountHandle.toString().slice(0, 20) + '...')

  // The handle should be a non-zero ciphertext reference, NOT the plaintext value
  if (encAmountHandle > 0n && encAmountHandle !== invoiceAmount) {
    pass('Amount is encrypted (handle != plaintext)')
  } else if (encAmountHandle === invoiceAmount) {
    fail('Amount encryption', 'Handle equals plaintext - NOT encrypted!')
  } else {
    fail('Amount encryption', 'Handle is zero')
  }

  const encRecipientHandle = await contractA.getEncryptedRecipient(invoiceHash)
  console.log('  encryptedRecipient handle:', encRecipientHandle.toString().slice(0, 20) + '...')
  if (encRecipientHandle > 0n) pass('Recipient is encrypted (non-zero handle)')
  else fail('Recipient encryption', 'Handle is zero')

  // ========== TEST 4: Pay Invoice (Wallet B) ==========
  console.log('\n========== TEST 4: Pay Invoice ==========')

  // Re-init CoFHE for wallet B
  await cofhejs.initializeWithEthers({
    ethersProvider: walletB.provider,
    ethersSigner: walletB,
    environment: 'TESTNET',
  })

  const payEncResult = await cofhejs.encrypt([Encryptable.uint64(invoiceAmount)])
  if (!payEncResult.data) { fail('Pay encrypt', payEncResult.error); return }
  const [encPayment] = payEncResult.data
  pass('Payment encrypted')

  const creatorBalBefore = await ethers.provider.getBalance(walletA.address)

  const payTx = await contractB.payInvoice(invoiceHash, encPayment, {
    value: invoiceAmount,
    gasLimit: 800000,
  })
  console.log('  TX:', payTx.hash)
  const payReceipt = await payTx.wait()

  if (payReceipt.status === 1) pass('Payment transaction succeeded')
  else { fail('Payment', 'TX reverted'); return }

  // Check events
  let paidEvent = false
  let settledEvent = false
  for (const log of payReceipt.logs) {
    try {
      const parsed = contractA.interface.parseLog({ topics: log.topics, data: log.data })
      if (parsed?.name === 'InvoicePaid') paidEvent = true
      if (parsed?.name === 'InvoiceSettled') settledEvent = true
    } catch {}
  }

  if (paidEvent) pass('InvoicePaid event emitted')
  else fail('InvoicePaid', 'No event')

  if (settledEvent) pass('InvoiceSettled event (auto-settle)')
  else fail('InvoiceSettled', 'No auto-settle event')

  // ========== TEST 5: Creator received ETH ==========
  console.log('\n========== TEST 5: Creator ETH Balance ==========')

  const creatorBalAfter = await ethers.provider.getBalance(walletA.address)
  const received = creatorBalAfter - creatorBalBefore
  console.log('  Creator balance before:', ethers.formatEther(creatorBalBefore))
  console.log('  Creator balance after: ', ethers.formatEther(creatorBalAfter))
  console.log('  Received:              ', ethers.formatEther(received), 'ETH')

  if (received >= invoiceAmount - ethers.parseEther('0.0001')) {
    pass('Creator received ETH via auto-settle')
  } else {
    fail('Creator ETH', `Expected ~${ethers.formatEther(invoiceAmount)}, got ${ethers.formatEther(received)}`)
  }

  // ========== TEST 6: Invoice status = settled ==========
  console.log('\n========== TEST 6: Post-payment State ==========')

  const inv2 = await contractA.getInvoice(invoiceHash)
  if (Number(inv2.status) === 1) pass('Status = settled')
  else fail('Status', `Expected 1 (settled), got ${inv2.status}`)

  const hasPaid = await contractA.checkHasPaid(invoiceHash, walletB.address)
  if (hasPaid) pass('Payer recorded')
  else fail('hasPaid', 'false')

  const payerCount = await contractA.getPayerCount(invoiceHash)
  if (Number(payerCount) === 1) pass('Payer count = 1')
  else fail('Payer count', `got ${payerCount}`)

  const paidList = await contractA.getPaidInvoices(walletB.address)
  if (paidList.includes(invoiceHash)) pass('Invoice in payer history')
  else fail('Paid invoices', 'Not in list')

  // ========== TEST 7: Cancel (should fail — already settled) ==========
  console.log('\n========== TEST 7: Cancel Settled (should revert) ==========')
  const reverted7 = await expectRevert(() =>
    contractA.cancelInvoice(invoiceHash, { gasLimit: 100000 })
  )
  if (reverted7) pass('Cancel settled correctly reverted')
  else fail('Cancel settled', 'Should have reverted')

  // ========== TEST 8: Create + Cancel Invoice ==========
  console.log('\n========== TEST 8: Create + Cancel ==========')

  // Re-init for walletA
  await cofhejs.initializeWithEthers({
    ethersProvider: walletA.provider,
    ethersSigner: walletA,
    environment: 'TESTNET',
  })

  // Wait for nonce to sync
  await new Promise(r => setTimeout(r, 3000))

  const salt2 = ethers.hexlify(ethers.randomBytes(32))
  const enc2 = await cofhejs.encrypt([
    Encryptable.uint64(ethers.parseEther('0.002')),
    Encryptable.address(ethers.ZeroAddress),
  ])
  if (!enc2.data) { fail('Encrypt 2', 'failed'); return }

  const nonceA1 = await ethers.provider.getTransactionCount(walletA.address, 'pending')
  const createTx2 = await contractA.createInvoice(
    enc2.data[0], enc2.data[1], false, 0, 0, 0, salt2, 'Cancel test',
    { gasLimit: 800000, nonce: nonceA1 }
  )
  const createReceipt2 = await createTx2.wait()
  let hash2: string | null = null
  for (const log of createReceipt2.logs) {
    try {
      const parsed = contractA.interface.parseLog({ topics: log.topics, data: log.data })
      if (parsed?.name === 'InvoiceCreated') hash2 = parsed.args.invoiceHash
    } catch {}
  }

  if (!hash2) { fail('Create 2', 'No event'); return }
  pass('Second invoice created')

  const nonceA2 = await ethers.provider.getTransactionCount(walletA.address, 'pending')
  const cancelTx = await contractA.cancelInvoice(hash2, { gasLimit: 200000, nonce: nonceA2 })
  const cancelReceipt = await cancelTx.wait()

  let cancelledEvent = false
  for (const log of cancelReceipt.logs) {
    try {
      const parsed = contractA.interface.parseLog({ topics: log.topics, data: log.data })
      if (parsed?.name === 'InvoiceCancelled') cancelledEvent = true
    } catch {}
  }

  if (cancelledEvent) pass('InvoiceCancelled event emitted')
  else fail('Cancel event', 'No event')

  const inv3 = await contractA.getInvoice(hash2)
  if (Number(inv3.status) === 2) pass('Status = cancelled')
  else fail('Cancel status', `got ${inv3.status}`)

  // ========== TEST 9: Non-creator cannot cancel ==========
  console.log('\n========== TEST 9: Non-creator cancel (should revert) ==========')

  await new Promise(r => setTimeout(r, 3000))
  const salt3 = ethers.hexlify(ethers.randomBytes(32))
  await cofhejs.initializeWithEthers({ ethersProvider: walletA.provider, ethersSigner: walletA, environment: 'TESTNET' })
  const enc3 = await cofhejs.encrypt([Encryptable.uint64(ethers.parseEther('0.001')), Encryptable.address(ethers.ZeroAddress)])
  if (!enc3.data) { fail('Encrypt 3', 'failed'); return }
  const nonceA3 = await ethers.provider.getTransactionCount(walletA.address, 'pending')
  const createTx3 = await contractA.createInvoice(enc3.data[0], enc3.data[1], false, 0, 0, 0, salt3, 'Auth test', { gasLimit: 800000, nonce: nonceA3 })
  const receipt3 = await createTx3.wait()
  let hash3: string | null = null
  for (const log of receipt3.logs) {
    try {
      const parsed = contractA.interface.parseLog({ topics: log.topics, data: log.data })
      if (parsed?.name === 'InvoiceCreated') hash3 = parsed.args.invoiceHash
    } catch {}
  }

  if (hash3) {
    const reverted9 = await expectRevert(() =>
      contractB.cancelInvoice(hash3!, { gasLimit: 100000 })
    )
    if (reverted9) pass('Non-creator cancel correctly reverted')
    else fail('Non-creator cancel', 'Should have reverted')
  }

  // ========== TEST 10: Multipay — no auto-settle ==========
  console.log('\n========== TEST 10: Multipay ==========')

  await new Promise(r => setTimeout(r, 3000))
  const salt4 = ethers.hexlify(ethers.randomBytes(32))
  await cofhejs.initializeWithEthers({ ethersProvider: walletA.provider, ethersSigner: walletA, environment: 'TESTNET' })
  const enc4 = await cofhejs.encrypt([Encryptable.uint64(ethers.parseEther('0.002')), Encryptable.address(ethers.ZeroAddress)])
  if (!enc4.data) { fail('Encrypt 4', 'failed'); return }

  const nonceA4 = await ethers.provider.getTransactionCount(walletA.address, 'pending')
  const createTx4 = await contractA.createInvoice(enc4.data[0], enc4.data[1], false, 1, 0, 0, salt4, 'Multipay test', { gasLimit: 800000, nonce: nonceA4 })
  const receipt4 = await createTx4.wait()
  let hash4: string | null = null
  for (const log of receipt4.logs) {
    try {
      const parsed = contractA.interface.parseLog({ topics: log.topics, data: log.data })
      if (parsed?.name === 'InvoiceCreated') hash4 = parsed.args.invoiceHash
    } catch {}
  }

  if (!hash4) { fail('Create multipay', 'No event'); return }
  pass('Multipay invoice created')

  // Pay partial
  await cofhejs.initializeWithEthers({ ethersProvider: walletB.provider, ethersSigner: walletB, environment: 'TESTNET' })
  const encPay4 = await cofhejs.encrypt([Encryptable.uint64(ethers.parseEther('0.001'))])
  if (!encPay4.data) { fail('Encrypt pay4', 'failed'); return }

  const nonceB1 = await ethers.provider.getTransactionCount(walletB.address, 'pending')
  const payTx4 = await contractB.payInvoice(hash4, encPay4.data[0], {
    value: ethers.parseEther('0.001'),
    gasLimit: 800000,
    nonce: nonceB1,
  })
  const payReceipt4 = await payTx4.wait()

  const inv4 = await contractA.getInvoice(hash4)
  if (Number(inv4.status) === 0) pass('Multipay stays OPEN after partial payment')
  else fail('Multipay status', `Expected 0 (open), got ${inv4.status}`)

  // Settle manually
  await new Promise(r => setTimeout(r, 3000))
  const nonceA5 = await ethers.provider.getTransactionCount(walletA.address, 'pending')
  const settleTx = await contractA.settleInvoice(hash4, { gasLimit: 200000, nonce: nonceA5 })
  await settleTx.wait()
  const inv4s = await contractA.getInvoice(hash4)
  if (Number(inv4s.status) === 1) pass('Multipay settled by creator')
  else fail('Settle', `Expected 1, got ${inv4s.status}`)

  // ========== SUMMARY ==========
  console.log('\n========================================')
  console.log(`  Passed: ${passed}`)
  console.log(`  Failed: ${failed}`)
  console.log(`  Total:  ${passed + failed}`)
  console.log('========================================')

  if (failed === 0) {
    console.log('\n\u2713 ALL FHE E2E TESTS PASSED')
  } else {
    console.log(`\n\u2717 ${failed} TEST(S) FAILED`)
  }

  console.log(`\nContract: https://sepolia.etherscan.io/address/${CONTRACT}`)
}

main().catch((err) => {
  console.error('Test failed:', err.message || err)
  process.exit(1)
})
