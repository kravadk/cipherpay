import { motion, AnimatePresence } from 'framer-motion';
import { Bell, CheckCircle, XCircle, DollarSign, Unlock, ExternalLink, Check, RefreshCw } from 'lucide-react';
import { Button } from '../../components/Button';
import { useNotifications, Notification } from '../../hooks/useNotifications';
import { FHENIX_EXPLORER_URL } from '../../config/fhenix';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

function NotificationIcon({ type }: { type: Notification['type'] }) {
  switch (type) {
    case 'payment_received':
      return <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-primary" /></div>;
    case 'invoice_settled':
      return <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-blue-500" /></div>;
    case 'invoice_cancelled':
      return <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center"><XCircle className="w-5 h-5 text-red-500" /></div>;
    case 'vesting_unlocked':
      return <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center"><Unlock className="w-5 h-5 text-yellow-500" /></div>;
    default:
      return <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center"><Bell className="w-5 h-5 text-text-muted" /></div>;
  }
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function Notifications() {
  const { notifications, isLoading, unreadCount, markAsRead, markAllAsRead, refetch } = useNotifications();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const filtered = filter === 'unread' ? notifications.filter(n => !n.read) : notifications;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-bold text-white tracking-tight">Notifications</h1>
            {unreadCount > 0 && (
              <span className="px-2.5 py-1 text-xs font-bold bg-primary text-black rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="text-text-secondary">On-chain activity for your invoices</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={handleRefresh}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={markAllAsRead}
            >
              <Check className="w-4 h-4" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {(['all', 'unread'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
              filter === tab
                ? 'bg-primary text-black'
                : 'bg-surface-1 text-text-secondary border border-border-default hover:border-primary/40'
            }`}
          >
            {tab === 'all' ? `All (${notifications.length})` : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>

      {/* Notifications list */}
      <div className="space-y-3">
        {isLoading && notifications.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 bg-surface-1 rounded-2xl border border-border-default animate-pulse" />
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <AnimatePresence mode="popLayout">
            {filtered.map((notif, index) => (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: index * 0.03 }}
                onClick={() => {
                  markAsRead(notif.id);
                  navigate(`/pay/${notif.invoiceHash}`);
                }}
                className={`flex items-start gap-4 p-5 rounded-2xl border cursor-pointer transition-all duration-200 group ${
                  notif.read
                    ? 'bg-surface-1 border-border-default hover:border-border-default/60'
                    : 'bg-surface-1 border-primary/20 hover:border-primary/40'
                }`}
              >
                <NotificationIcon type={notif.type} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`text-sm font-bold ${notif.read ? 'text-text-secondary' : 'text-white'}`}>
                      {notif.title}
                    </h3>
                    {!notif.read && (
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-1 truncate">{notif.message}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[10px] text-text-dim">{formatTimeAgo(notif.timestamp)}</span>
                    <span className="text-[10px] text-text-dim">Block {notif.blockNumber.toString()}</span>
                    {notif.txHash && (
                      <a
                        href={`${FHENIX_EXPLORER_URL}/tx/${notif.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-[10px] text-primary hover:underline flex items-center gap-1"
                      >
                        Etherscan <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>

                <span className="text-[10px] text-text-dim whitespace-nowrap mt-1">
                  {formatTimeAgo(notif.timestamp)}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 bg-surface-1 rounded-2xl border border-border-default">
            <Bell className="w-12 h-12 text-text-dim mb-4" />
            <p className="text-lg font-bold text-text-muted">No notifications</p>
            <p className="text-sm text-text-dim mt-1">
              {filter === 'unread' ? 'All caught up!' : 'Activity will appear here when invoices are paid, settled, or cancelled'}
            </p>
          </div>
        )}
      </div>

      {/* Source info */}
      <div className="flex items-center gap-2 px-2">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-[10px] text-text-dim uppercase tracking-widest">
          Live from Ethereum Sepolia blockchain events
        </span>
      </div>
    </div>
  );
}
