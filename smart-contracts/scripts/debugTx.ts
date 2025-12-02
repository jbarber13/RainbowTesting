import hre from "hardhat";
import { ethers as ethersLib } from "ethers";

async function main() {
  const { ethers } = hre;

  // Get the private key from hardhat config
  const accounts = hre.network.config.accounts as string[];
  const privateKey = accounts[0];

  // Try with Base's official RPC
  const officialRpc = "https://mainnet.base.org";
  console.log('Testing with official Base RPC:', officialRpc);

  const provider = new ethersLib.JsonRpcProvider(officialRpc);
  const wallet = new ethersLib.Wallet(privateKey, provider);
  const addr = await wallet.getAddress();

  console.log('Signer:', addr);

  const balance = await provider.getBalance(addr);
  console.log('Balance:', ethersLib.formatEther(balance), 'ETH');

  const nonce = await provider.getTransactionCount(addr);
  console.log('Nonce:', nonce);

  const feeData = await provider.getFeeData();
  console.log('Gas Price:', ethersLib.formatUnits(feeData.gasPrice || 0n, 'gwei'), 'gwei');

  // Test simple ETH transfer to self
  console.log('\n--- Testing simple ETH transfer (official RPC) ---');
  try {
    const tx = await wallet.sendTransaction({
      to: addr,
      value: 0n,
      gasLimit: 21000n,
    });
    console.log('✅ Tx hash:', tx.hash);
    const receipt = await tx.wait();
    console.log('✅ Tx confirmed in block:', receipt?.blockNumber);
  } catch (e: any) {
    console.log('\n❌ Error:', e.message);
    console.log('Error code:', e.code);
    if (e.info?.error) console.log('RPC error:', e.info.error);
  }
}

main().catch(console.error);
