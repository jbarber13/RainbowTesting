import hre from "hardhat";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const addr = await signer.getAddress();
  const pending = await hre.ethers.provider.getTransactionCount(addr, 'pending');
  const latest = await hre.ethers.provider.getTransactionCount(addr, 'latest');
  console.log('Address:', addr);
  console.log('Pending nonce:', pending);
  console.log('Latest nonce:', latest);
  console.log('Stuck transactions:', pending - latest);
}

main().catch(console.error);
