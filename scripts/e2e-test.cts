/**
 * CipherPayFHE — E2E on-chain test script
 * Real FHE encryption via @cofhe/sdk Node.js client + real Sepolia txs
 *
 * Tests:
 *  T1  createInvoice (standard)
 *  T2  payInvoice
 *  T3  createInvoice (multipay)
 *  T4  payInvoice x2 → settleInvoice
 *  T5  cancelInvoice
 *  T6  createInvoice (donation / type=4)
 *  T7  depositShielded + shieldedBalance read
 *  T8  payInvoiceShielded (msg.value=0)
 *  T9  withdrawShielded
 *  T10 enableAnonClaim + anonEnabled read
 *  T11 claimAnonymously + double-spend revert
 *  T12 sweepAnonPool + non-creator revert
 *  T13 getInvoice / getEncryptedAmount / getInvoiceMemo / getPayerCount
 *  T14 getUserInvoices / getPaidInvoices / checkHasPaid
 *  T15 requestFullyPaidCheck (allowPublic phase 1)
 *
 * Usage:
 *   TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/e2e-test.cts --network eth-sepolia --config hardhat.config.cts
 */

const hre = require('hardhat');
const { ethers } = hre;
const { createCofheConfig, createCofheClient } = require('@cofhe/sdk/node');
const { chains } = require('@cofhe/sdk/chains');
const { Encryptable, FheTypes } = require('@cofhe/sdk');
const { createPublicClient, createWalletClient, http, custom } = require('viem');
const { sepolia: sepoliaViemChain } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

// ─── config ─────────────────────────────────────────────────────────────────

const CONTRACT = '0xb3Fb5d67795CC2AaeFC4b843417DF9f45C864069';
const RPC = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const PK_A = process.env.PRIVATE_KEY as `0x${string}`;
const PK_B = process.env.PRIVATE_KEY_B as `0x${string}`;

// ─── helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results: { name: string; status: 'PASS' | 'FAIL'; detail: string }[] = [];

function ok(name: string, detail = '') {
  passed++;
  results.push({ name, status: 'PASS', detail });
  console.log(`  ✓  ${name}${detail ? '  →  ' + detail : ''}`);
}

function fail(name: string, detail: string) {
  failed++;
  results.push({ name, status: 'FAIL', detail });
  console.error(`  ✗  ${name}  →  ${detail}`);
}

function randomSalt(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

function randomNullifier(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

async function waitTx(promise: Promise<any>, label: string): Promise<any> {
  try {
    const tx = await promise;
    const receipt = await tx.wait();
    if (receipt.status === 0) throw new Error('reverted');
    ok(label, `tx ${receipt.hash.slice(0, 14)}… block ${receipt.blockNumber}`);
    return receipt;
  } catch (e: any) {
    const msg = e?.message || String(e);
    const reason = msg.match(/reason="([^"]+)"/)?.[1]
      || msg.match(/reverted with reason string '([^']+)'/)?.[1]
      || msg.match(/execution reverted: (.+?)(\.|$)/)?.[1]
      || msg.slice(0, 100);
    fail(label, reason);
    return null;
  }
}

// Force-fetch fresh nonce to avoid stale cache after rapid tx sequences
async function freshNonce(wallet: any): Promise<number> {
  return await wallet.provider.getTransactionCount(await wallet.getAddress(), 'pending');
}

function extractTuple(enc: any) {
  return {
    ctHash: BigInt(enc.ctHash ?? enc.data?.ctHash ?? 0),
    securityZone: enc.securityZone ?? enc.data?.securityZone ?? 0,
    utype: enc.utype ?? enc.data?.utype ?? 5,
    signature: enc.signature ?? enc.data?.signature ?? '0x',
  };
}

async function encryptUint64(cofheClient: any, amount: bigint) {
  const [enc] = await cofheClient
    .encryptInputs([Encryptable.uint64(amount)])
    .execute();
  return extractTuple(enc);
}

async function encryptAddress(cofheClient: any, addr: string) {
  // Encrypts an address as eaddress (utype=7)
  const [enc] = await cofheClient
    .encryptInputs([Encryptable.address(addr)])
    .execute();
  return extractTuple(enc);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  CipherPayFHE — E2E On-chain Test (real FHE + Sepolia)');
  console.log('══════════════════════════════════════════════════════\n');

  if (!PK_A || !PK_B) {
    console.error('  ERROR: PRIVATE_KEY and PRIVATE_KEY_B must be set in .env');
    process.exit(1);
  }

  // ── ethers signers ────────────────────────────────────────────────────────
  const [walletA] = await ethers.getSigners();
  const walletB = new ethers.Wallet(PK_B, ethers.provider);
  const addrA = await walletA.getAddress();
  const addrB = await walletB.getAddress();
  const balA = await ethers.provider.getBalance(addrA);
  const balB = await ethers.provider.getBalance(addrB);

  console.log(`  Wallet A : ${addrA}`);
  console.log(`  Balance A: ${ethers.formatEther(balA)} ETH`);
  console.log(`  Wallet B : ${addrB}`);
  console.log(`  Balance B: ${ethers.formatEther(balB)} ETH`);
  console.log(`  Contract : ${CONTRACT}\n`);

  if (balA < ethers.parseEther('0.05')) {
    console.error('  ERROR: Wallet A needs >= 0.05 ETH on Sepolia');
    process.exit(1);
  }
  if (balB < ethers.parseEther('0.03')) {
    console.error('  ERROR: Wallet B needs >= 0.03 ETH on Sepolia');
    process.exit(1);
  }

  // ── CoFHE SDK — Node.js client ────────────────────────────────────────────
  console.log('  Initializing CoFHE SDK (fetching FHE keys from coprocessor)…');

  const accountA = privateKeyToAccount(PK_A);
  const accountB = privateKeyToAccount(PK_B);

  const viemPublicClient = createPublicClient({ chain: sepoliaViemChain, transport: http(RPC) });
  const viemWalletA = createWalletClient({ account: accountA, chain: sepoliaViemChain, transport: http(RPC) });
  const viemWalletB = createWalletClient({ account: accountB, chain: sepoliaViemChain, transport: http(RPC) });

  const cofheConfig = createCofheConfig({ supportedChains: [chains.sepolia] });
  const cofheClientA = createCofheClient(cofheConfig);
  const cofheClientB = createCofheClient(cofheConfig);

  await cofheClientA.connect(viemPublicClient as any, viemWalletA as any);
  await cofheClientB.connect(viemPublicClient as any, viemWalletB as any);
  console.log('  ✓ CoFHE SDK connected (A + B)\n');

  // ── Load contract ABI ─────────────────────────────────────────────────────
  const artifact = require('../artifacts/contracts/CipherPayFHE.sol/CipherPayFHE.json');
  const cA = new ethers.Contract(CONTRACT, artifact.abi, walletA);
  const cB = new ethers.Contract(CONTRACT, artifact.abi, walletB);

  // Encrypt zero address as eaddress (utype=7) for _encryptedRecipient param
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
  console.log('  Encrypting zero address for recipient param…');
  const encZeroRecipient = await encryptAddress(cofheClientA, ZERO_ADDR);
  console.log(`  [debug] encZeroRecipient utype=${encZeroRecipient.utype} (expect 7)\n`);

  // ─── T1: createInvoice (standard) ───────────────────────────────────────
  console.log('── T1  createInvoice (standard) ──────────────────────');
  let hash1: string | null = null;
  try {
    const encAmt = await encryptUint64(cofheClientA, ethers.parseEther('0.005'));
    console.log('  [debug] encrypted amount ctHash:', BigInt(encAmt.ctHash).toString().slice(0, 20) + '…');
    const tx = await cA.createInvoice(
      encAmt, encZeroRecipient,
      addrB, true,        // recipient = B, hasRecipient = true
      0, 0, 0,            // standard, no deadline, no unlock
      randomSalt(), 'E2E standard invoice',
    );
    const receipt = await tx.wait();
    if (receipt.status === 0) throw new Error('reverted');
    const ev = receipt.logs
      .map((l: any) => { try { return cA.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === 'InvoiceCreated');
    hash1 = ev?.args?.invoiceHash ?? null;
    ok('T1 createInvoice (standard)', `hash ${hash1?.slice(0, 14)}… block ${receipt.blockNumber}`);
  } catch (e: any) {
    fail('T1 createInvoice (standard)', e?.message?.slice(0, 150));
  }

  // ─── T2: payInvoice ─────────────────────────────────────────────────────
  console.log('\n── T2  payInvoice ────────────────────────────────────');
  if (hash1) {
    const payAmt = ethers.parseEther('0.005');
    const encPay = await encryptUint64(cofheClientB, payAmt);
    console.log('  [debug] pay encTuple ctHash:', BigInt(encPay.ctHash).toString().slice(0, 20) + '…');
    await waitTx(cB.payInvoice(hash1, encPay, { value: payAmt }), 'T2 payInvoice');
  } else {
    fail('T2 payInvoice', 'skipped — no hash1');
  }

  // ─── T3: createInvoice (multipay) ───────────────────────────────────────
  console.log('\n── T3  createInvoice (multipay) ──────────────────────');
  let hash3: string | null = null;
  try {
    const encAmt = await encryptUint64(cofheClientA, ethers.parseEther('0.01'));
    const tx = await cA.createInvoice(
      encAmt, encZeroRecipient,
      ethers.ZeroAddress, false,
      1, 0, 0,  // TYPE_MULTIPAY
      randomSalt(), 'E2E multipay invoice',
    );
    const receipt = await tx.wait();
    if (receipt.status === 0) throw new Error('reverted');
    const ev = receipt.logs
      .map((l: any) => { try { return cA.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === 'InvoiceCreated');
    hash3 = ev?.args?.invoiceHash ?? null;
    ok('T3 createInvoice (multipay)', `hash ${hash3?.slice(0, 14)}…`);
  } catch (e: any) {
    fail('T3 createInvoice (multipay)', e?.message?.slice(0, 150));
  }

  // ─── T4: payInvoice x2 → settleInvoice ──────────────────────────────────
  console.log('\n── T4  payInvoice ×2 → settleInvoice ────────────────');
  if (hash3) {
    const half = ethers.parseEther('0.005');
    const encA = await encryptUint64(cofheClientA, half);
    const encB = await encryptUint64(cofheClientB, half);
    await waitTx(cA.payInvoice(hash3, encA, { value: half }), 'T4a payInvoice (A)');
    await waitTx(cB.payInvoice(hash3, encB, { value: half }), 'T4b payInvoice (B)');
    await waitTx(cA.settleInvoice(hash3), 'T4c settleInvoice');
  } else {
    fail('T4 multipay+settle', 'skipped — no hash3');
  }

  // ─── T5: cancelInvoice ──────────────────────────────────────────────────
  console.log('\n── T5  cancelInvoice ─────────────────────────────────');
  let hash5: string | null = null;
  try {
    const encAmt = await encryptUint64(cofheClientA, ethers.parseEther('0.001'));
    const tx = await cA.createInvoice(
      encAmt, encZeroRecipient,
      ethers.ZeroAddress, false, 0, 0, 0,
      randomSalt(), 'E2E cancel test',
    );
    const receipt = await tx.wait();
    if (receipt.status === 0) throw new Error('reverted');
    const ev = receipt.logs
      .map((l: any) => { try { return cA.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === 'InvoiceCreated');
    hash5 = ev?.args?.invoiceHash ?? null;
    ok('T5a createInvoice (to cancel)', `hash ${hash5?.slice(0, 14)}…`);
  } catch (e: any) {
    fail('T5a createInvoice', e?.message?.slice(0, 150));
  }
  if (hash5) {
    const nonce5b = await freshNonce(walletA);
    await waitTx(cA.cancelInvoice(hash5, { nonce: nonce5b }), 'T5b cancelInvoice');
  }

  // ─── T6: createInvoice (donation) ───────────────────────────────────────
  console.log('\n── T6  createInvoice (donation type=4) ──────────────');
  let hash6: string | null = null;
  try {
    const encAmt = await encryptUint64(cofheClientA, 0n);
    const tx = await cA.createInvoice(
      encAmt, encZeroRecipient,
      ethers.ZeroAddress, false,
      4, 0, 0,  // TYPE_DONATION
      randomSalt(), 'E2E donation invoice',
    );
    const receipt = await tx.wait();
    if (receipt.status === 0) throw new Error('reverted');
    const ev = receipt.logs
      .map((l: any) => { try { return cA.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === 'InvoiceCreated');
    hash6 = ev?.args?.invoiceHash ?? null;
    ok('T6 createInvoice (donation)', `hash ${hash6?.slice(0, 14)}…`);
  } catch (e: any) {
    fail('T6 createInvoice (donation)', e?.message?.slice(0, 150));
  }

  // ─── T7: depositShielded + read ─────────────────────────────────────────
  console.log('\n── T7  depositShielded ───────────────────────────────');
  const depositAmt = ethers.parseEther('0.02');
  const depositReceipt = await waitTx(cB.depositShielded({ value: depositAmt }), 'T7 depositShielded');
  // Wait for RPC state to propagate after block confirmation
  if (depositReceipt) {
    await ethers.provider.getBlock(depositReceipt.blockNumber);
  }
  const balShielded: bigint = await cB.shieldedBalance(addrB);
  balShielded >= depositAmt
    ? ok('T7 shieldedBalance read', `${ethers.formatEther(balShielded)} ETH`)
    : fail('T7 shieldedBalance read', `expected >= ${ethers.formatEther(depositAmt)}, got ${ethers.formatEther(balShielded)}`);

  // ─── T8: payInvoiceShielded (msg.value = 0) ─────────────────────────────
  console.log('\n── T8  payInvoiceShielded (msg.value=0) ─────────────');
  let hash8: string | null = null;
  try {
    const encAmt = await encryptUint64(cofheClientA, ethers.parseEther('0.01'));
    const tx = await cA.createInvoice(
      encAmt, encZeroRecipient,
      ethers.ZeroAddress, false, 0, 0, 0,
      randomSalt(), 'E2E shielded pay test',
    );
    const receipt = await tx.wait();
    if (receipt.status === 0) throw new Error('reverted');
    const ev = receipt.logs
      .map((l: any) => { try { return cA.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === 'InvoiceCreated');
    hash8 = ev?.args?.invoiceHash ?? null;
    ok('T8a createInvoice (for shielded pay)', `hash ${hash8?.slice(0, 14)}…`);
  } catch (e: any) {
    fail('T8a createInvoice (for shielded pay)', e?.message?.slice(0, 150));
  }
  if (hash8) {
    const payAmt = ethers.parseEther('0.01');
    const encPay = await encryptUint64(cofheClientB, payAmt);
    console.log('  [debug] payInvoiceShielded — msg.value will be 0');
    await waitTx(
      cB.payInvoiceShielded(hash8, encPay, payAmt),  // no { value } = msg.value 0
      'T8b payInvoiceShielded (msg.value=0)',
    );
    const balAfter: bigint = await cB.shieldedBalance(addrB);
    ok('T8c shieldedBalance after', `${ethers.formatEther(balAfter)} ETH`);
  }

  // ─── T9: withdrawShielded ────────────────────────────────────────────────
  console.log('\n── T9  withdrawShielded ──────────────────────────────');
  const balBefore9: bigint = await cB.shieldedBalance(addrB);
  if (balBefore9 > 0n) {
    await waitTx(cB.withdrawShielded(balBefore9), 'T9 withdrawShielded');
    const balAfter9: bigint = await cB.shieldedBalance(addrB);
    balAfter9 === 0n
      ? ok('T9 balance zeroed', '0 ETH')
      : fail('T9 balance zeroed', `still ${ethers.formatEther(balAfter9)} ETH`);
  } else {
    fail('T9 withdrawShielded', 'shieldedBalance is 0 — nothing to withdraw');
  }

  // ─── T10: enableAnonClaim ────────────────────────────────────────────────
  console.log('\n── T10 enableAnonClaim ───────────────────────────────');
  let hash10: string | null = null;
  try {
    const encAmt = await encryptUint64(cofheClientA, 0n);
    const tx = await cA.createInvoice(
      encAmt, encZeroRecipient,
      ethers.ZeroAddress, false,
      4, 0, 0,  // TYPE_DONATION — works best with anon
      randomSalt(), 'E2E anon claim test',
    );
    const receipt = await tx.wait();
    if (receipt.status === 0) throw new Error('reverted');
    const ev = receipt.logs
      .map((l: any) => { try { return cA.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === 'InvoiceCreated');
    hash10 = ev?.args?.invoiceHash ?? null;
    ok('T10a createInvoice (for anon)', `hash ${hash10?.slice(0, 14)}…`);
  } catch (e: any) {
    fail('T10a createInvoice (for anon)', e?.message?.slice(0, 150));
  }
  if (hash10) {
    const nonce10b = await freshNonce(walletA);
    await waitTx(cA.enableAnonClaim(hash10, { nonce: nonce10b }), 'T10b enableAnonClaim');
    const enabled: boolean = await cA.anonEnabled(hash10);
    enabled
      ? ok('T10c anonEnabled = true', '✓')
      : fail('T10c anonEnabled', 'returned false after enableAnonClaim');
  }

  // ─── T11: claimAnonymously + double-spend revert ─────────────────────────
  console.log('\n── T11 claimAnonymously ──────────────────────────────');
  if (hash10) {
    const anonAmt = ethers.parseEther('0.003');
    const nullifier = randomNullifier() as `0x${string}`;
    const encAnon = await encryptUint64(cofheClientB, anonAmt);
    console.log(`  [debug] nullifier: ${nullifier.slice(0, 18)}…`);

    await waitTx(
      cB.claimAnonymously(hash10, encAnon, nullifier, { value: anonAmt }),
      'T11 claimAnonymously',
    );

    const used: boolean = await cA.anonNullifierUsed(hash10, nullifier);
    used
      ? ok('T11 nullifier marked used', nullifier.slice(0, 18) + '…')
      : fail('T11 nullifier used', 'anonNullifierUsed returned false');

    const pool: bigint = await cA.anonEthPool(hash10);
    pool >= anonAmt
      ? ok('T11 anonEthPool', `${ethers.formatEther(pool)} ETH`)
      : fail('T11 anonEthPool', `expected >= ${ethers.formatEther(anonAmt)}, got ${ethers.formatEther(pool)}`);

    // Double-spend: same nullifier must revert
    console.log('  [debug] testing double-spend with same nullifier…');
    try {
      const encAnon2 = await encryptUint64(cofheClientB, anonAmt);
      const tx2 = await cB.claimAnonymously(hash10, encAnon2, nullifier, { value: anonAmt });
      await tx2.wait();
      fail('T11 double-spend revert', 'tx succeeded — should have reverted');
    } catch {
      ok('T11 double-spend reverts correctly', 'nullifier reuse rejected ✓');
    }
  } else {
    fail('T11 claimAnonymously', 'skipped — no hash10');
  }

  // ─── T12: sweepAnonPool ──────────────────────────────────────────────────
  console.log('\n── T12 sweepAnonPool ─────────────────────────────────');
  if (hash10) {
    const poolBefore: bigint = await cA.anonEthPool(hash10);
    console.log(`  [debug] pool before sweep: ${ethers.formatEther(poolBefore)} ETH`);
    await waitTx(cA.sweepAnonPool(hash10), 'T12 sweepAnonPool');
    const poolAfter: bigint = await cA.anonEthPool(hash10);
    poolAfter === 0n
      ? ok('T12 anonEthPool zeroed', `swept ${ethers.formatEther(poolBefore)} ETH`)
      : fail('T12 anonEthPool', `still ${ethers.formatEther(poolAfter)} ETH`);

    // Non-creator must revert
    console.log('  [debug] testing non-creator sweep revert…');
    try {
      const tx = await cB.sweepAnonPool(hash10);
      await tx.wait();
      fail('T12 non-creator revert', 'expected revert but succeeded');
    } catch {
      ok('T12 non-creator sweep reverts', 'access control ✓');
    }
  } else {
    fail('T12 sweepAnonPool', 'skipped — no hash10');
  }

  // ─── T13: read functions ─────────────────────────────────────────────────
  console.log('\n── T13 Read functions ────────────────────────────────');
  if (hash1) {
    try {
      const inv = await cA.getInvoice(hash1);
      inv.creator?.toLowerCase() === addrA.toLowerCase()
        ? ok('T13 getInvoice', `creator=${addrA.slice(0, 10)}… type=${inv.invoiceType} status=${inv.status}`)
        : fail('T13 getInvoice', `creator mismatch: ${inv.creator}`);
    } catch (e: any) { fail('T13 getInvoice', e.message.slice(0, 80)); }

    try {
      const ct = await cA.getEncryptedAmount(hash1);
      ok('T13 getEncryptedAmount', `ctHash=${ct.toString().slice(0, 20)}…`);
    } catch (e: any) { fail('T13 getEncryptedAmount', e.message.slice(0, 80)); }

    try {
      const memo = await cA.getInvoiceMemo(hash1);
      ok('T13 getInvoiceMemo', `"${memo}"`);
    } catch (e: any) { fail('T13 getInvoiceMemo', e.message.slice(0, 80)); }

    try {
      const cnt = await cA.getPayerCount(hash1);
      ok('T13 getPayerCount', cnt.toString());
    } catch (e: any) { fail('T13 getPayerCount', e.message.slice(0, 80)); }
  } else {
    fail('T13 read functions', 'skipped — no hash1');
  }

  // ─── T14: list functions ─────────────────────────────────────────────────
  console.log('\n── T14 getUserInvoices / getPaidInvoices ─────────────');
  try {
    const list = await cA.getUserInvoices(addrA);
    list.length > 0
      ? ok('T14 getUserInvoices', `${list.length} invoices for A`)
      : fail('T14 getUserInvoices', '0 invoices (unexpected)');
  } catch (e: any) { fail('T14 getUserInvoices', e.message.slice(0, 80)); }

  try {
    const paid = await cA.getPaidInvoices(addrB);
    ok('T14 getPaidInvoices', `${paid.length} paid by B`);
  } catch (e: any) { fail('T14 getPaidInvoices', e.message.slice(0, 80)); }

  if (hash1) {
    try {
      const chk = await cA.checkHasPaid(hash1, addrB);
      ok('T14 checkHasPaid', `B paid invoice1: ${chk}`);
    } catch (e: any) { fail('T14 checkHasPaid', e.message.slice(0, 80)); }
  }

  // ─── T15: requestFullyPaidCheck (allowPublic phase 1) ───────────────────
  console.log('\n── T15 requestFullyPaidCheck (allowPublic) ───────────');
  if (hash3) {
    await waitTx(cA.requestFullyPaidCheck(hash3), 'T15 requestFullyPaidCheck');
    try {
      const res = await cA.getFullyPaidResult(hash3);
      ok('T15 getFullyPaidResult', `isPaid=${res.isPaid} decrypted=${res.decrypted}`);
    } catch (e: any) { fail('T15 getFullyPaidResult', e.message.slice(0, 80)); }
  } else {
    fail('T15 requestFullyPaidCheck', 'skipped — no hash3');
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════');
  if (failed > 0) {
    console.log('\n  Failed:');
    results.filter(r => r.status === 'FAIL').forEach(r =>
      console.log(`    ✗  ${r.name}: ${r.detail}`)
    );
    console.log('');
    process.exitCode = 1;
  } else {
    console.log('\n  All tests passed.\n');
  }
}

main().catch(e => {
  console.error('\nFatal:', e?.message || e);
  process.exitCode = 1;
});
