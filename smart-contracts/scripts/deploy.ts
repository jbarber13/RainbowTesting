
import { Signer } from "ethers";
import { RainbowRouter__factory } from "../typechain-types"
import hre, { network } from "hardhat";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

const { ethers } = require("hardhat");


const name = "Rainbow Router"
const version = "1.0"


const userAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"
const gfxOwner = "0x00a0bB9dfD2db3a6E447147426aB2D1B5Ac356d5"

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {

  console.log("STARTING")
  let networkName = hre.network.name
  let mainnet = true
  let signer: Signer

  if (networkName == "hardhat" || networkName == "localhost") {
    //testing
    mainnet = false

    //reset
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.OP_URL!
          },
        },
      ],
    });
    console.log("Reset to OP")

    signer = await ethers.getSigner(userAddr)
    await setBalance(userAddr, ethers.parseEther("1000"))

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [userAddr],
    });

  } else {
    [signer] = await ethers.getSigners()

    console.log("DEPLOYING TO LIVE NETWORK: ", networkName, " as ", await signer.getAddress())
  }


  const contract = await new RainbowRouter__factory().connect(signer).deploy(name, version)
  await contract.waitForDeployment()
  if (mainnet) {
    await sleep(5000)
  }
  const tx = await contract.deploymentTransaction()
  console.log("DEPLOYED: ", await contract.getAddress(), tx?.hash)


  //register things


  //console.log("Transferring ownership to ", gfxOwner)
  //await contract.transferOwnership(gfxOwner)

  if (mainnet) {
    await hre.run("verify:verify", {
      address: await contract.getAddress(),
      constructorArguments: [name, version]
    })
  }

}

main().catch(console.error);

//hh verify --network op 0x003CCe004267597A3FFDA5C1945DA0C2C9276c96 "Rainbow Router" "1.0"