import "@nomicfoundation/hardhat-toolbox"; // Includes ethers, chai-matchers, typechain, verify, etc.
import { HardhatUserConfig, task } from 'hardhat/config';
import { config as dotEnvConfig } from "dotenv";


dotEnvConfig();
// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
/**
task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  const accounts = await hre.viem.getWalletClients();

  for (const account of accounts) {
    // eslint-disable-next-line no-console
    console.log(await account.getAddresses());
  }
});

task("check-viem", "Check if hre.viem is available").setAction(async (hre) => {
  console.log("hre.viem exists?", !!hre.viem);
  if (hre.viem) {
    const clients = await hre.viem.getWalletClients();
    console.log("Wallets:", clients.length);
  }
});

console.log("PLUGIN LOADED: ", !!viem); // Should print true

 */

const zaddr =
  "0000000000000000000000000000000000000000000000000000000000000000";
// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  etherscan: {
    apiKey: {
      mainnet: process.env.API_KEY!,
      goerli: process.env.API_KEY!,
      polygon: process.env.ETHERSCAN_POLYGON_KEY!,
      optimisticEthereum: process.env.OP_KEY!,
      arbitrumOne: process.env.ARB_API_KEY!,
      base: process.env.BASE_API_KEY!,
      bsc: process.env.BSC_API_KEY!,
      routescan: "routescan",
      scroll: process.env.SCROLL_API_KEY!,
      filecoin: "filecoin",
      moonbeam: process.env.MOONBEAM_API_KEY!,
      polygonZkEVM: process.env.POLYGONZKEVM_API_KEY!,
      blast: process.env.BLAST_API_KEY!,
      boba: "boba",
      rootstock: "rootstock",
      mantapacific: "mantapacific",
      linea_mainnet: process.env.LINEA_API_KEY!
    },
  },
  gasReporter: {
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    currency: 'USD',
  },
  networks: {
    hardhat: {
      chainId: 1,
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
          : zaddr,
        process.env.PERSONAL_PRIVATE_KEY
          ? process.env.PERSONAL_PRIVATE_KEY
          : zaddr
      ],
      minGasPrice: 32000000000,
    },
    op: {
      url: process.env.OP_URL ? process.env.OP_URL : zaddr,
      accounts: [
        process.env.MAINNET_PRIVATE_KEY
          ? process.env.MAINNET_PRIVATE_KEY
          : zaddr,
        process.env.PERSONAL_PRIVATE_KEY
          ? process.env.PERSONAL_PRIVATE_KEY
          : zaddr
      ],
      minGasPrice: 32000000000,
      chainId: 10
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
