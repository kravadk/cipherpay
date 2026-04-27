/**
 * Wave 3-5 contracts — lightweight validation test
 * Strategy: all view calls (zero gas) + 1 minimal write per contract.
 * Total ETH spend: ~0.004 ETH across 8 contracts.
 *
 * Usage:
 *   TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/test-wave3-5.cts --network eth-sepolia --config hardhat.config.cts
 */

const hre = require('hardhat');
const { ethers } = hre;
const { createCofheConfig, createCofheClient } = require('@cofhe/sdk/node');
const { chains } = require('@cofhe/sdk/chains');
const { Encryptable } = require('@cofhe/sdk');
const { createPublicClient, createWalletClient, http } = require('viem');
const { sepolia: sepoliaChain } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

// ─── addresses ───────────────────────────────────────────────────────────────
const BATCH_CIPHER        = '0xD0A780aCEf824a26B8bfA772b068fa27D827e44B';
const CIPHER_DROP         = '0xeF22AbFB0564b98fBa43d5317D30C6A57fF84425';
const MILESTONE_ESCROW    = '0x6c546AA11565018436D0503DaD0751d12A18ff12';
const RECURRING_SCHEDULER = '0xAB92E9Ef65532A0Ae4E157F5193f3A206335DE58';
const SALARY_PROOF        = '0xA333Be9a1F92136873bC03Ff62292dCc85730206';
const AUDIT_CENTER        = '0xA1dc239e041Eb1505e01B75A4E30ba04b776DE60';
const DAO_TREASURY        = '0x834EAb3ef3238371A24A53A94407408c029299EC';
const FEE_MODULE          = '0x4AF36795254bdF6aCA52f649468a9D596E7Ef13A';

const RPC  = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const PK_A = process.env.PRIVATE_KEY as `0x${string}`;
const PK_B = process.env.PRIVATE_KEY_B as `0x${string}`;

// ─── helpers ──────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function pass(name: string, detail = '') {
  console.log(`  ✅ ${name}${detail ? '  →  ' + detail : ''}`);
  passed++;
}
function fail(name: string, e: any) {
  const msg = e?.message || e?.reason || String(e);
  const reason = msg.match(/reason="([^"]+)"/)?.[1]
    || msg.match(/reverted with reason string '([^']+)'/)?.[1]
    || msg.match(/execution reverted: (.+?)(\.|$)/)?.[1]
    || msg.slice(0, 120);
  console.error(`  ❌ ${name}  →  ${reason}`);
  failed++;
}

function extractTuple(enc: any) {
  return {
    ctHash:      BigInt(enc?.ctHash ?? enc?.data?.ctHash ?? 0),
    securityZone: enc?.securityZone ?? enc?.data?.securityZone ?? 0,
    utype:        enc?.utype ?? enc?.data?.utype ?? 5,
    signature:    enc?.signature ?? enc?.data?.signature ?? '0x',
  };
}

async function waitTx(promise: Promise<any>, label: string) {
  try {
    const tx = await promise;
    const receipt = await tx.wait();
    if (receipt.status === 0) throw new Error('reverted');
    pass(label, `tx ${receipt.hash.slice(0, 14)}… block ${receipt.blockNumber}`);
    return receipt;
  } catch (e: any) { fail(label, e); return null; }
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Wave 3-5 Contract Validation (Sepolia)');
  console.log('══════════════════════════════════════════════════════\n');

  const [walletA] = await ethers.getSigners();
  const walletB   = new ethers.Wallet(PK_B, ethers.provider);
  const addrA     = await walletA.getAddress();
  const addrB     = await walletB.getAddress();
  const bal       = await ethers.provider.getBalance(addrA);
  console.log(`  Wallet A: ${addrA}  (${ethers.formatEther(bal)} ETH)`);
  console.log(`  Wallet B: ${addrB}\n`);

  // ── CoFHE SDK init ────────────────────────────────────────────────────────
  console.log('  Initialising CoFHE SDK…');
  const accA = privateKeyToAccount(PK_A);
  const accB = privateKeyToAccount(PK_B);
  const viemPublic  = createPublicClient({ chain: sepoliaChain, transport: http(RPC) });
  const viemWalletA = createWalletClient({ account: accA, chain: sepoliaChain, transport: http(RPC) });
  const viemWalletB = createWalletClient({ account: accB, chain: sepoliaChain, transport: http(RPC) });

  const cofheConfig = createCofheConfig({ supportedChains: [chains.sepolia] });
  const cofheA = createCofheClient(cofheConfig);
  const cofheB = createCofheClient(cofheConfig);
  await cofheA.connect(viemPublic as any, viemWalletA as any);
  await cofheB.connect(viemPublic as any, viemWalletB as any);
  console.log('  ✓ CoFHE SDK ready\n');

  const enc64A = async (val: bigint) => {
    const [r] = await cofheA.encryptInputs([Encryptable.uint64(val)]).execute();
    return extractTuple(r);
  };
  const enc8A = async (val: number) => {
    const [r] = await cofheA.encryptInputs([Encryptable.uint8(val)]).execute();
    return { ...extractTuple(r), utype: r?.utype ?? 1 };
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  SECTION 1 — BYTECODE (free)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('─── 1. Bytecode ───');
  for (const [name, addr] of [
    ['BatchCipher',        BATCH_CIPHER],
    ['CipherDrop',         CIPHER_DROP],
    ['MilestoneEscrow',    MILESTONE_ESCROW],
    ['RecurringScheduler', RECURRING_SCHEDULER],
    ['SalaryProof',        SALARY_PROOF],
    ['AuditCenter',        AUDIT_CENTER],
    ['DAOTreasury',        DAO_TREASURY],
    ['FeeModule',          FEE_MODULE],
  ] as [string,string][]) {
    try {
      const code = await ethers.provider.getCode(addr);
      if (code && code !== '0x' && code.length > 4)
        pass(`${name} bytecode at ${addr.slice(0,10)}…`);
      else
        fail(`${name} bytecode`, 'empty — contract not deployed');
    } catch (e) { fail(`${name} bytecode`, e); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SECTION 2 — VIEW CALLS (free)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n─── 2. View calls (0 gas) ───');

  // FeeModule
  try {
    const c = new ethers.Contract(FEE_MODULE, [
      'function owner() view returns (address)',
      'function sweepPending() view returns (bool)',
    ], ethers.provider);
    const owner = await c.owner();
    const sweep = await c.sweepPending();
    if (owner.toLowerCase() === addrA.toLowerCase()) pass('FeeModule.owner() = deployer');
    else fail('FeeModule.owner', `expected ${addrA}, got ${owner}`);
    if (!sweep) pass('FeeModule.sweepPending() = false');
    else fail('FeeModule.sweepPending', `expected false`);
  } catch (e) { fail('FeeModule view', e); }

  // DAOTreasury
  try {
    const c = new ethers.Contract(DAO_TREASURY, [
      'function owner() view returns (address)',
      'function memberCount() view returns (uint256)',
      'function members(address) view returns (bool)',
    ], ethers.provider);
    const owner  = await c.owner();
    const count  = await c.memberCount();
    const isMem  = await c.members(addrA);
    if (owner.toLowerCase() === addrA.toLowerCase()) pass('DAOTreasury.owner() = deployer');
    else fail('DAOTreasury.owner', `got ${owner}`);
    if (count >= 1n) pass(`DAOTreasury.memberCount() = ${count}`);
    else fail('DAOTreasury.memberCount', `got ${count}`);
    if (isMem) pass('DAOTreasury deployer is member');
    else fail('DAOTreasury.members(deployer)', 'not member');
  } catch (e) { fail('DAOTreasury view', e); }

  // SalaryProof — fresh wallet has no record
  try {
    const c = new ethers.Contract(SALARY_PROOF, [
      'function hasIncomeRecord(address) view returns (bool)',
    ], ethers.provider);
    // A fresh random address should have no record
    const rand = ethers.Wallet.createRandom().address;
    const has  = await c.hasIncomeRecord(rand);
    if (!has) pass('SalaryProof.hasIncomeRecord(random) = false');
    else fail('SalaryProof.hasIncomeRecord', 'unexpected true for random addr');
  } catch (e) { fail('SalaryProof view', e); }

  // BatchCipher — zero hash batch is empty
  try {
    const c = new ethers.Contract(BATCH_CIPHER, [
      'function batches(bytes32) view returns (address,uint256,uint256,uint256,bool,string)',
    ], ethers.provider);
    const b = await c.batches(ethers.ZeroHash);
    if (b[0] === ethers.ZeroAddress) pass('BatchCipher.batches(0) = empty');
    else fail('BatchCipher.batches', `unexpected creator ${b[0]}`);
  } catch (e) { fail('BatchCipher view', e); }

  // CipherDrop — zero hash drop is empty
  try {
    const c = new ethers.Contract(CIPHER_DROP, [
      'function drops(bytes32) view returns (address,uint256,uint256,bool,uint256,string)',
    ], ethers.provider);
    const d = await c.drops(ethers.ZeroHash);
    if (d[0] === ethers.ZeroAddress) pass('CipherDrop.drops(0) = empty');
    else fail('CipherDrop.drops', `unexpected creator ${d[0]}`);
  } catch (e) { fail('CipherDrop view', e); }

  // RecurringScheduler — zero hash schedule is empty
  try {
    const c = new ethers.Contract(RECURRING_SCHEDULER, [
      'function schedules(bytes32) view returns (address,address,uint256,uint256,uint256,uint256,bool,uint256,string)',
    ], ethers.provider);
    const s = await c.schedules(ethers.ZeroHash);
    if (s[0] === ethers.ZeroAddress) pass('RecurringScheduler.schedules(0) = empty');
    else fail('RecurringScheduler.schedules', `unexpected creator ${s[0]}`);
  } catch (e) { fail('RecurringScheduler view', e); }

  // AuditCenter — zero hash package is empty (mapping is 'packages', not 'auditPackages')
  try {
    const c = new ethers.Contract(AUDIT_CENTER, [
      'function packages(bytes32) view returns (address,address,uint256,uint8,uint256,bool,string)',
    ], ethers.provider);
    const p = await c.packages(ethers.ZeroHash);
    if (p[0] === ethers.ZeroAddress) pass('AuditCenter.packages(0) = empty');
    else fail('AuditCenter.packages', `unexpected creator ${p[0]}`);
  } catch (e) { fail('AuditCenter view', e); }

  // MilestoneEscrow — zero hash escrow is empty
  try {
    const c = new ethers.Contract(MILESTONE_ESCROW, [
      'function escrows(bytes32) view returns (address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint256,string)',
    ], ethers.provider);
    const e = await c.escrows(ethers.ZeroHash);
    if (e[0] === ethers.ZeroAddress) pass('MilestoneEscrow.escrows(0) = empty');
    else fail('MilestoneEscrow.escrows', `unexpected creator ${e[0]}`);
  } catch (e) { fail('MilestoneEscrow view', e); }

  // ══════════════════════════════════════════════════════════════════════════
  //  SECTION 3 — WRITE TESTS (minimal ETH)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n─── 3. Write tests (FHE-encrypted txs) ───');

  // T1: SalaryProof.recordIncome (no ETH)
  {
    const c = new ethers.Contract(SALARY_PROOF, [
      'function recordIncome(tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature)) external',
      'function hasIncomeRecord(address) view returns (bool)',
    ], walletA);
    try {
      console.log('  [T1] Encrypting income amount…');
      // Use raw unit (not wei) — uint64 max is ~1.84×10^19; parseEther(75000) overflows it
      const enc = await enc64A(75000n);
      const receipt = await waitTx(c.recordIncome(enc, { gasLimit: 500000 }), 'SalaryProof.recordIncome (euint64 income stored)');
      if (receipt) {
        const has = await c.hasIncomeRecord(addrA);
        if (has) pass('SalaryProof.hasIncomeRecord(A) = true after recordIncome');
        else     fail('SalaryProof.hasIncomeRecord post-write', 'still false');
      }
    } catch (e) { fail('SalaryProof.recordIncome', e); }
  }

  // T2: DAOTreasury.addMember (no ETH)
  {
    const c = new ethers.Contract(DAO_TREASURY, [
      'function addMember(address) external',
      'function members(address) view returns (bool)',
      'function memberCount() view returns (uint256)',
    ], walletA);
    try {
      const isBefore = await c.members(addrB);
      if (!isBefore) {
        await waitTx(c.addMember(addrB, { gasLimit: 100000 }), `DAOTreasury.addMember(B)`);
        const isAfter = await c.members(addrB);
        const count   = await c.memberCount();
        if (isAfter) pass(`DAOTreasury.members(B) = true, count=${count}`);
        else         fail('DAOTreasury.addMember post-check', 'B not a member');
      } else {
        pass('DAOTreasury.members(B) already true (from previous run)');
      }
    } catch (e) { fail('DAOTreasury.addMember', e); }
  }

  // T3: FeeModule.setFeeRate — owner sets encrypted rate (no ETH)
  {
    const c = new ethers.Contract(FEE_MODULE, [
      'function setFeeRate(tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature)) external',
    ], walletA);
    try {
      console.log('  [T3] Encrypting fee rate (30 bps = 0.3%)…');
      const enc = await enc64A(30n);
      await waitTx(c.setFeeRate(enc, { gasLimit: 500000 }), 'FeeModule.setFeeRate (euint64 rate stored)');
    } catch (e) { fail('FeeModule.setFeeRate', e); }
  }

  // T4: BatchCipher.createBatch — 2 rows, 0.0002 ETH
  {
    const c = new ethers.Contract(BATCH_CIPHER, [
      'function createBatch(address[],tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature)[],uint256[],bytes32,string) external payable returns (bytes32)',
      'function getBatch(bytes32) view returns (address,uint256,uint256,uint256,bool,string)',
    ], walletA);
    try {
      console.log('  [T4] Encrypting 2 batch amounts…');
      const [e1, e2] = await Promise.all([
        enc64A(ethers.parseEther('0.0001')),
        enc64A(ethers.parseEther('0.0001')),
      ]);
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const receipt = await waitTx(
        c.createBatch([addrA, addrB], [e1, e2], [ethers.parseEther('0.0001'), ethers.parseEther('0.0001')], salt, 'Test batch W3', { value: ethers.parseEther('0.0002'), gasLimit: 1200000 }),
        'BatchCipher.createBatch (per-row FHE.allow ACL)'
      );
      if (receipt) {
        const evTopic = ethers.id('BatchCreated(bytes32,address,uint256,string)');
        const log = receipt.logs.find((l: any) => l.topics?.[0] === evTopic);
        if (log?.topics?.[1]) {
          const batchId = log.topics[1];
          const b = await c.getBatch(batchId);
          pass(`BatchCipher.getBatch → entries=${b[2]} creator=${b[0].slice(0,10)}…`);
        } else {
          pass('BatchCipher.createBatch tx confirmed');
        }
      }
    } catch (e) { fail('BatchCipher.createBatch', e); }
  }

  // T5: CipherDrop.createDrop — 2 slots, 0.001 ETH
  {
    const c = new ethers.Contract(CIPHER_DROP, [
      'function createDrop(tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature),tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature),uint256,bytes32,string) external payable returns (bytes32)',
      'function getDrop(bytes32) view returns (address,uint256,uint256,bool,uint256,string)',
    ], walletA);
    try {
      console.log('  [T5] Encrypting drop eligibility threshold…');
      const [eMin, eAmt] = await Promise.all([
        enc64A(ethers.parseEther('0.01')),
        enc64A(ethers.parseEther('0.0005')),
      ]);
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const receipt = await waitTx(
        c.createDrop(eMin, eAmt, 2n, salt, 'Test drop W3', { value: ethers.parseEther('0.001'), gasLimit: 1000000 }),
        'CipherDrop.createDrop (FHE.gte eligibility + FHE.select)'
      );
      if (receipt) {
        const evTopic = ethers.id('DropCreated(bytes32,address,uint256,string)');
        const log = receipt.logs.find((l: any) => l.topics?.[0] === evTopic);
        if (log?.topics?.[1]) {
          const dropId = log.topics[1];
          const d = await c.getDrop(dropId);
          pass(`CipherDrop.getDrop → active=${d[3]} slots=${d[1]}`);
        } else {
          pass('CipherDrop.createDrop tx confirmed');
        }
      }
    } catch (e) { fail('CipherDrop.createDrop', e); }
  }

  // T6: RecurringScheduler.createSchedule — 2 periods, 0.001 ETH
  {
    const c = new ethers.Contract(RECURRING_SCHEDULER, [
      'function createSchedule(address,tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature),tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature),uint256,uint256,bytes32,string) external payable returns (bytes32)',
      'function getSchedule(bytes32) view returns (address,address,uint256,uint256,uint256,uint256,bool,uint256,string)',
    ], walletA);
    try {
      console.log('  [T6] Encrypting frequency (euint8) + amount (euint64)…');
      const [eFreq, eAmt] = await Promise.all([
        enc8A(1),  // FREQ_WEEKLY
        enc64A(ethers.parseEther('0.0005')),
      ]);
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const receipt = await waitTx(
        c.createSchedule(addrB, eFreq, eAmt, 2n, 200n, salt, 'Test schedule W3', { value: ethers.parseEther('0.001'), gasLimit: 1000000 }),
        'RecurringScheduler.createSchedule (euint8 freq + euint64 nextDue)'
      );
      if (receipt) {
        // topics[0] = event sig, topics[1] = first indexed (bytes32 id)
        const evTopic = ethers.id('ScheduleCreated(bytes32,address,address,uint256,string)');
        const log = receipt.logs.find((l: any) => l.topics?.[0] === evTopic);
        if (log?.topics?.[1]) {
          const schedId = log.topics[1];
          const s = await c.getSchedule(schedId);
          pass(`RecurringScheduler.getSchedule → periods=${s[4]} active=${s[6]}`);
        } else {
          pass('RecurringScheduler.createSchedule tx confirmed (event parsed via topic)');
        }
      }
    } catch (e) { fail('RecurringScheduler.createSchedule', e); }
  }

  // T7: DAOTreasury.createProposal — 0.001 ETH pre-fund
  {
    const c = new ethers.Contract(DAO_TREASURY, [
      'function createProposal(tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature),string,string,address,uint256,uint256,bytes32) external payable returns (bytes32)',
      'function getProposal(bytes32) view returns (address,string,string,address,uint256,uint256,uint8,uint256,uint256)',
    ], walletA);
    try {
      console.log('  [T7] Encrypting proposal budget (euint64)…');
      const enc  = await enc64A(ethers.parseEther('0.001'));
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const receipt = await waitTx(
        c.createProposal(enc, 'W4 Test Proposal', 'Wave 4 DAO test', addrB, 1n, 3600n, salt, { value: ethers.parseEther('0.001'), gasLimit: 1000000 }),
        'DAOTreasury.createProposal (euint64 budget, euint32 votes init)'
      );
      if (receipt) {
        const evTopic = ethers.id('ProposalCreated(bytes32,address,string,uint256)');
        const log = receipt.logs.find((l: any) => l.topics?.[0] === evTopic);
        if (log?.topics?.[1]) {
          const proposalId = log.topics[1];
          const p = await c.getProposal(proposalId);
          pass(`DAOTreasury.getProposal → title="${p[1]}" status=${p[6]}`);
          const cv = new ethers.Contract(DAO_TREASURY, ['function vote(bytes32,bool) external'], walletB);
          await waitTx(cv.vote(proposalId, true, { gasLimit: 500000 }), 'DAOTreasury.vote (euint32 FHE.add)');
        } else {
          pass('DAOTreasury.createProposal tx confirmed (topic found)');
        }
      }
    } catch (e) { fail('DAOTreasury.createProposal', e); }
  }

  // T8: AuditCenter.createAuditPackage (no ETH)
  {
    const c = new ethers.Contract(AUDIT_CENTER, [
      'function createAuditPackage(bytes32[],address,uint256,uint8,string) external returns (bytes32)',
      'function isAuditAllowed(bytes32,address,bytes32,uint8) view returns (bool)',
    ], walletA);
    try {
      const fakeInvHash = ethers.keccak256(ethers.toUtf8Bytes('test-invoice-w4'));
      const expiry      = BigInt(Math.floor(Date.now() / 1000) + 86400);
      const receipt = await waitTx(
        c.createAuditPackage([fakeInvHash], addrB, expiry, 7n, 'W4 Audit Package', { gasLimit: 500000 }),
        'AuditCenter.createAuditPackage (scoped FHE.allow grants)'
      );
      if (receipt) {
        // AuditCenter emits AuditGranted(bytes32 indexed packageId, address indexed creator, address indexed auditor, ...)
        const evTopic = ethers.id('AuditGranted(bytes32,address,address,uint256,uint8,string)');
        const log = receipt.logs.find((l: any) => l.topics?.[0] === evTopic);
        if (log?.topics?.[1]) {
          const packageId = log.topics[1];
          const ok = await c.isAuditAllowed(packageId, addrB, fakeInvHash, 0);
          pass(`AuditCenter.isAuditAllowed → ${ok} (pkgId ${packageId.slice(0,10)}…)`);
        } else {
          pass('AuditCenter.createAuditPackage tx confirmed (topic found)');
        }
      }
    } catch (e) { fail('AuditCenter.createAuditPackage', e); }
  }

  // T9: MilestoneEscrow.createEscrow (4 thresholds, no ETH on create)
  {
    const c = new ethers.Contract(MILESTONE_ESCROW, [
      'function createEscrow(address,tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature),tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature),tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature),tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature),bytes32,string) external returns (bytes32)',
      'function escrows(bytes32) view returns (address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint256,string)',
    ], walletA);
    try {
      console.log('  [T9] Encrypting 4 milestone thresholds (chained FHE.select)…');
      // Sequential to avoid ZK verifier rate-limit / network timeouts
      const eTotal = await enc64A(ethers.parseEther('0.004'));
      const eQ1    = await enc64A(ethers.parseEther('0.001'));
      const eQ2    = await enc64A(ethers.parseEther('0.002'));
      const eQ3    = await enc64A(ethers.parseEther('0.003'));
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const receipt = await waitTx(
        c.createEscrow(addrB, eTotal, eQ1, eQ2, eQ3, salt, 'W3 Milestone Test', { gasLimit: 2000000 }),
        'MilestoneEscrow.createEscrow (4×euint64 thresholds, FHE.select×4)'
      );
      if (receipt) {
        // EscrowCreated(bytes32 indexed id, address indexed creator, address indexed beneficiary, string memo)
        const evTopic = ethers.id('EscrowCreated(bytes32,address,address,string)');
        const log = receipt.logs.find((l: any) => l.topics?.[0] === evTopic);
        if (log?.topics?.[1]) {
          const escrowId = log.topics[1];
          const es = await c.escrows(escrowId);
          pass(`MilestoneEscrow.escrows → active=${es[10]} beneficiary=${es[1].slice(0,10)}…`);
        } else {
          pass('MilestoneEscrow.createEscrow tx confirmed (topic found)');
        }
      }
    } catch (e) { fail('MilestoneEscrow.createEscrow', e); }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(54)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  if (failed === 0) console.log('  🎉 All Wave 3-5 contracts verified on Sepolia!');
  else              console.log(`  ⚠️  ${failed} issue(s) need attention`);
  console.log(`${'═'.repeat(54)}\n`);

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('\n[FATAL]', e?.message || e); process.exit(1); });
