import { motion, useScroll, useTransform } from 'framer-motion';
import { ArrowRight, Shield, Lock, Zap, CheckCircle, XCircle, Github, ExternalLink, Menu, X } from 'lucide-react';
import { Button } from '../components/Button';
import { FloatingMockCard } from '../components/FloatingMockCard';
import { CounterStat } from '../components/CounterStat';
import { HexGrid } from '../components/HexGrid';
import { MagneticButton } from '../components/MagneticButton';
import { Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { WalletModal } from '../components/WalletModal';

// Floating encryption symbols
function FloatingSymbols() {
  const symbols = ['0x', 'FHE', '●●●', 'euint64', 'ZK', 'permit', 'encrypt', '0xf4a...'];
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {symbols.map((sym, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 100 }}
          animate={{
            opacity: [0, 0.15, 0.15, 0],
            y: [100, -200],
            x: [0, (i % 2 === 0 ? 30 : -30)],
          }}
          transition={{
            duration: 8 + i * 2,
            delay: i * 1.5,
            repeat: Infinity,
            ease: 'linear',
          }}
          className="absolute text-primary/20 font-mono text-sm"
          style={{ left: `${10 + i * 12}%`, top: '80%' }}
        >
          {sym}
        </motion.span>
      ))}
    </div>
  );
}

// Typewriter effect
function TypeWriter({ text, delay = 0 }: { text: string; delay?: number }) {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      let i = 0;
      const interval = setInterval(() => {
        setDisplayed(text.slice(0, i + 1));
        i++;
        if (i >= text.length) clearInterval(interval);
      }, 60);
      return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(timer);
  }, [text, delay]);
  return <>{displayed}<motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }} className="text-primary">|</motion.span></>;
}

// Encryption demo animation
function EncryptionDemo() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setPhase(p => (p + 1) % 4), 2000);
    return () => clearInterval(interval);
  }, []);

  const phases = [
    { label: 'Plaintext', value: '0.01 ETH', color: 'text-red-400' },
    { label: 'Encrypting...', value: '░▒▓█●◆▓░▒█', color: 'text-yellow-400' },
    { label: 'Ciphertext', value: '8847291038...', color: 'text-primary' },
    { label: 'On-chain', value: 'euint64 handle', color: 'text-blue-400' },
  ];

  return (
    <div className="flex items-center justify-center gap-4">
      {phases.map((p, i) => (
        <motion.div
          key={i}
          animate={{ scale: phase === i ? 1.05 : 0.95, opacity: phase === i ? 1 : 0.3 }}
          className="text-center space-y-2 px-4"
        >
          <p className="text-xs text-text-muted uppercase tracking-widest">{p.label}</p>
          <p className={`font-mono text-sm font-bold ${p.color}`}>{p.value}</p>
        </motion.div>
      ))}
    </div>
  );
}

export function Home() {
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const { isConnected } = useAccount();
  const navigate = useNavigate();
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const blobY1 = useTransform(scrollYProgress, [0, 1], [0, -150]);
  const blobY2 = useTransform(scrollYProgress, [0, 1], [0, -100]);

  const handleLaunch = () => {
    if (isConnected) {
      navigate('/app/dashboard');
    } else {
      setIsWalletModalOpen(true);
    }
  };

  return (
    <div className="relative">
      <HexGrid />
      <FloatingSymbols />

      {/* Hero Section */}
      <section ref={heroRef} className="relative min-h-[90vh] flex flex-col items-center justify-center px-8 text-center overflow-hidden">
        <div className="absolute inset-0 z-0 pointer-events-none">
          <motion.div style={{ y: blobY1 }} className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
          <motion.div style={{ y: blobY2 }} className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-secondary/10 blur-[120px] rounded-full animate-pulse" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-surface-2 border border-border-default rounded-full mb-8 z-10"
        >
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-bold text-text-secondary uppercase tracking-widest">Now live on Ethereum Sepolia</span>
        </motion.div>

        <div className="text-6xl md:text-8xl font-bold text-white tracking-tighter mb-8 z-10">
          <TypeWriter text="Private Payments." />
          <br />
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5, duration: 0.8 }}
            className="text-text-secondary"
          >
            Verifiable Trust.
          </motion.span>
        </div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2 }}
          className="max-w-2xl text-lg md:text-xl text-text-secondary mb-12 z-10 leading-relaxed"
        >
          Encrypted invoices powered by Fhenix FHE. Create, pay, and settle — without revealing amounts, identities, or strategy.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.3 }}
          className="flex flex-col sm:flex-row gap-4 z-10"
        >
          <MagneticButton>
            <Button size="lg" onClick={handleLaunch}>
              Launch App <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </MagneticButton>
          <Button variant="outline" size="lg" onClick={handleLaunch}>
            Connect Wallet
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.5, duration: 1 }}
          className="mt-24 z-10"
        >
          <FloatingMockCard />
        </motion.div>
      </section>

      {/* Encryption Live Demo */}
      <section className="py-16 px-8 bg-surface-1/50 border-y border-border-default">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mb-8"
          >
            <p className="text-xs font-bold text-primary uppercase tracking-[0.3em] mb-3">Live encryption visualization</p>
            <h3 className="text-2xl font-bold text-white">How Your Payment Disappears</h3>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-black border border-border-default rounded-2xl p-8"
          >
            <EncryptionDemo />
          </motion.div>
        </div>
      </section>

      {/* Etherscan Comparison */}
      <section className="py-24 px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <p className="text-xs font-bold text-primary uppercase tracking-[0.3em] mb-4">Privacy comparison</p>
            <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">What Others See</h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Without CipherPay */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-[#1a0f0f] border border-red-500/20 rounded-[24px] p-8 space-y-4"
            >
              <div className="flex items-center gap-2 mb-4">
                <XCircle className="w-5 h-5 text-red-500" />
                <span className="text-sm font-bold text-red-400">Standard Etherscan View</span>
              </div>
              <div className="bg-black/50 rounded-xl p-5 font-mono text-xs space-y-3">
                <div className="flex justify-between"><span className="text-text-muted">Value:</span><span className="text-red-400 font-bold">0.01 ETH</span></div>
                <div className="flex justify-between"><span className="text-text-muted">From:</span><span className="text-white">0x0E43...3F71</span></div>
                <div className="flex justify-between"><span className="text-text-muted">To:</span><span className="text-white">0x3BBc...197E</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Input:</span><span className="text-red-400">amount=10000000000000000</span></div>
              </div>
              <p className="text-xs text-red-300">Everyone sees exact amount, sender, and recipient</p>
            </motion.div>

            {/* With CipherPay FHE */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-[#0f1a0f] border border-primary/20 rounded-[24px] p-8 space-y-4"
            >
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span className="text-sm font-bold text-primary">CipherPay FHE View</span>
              </div>
              <div className="bg-black/50 rounded-xl p-5 font-mono text-xs space-y-3">
                <div className="flex justify-between"><span className="text-text-muted">Value:</span><span className="text-primary font-bold">0 ETH</span></div>
                <div className="flex justify-between"><span className="text-text-muted">From:</span><span className="text-white">0x0E43...3F71</span></div>
                <div className="flex justify-between"><span className="text-text-muted">To:</span><span className="text-white">0x3965...20eb</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Input:</span><span className="text-primary">ctHash=88472910385...</span></div>
              </div>
              <p className="text-xs text-green-300">Amount encrypted — only ciphertext handle visible</p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="bg-surface-1 border-y border-border-default py-16">
        <div className="max-w-7xl mx-auto px-8 grid grid-cols-1 md:grid-cols-3 gap-12">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center space-y-2">
            <span className="text-5xl font-bold text-white">FHE</span>
            <p className="text-sm text-text-muted uppercase tracking-widest">Fully Homomorphic Encryption</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="text-center space-y-2">
            <span className="text-5xl font-bold text-white">Sepolia</span>
            <p className="text-sm text-text-muted uppercase tracking-widest">Live on Testnet</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }} className="text-center space-y-2">
            <div className="flex items-center justify-center gap-1">
              <CounterStat value={100} className="text-5xl font-bold text-white" />
              <span className="text-5xl font-bold text-white">%</span>
            </div>
            <p className="text-sm text-text-muted uppercase tracking-widest">On-chain Private</p>
          </motion.div>
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
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            className="text-xs font-bold text-primary uppercase tracking-[0.3em] mb-4">How it works</motion.p>
          <h2 className="text-4xl md:text-6xl font-bold text-white tracking-tight mb-6">Why CipherPay Works</h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">Privacy-first architecture where encryption is the default, not an afterthought.</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { title: 'FHE-Encrypted Amounts', desc: 'Invoice amounts stored as euint64 ciphertext on-chain. Even Etherscan shows only a handle — not the value.', icon: <Lock className="w-7 h-7" />, detail: 'FHE.asEuint64()', step: '01', link: '/how-it-works' },
            { title: 'Client-Side ZK Proofs', desc: 'Amounts encrypted in your browser with ZK proof generation. 5-stage pipeline: Init, Keys, Pack, Prove, Verify.', icon: <Shield className="w-7 h-7" />, detail: 'encryptInputs()', active: true, step: '02', link: '/how-it-works' },
            { title: 'Permit-Based Reveal', desc: 'Only authorized parties decrypt via EIP-712 wallet signature. CoFHE Threshold Network ensures no single key holder.', icon: <Zap className="w-7 h-7" />, detail: 'decryptForView()', step: '03', link: '/how-it-works' }
          ].map((feature, i) => (
            <Link to={feature.link} key={i}>
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15, duration: 0.6 }}
              whileHover={{ y: -8, transition: { duration: 0.3 } }}
              className={`p-8 rounded-[28px] border transition-all duration-500 group relative overflow-hidden ${
                feature.active
                  ? 'bg-gradient-to-br from-secondary/90 to-secondary text-white border-secondary/50 shadow-2xl shadow-secondary/20'
                  : 'bg-surface-1 border-border-default hover:border-primary/30'
              }`}
            >
              <span className={`text-[80px] font-bold absolute -top-4 -right-2 leading-none pointer-events-none ${feature.active ? 'text-white/[0.07]' : 'text-white/[0.03]'}`}>{feature.step}</span>
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 ${feature.active ? 'bg-white/15' : 'bg-primary/10'}`}>
                <div className={feature.active ? 'text-white' : 'text-primary'}>{feature.icon}</div>
              </div>
              <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
              <p className={`text-sm leading-relaxed mb-6 ${feature.active ? 'text-white/70' : 'text-text-secondary'}`}>{feature.desc}</p>
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono ${feature.active ? 'bg-white/10 text-white/80' : 'bg-surface-2 text-primary'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${feature.active ? 'bg-white animate-pulse' : 'bg-primary animate-pulse'}`} />
                {feature.detail}
              </div>
              <div className={`absolute bottom-6 right-6 w-9 h-9 rounded-full flex items-center justify-center border transition-all group-hover:rotate-[-45deg] group-hover:scale-110 ${feature.active ? 'border-white/20 text-white' : 'border-border-default text-text-muted group-hover:border-primary/40 group-hover:text-primary'}`}>
                <ArrowRight className="w-4 h-4" />
              </div>
            </motion.div>
            </Link>
          ))}
        </div>

        {/* Encryption pipeline */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="mt-16 p-8 bg-surface-1 border border-border-default rounded-[28px] overflow-hidden">
          <p className="text-xs font-bold text-text-muted uppercase tracking-widest mb-6 text-center">Encryption Pipeline</p>
          <div className="flex items-center justify-between max-w-3xl mx-auto gap-2">
            {['initTfhe', 'fetchKeys', 'pack', 'prove', 'verify'].map((step, i) => (
              <motion.div key={step} initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.15 }} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-2">
                  <motion.div animate={{ boxShadow: ['0 0 0px rgba(183,252,114,0)', '0 0 15px rgba(183,252,114,0.3)', '0 0 0px rgba(183,252,114,0)'] }} transition={{ duration: 2, delay: i * 0.4, repeat: Infinity }}
                    className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <span className="text-primary text-lg font-bold">✓</span>
                  </motion.div>
                  <span className="text-xs font-mono text-text-muted">{step}</span>
                </div>
                {i < 4 && <motion.div initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ delay: 0.5 + i * 0.15, duration: 0.3 }} className="w-6 md:w-12 h-px bg-primary/30 origin-left mb-5" />}
              </motion.div>
            ))}
          </div>
          <p className="text-center text-xs text-text-muted mt-4">~9 seconds · Client-side · ZK proof in Web Worker</p>
        </motion.div>
      </section>

      {/* Built With strip */}
      <section className="py-12 border-y border-border-default overflow-hidden">
        <div className="flex items-center gap-12 animate-marquee whitespace-nowrap">
          {[...Array(2)].map((_, k) => (
            <div key={k} className="flex items-center gap-12 min-w-max">
              {['Fhenix', 'Ethereum', 'CoFHE SDK', 'Wagmi', 'Viem', 'React', 'Solidity', 'TFHE', 'EIP-712', 'Hardhat'].map((tech) => (
                <span key={tech} className="text-text-muted text-sm font-bold uppercase tracking-widest">{tech}</span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Problem / Solution Section */}
      <section className="py-32 px-8 bg-surface-1">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12">
          <motion.div initial={{ opacity: 0, x: -40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
            className="p-12 rounded-[40px] bg-[#1a0f0f] border border-red-500/10">
            <h3 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
              <XCircle className="w-8 h-8 text-red-500" /> Without CipherPay
            </h3>
            <ul className="space-y-6">
              {['Competitors see every invoice you send', 'Wallet balances exposed to front-runners', 'Payroll amounts visible on-chain', 'No selective disclosure for auditors', 'Transaction history permanently public'].map((item, i) => (
                <li key={i} className="flex items-start gap-4 text-text-secondary"><XCircle className="w-5 h-5 text-red-500 shrink-0 mt-1" /><span>{item}</span></li>
              ))}
            </ul>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
            className="p-12 rounded-[40px] bg-[#0f1a0f] border border-primary/20">
            <h3 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-primary" /> With CipherPay
            </h3>
            <ul className="space-y-6">
              {['Amounts encrypted via Fhenix FHE', 'Identities hidden, settlement provable', 'Payroll runs privately, on schedule', 'Auditors see only what you allow', 'Cipher hash — prove it, don\'t reveal it'].map((item, i) => (
                <li key={i} className="flex items-start gap-4 text-white"><CheckCircle className="w-5 h-5 text-primary shrink-0 mt-1" /><span>{item}</span></li>
              ))}
            </ul>
          </motion.div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-32 px-8">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
          className="max-w-5xl mx-auto p-16 rounded-[48px] bg-surface-1 border border-border-default text-center relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
          <p className="text-xs font-bold text-primary uppercase tracking-[0.3em] mb-6">Start encrypting today</p>
          <h2 className="text-5xl md:text-7xl font-bold text-white tracking-tight mb-8">Ready to pay privately?</h2>
          <p className="max-w-xl mx-auto text-text-secondary text-lg mb-12">
            Join the next generation of on-chain finance where your data remains yours.
          </p>
          <div className="flex flex-col items-center gap-6">
            <Button size="lg" onClick={handleLaunch}>
              Launch App <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <p className="text-xs text-text-muted uppercase tracking-widest">
              No account needed · Connect wallet · Start in 60 seconds
            </p>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border-default py-16 px-8 bg-bg-base">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="CipherPay" className="w-8 h-8 rounded-lg" />
              <span className="text-lg font-bold text-white">CipherPay</span>
            </div>
            <p className="text-sm text-text-muted leading-relaxed">Privacy-first invoice protocol powered by Fhenix FHE on Ethereum Sepolia.</p>
          </div>
          <div className="space-y-4">
            <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Protocol</p>
            <div className="space-y-2">
              <a href="https://fhenix.io" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors">Fhenix <ExternalLink className="w-3 h-3" /></a>
              <a href="https://cofhe-docs.fhenix.zone" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors">CoFHE Docs <ExternalLink className="w-3 h-3" /></a>
              <a href="https://sepolia.etherscan.io/address/0x39655b5171577e91AFB57d86a48c6D39D51f20eb" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors">Contract <ExternalLink className="w-3 h-3" /></a>
            </div>
          </div>
          <div className="space-y-4">
            <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Community</p>
            <div className="space-y-2">
              <a href="https://github.com/kravadk/cipherpay" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors"><Github className="w-4 h-4" /> GitHub</a>
              <a href="https://t.me/+rA9gI3AsW8c3YzIx" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors">Telegram <ExternalLink className="w-3 h-3" /></a>
            </div>
          </div>
          <div className="space-y-4">
            <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Resources</p>
            <div className="space-y-2">
              <Link to="/how-it-works" className="block text-sm text-text-secondary hover:text-primary transition-colors">How It Works</Link>
              <Link to="/manifesto" className="block text-sm text-text-secondary hover:text-primary transition-colors">Manifesto</Link>
              <Link to="/app/guide" className="block text-sm text-text-secondary hover:text-primary transition-colors">Guide</Link>
              <Link to="/app/build" className="block text-sm text-text-secondary hover:text-primary transition-colors">Build</Link>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-12 pt-8 border-t border-border-default flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-text-muted">Built with Fhenix FHE for Privacy-by-Design dApp Buildathon</p>
          <div className="flex items-center gap-4">
            <span className="text-xs px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20 font-bold">Fhenix Testnet</span>
            <span className="text-xs px-2 py-1 rounded bg-surface-2 text-text-muted border border-border-default font-bold">Sepolia</span>
          </div>
        </div>
      </footer>

      <WalletModal isOpen={isWalletModalOpen} onClose={() => setIsWalletModalOpen(false)} />

      {/* Marquee animation */}
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 20s linear infinite;
        }
      `}</style>
    </div>
  );
}
