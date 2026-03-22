import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Search,
  Plus,
  Repeat,
  Zap,
  Gift,
  History,
  User,
  Settings,
  Shield,
  Code,
  BookOpen,
  ChevronDown,
  Copy,
  LogOut,
  Bell,
  Users
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { useWalletStore } from '../store/useInvoiceStore';
import { useCofhe } from '../hooks/useCofhe';
import { useNotifications } from '../hooks/useNotifications';

interface SidebarItemProps {
  icon: any;
  label: string;
  path: string;
  isActive?: boolean;
  isComingSoon?: boolean;
  badge?: string;
  badgeColor?: string;
}

function SidebarItem({ icon: Icon, label, path, isActive, isComingSoon, badge, badgeColor }: SidebarItemProps) {
  return (
    <Link
      to={isComingSoon ? '#' : path}
      className={`group relative flex items-center justify-between px-4 py-2.5 rounded-xl transition-all duration-300 ${
        isActive
          ? 'bg-primary text-black font-bold'
          : isComingSoon
            ? 'text-text-dim cursor-not-allowed'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'
      }`}
    >
      {isActive && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full"
          transition={{ type: 'spring', stiffness: 350, damping: 30 }}
        />
      )}
      <div className="flex items-center gap-3">
        <Icon className={`w-4 h-4 ${isActive ? 'text-black' : 'text-inherit'}`} />
        <span className="text-sm">{label}</span>
      </div>
      {badge && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${badgeColor || 'bg-surface-3 text-text-muted'}`}>
          {badge}
        </span>
      )}
      {isActive && (
        <motion.div
          layoutId="sidebar-active-glow"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-black rounded-r-full shadow-[0_0_12px_#000]"
        />
      )}
    </Link>
  );
}

interface SidebarSectionProps {
  label: string;
  children: React.ReactNode;
  badge?: string;
}

function SidebarSection({ label, children, badge }: SidebarSectionProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="space-y-1">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2 text-[11px] font-bold text-text-muted uppercase tracking-widest hover:text-text-secondary transition-colors"
      >
        <div className="flex items-center gap-2">
          {label}
          {badge && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
              badge === 'FEATURED' ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'
            }`}>
              {badge}
            </span>
          )}
        </div>
        <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${isOpen ? '' : '-rotate-90'}`} />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden space-y-1"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AppSidebar() {
  const location = useLocation();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { permitActive, permitExpiry } = useWalletStore();
  const { isReady: isFheReady, isConnecting: isFheConnecting } = useCofhe();
  const { unreadCount } = useNotifications();

  return (
    <aside className="w-64 h-screen bg-bg-base border-r border-border-default flex flex-col z-[10001]">
      <div className="p-6">
        <Link to="/" className="flex items-center gap-2 mb-2">
          <img src="/logo.png" alt="CipherPay" className="w-8 h-8 rounded-lg" />
          <span className="text-xl font-bold text-white tracking-tight">CipherPay</span>
        </Link>
        <div className="flex items-center gap-2 px-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Ethereum Sepolia</span>
        </div>
        <div className="flex items-center gap-2 px-2 mt-1">
          <div className={`w-1.5 h-1.5 rounded-full ${isFheReady ? 'bg-blue-500 animate-pulse' : isFheConnecting ? 'bg-yellow-500 animate-pulse' : 'bg-text-dim'}`} />
          <span className={`text-[10px] font-bold uppercase tracking-widest ${isFheReady ? 'text-blue-400' : isFheConnecting ? 'text-yellow-500' : 'text-text-dim'}`}>
            {isFheReady ? 'FHE Ready' : isFheConnecting ? 'FHE Loading...' : 'FHE Standby'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 space-y-6 py-4">
        <SidebarSection label="Main">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" path="/app/dashboard" isActive={location.pathname === '/app/dashboard'} />
          <SidebarItem icon={Plus} label="New Cipher" path="/app/new-cipher" isActive={location.pathname === '/app/new-cipher'} badge="NEW" badgeColor="bg-primary text-black" />
          <SidebarItem icon={Search} label="Explorer" path="/app/explorer" isActive={location.pathname === '/app/explorer'} />
        </SidebarSection>

        <SidebarSection label="Invoices">
          <SidebarItem icon={History} label="Payment Proofs" path="/app/proofs" isActive={location.pathname === '/app/proofs'} />
          <SidebarItem icon={Repeat} label="Recurring" path="/app/recurring" isActive={location.pathname === '/app/recurring'} />
          <SidebarItem icon={Users} label="Shared Invoice" path="/app/shared" isActive={location.pathname === '/app/shared'} />
          <SidebarItem icon={Zap} label="Batch Cipher" path="/app/batch" isComingSoon badge="W3" badgeColor="bg-surface-3 text-text-dim" />
          <SidebarItem icon={Gift} label="Cipher Drop" path="/app/cipher-drop" isComingSoon badge="W3" badgeColor="bg-surface-3 text-text-dim" />
          <SidebarItem icon={Shield} label="Salary Proof" path="/app/compliance/salary" isComingSoon badge="W4" badgeColor="bg-surface-3 text-text-dim" />
          <SidebarItem icon={BookOpen} label="Audit Center" path="/app/compliance/audit" isComingSoon badge="W4" badgeColor="bg-surface-3 text-text-dim" />
        </SidebarSection>

        <SidebarSection label="Account">
          <SidebarItem icon={User} label="My Identity" path="/app/identity" isActive={location.pathname === '/app/identity'} />
          <SidebarItem icon={Settings} label="Settings" path="/app/settings" isActive={location.pathname === '/app/settings'} />
        </SidebarSection>

        <SidebarSection label="More">
          <SidebarItem icon={Code} label="Build" path="/app/build" isActive={location.pathname === '/app/build'} />
          <SidebarItem icon={BookOpen} label="Guide" path="/app/guide" isActive={location.pathname === '/app/guide'} />
        </SidebarSection>
      </div>

      <div className="p-4 border-t border-border-default space-y-4">
        {permitActive ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 rounded-xl" title={`Signed permit expires ${permitExpiry ? new Date(permitExpiry).toLocaleString('en-US') : 'N/A'}`}>
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Permit active</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 bg-surface-2 rounded-xl">
            <div className="w-1.5 h-1.5 rounded-full bg-text-muted" />
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">No permit</span>
          </div>
        )}

        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-surface-2 border border-border-default flex items-center justify-center text-[10px] font-bold">
              {address?.slice(2, 4)}
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-white">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
              <span className="text-[10px] text-text-muted uppercase tracking-widest">Connected</span>
            </div>
          </div>
          <button onClick={() => navigator.clipboard.writeText(address || '')} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-secondary transition-colors">
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={() => disconnect()}
          className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-xl transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Disconnect
        </button>
      </div>
    </aside>
  );
}
