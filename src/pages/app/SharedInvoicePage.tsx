import { motion } from 'framer-motion';
import { Users, Plus, CheckCircle, Clock, Copy, QrCode, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { SHARED_INVOICE_ADDRESS } from '../../config/contract';
import { FHENIX_EXPLORER_URL } from '../../config/fhenix';
import { AmountInput } from '../../components/AmountInput';
import { useCofhe } from '../../hooks/useCofhe';
import { parseEther } from 'viem';
import { QRCodeSVG } from 'qrcode.react';

const SHARED_ABI = [
  { name: 'getUserGroups', type: 'function', stateMutability: 'view', inputs: [{ name: '_user', type: 'address' }], outputs: [{ name: '', type: 'bytes32[]' }] },
  { name: 'getGroup', type: 'function', stateMutability: 'view', inputs: [{ name: '_groupHash', type: 'bytes32' }], outputs: [
    { name: 'creator', type: 'address' }, { name: 'participantCount', type: 'uint256' }, { name: 'paidCount', type: 'uint256' },
    { name: 'status', type: 'uint8' }, { name: 'createdAt', type: 'uint256' }, { name: 'memo', type: 'string' },
  ]},
  { name: 'getShare', type: 'function', stateMutability: 'view', inputs: [{ name: '_groupHash', type: 'bytes32' }, { name: '_index', type: 'uint256' }], outputs: [
    { name: 'participant', type: 'address' }, { name: 'paid', type: 'bool' },
  ]},
  { name: 'getMyShareIndex', type: 'function', stateMutability: 'view', inputs: [{ name: '_groupHash', type: 'bytes32' }, { name: '_user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'payShare', type: 'function', stateMutability: 'payable', inputs: [{ name: '_groupHash', type: 'bytes32' }], outputs: [] },
  { name: 'totalGroups', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const;

interface GroupData {
  hash: string;
  creator: string;
  participantCount: number;
  paidCount: number;
  status: number;
  createdAt: number;
  memo: string;
}

export function SharedInvoicePage() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { addToast } = useToastStore();
  const { writeContractAsync } = useWriteContract();
  const [groups, setGroups] = useState<GroupData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'my' | 'create'>('my');
  const [showQR, setShowQR] = useState<string | null>(null);

  // Create form
  const [totalAmount, setTotalAmount] = useState('');
  const [participants, setParticipants] = useState<string[]>(['', '']);
  const [memo, setMemo] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!address || !publicClient) return;
    loadGroups();
  }, [address, publicClient]);

  const loadGroups = async () => {
    if (!address || !publicClient) return;
    setIsLoading(true);
    try {
      const hashes = await publicClient.readContract({
        address: SHARED_INVOICE_ADDRESS, abi: SHARED_ABI as any,
        functionName: 'getUserGroups', args: [address],
      }) as `0x${string}`[];

      const loaded: GroupData[] = [];
      for (const hash of hashes.slice(-20)) {
        try {
          const data = await publicClient.readContract({
            address: SHARED_INVOICE_ADDRESS, abi: SHARED_ABI as any,
            functionName: 'getGroup', args: [hash],
          }) as any[];
          loaded.push({
            hash, creator: data[0], participantCount: Number(data[1]),
            paidCount: Number(data[2]), status: Number(data[3]),
            createdAt: Number(data[4]), memo: data[5],
          });
        } catch {}
      }
      setGroups(loaded.reverse());
    } catch {}
    setIsLoading(false);
  };

  const handlePayShare = async (groupHash: string) => {
    try {
      addToast('info', 'Paying your share...');
      const tx = await writeContractAsync({
        address: SHARED_INVOICE_ADDRESS, abi: SHARED_ABI as any,
        functionName: 'payShare', args: [groupHash as `0x${string}`],
      });
      addToast('success', 'Share paid!');
      loadGroups();
    } catch (err: any) {
      const msg = err.shortMessage || err.message || 'Payment failed';
      if (msg.includes('Already paid')) addToast('warning', 'You already paid your share');
      else if (msg.includes('Not a participant')) addToast('error', 'You are not part of this group');
      else addToast('error', msg.slice(0, 60));
    }
  };

  const addParticipant = () => {
    if (participants.length < 20) setParticipants([...participants, '']);
  };

  const removeParticipant = (i: number) => {
    if (participants.length > 2) setParticipants(participants.filter((_, idx) => idx !== i));
  };

  const getShareUrl = (hash: string) => `${window.location.origin}/shared/${hash}`;

  const statusBadge = (status: number) => {
    if (status === 0) return <span className="text-xs font-bold px-2 py-1 rounded bg-secondary/10 text-secondary border border-secondary/20">OPEN</span>;
    if (status === 1) return <span className="text-xs font-bold px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20">SETTLED</span>;
    return <span className="text-xs font-bold px-2 py-1 rounded bg-surface-3 text-text-dim border border-border-default">CANCELLED</span>;
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Shared Invoice</h1>
        <p className="text-text-secondary">Split bills with encrypted individual shares — each person sees only their own amount</p>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setActiveTab('my')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'my' ? 'bg-primary text-black' : 'bg-surface-2 text-text-secondary hover:text-white'}`}>
          My Groups
        </button>
        <button onClick={() => setActiveTab('create')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'create' ? 'bg-primary text-black' : 'bg-surface-2 text-text-secondary hover:text-white'}`}>
          <Plus className="w-4 h-4 inline mr-1" /> New Group
        </button>
      </div>

      {activeTab === 'my' && (
        isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <Users className="w-16 h-16 text-text-muted mx-auto" />
            <h2 className="text-xl font-bold text-white">No Shared Invoices</h2>
            <p className="text-sm text-text-secondary">Create a group to split a bill with friends or colleagues</p>
            <Button onClick={() => setActiveTab('create')}>Create Group</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <motion.div key={group.hash} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <Users className="w-5 h-5 text-primary" />
                      <p className="text-sm font-mono text-white">{group.hash.slice(0, 12)}...{group.hash.slice(-6)}</p>
                      {statusBadge(group.status)}
                    </div>
                    {group.memo && <p className="text-xs text-text-secondary ml-8">{group.memo}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowQR(group.hash)} className="p-2 rounded-lg bg-surface-2 border border-border-default hover:border-primary/30 text-text-muted hover:text-primary transition-colors">
                      <QrCode className="w-4 h-4" />
                    </button>
                    <button onClick={() => { navigator.clipboard.writeText(getShareUrl(group.hash)); addToast('success', 'Link copied'); }}
                      className="p-2 rounded-lg bg-surface-2 border border-border-default hover:border-primary/30 text-text-muted hover:text-primary transition-colors">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-xs">
                  <div>
                    <span className="text-text-muted">Participants: </span>
                    <span className="text-white font-bold">{group.participantCount}</span>
                  </div>
                  <div>
                    <span className="text-text-muted">Paid: </span>
                    <span className="text-primary font-bold">{group.paidCount}/{group.participantCount}</span>
                  </div>
                  <div>
                    <span className="text-text-muted">Created: </span>
                    <span className="text-text-secondary">{new Date(group.createdAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </div>
                </div>

                <div className="w-full h-2 bg-surface-3 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(group.paidCount / group.participantCount) * 100}%` }}
                    className="h-full bg-primary rounded-full"
                  />
                </div>

                {group.status === 0 && group.creator.toLowerCase() !== address?.toLowerCase() && (
                  <Button size="sm" onClick={() => handlePayShare(group.hash)}>
                    Pay My Share
                  </Button>
                )}
              </motion.div>
            ))}
          </div>
        )
      )}

      {activeTab === 'create' && (
        <div className="bg-surface-1 border border-border-default rounded-[24px] p-8 space-y-6">
          <h2 className="text-lg font-bold text-white">Create Shared Invoice</h2>

          <AmountInput value={totalAmount} onChange={setTotalAmount} label="Total Amount" placeholder="0.1" />

          <div className="space-y-3">
            <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Participants</label>
            {participants.map((addr, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={addr}
                  onChange={(e) => { const n = [...participants]; n[i] = e.target.value; setParticipants(n); }}
                  placeholder={`0x... (participant ${i + 1})`}
                  className="flex-1 h-12 px-4 bg-surface-2 border border-border-default rounded-xl text-sm font-mono text-white focus:border-primary/40 focus:outline-none"
                />
                {participants.length > 2 && (
                  <button onClick={() => removeParticipant(i)} className="px-3 text-red-500 hover:bg-red-500/10 rounded-xl">
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            {participants.length < 20 && (
              <button onClick={addParticipant} className="text-xs text-primary hover:underline">+ Add Participant</button>
            )}
            <p className="text-xs text-text-muted">{participants.length} participants — amount will be split equally (encrypted)</p>
          </div>

          <div>
            <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Memo (optional)</label>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Dinner, project expenses, etc."
              className="w-full h-12 px-4 mt-2 bg-surface-2 border border-border-default rounded-xl text-sm text-white focus:border-primary/40 focus:outline-none" />
          </div>

          <Button className="w-full h-14 text-lg" disabled={!totalAmount || participants.filter(p => p.startsWith('0x')).length < 2 || isCreating}>
            {isCreating ? 'Creating...' : `Split ${totalAmount || '...'} ETH between ${participants.filter(p => p).length} people`}
          </Button>

          <p className="text-xs text-text-dim text-center">Each participant's share is FHE-encrypted — only they can see their own amount</p>
        </div>
      )}

      {/* QR Modal */}
      {showQR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowQR(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-1 border border-border-default rounded-[32px] p-8 max-w-sm w-full mx-4 space-y-6">
            <div className="text-center space-y-2">
              <Users className="w-10 h-10 text-primary mx-auto" />
              <h2 className="text-xl font-bold text-white">Share Group</h2>
              <p className="text-xs text-text-muted">Scan to join and pay your share</p>
            </div>
            <div className="flex justify-center p-6 bg-white rounded-2xl">
              <QRCodeSVG value={getShareUrl(showQR)} size={180} bgColor="white" fgColor="black" level="M" />
            </div>
            <Button className="w-full" onClick={() => { navigator.clipboard.writeText(getShareUrl(showQR)); addToast('success', 'Link copied'); }}>
              <Copy className="w-4 h-4 mr-2" /> Copy Link
            </Button>
            <button onClick={() => setShowQR(null)} className="w-full text-sm text-text-muted hover:text-white py-2">Close</button>
          </motion.div>
        </div>
      )}
    </div>
  );
}
