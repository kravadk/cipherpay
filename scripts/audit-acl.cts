/**
 * ACL audit — fails CI if any contract grants `FHE.allowGlobal` outside
 * the documented allow-list.
 *
 * The only handles that may be globally decryptable are protocol-wide
 * aggregates with no per-user information. Today that's:
 *   - platformVolume
 *   - platformInvoiceCount
 *
 * Run via:  npx tsx scripts/audit-acl.cts
 *
 * Designed to be wired into CI (npm script or GitHub Action).
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const CONTRACTS_DIR = join(__dirname, '..', 'contracts')

// Whitelist: handle name -> reason it is intentionally global.
const ALLOW_GLOBAL_WHITELIST: Record<string, string> = {
  platformVolume: 'protocol-wide TVL aggregate; documented in THREAT_MODEL.md §5',
  platformInvoiceCount: 'protocol-wide invoice counter; documented in THREAT_MODEL.md §5',
}

interface Finding {
  file: string
  line: number
  text: string
  handle: string
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (name.endsWith('.sol')) out.push(p)
  }
  return out
}

function audit(): { violations: Finding[]; allowed: Finding[] } {
  const files = walk(CONTRACTS_DIR)
  const violations: Finding[] = []
  const allowed: Finding[] = []
  // Match: FHE.allowGlobal(<handle>);  — capture the first identifier-ish arg
  const re = /FHE\.allowGlobal\s*\(\s*([A-Za-z_][A-Za-z0-9_\.]*)/g

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const lines = src.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // strip line comments so commented-out grants don't trip the audit
      const code = line.replace(/\/\/.*$/, '')
      let m: RegExpExecArray | null
      re.lastIndex = 0
      while ((m = re.exec(code)) !== null) {
        const handle = m[1]
        const finding: Finding = {
          file: file.replace(CONTRACTS_DIR, 'contracts'),
          line: i + 1,
          text: line.trim(),
          handle,
        }
        if (handle in ALLOW_GLOBAL_WHITELIST) allowed.push(finding)
        else violations.push(finding)
      }
    }
  }

  return { violations, allowed }
}

const { violations, allowed } = audit()

console.log('CipherPay ACL audit')
console.log('===================')
console.log(`Whitelist: ${Object.keys(ALLOW_GLOBAL_WHITELIST).join(', ')}`)
console.log()
console.log(`Allowed FHE.allowGlobal grants: ${allowed.length}`)
for (const f of allowed) {
  console.log(`  ✓ ${f.file}:${f.line}  ${f.handle}`)
}
console.log()

if (violations.length === 0) {
  console.log('✓ No unauthorized FHE.allowGlobal grants found.')
  process.exit(0)
}

console.error(`✗ Found ${violations.length} unauthorized FHE.allowGlobal grant(s):`)
for (const f of violations) {
  console.error(`  ✗ ${f.file}:${f.line}  ${f.handle}`)
  console.error(`      ${f.text}`)
}
console.error()
console.error('Either narrow the grant to a specific address (FHE.allow(handle, addr))')
console.error('or add the handle to ALLOW_GLOBAL_WHITELIST in scripts/audit-acl.cts')
console.error('with a written justification (and update THREAT_MODEL.md).')
process.exit(1)
