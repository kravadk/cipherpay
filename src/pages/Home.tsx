import { motion } from 'framer-motion';
import { ArrowRight, Shield, Lock, Zap, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '../components/Button';
import { FloatingMockCard } from '../components/FloatingMockCard';
import { CounterStat } from '../components/CounterStat';
import { HexGrid } from '../components/HexGrid';
import { MagneticButton } from '../components/MagneticButton';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { WalletModal } from '../components/WalletModal';

export function Home() {
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  return (
    <div className="relative">
      <HexGrid />
      
      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex flex-col items-center justify-center px-8 text-center overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8 }}
          className="absolute inset-0 z-0 pointer-events-none"
        >
          <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-secondary/10 blur-[120px] rounded-full animate-pulse delay-1000" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-surface-2 border border-border-default rounded-full mb-8 z-10"
        >
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-bold text-text-secondary uppercase tracking-widest">Now live on Ethereum Sepolia</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-6xl md:text-8xl font-bold text-white tracking-tighter mb-8 z-10"
        >
          Private Payments.<br />
          <span className="text-text-secondary">Verifiable Trust.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="max-w-2xl text-lg md:text-xl text-text-secondary mb-12 z-10 leading-relaxed"
        >
          Encrypted invoices powered by Fhenix FHE. Create, pay, and settle — without revealing amounts, identities, or strategy.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex flex-col sm:flex-row gap-4 z-10"
        >
          <MagneticButton>
            <Button size="lg" onClick={() => setIsWalletModalOpen(true)}>
              Launch App <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </MagneticButton>
          <Button variant="outline" size="lg" onClick={() => setIsWalletModalOpen(true)}>
            Connect Wallet
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 1 }}
          className="mt-24 z-10"
        >
          <FloatingMockCard />
        </motion.div>
      </section>

      {/* Stats Bar */}
      <section className="bg-surface-1 border-y border-border-default py-16">
        <div className="max-w-7xl mx-auto px-8 grid grid-cols-1 md:grid-cols-3 gap-12">
          <div className="text-center space-y-2">
            <span className="text-5xl font-bold text-white">FHE</span>
            <p className="text-sm text-text-muted uppercase tracking-widest">Fully Homomorphic Encryption</p>
          </div>
          <div className="text-center space-y-2">
            <span className="text-5xl font-bold text-white">Sepolia</span>
            <p className="text-sm text-text-muted uppercase tracking-widest">Live on Testnet</p>
          </div>
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-1">
              <CounterStat value={100} className="text-5xl font-bold text-white" />
              <span className="text-5xl font-bold text-white">%</span>
            </div>
            <p className="text-sm text-text-muted uppercase tracking-widest">On-chain Private</p>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-32 px-8 max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4">Why CipherPay Works</h2>
          <p className="text-text-secondary">The next generation of on-chain finance where your data remains yours.</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { 
              title: 'Fully Encrypted', 
              desc: 'Amounts, addresses, and memo hidden via Fhenix FHE. Data is encrypted before it reaches the chain.', 
              icon: <Lock className="w-8 h-8" /> 
            },
            { 
              title: 'Zero-Knowledge Proofs', 
              desc: 'Prove payment and settlement without revealing sensitive details. Cryptographic trust without exposure.', 
              icon: <Shield className="w-8 h-8" />,
              active: true
            },
            { 
              title: 'Selective Disclosure', 
              desc: 'Share specific invoice data only with trusted auditors. You control the scope and duration of access.', 
              icon: <Zap className="w-8 h-8" /> 
            }
          ].map((feature, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`p-10 rounded-[32px] border border-border-default transition-all duration-500 group relative overflow-hidden ${
                feature.active ? 'bg-secondary text-white border-secondary' : 'bg-surface-1 hover:bg-surface-2'
              }`}
            >
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-8 ${
                feature.active ? 'bg-white/10' : 'bg-primary/10'
              }`}>
                <div className={feature.active ? 'text-white' : 'text-primary'}>
                  {feature.icon}
                </div>
              </div>
              <h3 className="text-2xl font-bold mb-4">{feature.title}</h3>
              <p className={feature.active ? 'text-white/70' : 'text-text-secondary'}>{feature.desc}</p>
              <div className={`absolute bottom-8 right-8 w-10 h-10 rounded-full flex items-center justify-center border transition-transform group-hover:rotate-[-45deg] ${
                feature.active ? 'border-white/20 text-white' : 'border-border-default text-text-secondary'
              }`}>
                <ArrowRight className="w-5 h-5" />
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Problem / Solution Section */}
      <section className="py-32 px-8 bg-surface-1">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12">
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="p-12 rounded-[40px] bg-[#1a0f0f] border border-red-500/10"
          >
            <h3 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
              <span className="text-red-500">😰</span> Without CipherPay
            </h3>
            <ul className="space-y-6">
              {[
                'Competitors see every invoice you send',
                'Wallet balances exposed to front-runners',
                'Payroll amounts visible on-chain',
                'No selective disclosure for auditors',
                'Transaction history permanently public'
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-4 text-text-secondary">
                  <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-1" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="p-12 rounded-[40px] bg-[#0f1a0f] border border-primary/20"
          >
            <h3 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
              <span className="text-primary">✓</span> With CipherPay
            </h3>
            <ul className="space-y-6">
              {[
                'Amounts encrypted via Fhenix FHE',
                'Identities hidden, settlement provable',
                'Payroll runs privately, on schedule',
                'Auditors see only what you allow',
                'Cipher hash — prove it, don\'t reveal it'
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-4 text-white">
                  <CheckCircle className="w-5 h-5 text-primary shrink-0 mt-1" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-32 px-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="max-w-5xl mx-auto p-16 rounded-[48px] bg-surface-1 border border-border-default text-center relative overflow-hidden group"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
          <p className="text-xs font-bold text-primary uppercase tracking-[0.3em] mb-6">Start encrypting today</p>
          <h2 className="text-5xl md:text-7xl font-bold text-white tracking-tight mb-8">Ready to pay privately?</h2>
          <p className="max-w-xl mx-auto text-text-secondary text-lg mb-12">
            Join the next generation of on-chain finance where your data remains yours.
          </p>
          <div className="flex flex-col items-center gap-6">
            <Button size="lg" onClick={() => setIsWalletModalOpen(true)}>
              Launch App <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <p className="text-xs text-text-muted uppercase tracking-widest">
              No account needed · Connect wallet · Start in 60 seconds
            </p>
          </div>
        </motion.div>
      </section>

      <WalletModal isOpen={isWalletModalOpen} onClose={() => setIsWalletModalOpen(false)} />
    </div>
  );
}
