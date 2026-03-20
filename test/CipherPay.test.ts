import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { expect } from 'chai'
import hre from 'hardhat'
import { ethers } from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'

describe('CipherPay', function () {
  async function deployCipherPayFixture() {
    const [creator, payer, stranger] = await ethers.getSigners()

    const CipherPay = await ethers.getContractFactory('CipherPay')
    const cipherPay = await CipherPay.connect(creator).deploy()

    return { cipherPay, creator, payer, stranger }
  }

  async function createStandardInvoice(
    cipherPay: any,
    creator: any,
    recipient: string,
    amount: bigint,
    deadline: number = 0,
    unlockBlock: number = 0
  ) {
    // Initialize cofhejs for creator
    await hre.cofhe.expectResultSuccess(
      hre.cofhe.initializeWithHardhatSigner(creator)
    )

    // Encrypt the amount
    const encryptResult = await hre.cofhe.expectResultSuccess(
      cofhejs.encrypt([Encryptable.uint64(amount)] as const)
    )
    const [encryptedAmount] = encryptResult

    // Generate salt
    const salt = ethers.randomBytes(32)

    // Create invoice
    const tx = await cipherPay.connect(creator).createInvoice(
      encryptedAmount,
      recipient,
      0, // standard type
      deadline,
      unlockBlock,
      salt
    )

    const receipt = await tx.wait()

    // Extract invoice hash from event
    const event = receipt?.logs?.find((log: any) => {
      try {
        return cipherPay.interface.parseLog(log)?.name === 'InvoiceCreated'
      } catch {
        return false
      }
    })

    const parsedEvent = cipherPay.interface.parseLog(event!)
    const invoiceHash = parsedEvent!.args.invoiceHash

    return { invoiceHash, encryptedAmount, tx, receipt }
  }

  describe('Deployment', function () {
    it('Should deploy successfully', async function () {
      const { cipherPay } = await loadFixture(deployCipherPayFixture)
      const address = await cipherPay.getAddress()
      expect(address).to.be.properAddress
    })
  })

  describe('Create Invoice', function () {
    beforeEach(function () {
      if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
    })

    it('Should create a standard invoice', async function () {
      const { cipherPay, creator, payer } = await loadFixture(deployCipherPayFixture)

      const { invoiceHash } = await createStandardInvoice(
        cipherPay,
        creator,
        payer.address,
        1000n
      )

      // Verify invoice exists
      const invoice = await cipherPay.getInvoice(invoiceHash)
      expect(invoice.creator).to.equal(creator.address)
      expect(invoice.recipient).to.equal(payer.address)
      expect(invoice.invoiceType).to.equal(0) // standard
      expect(invoice.status).to.equal(0) // open

      // Verify user invoices
      const userInvoices = await cipherPay.getUserInvoices(creator.address)
      expect(userInvoices).to.include(invoiceHash)

      // Verify encrypted amount via mock
      const ctHash = await cipherPay.getEncryptedAmount(invoiceHash)
      await hre.cofhe.mocks.expectPlaintext(ctHash, 1000n)
    })

    it('Should create invoice without recipient (open to anyone)', async function () {
      const { cipherPay, creator } = await loadFixture(deployCipherPayFixture)

      const { invoiceHash } = await createStandardInvoice(
        cipherPay,
        creator,
        ethers.ZeroAddress,
        500n
      )

      const invoice = await cipherPay.getInvoice(invoiceHash)
      expect(invoice.recipient).to.equal(ethers.ZeroAddress)
    })

    it('Should create invoice with deadline', async function () {
      const { cipherPay, creator, payer } = await loadFixture(deployCipherPayFixture)
      const futureTime = Math.floor(Date.now() / 1000) + 86400 // +1 day

      const { invoiceHash } = await createStandardInvoice(
        cipherPay,
        creator,
        payer.address,
        1000n,
        futureTime
      )

      const invoice = await cipherPay.getInvoice(invoiceHash)
      expect(invoice.deadline).to.equal(futureTime)
    })

    it('Should track invoice count', async function () {
      const { cipherPay, creator, payer } = await loadFixture(deployCipherPayFixture)

      expect(await cipherPay.getInvoiceCount(creator.address)).to.equal(0)

      await createStandardInvoice(cipherPay, creator, payer.address, 100n)
      expect(await cipherPay.getInvoiceCount(creator.address)).to.equal(1)

      await createStandardInvoice(cipherPay, creator, payer.address, 200n)
      expect(await cipherPay.getInvoiceCount(creator.address)).to.equal(2)
    })
  })

  describe('Pay Invoice', function () {
    beforeEach(function () {
      if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
    })

    it('Should pay a standard invoice', async function () {
      const { cipherPay, creator, payer } = await loadFixture(deployCipherPayFixture)

      const { invoiceHash } = await createStandardInvoice(
        cipherPay,
        creator,
        payer.address,
        1000n
      )

      // Initialize cofhejs for payer
      await hre.cofhe.expectResultSuccess(
        hre.cofhe.initializeWithHardhatSigner(payer)
      )

      // Encrypt payment
      const paymentResult = await hre.cofhe.expectResultSuccess(
        cofhejs.encrypt([Encryptable.uint64(1000n)] as const)
      )

      // Pay
      await cipherPay.connect(payer).payInvoice(invoiceHash, paymentResult[0])

      // Verify settled
      const invoice = await cipherPay.getInvoice(invoiceHash)
      expect(invoice.status).to.equal(1) // settled

      // Verify payment recorded
      expect(await cipherPay.hasPaid(invoiceHash, payer.address)).to.be.true
    })

    it('Should NOT pay a non-existent invoice', async function () {
      const { cipherPay, payer } = await loadFixture(deployCipherPayFixture)

      await hre.cofhe.expectResultSuccess(
        hre.cofhe.initializeWithHardhatSigner(payer)
      )

      const paymentResult = await hre.cofhe.expectResultSuccess(
        cofhejs.encrypt([Encryptable.uint64(1000n)] as const)
      )

      const fakeHash = ethers.randomBytes(32)
      await expect(
        cipherPay.connect(payer).payInvoice(fakeHash, paymentResult[0])
      ).to.be.revertedWith('Invoice not found')
    })

    it('Should NOT pay if wrong recipient', async function () {
      const { cipherPay, creator, payer, stranger } = await loadFixture(deployCipherPayFixture)

      const { invoiceHash } = await createStandardInvoice(
        cipherPay,
        creator,
        payer.address,
        1000n
      )

      // Stranger tries to pay
      await hre.cofhe.expectResultSuccess(
        hre.cofhe.initializeWithHardhatSigner(stranger)
      )

      const paymentResult = await hre.cofhe.expectResultSuccess(
        cofhejs.encrypt([Encryptable.uint64(1000n)] as const)
      )

      await expect(
        cipherPay.connect(stranger).payInvoice(invoiceHash, paymentResult[0])
      ).to.be.revertedWith('Not authorized')
    })

    it('Should allow anyone to pay open invoice (no recipient)', async function () {
      const { cipherPay, creator, stranger } = await loadFixture(deployCipherPayFixture)

      const { invoiceHash } = await createStandardInvoice(
        cipherPay,
        creator,
        ethers.ZeroAddress,
        500n
      )

      await hre.cofhe.expectResultSuccess(
        hre.cofhe.initializeWithHardhatSigner(stranger)
      )

      const paymentResult = await hre.cofhe.expectResultSuccess(
        cofhejs.encrypt([Encryptable.uint64(500n)] as const)
      )

      await cipherPay.connect(stranger).payInvoice(invoiceHash, paymentResult[0])

      const invoice = await cipherPay.getInvoice(invoiceHash)
      expect(invoice.status).to.equal(1)
    })
  })

  describe('Cancel Invoice', function () {
    beforeEach(function () {
      if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
    })

    it('Should cancel own invoice', async function () {
      const { cipherPay, creator, payer } = await loadFixture(deployCipherPayFixture)

      const { invoiceHash } = await createStandardInvoice(
        cipherPay,
        creator,
        payer.address,
        1000n
      )

      await cipherPay.connect(creator).cancelInvoice(invoiceHash)

      const invoice = await cipherPay.getInvoice(invoiceHash)
      expect(invoice.status).to.equal(2) // cancelled
    })

    it('Should NOT cancel someone else\'s invoice', async function () {
      const { cipherPay, creator, payer, stranger } = await loadFixture(deployCipherPayFixture)

      const { invoiceHash } = await createStandardInvoice(
        cipherPay,
        creator,
        payer.address,
        1000n
      )

      await expect(
        cipherPay.connect(stranger).cancelInvoice(invoiceHash)
      ).to.be.revertedWith('Not creator')
    })

    it('Should NOT cancel already settled invoice', async function () {
      const { cipherPay, creator, payer } = await loadFixture(deployCipherPayFixture)

      const { invoiceHash } = await createStandardInvoice(
        cipherPay,
        creator,
        payer.address,
        1000n
      )

      // Pay first
      await hre.cofhe.expectResultSuccess(
        hre.cofhe.initializeWithHardhatSigner(payer)
      )
      const paymentResult = await hre.cofhe.expectResultSuccess(
        cofhejs.encrypt([Encryptable.uint64(1000n)] as const)
      )
      await cipherPay.connect(payer).payInvoice(invoiceHash, paymentResult[0])

      // Try to cancel
      await expect(
        cipherPay.connect(creator).cancelInvoice(invoiceHash)
      ).to.be.revertedWith('Not open')
    })
  })

  describe('Settle Multipay', function () {
    beforeEach(function () {
      if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
    })

    it('Should settle multipay invoice', async function () {
      const { cipherPay, creator, payer } = await loadFixture(deployCipherPayFixture)

      // Initialize and create multipay invoice
      await hre.cofhe.expectResultSuccess(
        hre.cofhe.initializeWithHardhatSigner(creator)
      )

      const encryptResult = await hre.cofhe.expectResultSuccess(
        cofhejs.encrypt([Encryptable.uint64(5000n)] as const)
      )

      const salt = ethers.randomBytes(32)
      const tx = await cipherPay.connect(creator).createInvoice(
        encryptResult[0],
        ethers.ZeroAddress,
        1, // multipay
        0,
        0,
        salt
      )
      const receipt = await tx.wait()
      const event = receipt?.logs?.find((log: any) => {
        try {
          return cipherPay.interface.parseLog(log)?.name === 'InvoiceCreated'
        } catch {
          return false
        }
      })
      const invoiceHash = cipherPay.interface.parseLog(event!)!.args.invoiceHash

      // Payer pays — should NOT settle (multipay)
      await hre.cofhe.expectResultSuccess(
        hre.cofhe.initializeWithHardhatSigner(payer)
      )
      const paymentResult = await hre.cofhe.expectResultSuccess(
        cofhejs.encrypt([Encryptable.uint64(2500n)] as const)
      )
      await cipherPay.connect(payer).payInvoice(invoiceHash, paymentResult[0])

      // Should still be open
      let invoice = await cipherPay.getInvoice(invoiceHash)
      expect(invoice.status).to.equal(0) // still open

      // Creator settles
      await cipherPay.connect(creator).settleInvoice(invoiceHash)
      invoice = await cipherPay.getInvoice(invoiceHash)
      expect(invoice.status).to.equal(1) // settled
    })

    it('Should NOT settle non-multipay invoice', async function () {
      const { cipherPay, creator, payer } = await loadFixture(deployCipherPayFixture)

      const { invoiceHash } = await createStandardInvoice(
        cipherPay,
        creator,
        payer.address,
        1000n
      )

      await expect(
        cipherPay.connect(creator).settleInvoice(invoiceHash)
      ).to.be.revertedWith('Not multipay')
    })
  })
})
