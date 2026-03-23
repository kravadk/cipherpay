import helpers from '@nomicfoundation/hardhat-network-helpers'
const { loadFixture, time } = helpers
import chai from 'chai'
const { expect } = chai
import hre from 'hardhat'
const { ethers } = hre

describe('CipherPaySimple — Recurring', function () {
  async function deployFixture() {
    const [creator, payer, stranger] = await ethers.getSigners()
    const Factory = await ethers.getContractFactory('CipherPaySimple')
    const contract = await Factory.connect(creator).deploy()
    return { contract, creator, payer, stranger }
  }

  async function createRecurringInvoice(contract: any, creator: any, recipient: string, amount: bigint) {
    const salt = ethers.randomBytes(32)
    const tx = await contract.connect(creator).createInvoice(
      amount, recipient, 2, // type=recurring
      0, 0, salt, 'recurring test'
    )
    const receipt = await tx.wait()
    const event = receipt?.logs?.find((log: any) => {
      try { return contract.interface.parseLog(log)?.name === 'InvoiceCreated' } catch { return false }
    })
    const parsed = contract.interface.parseLog(event!)
    return parsed!.args[0] as string
  }

  const ONE_DAY = 86400
  const THIRTY_DAYS = 30 * ONE_DAY

  it('should block recurring from payInvoice', async function () {
    const { contract, creator, payer } = await loadFixture(deployFixture)
    const hash = await createRecurringInvoice(contract, creator, payer.address, ethers.parseEther('0.06'))

    await expect(
      contract.connect(payer).payInvoice(hash, ethers.parseEther('0.06'), { value: ethers.parseEther('0.06') })
    ).to.be.revertedWith('Recurring: use depositRecurring instead')
  })

  it('should deposit full amount into escrow', async function () {
    const { contract, creator, payer } = await loadFixture(deployFixture)
    const amount = ethers.parseEther('0.06')
    const hash = await createRecurringInvoice(contract, creator, payer.address, amount)

    await expect(
      contract.connect(payer).depositRecurring(hash, THIRTY_DAYS, 6, { value: amount })
    ).to.emit(contract, 'RecurringDeposited')
      .withArgs(hash, payer.address, amount, 6, THIRTY_DAYS)

    const sched = await contract.getRecurringSchedule(hash)
    expect(sched.intervalSeconds).to.equal(THIRTY_DAYS)
    expect(sched.totalPeriods).to.equal(6)
    expect(sched.claimedPeriods).to.equal(0)
    expect(sched.perPeriodAmount).to.equal(ethers.parseEther('0.01'))
  })

  it('should reject deposit with wrong amount', async function () {
    const { contract, creator, payer } = await loadFixture(deployFixture)
    const hash = await createRecurringInvoice(contract, creator, payer.address, ethers.parseEther('0.06'))

    await expect(
      contract.connect(payer).depositRecurring(hash, THIRTY_DAYS, 6, { value: ethers.parseEther('0.03') })
    ).to.be.revertedWith('Must deposit exact amount')
  })

  it('should reject double deposit', async function () {
    const { contract, creator, payer } = await loadFixture(deployFixture)
    const amount = ethers.parseEther('0.06')
    const hash = await createRecurringInvoice(contract, creator, payer.address, amount)

    await contract.connect(payer).depositRecurring(hash, THIRTY_DAYS, 6, { value: amount })

    await expect(
      contract.connect(payer).depositRecurring(hash, THIRTY_DAYS, 6, { value: amount })
    ).to.be.revertedWith('Already deposited')
  })

  it('should not allow claim before first period', async function () {
    const { contract, creator, payer } = await loadFixture(deployFixture)
    const amount = ethers.parseEther('0.06')
    const hash = await createRecurringInvoice(contract, creator, payer.address, amount)

    await contract.connect(payer).depositRecurring(hash, THIRTY_DAYS, 6, { value: amount })

    await expect(
      contract.connect(creator).claimRecurring(hash)
    ).to.be.revertedWith('Nothing to claim yet')
  })

  it('should allow claim after one period', async function () {
    const { contract, creator, payer } = await loadFixture(deployFixture)
    const amount = ethers.parseEther('0.06')
    const hash = await createRecurringInvoice(contract, creator, payer.address, amount)

    await contract.connect(payer).depositRecurring(hash, THIRTY_DAYS, 6, { value: amount })

    // Fast-forward 30 days
    await time.increase(THIRTY_DAYS)

    const balBefore = await ethers.provider.getBalance(creator.address)

    const tx = await contract.connect(creator).claimRecurring(hash)
    const receipt = await tx.wait()
    const gasUsed = receipt!.gasUsed * receipt!.gasPrice

    const balAfter = await ethers.provider.getBalance(creator.address)

    // Creator should receive 0.01 ETH (minus gas)
    expect(balAfter - balBefore + gasUsed).to.equal(ethers.parseEther('0.01'))

    const sched = await contract.getRecurringSchedule(hash)
    expect(sched.claimedPeriods).to.equal(1)
    expect(sched.claimableNow).to.equal(0)
  })

  it('should claim multiple periods at once', async function () {
    const { contract, creator, payer } = await loadFixture(deployFixture)
    const amount = ethers.parseEther('0.06')
    const hash = await createRecurringInvoice(contract, creator, payer.address, amount)

    await contract.connect(payer).depositRecurring(hash, THIRTY_DAYS, 6, { value: amount })

    // Fast-forward 90 days (3 periods)
    await time.increase(THIRTY_DAYS * 3)

    const balBefore = await ethers.provider.getBalance(creator.address)
    const tx = await contract.connect(creator).claimRecurring(hash)
    const receipt = await tx.wait()
    const gasUsed = receipt!.gasUsed * receipt!.gasPrice
    const balAfter = await ethers.provider.getBalance(creator.address)

    // 3 periods × 0.01 = 0.03 ETH
    expect(balAfter - balBefore + gasUsed).to.equal(ethers.parseEther('0.03'))

    const sched = await contract.getRecurringSchedule(hash)
    expect(sched.claimedPeriods).to.equal(3)
  })

  it('should settle after all periods claimed', async function () {
    const { contract, creator, payer } = await loadFixture(deployFixture)
    const amount = ethers.parseEther('0.06')
    const hash = await createRecurringInvoice(contract, creator, payer.address, amount)

    await contract.connect(payer).depositRecurring(hash, THIRTY_DAYS, 6, { value: amount })

    // Fast-forward past all 6 periods
    await time.increase(THIRTY_DAYS * 7)

    await expect(contract.connect(creator).claimRecurring(hash))
      .to.emit(contract, 'InvoiceSettled')
      .withArgs(hash)

    const inv = await contract.getInvoice(hash)
    expect(inv.status).to.equal(1) // settled
  })

  it('should not allow claim after settled', async function () {
    const { contract, creator, payer } = await loadFixture(deployFixture)
    const amount = ethers.parseEther('0.06')
    const hash = await createRecurringInvoice(contract, creator, payer.address, amount)

    await contract.connect(payer).depositRecurring(hash, THIRTY_DAYS, 6, { value: amount })
    await time.increase(THIRTY_DAYS * 7)
    await contract.connect(creator).claimRecurring(hash)

    await expect(
      contract.connect(creator).claimRecurring(hash)
    ).to.be.revertedWith('Not open')
  })

  it('should only allow creator to claim', async function () {
    const { contract, creator, payer } = await loadFixture(deployFixture)
    const amount = ethers.parseEther('0.06')
    const hash = await createRecurringInvoice(contract, creator, payer.address, amount)

    await contract.connect(payer).depositRecurring(hash, THIRTY_DAYS, 6, { value: amount })
    await time.increase(THIRTY_DAYS)

    await expect(
      contract.connect(payer).claimRecurring(hash)
    ).to.be.revertedWith('Only creator')
  })

  it('should handle rounding on last period', async function () {
    const { contract, creator, payer } = await loadFixture(deployFixture)
    // 0.07 ETH / 3 periods = 0.0233... per period — rounding issue
    const amount = ethers.parseEther('0.07')
    const hash = await createRecurringInvoice(contract, creator, payer.address, amount)

    await contract.connect(payer).depositRecurring(hash, THIRTY_DAYS, 3, { value: amount })

    // Claim first 2 periods
    await time.increase(THIRTY_DAYS * 2)
    await contract.connect(creator).claimRecurring(hash)

    // Claim last period — should get remainder
    await time.increase(THIRTY_DAYS)
    const balBefore = await ethers.provider.getBalance(creator.address)
    const tx = await contract.connect(creator).claimRecurring(hash)
    const receipt = await tx.wait()
    const gasUsed = receipt!.gasUsed * receipt!.gasPrice
    const balAfter = await ethers.provider.getBalance(creator.address)

    const perPeriod = amount / 3n
    const expectedLast = amount - perPeriod * 2n
    expect(balAfter - balBefore + gasUsed).to.equal(expectedLast)

    // Contract should have 0 balance for this invoice
    const sched = await contract.getRecurringSchedule(hash)
    expect(sched.claimedPeriods).to.equal(3)
  })

  it('should reject unauthorized payer', async function () {
    const { contract, creator, payer, stranger } = await loadFixture(deployFixture)
    const amount = ethers.parseEther('0.06')
    const hash = await createRecurringInvoice(contract, creator, payer.address, amount)

    await expect(
      contract.connect(stranger).depositRecurring(hash, THIRTY_DAYS, 6, { value: amount })
    ).to.be.revertedWith('Not authorized')
  })

  it('should allow anyone to deposit when no recipient set', async function () {
    const { contract, creator, stranger } = await loadFixture(deployFixture)
    const amount = ethers.parseEther('0.06')
    const hash = await createRecurringInvoice(contract, creator, ethers.ZeroAddress, amount)

    await expect(
      contract.connect(stranger).depositRecurring(hash, THIRTY_DAYS, 6, { value: amount })
    ).to.emit(contract, 'RecurringDeposited')
  })
})
