import "@nomicfoundation/hardhat-toolbox"; // Includes ethers, chai-matchers, typechain, verify, etc.
import { HardhatUserConfig, task } from 'hardhat/config';
import { config as dotEnvConfig } from "dotenv";


dotEnvConfig();

const zaddr =
  "0000000000000000000000000000000000000000000000000000000000000000";
// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  etherscan: {
    apiKey: process.env.MAINNET_API_KEY || process.env.API_KEY || "",
    customChains: [
      {
        network: "worldchain",
        chainId: 480,
        urls: {
          apiURL: "https://worldchain-mainnet.explorer.alchemy.com/api",
          browserURL: "https://worldchain-mainnet.explorer.alchemy.com"
        }
      }
    ]
  },
  gasReporter: {
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    currency: 'USD',
  },
  networks: {
    hardhat: {
      chainId: 10, // Use Optimism chainId by default for EIP-712 compatibility
      forking: {
        url: process.env.MAINNET_URL ? process.env.MAINNET_URL : zaddr,
        blockNumber: 14546835,
      },
      mining: {
        auto: true,
      },
    },
    mainnet: {
      url: process.env.MAINNET_URL ? process.env.MAINNET_URL : zaddr,
      accounts: [
        process.env.MAINNET_PRIVATE_KEY
          ? process.env.MAINNET_PRIVATE_KEY
          : zaddr
      ],
      minGasPrice: 32000000000,
    },
    op: {
      url: process.env.OP_URL ? process.env.OP_URL : zaddr,
      accounts: [
        process.env.MAINNET_PRIVATE_KEY
          ? process.env.MAINNET_PRIVATE_KEY
          : zaddr
      ],
      minGasPrice: 32000000000,
      chainId: 10
    },
    worldchain: {
      url: process.env.WORLDCHAIN_URL ? process.env.WORLDCHAIN_URL : zaddr,
      accounts: [
        process.env.MAINNET_PRIVATE_KEY
          ? process.env.MAINNET_PRIVATE_KEY
          : zaddr
      ],
      minGasPrice: 32000000000,
      chainId: 480
    },
    base: {
      url: process.env.BASE_URL ? process.env.BASE_URL : zaddr,
      accounts: [
        process.env.MAINNET_PRIVATE_KEY
          ? process.env.MAINNET_PRIVATE_KEY
          : zaddr
      ],
      chainId: 8453
    },
  },
  solidity: {
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
    version: '0.8.27',
  }
};

export default config
