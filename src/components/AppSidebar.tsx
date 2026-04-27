import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Search, Plus, Repeat, Zap, Gift, History,
  User, Settings, Shield, Code, BookOpen, ChevronDown, Copy,
  LogOut, Users, EyeOff, BarChart2, Target, DollarSign, X,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useState, useCallback } from 'react';
import { useAccount, useDisconnect, useBalance } from 'wagmi';
import { RefreshCw } from 'lucide-react';
import { useWalletStore } from '../store/useInvoiceStore';
import { useNotifications } from '../hooks/useNotifications';

function BalanceDisplay() {
  const { address } = useAccount();
  const { data: balanceData, refetch } = useBalance({ address });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const formatted = balanceData
    ? (Number(balanceData.value) / 10 ** balanceData.decimals).toFixed(4)
    : '—';

  return (
    <div className="flex items-center justify-between px-3 py-2.5 bg-surface-2 rounded-xl border border-border-default hover:border-border-active/40 transition-all duration-300">
      <div className="flex items-center gap-2">
        <motion.span
          key={formatted}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-sm font-bold text-primary tabular-nums"
        >
          {formatted}
        </motion.span>
        <span className="text-xs text-text-muted">{balanceData?.symbol || 'ETH'}</span>
      </div>
      <button
        onClick={handleRefresh}
        aria-label="Refresh balance"
        className="p-1 rounded-lg hover:bg-surface-3 text-text-muted hover:text-primary transition-all duration-200"
      >
        <RefreshCw className={`w-3.5 h-3.5 transition-transform duration-500 ${isRefreshing ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}

interface SidebarItemProps {
  icon: any;
  label: string;
  path: string;
  isActive?: boolean;
  isComingSoon?: boolean;
  badge?: string;
  badgeColor?: string;
  onNavigate?: () => void;
}

function SidebarItem({ icon: Icon, label, path, isActive, isComingSoon, badge, badgeColor, onNavigate }: SidebarItemProps) {
  return (
    <Link
      to={isComingSoon ? '#' : path}
      onClick={onNavigate}
      className={`group relative flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all duration-200 ${
        isActive
          ? 'bg-primary text-black font-bold shadow-[0_0_16px_rgba(183,252,114,0.2)]'
          : isComingSoon
            ? 'text-text-dim cursor-not-allowed pointer-events-none'
            : 'text-text-secondary hover:text-white hover:bg-surface-2 hover:translate-x-0.5'
      }`}
    >
      {/* Active left indicator */}
      {isActive && (
        <motion.div
          layoutId="sidebar-active-bar"
          className="absolute -left-4 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full"
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        />
      )}

      <div className="flex items-center gap-3 min-w-0">
        <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-black' : 'text-inherit group-hover:text-primary/80'}`} />
        <span className="text-[13px] truncate leading-none">{label}</span>
      </div>

      {badge && (
        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${badgeColor || 'bg-surface-3 text-text-muted'}`}>
          {badge}
        </span>
      )}
    </Link>
  );
}

interface SidebarSectionProps {
  label: string;
  children: React.ReactNode;
  badge?: string;
  defaultOpen?: boolean;
}

function SidebarSection({ label, children, badge, defaultOpen = true }: SidebarSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center justify-between px-3.5 py-1.5 text-[10px] font-bold text-text-dim uppercase tracking-widest hover:text-text-muted transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2">
          {label}
          {badge && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
              badge === 'FEATURED' ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'
            }`}>
              {badge}
            </span>
          )}
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 0 : -90 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        >
          <ChevronDown className="w-3 h-3" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden space-y-0.5 pl-1"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const getRelativeTime = (timestamp: number) => {
  const diff = timestamp - Date.now() / 1000;
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3600);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h left`;
  return `${Math.floor(diff / 60)}m left`;
};

interface AppSidebarProps {
  onClose?: () => void;
}

export function AppSidebar({ onClose }: AppSidebarProps) {
  const location = useLocation();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { permitActive, permitExpiry } = useWalletStore();
  const { unreadCount } = useNotifications();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(address || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [address]);

  const isAt = (path: string) => location.pathname === path;
  const nav = onClose;

  return (
    <aside className="w-64 h-screen bg-bg-base border-r border-border-default flex flex-col select-none">
      {/* Logo */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 group" onClick={nav}>
          <img src="/logo.png" alt="CipherPay" className="w-8 h-8 rounded-xl group-hover:scale-105 transition-transform duration-200" />
          <span className="text-[17px] font-extrabold text-white tracking-tight">CipherPay</span>
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="p-1.5 rounded-lg text-text-muted hover:text-white hover:bg-surface-2 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4 no-scrollbar">
        <SidebarSection label="Main">
          <SidebarItem icon={Plus} label="Create Invoice" path="/app/new-cipher" isActive={isAt('/app/new-cipher')} badge="NEW" badgeColor="bg-primary/15 text-primary" onNavigate={nav} />
          <SidebarItem icon={LayoutDashboard} label="Dashboard" path="/app/dashboard" isActive={isAt('/app/dashboard')} onNavigate={nav} />
          <SidebarItem icon={Search} label="Explorer" path="/app/explorer" isActive={isAt('/app/explorer')} onNavigate={nav} />
        </SidebarSection>

        <SidebarSection label="Privacy" badge="FEATURED">
          <SidebarItem icon={EyeOff} label="Anon Claim" path="/app/anon-claim" isActive={isAt('/app/anon-claim')} onNavigate={nav} />
          <SidebarItem icon={Zap} label="Batch Cipher" path="/app/batch" isActive={isAt('/app/batch')} badge="W3" badgeColor="bg-blue-500/15 text-blue-400" onNavigate={nav} />
          <SidebarItem icon={Gift} label="Cipher Drop" path="/app/cipher-drop" isActive={isAt('/app/cipher-drop')} badge="W3" badgeColor="bg-blue-500/15 text-blue-400" onNavigate={nav} />
          <SidebarItem icon={Target} label="Milestone" path="/app/milestone-escrow" isActive={isAt('/app/milestone-escrow')} badge="W3" badgeColor="bg-blue-500/15 text-blue-400" onNavigate={nav} />
          <SidebarItem icon={Repeat} label="FHE Recurring" path="/app/recurring-scheduler" isActive={isAt('/app/recurring-scheduler')} badge="W3" badgeColor="bg-blue-500/15 text-blue-400" onNavigate={nav} />
        </SidebarSection>

        <SidebarSection label="Compliance">
          <SidebarItem icon={Shield} label="Salary Proof" path="/app/salary-proof" isActive={isAt('/app/salary-proof')} badge="W4" badgeColor="bg-purple-500/15 text-purple-400" onNavigate={nav} />
          <SidebarItem icon={BookOpen} label="Audit Center" path="/app/audit-center" isActive={isAt('/app/audit-center')} badge="W4" badgeColor="bg-purple-500/15 text-purple-400" onNavigate={nav} />
          <SidebarItem icon={Users} label="DAO Treasury" path="/app/dao-treasury" isActive={isAt('/app/dao-treasury')} badge="W4" badgeColor="bg-purple-500/15 text-purple-400" onNavigate={nav} />
          <SidebarItem icon={BarChart2} label="Privacy Analytics" path="/app/privacy-analytics" isActive={isAt('/app/privacy-analytics')} badge="W5" badgeColor="bg-yellow-500/15 text-yellow-400" onNavigate={nav} />
          <SidebarItem icon={DollarSign} label="Fee Module" path="/app/fee-module" isActive={isAt('/app/fee-module')} badge="W5" badgeColor="bg-yellow-500/15 text-yellow-400" onNavigate={nav} />
        </SidebarSection>

        <SidebarSection label="Advanced" defaultOpen={false}>
          <SidebarItem icon={History} label="Payment Proofs" path="/app/proofs" isActive={isAt('/app/proofs')} onNavigate={nav} />
          <SidebarItem icon={Repeat} label="Recurring" path="/app/recurring" isActive={isAt('/app/recurring')} onNavigate={nav} />
          <SidebarItem icon={Users} label="Shared Invoice" path="/app/shared" isActive={isAt('/app/shared')} onNavigate={nav} />
          <SidebarItem icon={User} label="My Identity" path="/app/identity" isActive={isAt('/app/identity')} onNavigate={nav} />
          <SidebarItem icon={Settings} label="Settings" path="/app/settings" isActive={isAt('/app/settings')} onNavigate={nav} />
          <SidebarItem icon={Code} label="Build" path="/app/build" isActive={isAt('/app/build')} onNavigate={nav} />
          <SidebarItem icon={BookOpen} label="Guide" path="/app/guide" isActive={isAt('/app/guide')} onNavigate={nav} />
        </SidebarSection>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border-default space-y-3">
        <BalanceDisplay />

        {/* Permit indicator */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-colors ${
          permitActive ? 'bg-primary/6 border border-primary/15' : 'bg-surface-2'
        }`}>
          <span className={`relative flex w-2 h-2 shrink-0 ${permitActive ? 'text-primary' : 'text-text-muted'}`}>
            {permitActive && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-40" />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${permitActive ? 'bg-primary' : 'bg-text-muted/40'}`} />
          </span>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${permitActive ? 'text-primary' : 'text-text-muted'}`}>
            {permitActive ? 'Permit active' : 'No permit'}
          </span>
          {permitActive && permitExpiry && (
            <span className="text-[10px] text-primary/50 ml-auto">{getRelativeTime(permitExpiry / 1000)}</span>
          )}
        </div>

        {/* Account row */}
        <div className="flex items-center justify-between px-1 gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 shrink-0 rounded-full bg-gradient-to-br from-primary/30 to-secondary/30 border border-border-default flex items-center justify-center text-[10px] font-bold text-white">
              {address?.slice(2, 4)?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">{address?.slice(0, 6)}…{address?.slice(-4)}</p>
              <p className="text-[10px] text-text-muted uppercase tracking-wider">Connected</p>
            </div>
          </div>

          <button
            onClick={handleCopy}
            aria-label="Copy address"
            className="shrink-0 p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-primary transition-all duration-200"
          >
            <AnimatePresence mode="wait" initial={false}>
              {copied ? (
                <motion.span key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="block w-3.5 h-3.5 text-primary text-[10px] font-bold">✓</motion.span>
              ) : (
                <motion.div key="copy" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                  <Copy className="w-3.5 h-3.5" />
                </motion.div>
              )}
            </AnimatePresence>
          </button>
        </div>

        <button
          onClick={() => { disconnect(); onClose?.(); }}
          className="w-full flex items-center justify-center gap-2 py-2 text-[11px] font-bold text-red-500/70 hover:text-red-400 hover:bg-red-500/8 rounded-xl transition-all duration-200"
        >
          <LogOut className="w-3.5 h-3.5" />
          Disconnect
        </button>
      </div>
    </aside>
  );
}
