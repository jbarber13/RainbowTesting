
import { Signer } from "ethers";
import { RainbowRouter__factory } from "../typechain-types"
import hre, { network } from "hardhat";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

const { ethers } = require("hardhat");


const name = "Rainbow Router"
const version = "1.0"


const userAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"
const gfxOwner = "0x00a0bB9dfD2db3a6E447147426aB2D1B5Ac356d5"

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
  await contract.deploymentTransaction()
  console.log("DEPLOYED: ", await contract.getAddress())


  //register things


  //console.log("Transferring ownership to ", gfxOwner)
  //await contract.transferOwnership(gfxOwner)

  if (mainnet) {
    const verification = await hre.run("verify:verify", {
      address: await contract.getAddress(),
      constructorArguments: [name, version]
    })
    console.log("Submitting verification...")
    await Promise.all([verification])
  }

}

main().catch(console.error);

//hh verify --network op 0x882f17ad0499AE24FAeCd3CF09e509B98038fd95