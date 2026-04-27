const hre = require('hardhat');
const { createCofheConfig, createCofheClient } = require('@cofhe/sdk/node');
const { chains } = require('@cofhe/sdk/chains');
const { Encryptable } = require('@cofhe/sdk');
const { createPublicClient, createWalletClient, http } = require('viem');
const { sepolia } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
const { ethers } = hre;

const RPC  = process.env.SEPOLIA_RPC_URL;
const PK_A = process.env.PRIVATE_KEY as `0x${string}`;
const FEE_MODULE = '0x4AF36795254bdF6aCA52f649468a9D596E7Ef13A';

async function main() {
  const acc = privateKeyToAccount(PK_A);
  const viemPublic  = createPublicClient({ chain: sepolia, transport: http(RPC) });
  const viemWallet  = createWalletClient({ account: acc, chain: sepolia, transport: http(RPC) });
  const cfg  = createCofheConfig({ supportedChains: [chains.sepolia] });
  const cli  = createCofheClient(cfg);
  await cli.connect(viemPublic as any, viemWallet as any);
  console.log('CoFHE connected');

  const res = await cli.encryptInputs([Encryptable.uint64(30n)]).execute();
  const r = res[0];
  console.log('\nResult keys:', Object.keys(r));
  console.log('ctHash:', r?.ctHash?.toString?.() ?? r?.ctHash);
  console.log('utype:', r?.utype);
  console.log('securityZone:', r?.securityZone);
  console.log('signature type:', typeof r?.signature, r?.signature?.length);
  // Check if data is nested
  if (r?.data) {
    console.log('\nNested data keys:', Object.keys(r.data));
    console.log('data.ctHash:', r.data?.ctHash?.toString?.());
  }

  // Now try a real tx with the correct tuple
  const ctHash = BigInt(r?.ctHash ?? r?.data?.ctHash ?? 0);
  console.log('\nFinal ctHash:', ctHash.toString());
  if (ctHash === 0n) {
    console.error('ERROR: ctHash is 0! Encryption failed silently');
    return;
  }

  const tuple = {
    ctHash,
    securityZone: r?.securityZone ?? r?.data?.securityZone ?? 0,
    utype: r?.utype ?? r?.data?.utype ?? 5,
    signature: r?.signature ?? r?.data?.signature ?? '0x',
  };
  console.log('\nTuple to send:', { ctHash: tuple.ctHash.toString(), securityZone: tuple.securityZone, utype: tuple.utype, sigLen: tuple.signature?.length });

  const [walletA] = await ethers.getSigners();
  const c = new ethers.Contract(FEE_MODULE, [
    'function setFeeRate(tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature)) external',
  ], walletA);

  console.log('\nSending setFeeRate...');
  try {
    const tx = await c.setFeeRate(tuple, { gasLimit: 500000 });
    const receipt = await tx.wait();
    console.log('✅ setFeeRate succeeded! tx:', receipt.hash, 'block:', receipt.blockNumber);
  } catch (e: any) {
    console.error('❌ setFeeRate failed:', e?.message?.slice(0, 200));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
