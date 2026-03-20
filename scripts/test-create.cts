const hre = require('hardhat')

async function main() {
  const { ethers } = hre

  const [signer] = await ethers.getSigners()
  console.log('Signer:', signer.address)

  const contractAddress = '0x19a95C85a118bD63F0b08e64e731fB7efcdF1dB8'
  const CipherPay = await ethers.getContractFactory('CipherPay')
  const contract = CipherPay.attach(contractAddress)

  // Test 1: Read count (should work)
  console.log('\n--- Test 1: Read invoice count ---')
  const count = await contract.getInvoiceCount(signer.address)
  console.log('Invoice count:', count.toString())

  // Test 2: Try to create invoice with a simple encrypted input
  console.log('\n--- Test 2: Create invoice ---')
  const salt = ethers.randomBytes(32)

  // The encrypted input struct: { ctHash, securityZone, utype, signature }
  // For FHE.asEuint64 to work, CoFHE TaskManager must be deployed on this chain
  const encryptedAmount = {
    ctHash: 1000n,  // placeholder
    securityZone: 0,
    utype: 4, // uint64
    signature: '0x',
  }

  try {
    const tx = await contract.createInvoice(
      encryptedAmount,
      ethers.ZeroAddress, // no specific recipient
      0, // standard
      0, // no deadline
      0, // no unlock
      salt,
      { gasLimit: 500000 }
    )
    console.log('TX submitted:', tx.hash)
    const receipt = await tx.wait()
    console.log('TX confirmed in block:', receipt.blockNumber)
    console.log('Status:', receipt.status === 1 ? 'SUCCESS' : 'FAILED')
  } catch (err) {
    console.error('TX FAILED:', err.message?.slice(0, 200))

    // Check if it's because CoFHE contracts are not deployed
    if (err.message?.includes('CALL_EXCEPTION') || err.message?.includes('revert')) {
      console.log('\n⚠ FHE.asEuint64() likely failed because CoFHE infrastructure is not deployed on this network.')
      console.log('Solution: Deploy a simplified contract without FHE, or use a network with CoFHE (eth-sepolia with cofhe plugin)')
    }
  }
}

main().catch(console.error)
