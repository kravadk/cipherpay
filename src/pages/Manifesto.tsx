import { motion } from 'framer-motion';
import { Shield, Lock, Globe, Zap, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '../components/Button';
import { Link } from 'react-router-dom';

export function Manifesto() {
  return (
    <div className="max-w-4xl mx-auto space-y-24 py-12">
      <section className="text-center space-y-8">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-6xl md:text-8xl font-bold text-white tracking-tighter"
        >
          Finance should be <br />
          <span className="text-primary">private by default.</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-xl text-text-secondary max-w-2xl mx-auto leading-relaxed"
        >
          The current state of on-chain finance is a surveillance nightmare. Every payment, every balance, and every strategy is exposed to the world. We are here to change that.
        </motion.p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="space-y-6"
        >
          <h2 className="text-4xl font-bold text-white tracking-tight">The Problem</h2>
          <p className="text-text-secondary leading-relaxed">
            Transparent blockchains were a breakthrough for trust, but a failure for privacy. When every transaction is public, you lose your competitive edge, expose your personal wealth, and invite front-running.
          </p>
          <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-4">
            <div className="flex items-center gap-3 text-red-500">
              <Globe className="w-5 h-5" />
              <span className="text-sm font-bold uppercase tracking-widest">Public Exposure</span>
            </div>
            <p className="text-sm text-text-secondary">
              Traditional chains store everything in plaintext. Your competitors, governments, and malicious actors can see every move you make.
            </p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="relative"
        >
          <div className="absolute inset-0 bg-primary/10 blur-[100px] rounded-full" />
          <div className="bg-surface-2 border border-border-default rounded-[40px] p-12 relative z-10 space-y-8">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center">
                <Lock className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-2xl font-bold text-white">The Shift to FHE</h3>
              <p className="text-sm text-text-secondary">
                Fully Homomorphic Encryption allows contracts to compute on encrypted data without ever decrypting it.
              </p>
            </div>
            <div className="h-[1px] bg-border-default w-full" />
            <div className="flex justify-between items-center text-xs font-mono uppercase tracking-widest text-text-muted">
              <span>Plaintext</span>
              <ArrowRight className="w-4 h-4" />
              <span className="text-primary">Ciphertext</span>
            </div>
          </div>
        </motion.div>
      </section>

      <section className="space-y-12">
        <h2 className="text-4xl font-bold text-white text-center tracking-tight">Our Principles</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { 
              title: 'Privacy by Default', 
              desc: 'We don\'t encrypt as an option. We encrypt by default. Every invoice, every amount, every identity.',
              icon: <Lock className="w-6 h-6" />
            },
            { 
              title: 'Selective Transparency', 
              desc: 'You own your data. You decide who gets to see it, for how long, and for what purpose.',
              icon: <Shield className="w-6 h-6" />
            },
            { 
              title: 'Trustless Verification', 
              desc: 'Privacy doesn\'t mean lack of trust. Every transaction is cryptographically verifiable on Fhenix.',
              icon: <Zap className="w-6 h-6" />
            }
          ].map((principle, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="bg-surface-1 border border-border-default rounded-[32px] p-10 space-y-6"
            >
              <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                {principle.icon}
              </div>
              <h3 className="text-xl font-bold text-white">{principle.title}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">{principle.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="space-y-12">
        <h2 className="text-4xl font-bold text-white text-center tracking-tight">Roadmap</h2>
        <div className="relative space-y-12 before:absolute before:left-8 before:top-0 before:bottom-0 before:w-[1px] before:bg-border-default">
          {[
            {
              phase: 'Wave 1 (Current)',
              title: 'Core Protocol + FHE',
              items: ['Standard, Multi Pay, Recurring invoices', 'FHE encryption end-to-end (CoFHE SDK)', 'Real ETH transfers with auto-settle', 'Permit-based Reveal (decryptForView)'],
              active: true
            },
            {
              phase: 'Wave 2',
              title: 'Full FHE + Indexing',
              items: ['Full FHE decryption for all amounts', 'The Graph subgraph for event indexing', 'Encrypted threshold milestones', 'Dual receipt system'],
              active: false
            },
            {
              phase: 'Wave 3',
              title: 'Automation + Distribution',
              items: ['Recurring automation via Chainlink', 'Batch single-tx payments', 'CipherDrop (Merkle airdrop)', 'ReinieraOS cross-chain USDC'],
              active: false
            },
            {
              phase: 'Wave 4-5',
              title: 'Compliance + Production',
              items: ['Audit packages with scoped disclosure', 'Salary Proof (FHE.gte)', 'Multi-chain deployment', 'Merchant SDK'],
              active: false
            }
          ].map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="relative pl-20"
            >
              <div className={`absolute left-6 top-0 w-4 h-4 rounded-full border-2 bg-bg-base z-10 ${
                step.active ? 'border-primary' : 'border-border-default'
              }`}>
                {step.active && <div className="absolute inset-1 rounded-full bg-primary animate-pulse" />}
              </div>
              <div className={`p-8 rounded-[32px] border ${
                step.active ? 'bg-primary/5 border-primary/20' : 'bg-surface-1 border-border-default'
              }`}>
                <p className={`text-xs font-bold uppercase tracking-widest mb-2 ${
                  step.active ? 'text-primary' : 'text-text-muted'
                }`}>{step.phase}</p>
                <h3 className="text-2xl font-bold text-white mb-6">{step.title}</h3>
                <ul className="space-y-3">
                  {step.items.map((item, j) => (
                    <li key={j} className="flex items-center gap-3 text-sm text-text-secondary">
                      <CheckCircle className={`w-4 h-4 ${step.active ? 'text-primary' : 'text-text-muted'}`} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="text-center py-12">
        <Link to="/app/dashboard">
          <Button size="lg">
            Launch CipherPay <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </Link>
      </section>
    </div>
  );
}
