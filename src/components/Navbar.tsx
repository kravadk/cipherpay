import { motion } from 'framer-motion';
import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Button } from './Button';
import { useAccount, useDisconnect } from 'wagmi';
import { WalletModal } from './WalletModal';

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 80);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Manifesto', path: '/manifesto' },
    { name: 'How It Works', path: '/how-it-works' },
  ];

  return (
    <>
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className={`fixed top-0 left-0 right-0 z-[9999] h-20 flex items-center justify-between px-8 md:px-16 transition-all duration-300 ${
          isScrolled ? 'bg-bg-base/90 backdrop-blur-xl border-b border-border-default' : 'bg-transparent'
        }`}
      >
        <Link to="/" className="flex items-center gap-2 group">
          <img src="/logo.png" alt="CipherPay" className="w-8 h-8 rounded-lg group-hover:scale-110 transition-transform duration-300" />
          <span className="text-xl font-bold text-white tracking-tight">CipherPay</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.name}
              to={link.path}
              className={`relative px-4 py-2 text-sm font-medium transition-colors ${
                location.pathname === link.path ? 'text-white' : 'text-text-secondary hover:text-white'
              }`}
            >
              {location.pathname === link.path && (
                <motion.div
                  layoutId="nav-pill"
                  className="absolute inset-0 bg-surface-2 rounded-full -z-10"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
              {link.name}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-4">
          {isConnected ? (
            <div className="flex items-center gap-3">
              <Link to="/app/dashboard" className="px-4 py-2 bg-surface-2 border border-border-default rounded-full text-xs font-mono text-text-secondary hover:border-primary/40 transition-colors">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </Link>
              <Button variant="ghost" size="sm" onClick={() => disconnect()}>
                Disconnect
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setIsWalletModalOpen(true)}>
              Connect Wallet
            </Button>
          )}
        </div>
      </motion.nav>

      <WalletModal isOpen={isWalletModalOpen} onClose={() => setIsWalletModalOpen(false)} />
    </>
  );
}
