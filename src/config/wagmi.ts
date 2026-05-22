import { createConfig, http } from 'wagmi';
import { sepolia, arbitrumSepolia } from 'viem/chains';
import { injected, metaMask } from 'wagmi/connectors';

// Ethereum Sepolia hosts the core CipherPay payroll stack.
// Arbitrum Sepolia is used by the Privara settlement page (ReineiraOS escrows).
export const wagmiConfig = createConfig({
  chains: [sepolia, arbitrumSepolia],
  connectors: [injected(), metaMask()],
  transports: {
    [sepolia.id]: http('https://ethereum-sepolia-rpc.publicnode.com'),
    [arbitrumSepolia.id]: http('https://arbitrum-sepolia-rpc.publicnode.com'),
  },
});
