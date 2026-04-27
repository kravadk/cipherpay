import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { Terminal, ExternalLink } from 'lucide-react';

interface FheTerminalProps {
  logs: string[];
  /** Show blinking cursor at the end when active */
  active?: boolean;
  /** Max visible height in px (default 140) */
  maxHeight?: number;
  className?: string;
}

const TX_HASH_RE = /\b(0x[0-9a-fA-F]{64})\b/g;

function renderLineWithLinks(line: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TX_HASH_RE.lastIndex = 0;
  while ((match = TX_HASH_RE.exec(line)) !== null) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    const hash = match[1];
    parts.push(
      <a
        key={match.index}
        href={`https://sepolia.etherscan.io/tx/${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline hover:text-primary/80 inline-flex items-center gap-0.5"
      >
        {hash.slice(0, 10)}…{hash.slice(-6)}
        <ExternalLink className="w-2.5 h-2.5 inline" />
      </a>
    );
    last = match.index + hash.length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts.length > 1 ? parts : line;
}

function classifyLine(line: string): { color: string; prefix?: string } {
  if (line.includes('✓') || line.includes('✅')) return { color: 'text-primary' };
  if (line.includes('✗') || line.includes('❌') || line.includes('Error') || line.includes('error'))
    return { color: 'text-red-400' };
  if (line.includes('⚠') || line.includes('Warning')) return { color: 'text-yellow-400' };
  if (line.startsWith('>   ') || line.startsWith('  ')) return { color: 'text-text-muted' };
  return { color: 'text-text-secondary' };
}

export function FheTerminal({ logs, active = false, maxHeight = 140, className = '' }: FheTerminalProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [logs.length]);

  if (logs.length === 0 && !active) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className={`overflow-hidden rounded-xl border border-border-default ${className}`}
    >
      {/* Terminal header bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border-b border-border-default">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-primary/60" />
        </div>
        <div className="flex items-center gap-1.5 ml-1">
          <Terminal className="w-3 h-3 text-text-muted" />
          <span className="text-[10px] font-mono text-text-muted uppercase tracking-widest">FHE</span>
        </div>
        {active && (
          <span className="ml-auto flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[9px] font-bold text-primary uppercase tracking-widest">live</span>
          </span>
        )}
      </div>

      {/* Log body */}
      <div
        className="bg-black/70 font-mono text-[11px] leading-relaxed px-3 py-2 overflow-y-auto no-scrollbar"
        style={{ maxHeight }}
      >
        <AnimatePresence initial={false}>
          {logs.map((line, i) => {
            const { color } = classifyLine(line);
            return (
              <motion.p
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15 }}
                className={`whitespace-pre-wrap break-all ${color}`}
              >
                {renderLineWithLinks(line)}
              </motion.p>
            );
          })}
        </AnimatePresence>

        {/* Blinking cursor */}
        {active && (
          <span className="inline-block w-1.5 h-3.5 bg-primary ml-0.5 align-middle animate-pulse" />
        )}
        <div ref={bottomRef} />
      </div>
    </motion.div>
  );
}
