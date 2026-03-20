import { createConfig, http } from 'wagmi';
import { sepolia } from 'viem/chains';
import { injected, metaMask } from 'wagmi/connectors';

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected(), metaMask()],
  transports: {
    [sepolia.id]: http('https://1rpc.io/sepolia'),
  },
});
