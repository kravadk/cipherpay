# Security

CipherPay is a confidential payroll rail built on Fhenix CoFHE. This document is an
**honest self-audit** of the contracts as deployed on **Ethereum Sepolia (testnet only)**.
It has **not** had a third-party audit — see *Known limitations* below.

For the full adversary model, see [`THREAT_MODEL.md`](./THREAT_MODEL.md).

## Scope

All Solidity in [`contracts/`](./contracts/) — the payroll layers (`BatchCipher`,
`RecurringScheduler`, `SalaryProof`, `AuditCenter`, `DAOTreasury`, `FeeModule`), the
invoicing core (`CipherPayFHE`, `CipherPaySimple`, …), and `PayrollAnchor`.

## Self-review checklist

| Threat class | Status | Notes |
|---|---|---|
| **Reentrancy** | Reviewed | ETH transfers in `CipherPaySimple` / settlement paths follow checks-effects-interactions; state is updated before external `call`. No `delegatecall`. Covered by the Hardhat invariant suite (`test/ShieldedInvariants.test.ts`). |
| **FHE ACL bypass** | Reviewed | Every `FHE.allow*` grant is enumerated and CI-checked by [`scripts/audit-acl.cts`](./scripts/audit-acl.cts). `FHE.allowGlobal` is used only on aggregate handles (`platformVolume`, `platformInvoiceCount`); per-row payouts use scoped `FHE.allow(amount, recipient)`. |
| **Replay — nullifiers** | Reviewed | Anonymous claims and `CipherDrop` use `keccak256`-derived nullifiers checked against an on-chain `used` mapping before state changes. |
| **Replay — decrypt permits** | **Open gap** | The two-phase decrypt pattern (`allowPublic` → `decryptForTx` → `publishDecryptResult`) does not enforce on-chain permit freshness — see *Known limitations*. |
| **Ciphertext-handle collision** | Reviewed | Invoice IDs are `keccak256` of caller-supplied entropy; encrypted handles come from CoFHE and are never reused as map keys. |
| **Integer overflow / underflow** | Reviewed | Solidity 0.8.25 — checked arithmetic by default. FHE arithmetic on `euint*` is bounded by type width; `BatchCipher` caps batches at 100 rows. |
| **Access control** | Reviewed | Creator-only / owner-only functions are `require`-guarded against `msg.sender`. `AuditCenter` grants are field-scoped and time-bounded. |
| **Merkle anchor (`PayrollAnchor`)** | Reviewed | `verify()` uses sorted-pair `keccak256`, matching `src/lib/merkle.ts`. Leaves are invoice hashes only — no amounts or recipients. `anchorRoot` rejects an empty root. |

## Known limitations (disclosed, not hidden)

1. **No third-party audit.** Contracts are testnet-deployed and covered by 67 on-chain E2E
   tests, but have not had an independent security review. Do not use with real funds.
2. **Decrypt-permit freshness.** Two-phase decryption does not check a timestamp/expiry
   on-chain, so an old `publishDecryptResult` proof could in principle be re-submitted.
   *Planned fix:* add an `expiry`/`nonce` parameter to the publish path. Tracked for the
   next iteration.
3. **`msg.value` is visible on L1.** ETH amounts in a payable transaction are always
   visible in the transaction envelope — this is an Ethereum limitation, not solvable by
   FHE. Use the shielded path (`msg.value = 0`) to break amount correlation.
4. **Gas side-channel.** FHE operations have distinguishable gas costs; an observer can
   infer *which* operation ran, though not the encrypted values.
5. **Testnet only.** Fhenix CoFHE is available on Sepolia / Arbitrum Sepolia / Base
   Sepolia testnets. No mainnet deployment exists.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository, or contact the maintainer
listed in the repo. Please do not open public issues for security reports.
