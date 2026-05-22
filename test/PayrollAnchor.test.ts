/**
 * Unit tests for PayrollAnchor — the on-chain Merkle anchor for invoice-existence
 * proofs. PayrollAnchor is pure Solidity (no FHE), so it is fully unit-testable
 * on a bare Hardhat node.
 *
 * The in-test Merkle helpers below use sorted-pair keccak256 — identical to
 * PayrollAnchor.verify() and the client-side src/lib/merkle.ts — so these tests
 * also cross-check that all three implementations agree.
 */
import helpers from '@nomicfoundation/hardhat-network-helpers'
const { loadFixture } = helpers
import chai from 'chai'
const { expect } = chai
import hre from 'hardhat'
const { ethers } = hre

function hashPair(a: string, b: string): string {
  const [x, y] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a]
  return ethers.keccak256(ethers.concat([x, y]))
}

function buildTree(leaves: string[]): { root: string; layers: string[][] } {
  const sorted = [...new Set(leaves.map(l => l.toLowerCase()))].sort()
  const layers: string[][] = [sorted]
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1]
    const next: string[] = []
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i])
    }
    layers.push(next)
  }
  return { root: layers[layers.length - 1][0], layers }
}

function merkleProof(tree: { layers: string[][] }, leaf: string): string[] {
  let idx = tree.layers[0].indexOf(leaf.toLowerCase())
  const p: string[] = []
  for (let l = 0; l < tree.layers.length - 1; l++) {
    const layer = tree.layers[l]
    const sib = idx ^ 1
    if (sib < layer.length) p.push(layer[sib])
    idx = Math.floor(idx / 2)
  }
  return p
}

const LEAVES = Array.from({ length: 6 }, (_, i) =>
  ethers.keccak256(ethers.toUtf8Bytes(`invoice-${i}`)),
)

describe('PayrollAnchor', function () {
  async function deployFixture() {
    const [deployer, other] = await ethers.getSigners()
    const Factory = await ethers.getContractFactory('PayrollAnchor')
    const contract = await Factory.connect(deployer).deploy()
    return { contract, deployer, other }
  }

  describe('anchorRoot', function () {
    it('stores the root and increments anchorCount', async function () {
      const { contract } = await loadFixture(deployFixture)
      const { root } = buildTree(LEAVES)
      await contract.anchorRoot(root, LEAVES.length)

      expect(await contract.anchorCount()).to.equal(1n)
      const anchor = await contract.anchors(0)
      expect(anchor.root).to.equal(root)
      expect(anchor.leafCount).to.equal(BigInt(LEAVES.length))
    })

    it('emits RootAnchored with the publisher', async function () {
      const { contract, deployer } = await loadFixture(deployFixture)
      const { root } = buildTree(LEAVES)
      await expect(contract.anchorRoot(root, LEAVES.length))
        .to.emit(contract, 'RootAnchored')
        .withArgs(0, root, LEAVES.length, deployer.address)
    })

    it('rejects an empty root', async function () {
      const { contract } = await loadFixture(deployFixture)
      await expect(contract.anchorRoot(ethers.ZeroHash, 0)).to.be.revertedWith(
        'PayrollAnchor: empty root',
      )
    })

    it('keeps multiple anchors independent', async function () {
      const { contract } = await loadFixture(deployFixture)
      const t1 = buildTree(LEAVES.slice(0, 3))
      const t2 = buildTree(LEAVES.slice(3))
      await contract.anchorRoot(t1.root, 3)
      await contract.anchorRoot(t2.root, 3)

      expect(await contract.anchorCount()).to.equal(2n)
      expect((await contract.anchors(0)).root).to.equal(t1.root)
      expect((await contract.anchors(1)).root).to.equal(t2.root)
    })
  })

  describe('verify', function () {
    it('accepts a valid proof for every leaf', async function () {
      const { contract } = await loadFixture(deployFixture)
      const tree = buildTree(LEAVES)
      await contract.anchorRoot(tree.root, LEAVES.length)

      for (const leaf of LEAVES) {
        const proof = merkleProof(tree, leaf)
        expect(await contract.verify(0, leaf, proof)).to.equal(true)
      }
    })

    it('rejects a leaf that is not in the tree', async function () {
      const { contract } = await loadFixture(deployFixture)
      const tree = buildTree(LEAVES)
      await contract.anchorRoot(tree.root, LEAVES.length)

      const outsider = ethers.keccak256(ethers.toUtf8Bytes('not-in-tree'))
      const proof = merkleProof(tree, LEAVES[0])
      expect(await contract.verify(0, outsider, proof)).to.equal(false)
    })

    it('rejects a tampered proof', async function () {
      const { contract } = await loadFixture(deployFixture)
      const tree = buildTree(LEAVES)
      await contract.anchorRoot(tree.root, LEAVES.length)

      const proof = merkleProof(tree, LEAVES[0])
      const tampered = [...proof]
      tampered[0] = ethers.keccak256(ethers.toUtf8Bytes('wrong-sibling'))
      expect(await contract.verify(0, LEAVES[0], tampered)).to.equal(false)
    })

    it('returns false for a non-existent anchor id', async function () {
      const { contract } = await loadFixture(deployFixture)
      const tree = buildTree(LEAVES)
      const proof = merkleProof(tree, LEAVES[0])
      expect(await contract.verify(99, LEAVES[0], proof)).to.equal(false)
    })
  })
})
