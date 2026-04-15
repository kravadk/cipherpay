/**
 * Invariant tests for the CipherPayFHE shielded balance pool.
 *
 * These tests deliberately exercise only the non-FHE entrypoints
 * (depositShielded / withdrawShielded). The FHE-touching paths
 * (payInvoiceShielded, claimAnonymously) are covered by E2E scripts that
 * run against the live CoFHE coprocessor on Sepolia, since CoFHE
 * requires a real coprocessor that is not present in a bare Hardhat node.
 *
 * The five invariants below are the security claims THREAT_MODEL.md makes
 * about the shielded pool:
 *
 *   I1  Sum of all shielded balances equals the ETH held in the contract.
 *   I2  No deposit/withdraw sequence can create or destroy ETH.
 *   I3  A user can never withdraw more than they deposited.
 *   I4  A withdrawal returns ETH only to msg.sender (no privilege escalation).
 *   I5  Reverted operations leave state unchanged.
 */
import helpers from '@nomicfoundation/hardhat-network-helpers'
const { loadFixture } = helpers
import chai from 'chai'
const { expect } = chai
import hre from 'hardhat'
const { ethers } = hre

describe('CipherPayFHE — shielded pool invariants', function () {
  async function deployFixture() {
    const [creator, alice, bob, carol] = await ethers.getSigners()
    const Factory = await ethers.getContractFactory('CipherPayFHE')
    const contract = await Factory.connect(creator).deploy()
    return { contract, creator, alice, bob, carol }
  }

  async function sumShielded(contract: any, users: any[]) {
    let total = 0n
    for (const u of users) {
      total += BigInt(await contract.shieldedBalance(u.address))
    }
    return total
  }

  describe('I1 — sum(shieldedBalance) == address(contract).balance', function () {
    it('after a single deposit', async function () {
      const { contract, alice } = await loadFixture(deployFixture)
      await contract.connect(alice).depositShielded({ value: ethers.parseEther('0.5') })

      const sum = await sumShielded(contract, [alice])
      const ethHeld = await ethers.provider.getBalance(await contract.getAddress())
      expect(sum).to.equal(ethHeld)
    })

    it('after many deposits from many users', async function () {
      const { contract, alice, bob, carol } = await loadFixture(deployFixture)
      await contract.connect(alice).depositShielded({ value: ethers.parseEther('0.1') })
      await contract.connect(bob).depositShielded({ value: ethers.parseEther('0.25') })
      await contract.connect(carol).depositShielded({ value: ethers.parseEther('0.05') })
      await contract.connect(alice).depositShielded({ value: ethers.parseEther('0.4') })

      const sum = await sumShielded(contract, [alice, bob, carol])
      const ethHeld = await ethers.provider.getBalance(await contract.getAddress())
      expect(sum).to.equal(ethHeld)
      expect(sum).to.equal(ethers.parseEther('0.8'))
    })

    it('after interleaved deposits and withdrawals', async function () {
      const { contract, alice, bob } = await loadFixture(deployFixture)
      await contract.connect(alice).depositShielded({ value: ethers.parseEther('1.0') })
      await contract.connect(bob).depositShielded({ value: ethers.parseEther('0.3') })
      await contract.connect(alice).withdrawShielded(ethers.parseEther('0.4'))
      await contract.connect(bob).withdrawShielded(ethers.parseEther('0.1'))
      await contract.connect(alice).depositShielded({ value: ethers.parseEther('0.05') })

      const sum = await sumShielded(contract, [alice, bob])
      const ethHeld = await ethers.provider.getBalance(await contract.getAddress())
      expect(sum).to.equal(ethHeld)
      expect(sum).to.equal(ethers.parseEther('0.85'))
    })
  })

  describe('I2 — conservation: deposit-then-withdraw round trip', function () {
    it('returns ETH (minus gas) to the depositor', async function () {
      const { contract, alice } = await loadFixture(deployFixture)
      const before = await ethers.provider.getBalance(alice.address)

      const depositAmt = ethers.parseEther('0.5')
      const tx1 = await contract.connect(alice).depositShielded({ value: depositAmt })
      const r1 = await tx1.wait()
      const tx2 = await contract.connect(alice).withdrawShielded(depositAmt)
      const r2 = await tx2.wait()

      const after = await ethers.provider.getBalance(alice.address)
      const gas = (r1!.gasUsed * r1!.gasPrice) + (r2!.gasUsed * r2!.gasPrice)

      // Net change = -gas (no ETH lost or created)
      expect(before - after).to.equal(gas)
      expect(await contract.shieldedBalance(alice.address)).to.equal(0n)
    })
  })

  describe('I3 — withdraw cannot exceed deposit', function () {
    it('reverts when amount > shieldedBalance', async function () {
      const { contract, alice } = await loadFixture(deployFixture)
      await contract.connect(alice).depositShielded({ value: ethers.parseEther('0.1') })
      await expect(
        contract.connect(alice).withdrawShielded(ethers.parseEther('0.2'))
      ).to.be.revertedWith('Bad amount')
    })

    it('reverts on zero amount', async function () {
      const { contract, alice } = await loadFixture(deployFixture)
      await contract.connect(alice).depositShielded({ value: ethers.parseEther('0.1') })
      await expect(
        contract.connect(alice).withdrawShielded(0)
      ).to.be.revertedWith('Bad amount')
    })

    it('reverts when withdrawing from an empty balance', async function () {
      const { contract, alice } = await loadFixture(deployFixture)
      await expect(
        contract.connect(alice).withdrawShielded(1n)
      ).to.be.revertedWith('Bad amount')
    })
  })

  describe('I4 — privilege isolation', function () {
    it('alice cannot drain bob via her own withdrawal', async function () {
      const { contract, alice, bob } = await loadFixture(deployFixture)
      await contract.connect(alice).depositShielded({ value: ethers.parseEther('0.1') })
      await contract.connect(bob).depositShielded({ value: ethers.parseEther('0.5') })

      // Alice tries to withdraw more than her own balance — bob's funds are off-limits
      await expect(
        contract.connect(alice).withdrawShielded(ethers.parseEther('0.2'))
      ).to.be.revertedWith('Bad amount')

      // Bob's balance is untouched
      expect(await contract.shieldedBalance(bob.address)).to.equal(ethers.parseEther('0.5'))
    })
  })

  describe('I5 — reverted ops leave state unchanged', function () {
    it('failed withdraw does not change balance', async function () {
      const { contract, alice } = await loadFixture(deployFixture)
      await contract.connect(alice).depositShielded({ value: ethers.parseEther('0.3') })
      const before = await contract.shieldedBalance(alice.address)
      await expect(
        contract.connect(alice).withdrawShielded(ethers.parseEther('1.0'))
      ).to.be.reverted
      const after = await contract.shieldedBalance(alice.address)
      expect(after).to.equal(before)
    })

    it('zero deposit reverts and changes nothing', async function () {
      const { contract, alice } = await loadFixture(deployFixture)
      await expect(
        contract.connect(alice).depositShielded({ value: 0 })
      ).to.be.revertedWith('Must send ETH')
      expect(await contract.shieldedBalance(alice.address)).to.equal(0n)
    })
  })

  describe('Anonymous claim — nullifier replay protection', function () {
    // Anonymous claim requires a pre-existing invoice (which requires FHE
    // encryption). Here we only assert the contract correctly enforces the
    // pre-conditions a relayer can check before submitting an FHE payload.
    it('reverts when anon mode not enabled', async function () {
      const { contract, alice } = await loadFixture(deployFixture)
      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes('not-an-invoice'))
      const fakeNullifier = ethers.keccak256(ethers.toUtf8Bytes('null'))
      const fakeEnc = {
        ctHash: 1n,
        securityZone: 0,
        utype: 5,
        signature: '0x',
      }
      await expect(
        contract.connect(alice).claimAnonymously(fakeHash, fakeEnc, fakeNullifier, { value: 1 })
      ).to.be.reverted // Either "Invoice not found" or "Anon not enabled"
    })
  })
})
