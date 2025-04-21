
import { RainbowRouter__factory } from "../typechain-types"

const { ethers } = require("hardhat"); 

async function main() {
  console.log("--- Using Ethers ---");
  const [owner] = await ethers.getSigners();
 
  const contract = await new RainbowRouter__factory().connect(owner).deploy()
  await contract.deploymentTransaction()
  console.log("DEPLOYED: ", await contract.getAddress())
  //const rainbow = await factory.depoloy()

}

main().catch(console.error);

//hh verify --network op 0x882f17ad0499AE24FAeCd3CF09e509B98038fd95