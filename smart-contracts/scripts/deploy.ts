
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

// Router addresses by chain ID
const ROUTERS_BY_CHAIN: Record<number, string[]> = {
  // Worldchain (480)
  480: [
    "0xBb5e1777A331ED93E07cF043363e48d320eb96c4", // icecreamswap
    "0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf", // enso
    "0x8ac7bee993bb44dab564ea4bc9ea67bf9eb5e743", // lusor
  ],
  // Base (8453)
  8453: [
    "0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf", // Enso
    "0xBb5e1777A331ED93E07cF043363e48d320eb96c4", // Icecreamswap
    "0x5e2F47bD7D4B357fCfd0Bb224Eb665773B1B9801", // Oks
    "0x19cEeAd7105607Cd444F5ad10dd51356436095a1", // Odos
    "0x111111125421cA6dc452d289314280a0f8842A65", // 1inch
    "0x6352a56caadc4f1e25cd6c75970fa768a3304e64", // OpenOcean
    "0x6A000F20005980200259B80c5102003040001068", // Velora
    "0xef58B643240178c2BC37681f8d4E50d7Ec37Ee22", // Unison
    "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD", // Luxor
    "0x000000000022D473030F116dDEE9F6B43aC78BA3", // 0x (permit2)
    "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // Kyberswap
  ]
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
            jsonRpcUrl: process.env.BASE_URL!
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


  // Get current chain ID
  const chainId = (await ethers.provider.getNetwork()).chainId
  console.log("Chain ID: ", chainId)

  // Register routers for this chain
  const routers = ROUTERS_BY_CHAIN[Number(chainId)]
  if (routers && routers.length > 0) {
    console.log(`Registering ${routers.length} swap routers for chain ${chainId}...`)
    for (let i = 0; i < routers.length; i++) {
      const routerAddr = routers[i]
      console.log(`  Adding router ${i + 1}/${routers.length}: ${routerAddr}`)
      const updateTx = await contract.updateSwapTargets(routerAddr, true, {
        gasLimit: 5000000
      })
      await updateTx.wait()

      // Add delay between transactions to avoid overloading RPC (only for mainnet)
      if (mainnet && i < routers.length - 1) {
        await sleep(2000)
      }
    }
    console.log("All swap targets updated successfully")
  } else {
    console.log(`No routers configured for chain ${chainId}`)
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