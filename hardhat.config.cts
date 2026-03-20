import { HardhatUserConfig } from 'hardhat/config'
require('@nomicfoundation/hardhat-ethers')
require('@nomicfoundation/hardhat-chai-matchers')
// Note: @cofhe/hardhat-plugin loaded only for testing (has mock contract compilation issues)
// For production deployment, we compile without it and deploy directly
require('dotenv').config()

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.25',
    settings: {
      evmVersion: 'cancun',
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  defaultNetwork: 'hardhat',
  networks: {
    'eth-sepolia': {
      url: process.env.SEPOLIA_RPC_URL || 'https://1rpc.io/sepolia',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 11155111,
      gasMultiplier: 1.2,
      timeout: 60000,
    },
  },
}

export default config
