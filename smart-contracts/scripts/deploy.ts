
import { Signer } from "ethers";
import { RainbowRouter__factory } from "../typechain-types"
import hre, { network } from "hardhat";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { getNetworkConfig } from "../util/networkConfig";

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
    console.log("Reset")

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


  let contract;
  try {
    console.log("Deploying contract...")
    console.log("Signer balance:", ethers.formatEther(await ethers.provider.getBalance(await signer.getAddress())), "ETH")

    contract = await new RainbowRouter__factory().connect(signer).deploy(name, version, {
      gasLimit: 5000000
    })
    await contract.waitForDeployment()
  } catch (error: any) {
    console.error("Deployment failed:", error.message)
    if (error.data) {
      console.error("Error data:", error.data)
    }
    if (error.error) {
      console.error("Inner error:", error.error)
    }
    throw error
  }

  if (mainnet) {
    await sleep(5000)
  }
  const tx = await contract.deploymentTransaction()
  console.log("DEPLOYED: ", await contract.getAddress(), tx?.hash)


  // Get network config for swap targets
  let config;
  try {
    config = getNetworkConfig(networkName);
  } catch (e) {
    console.log(`No network config found for ${networkName}, skipping swap target registration`)
  }

  // Register swap targets from config
  if (config && config.knownSwapTargets.length > 0) {
    const targets = config.knownSwapTargets;
    console.log(`\nRegistering ${targets.length} swap targets for ${config.chainName}...`)
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      console.log(`  Adding ${i + 1}/${targets.length}: ${target.name} (${target.protocol}) - ${target.address}`)
      const updateTx = await contract.updateSwapTargets(target.address, true, {
        gasLimit: 100000
      })
      await updateTx.wait()

      // Add delay between transactions to avoid overloading RPC (only for mainnet)
      if (mainnet && i < targets.length - 1) {
        await sleep(2000)
      }
    }
    console.log("All swap targets registered successfully")
  } else {
    console.log(`No swap targets configured for ${networkName}`)
  }

  // Approve zero address as valid signer
  console.log("Approving zero address as valid signer...")
  const zeroAddress = ethers.ZeroAddress
  const validSignerTx = await contract.updateValidSigner(zeroAddress, true, {
    gasLimit: 5000000
  })
  await validSignerTx.wait()
  console.log("Zero address approved as valid signer")


  //console.log("Transferring ownership to ", gfxOwner)
  //await contract.transferOwnership(gfxOwner)

  if (mainnet) {
    console.log("Verifying: ", await contract.getAddress())
    await hre.run("verify:verify", {
      address: await contract.getAddress(),
      constructorArguments: [name, version]
    })
  }

}

main().catch(console.error);

//hh verify --network op 0x003CCe004267597A3FFDA5C1945DA0C2C9276c96 "Rainbow Router" "1.0"