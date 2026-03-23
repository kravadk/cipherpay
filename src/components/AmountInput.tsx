import { useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { useEthPrice } from '../hooks/useEthPrice';

interface AmountInputProps {
  value: string;
  onChange: (ethValue: string) => void;
  label?: string;
  placeholder?: string;
}

export function AmountInput({ value, onChange, label = 'Amount', placeholder = '0.00' }: AmountInputProps) {
  const [inputMode, setInputMode] = useState<'eth' | 'usd'>('eth');
  const [usdInput, setUsdInput] = useState('');
  const { price, loading, ethToUsd, usdToEth } = useEthPrice();

  const handleEthChange = (val: string) => {
    onChange(val);
    if (price && val) {
      setUsdInput((parseFloat(val) * price).toFixed(2));
    } else {
      setUsdInput('');
    }
  };

  const handleUsdChange = (val: string) => {
    setUsdInput(val);
    if (price && val) {
      const eth = parseFloat(val) / price;
      onChange(eth.toFixed(8).replace(/\.?0+$/, ''));
    } else {
      onChange('');
    }
  };

  const toggleMode = () => {
    if (inputMode === 'eth') {
      setInputMode('usd');
      if (value && price) {
        setUsdInput((parseFloat(value) * price).toFixed(2));
      }
    } else {
      setInputMode('eth');
    }
  };

  const ethValue = parseFloat(value || '0');
  const usdValue = ethToUsd(ethValue);

  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-text-muted uppercase tracking-widest">
        {label}
      </label>

      <div className="relative">
        {inputMode === 'eth' ? (
          <input
            type="number"
            placeholder={placeholder}
            min="0.000001"
            step="0.001"
            value={value}
            onChange={(e) => handleEthChange(e.target.value)}
            className="w-full h-14 px-6 pr-24 bg-surface-2 border border-border-default rounded-2xl text-white focus:border-primary/40 focus:outline-none transition-colors"
          />
        ) : (
          <input
            type="number"
            placeholder="0.00"
            min="0.01"
            step="0.01"
            value={usdInput}
            onChange={(e) => handleUsdChange(e.target.value)}
            className="w-full h-14 px-6 pr-24 bg-surface-2 border border-border-default rounded-2xl text-white focus:border-primary/40 focus:outline-none transition-colors"
          />
        )}

        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
          <button
            type="button"
            onClick={toggleMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
              inputMode === 'usd'
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-surface-3 border-border-default text-text-muted hover:border-primary/30 hover:text-primary'
            }`}
            title={`Switch to ${inputMode === 'eth' ? 'USD' : 'ETH'}`}
          >
            <ArrowRightLeft className="w-3 h-3" />
            {inputMode === 'eth' ? 'ETH' : 'USD'}
          </button>
        </div>
      </div>

      {/* Conversion display */}
      {value && price ? (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-text-muted">
            {inputMode === 'eth' ? (
              <>≈ <span className="text-green-400 font-medium">${usdValue?.toFixed(2)}</span> USD</>
            ) : (
              <>≈ <span className="text-primary font-medium">{value}</span> ETH</>
            )}
          </p>
          <p className="text-xs text-text-dim">
            1 ETH = ${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            {loading && ' ↻'}
          </p>
        </div>
      ) : !loading && price ? (
        <p className="text-xs text-text-dim px-1">
          1 ETH ≈ ${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </p>
      ) : null}
    </div>
  );
}
