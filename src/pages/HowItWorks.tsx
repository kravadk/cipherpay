import { motion } from 'framer-motion';
import { Shield, Lock, Eye, EyeOff, Globe, Zap, CheckCircle, ArrowRight, ArrowLeft, Loader2, Copy, QrCode } from 'lucide-react';
import { Button } from '../components/Button';
import { Link } from 'react-router-dom';

export function HowItWorks() {
  return (
    <div className="max-w-5xl mx-auto space-y-24 py-12">
      <section className="text-center space-y-8">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-6xl md:text-8xl font-bold text-white tracking-tighter"
        >
          How it <br />
          <span className="text-secondary">actually works.</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-xl text-text-secondary max-w-2xl mx-auto leading-relaxed"
        >
          CipherPay leverages Fhenix FHE (Fully Homomorphic Encryption) to enable computation on encrypted data. No decryption, no exposure.
        </motion.p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          { 
            step: '01', 
            title: 'Encrypt', 
            desc: 'Amount encrypted client-side via CoFHE SDK (TFHE + ZK proof). 5-stage pipeline runs in Web Worker — your browser never sends plaintext.',
            icon: <Lock className="w-8 h-8 text-primary" />
          },
          { 
            step: '02', 
            title: 'Compute', 
            desc: 'CoFHE coprocessor executes FHE operations off-chain — FHE.add() for multi-pay, FHE.gte() for thresholds. Results returned as new ciphertext handles.',
            icon: <Zap className="w-8 h-8 text-secondary" />
          },
          { 
            step: '03', 
            title: 'Settle', 
            desc: 'Real ETH transfers on settlement. Creator and recipient decrypt amounts via EIP-712 permit through CoFHE Threshold Network.',
            icon: <Shield className="w-8 h-8 text-purple-500" />
          }
        ].map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="bg-surface-1 border border-border-default rounded-[32px] p-10 space-y-6 relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 p-8 text-6xl font-bold text-white/5 group-hover:text-primary/10 transition-colors">
              {item.step}
            </div>
            <div className="w-16 h-16 bg-surface-2 rounded-2xl flex items-center justify-center mb-4">
              {item.icon}
            </div>
            <h3 className="text-2xl font-bold text-white">{item.title}</h3>
            <p className="text-sm text-text-secondary leading-relaxed">{item.desc}</p>
          </motion.div>
        ))}
      </section>

      <section className="bg-surface-1 border border-border-default rounded-[48px] p-12 md:p-20 space-y-12 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-secondary/20 via-secondary to-secondary/20" />
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h2 className="text-4xl font-bold text-white tracking-tight">What CipherPay Hides</h2>
          <p className="text-text-secondary">Unlike traditional explorers, CipherPay ensures that only the minimum necessary data is public.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-6">
            <div className="flex items-center gap-3 text-red-500">
              <Globe className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-widest">Public (On-chain)</span>
            </div>
            <div className="bg-surface-2 border border-border-default rounded-2xl p-8 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-secondary">Invoice Hash</span>
                <span className="text-sm font-mono text-white">0x7cef...23e3</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-secondary">Status</span>
                <span className="text-sm font-bold text-primary uppercase tracking-widest">Settled</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-secondary">Block Height</span>
                <span className="text-sm font-mono text-white">10,492,395</span>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-3 text-secondary">
              <Lock className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-widest">Private (Encrypted)</span>
            </div>
            <div className="bg-surface-2 border border-secondary/20 rounded-2xl p-8 space-y-4 relative overflow-hidden">
              <div className="absolute inset-0 bg-secondary/[0.02] pointer-events-none" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-secondary">Amount</span>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-white tracking-widest">••••••</span>
                  <Lock className="w-4 h-4 text-text-muted" />
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-secondary">Recipient</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-white tracking-widest">0x••••••••</span>
                  <Lock className="w-4 h-4 text-text-muted" />
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-secondary">Memo</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white tracking-widest">••••••••</span>
                  <Lock className="w-4 h-4 text-text-muted" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="space-y-8"
        >
          <h2 className="text-4xl font-bold text-white tracking-tight">Selective Disclosure</h2>
          <p className="text-text-secondary leading-relaxed">
            Privacy doesn't mean lack of compliance. CipherPay allows you to generate temporary "Audit Packages" — selective disclosure keys that grant auditors access to specific invoice data for a limited time.
          </p>
          <ul className="space-y-4">
            {[
              'You control the scope of access',
              'Set automatic expiry for audit keys',
              'Revoke access at any time',
              'Cryptographically signed proofs'
            ].map((item, i) => (
              <li key={i} className="flex items-center gap-3 text-white">
                <CheckCircle className="w-5 h-5 text-secondary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Link to="/app/guide">
            <Button variant="outline">
              Read Technical Docs <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="bg-surface-1 border border-border-default rounded-[40px] p-12 space-y-8"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-secondary/10 rounded-2xl flex items-center justify-center">
              <Shield className="w-6 h-6 text-secondary" />
            </div>
            <h3 className="text-xl font-bold text-white">Audit Package #492</h3>
          </div>
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs text-text-muted uppercase tracking-widest">Access Scope</p>
              <div className="flex gap-2">
                <span className="px-3 py-1 bg-secondary/10 text-secondary text-xs font-bold rounded-full border border-secondary/20">Amount</span>
                <span className="px-3 py-1 bg-secondary/10 text-secondary text-xs font-bold rounded-full border border-secondary/20">Recipient</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-text-muted uppercase tracking-widest">Expiry</p>
              <p className="text-sm text-white font-mono">2026-03-20 15:00 UTC</p>
            </div>
            <div className="h-[1px] bg-border-default w-full" />
            <div className="flex justify-between items-center">
              <span className="text-xs text-text-secondary">Status</span>
              <span className="text-xs font-bold text-primary uppercase tracking-widest">Active</span>
            </div>
          </div>
        </motion.div>
      </section>

      <section className="text-center py-12">
        <Link to="/app/build">
          <Button size="lg">
            Start Building with CipherPay <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </Link>
      </section>
    </div>
  );
}
