/**
 * Unit tests for ConfidentialPayrollToken — non-FHE guards.
 *
 * Balances are FHE euint64; the mint/transfer *value* paths require the CoFHE
 * coprocessor, which is not present on a bare Hardhat node — those are covered
 * by the E2E suite on Sepolia (the same split ShieldedInvariants.test.ts uses).
 *
 * These tests cover the guards that revert BEFORE any FHE operation runs:
 * token metadata, issuer access control, and recipient validation.
 */
import helpers from '@nomicfoundation/hardhat-network-helpers'
const { loadFixture } = helpers
import chai from 'chai'
const { expect } = chai
import hre from 'hardhat'
const { ethers } = hre

// A placeholder InEuint64 tuple. The guards under test revert before this
// calldata is ever passed to FHE.asEuint64().
const DUMMY_ENC = { ctHash: 0n, securityZone: 0, utype: 5, signature: '0x' }

describe('ConfidentialPayrollToken — non-FHE guards', function () {
  async function deployFixture() {
    const [issuer, alice, bob] = await ethers.getSigners()
    const Factory = await ethers.getContractFactory('ConfidentialPayrollToken')
    const contract = await Factory.connect(issuer).deploy('CipherPay USD', 'cpUSD')
    return { contract, issuer, alice, bob }
  }

  it('exposes the expected metadata', async function () {
    const { contract, issuer } = await loadFixture(deployFixture)
    expect(await contract.name()).to.equal('CipherPay USD')
    expect(await contract.symbol()).to.equal('cpUSD')
    expect(await contract.decimals()).to.equal(6n)
    expect(await contract.issuer()).to.equal(issuer.address)
    expect(await contract.holderCount()).to.equal(0n)
  })

  it('reverts mint from a non-issuer (access control before FHE)', async function () {
    const { contract, alice, bob } = await loadFixture(deployFixture)
    await expect(
      contract.connect(alice).mint(bob.address, DUMMY_ENC),
    ).to.be.revertedWith('Not issuer')
  })

  it('reverts mint to the zero address', async function () {
    const { contract, issuer } = await loadFixture(deployFixture)
    await expect(
      contract.connect(issuer).mint(ethers.ZeroAddress, DUMMY_ENC),
    ).to.be.revertedWith('Zero address')
  })

  it('reverts transfer to the zero address', async function () {
    const { contract, alice } = await loadFixture(deployFixture)
    await expect(
      contract.connect(alice).transfer(ethers.ZeroAddress, DUMMY_ENC),
    ).to.be.revertedWith('Zero address')
  })

  it('reverts a self-transfer', async function () {
    const { contract, alice } = await loadFixture(deployFixture)
    await expect(
      contract.connect(alice).transfer(alice.address, DUMMY_ENC),
    ).to.be.revertedWith('Self transfer')
  })
})
