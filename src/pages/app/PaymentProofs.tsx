import { motion } from 'framer-motion';
import { FileCheck, Copy, QrCode, ExternalLink, Download, Share2, Eye, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { PAYMENT_PROOF_ADDRESS, CIPHERPAY_SIMPLE_ADDRESS } from '../../config/contract';
import { FHENIX_EXPLORER_URL } from '../../config/fhenix';
import { formatEther } from 'viem';
import { QRCodeSVG } from 'qrcode.react';

const PROOF_ABI = [
  { name: 'getUserProofs', type: 'function', stateMutability: 'view', inputs: [{ name: '_user', type: 'address' }], outputs: [{ name: '', type: 'bytes32[]' }] },
  { name: 'getProof', type: 'function', stateMutability: 'view', inputs: [{ name: '_proofHash', type: 'bytes32' }], outputs: [
    { name: 'invoiceHash', type: 'bytes32' }, { name: 'payer', type: 'address' }, { name: 'creator', type: 'address' },
    { name: 'timestamp', type: 'uint256' }, { name: 'blockNumber', type: 'uint256' },
  ]},
  { name: 'totalProofs', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const;

interface ProofData {
  hash: string;
  invoiceHash: string;
  payer: string;
  creator: string;
  timestamp: number;
  blockNumber: number;
}

export function PaymentProofs() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { addToast } = useToastStore();
  const [proofs, setProofs] = useState<ProofData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProof, setSelectedProof] = useState<ProofData | null>(null);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    if (!address || !publicClient) return;
    loadProofs();
  }, [address, publicClient]);

  const loadProofs = async () => {
    if (!address || !publicClient) return;
    setIsLoading(true);
    try {
      const hashes = await publicClient.readContract({
        address: PAYMENT_PROOF_ADDRESS, abi: PROOF_ABI as any,
        functionName: 'getUserProofs', args: [address],
      }) as `0x${string}`[];

      const loaded: ProofData[] = [];
      for (const hash of hashes.slice(-20)) { // last 20
        try {
          const data = await publicClient.readContract({
            address: PAYMENT_PROOF_ADDRESS, abi: PROOF_ABI as any,
            functionName: 'getProof', args: [hash],
          }) as any[];
          loaded.push({
            hash: hash,
            invoiceHash: data[0],
            payer: data[1],
            creator: data[2],
            timestamp: Number(data[3]),
            blockNumber: Number(data[4]),
          });
        } catch {}
      }
      setProofs(loaded.reverse());
    } catch {
      // Contract may not have proofs yet
    }
    setIsLoading(false);
  };

  const getProofUrl = (proofHash: string) => `${window.location.origin}/proof/${proofHash}`;

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    addToast('success', `${label} copied`);
  };

  const isPayer = (proof: ProofData) => proof.payer.toLowerCase() === address?.toLowerCase();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-white tracking-tight">Payment Proofs</h1>
          <p className="text-text-secondary">On-chain receipts for every payment — share via QR or link</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{proofs.length} proofs</span>
          <Button variant="outline" size="sm" onClick={loadProofs}>Refresh</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : proofs.length === 0 ? (
        <div className="text-center py-20 space-y-4">
          <FileCheck className="w-16 h-16 text-text-muted mx-auto" />
          <h2 className="text-xl font-bold text-white">No Payment Proofs Yet</h2>
          <p className="text-sm text-text-secondary max-w-md mx-auto">
            Payment proofs are automatically generated when invoices are paid.
            Create and pay an invoice to see your first proof here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {proofs.map((proof) => (
            <motion.div
              key={proof.hash}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-surface-1 border border-border-default rounded-2xl p-6 hover:border-primary/20 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-3 flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <FileCheck className="w-5 h-5 text-primary flex-shrink-0" />
                    <div>
                      <p className="text-xs text-text-muted">PROOF</p>
                      <p className="text-sm font-mono text-white truncate">{proof.hash.slice(0, 16)}...{proof.hash.slice(-8)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div>
                      <p className="text-text-muted uppercase tracking-widest mb-1">Role</p>
                      <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                        isPayer(proof) ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-primary/10 text-primary border border-primary/20'
                      }`}>
                        {isPayer(proof) ? 'PAYER' : 'CREATOR'}
                      </span>
                    </div>
                    <div>
                      <p className="text-text-muted uppercase tracking-widest mb-1">Invoice</p>
                      <p className="font-mono text-text-secondary">{proof.invoiceHash.slice(0, 10)}...</p>
                    </div>
                    <div>
                      <p className="text-text-muted uppercase tracking-widest mb-1">Date</p>
                      <p className="text-text-secondary">{new Date(proof.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    </div>
                    <div>
                      <p className="text-text-muted uppercase tracking-widest mb-1">Block</p>
                      <p className="font-mono text-text-secondary">{proof.blockNumber.toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-text-muted">{isPayer(proof) ? 'Paid to' : 'Received from'}:</span>
                    <span className="font-mono text-text-secondary">
                      {(isPayer(proof) ? proof.creator : proof.payer).slice(0, 8)}...{(isPayer(proof) ? proof.creator : proof.payer).slice(-6)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 flex-shrink-0">
                  <button onClick={() => { setSelectedProof(proof); setShowQR(true); }}
                    className="p-2 rounded-lg bg-surface-2 border border-border-default hover:border-primary/30 text-text-muted hover:text-primary transition-colors"
                    title="Show QR">
                    <QrCode className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleCopy(getProofUrl(proof.hash), 'Proof link')}
                    className="p-2 rounded-lg bg-surface-2 border border-border-default hover:border-primary/30 text-text-muted hover:text-primary transition-colors"
                    title="Copy link">
                    <Copy className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleCopy(proof.hash, 'Proof hash')}
                    className="p-2 rounded-lg bg-surface-2 border border-border-default hover:border-primary/30 text-text-muted hover:text-primary transition-colors"
                    title="Copy hash">
                    <Share2 className="w-4 h-4" />
                  </button>
                  <a href={`${FHENIX_EXPLORER_URL}/tx/${proof.hash}`} target="_blank" rel="noopener noreferrer"
                    className="p-2 rounded-lg bg-surface-2 border border-border-default hover:border-primary/30 text-text-muted hover:text-primary transition-colors"
                    title="View on Etherscan">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* QR Modal */}
      {showQR && selectedProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowQR(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-1 border border-border-default rounded-[32px] p-8 max-w-md w-full mx-4 space-y-6"
          >
            <div className="text-center space-y-2">
              <FileCheck className="w-10 h-10 text-primary mx-auto" />
              <h2 className="text-xl font-bold text-white">Payment Proof</h2>
              <p className="text-xs text-text-muted">Scan to verify this payment on-chain</p>
            </div>

            <div className="flex justify-center p-6 bg-white rounded-2xl">
              <QRCodeSVG
                value={getProofUrl(selectedProof.hash)}
                size={200}
                bgColor="white"
                fgColor="black"
                level="M"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Proof Hash</span>
                <span className="font-mono text-text-secondary">{selectedProof.hash.slice(0, 12)}...{selectedProof.hash.slice(-6)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Invoice</span>
                <span className="font-mono text-text-secondary">{selectedProof.invoiceHash.slice(0, 12)}...</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Date</span>
                <span className="text-text-secondary">{new Date(selectedProof.timestamp * 1000).toLocaleString('en-US')}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Block</span>
                <span className="font-mono text-text-secondary">{selectedProof.blockNumber.toLocaleString()}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <Button className="flex-1" onClick={() => handleCopy(getProofUrl(selectedProof.hash), 'Proof link')}>
                <Copy className="w-4 h-4 mr-2" /> Copy Link
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => handleCopy(selectedProof.hash, 'Proof hash')}>
                <Share2 className="w-4 h-4 mr-2" /> Copy Hash
              </Button>
            </div>

            <button onClick={() => setShowQR(false)} className="w-full text-sm text-text-muted hover:text-white transition-colors py-2">
              Close
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
}
