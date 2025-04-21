
import hre, { network } from "hardhat";
import { IERC20__factory, RainbowRouter, RainbowRouter__factory } from "../typechain-types";
import { Signer, ZeroAddress } from "ethers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { IERC20 } from "../typechain-types/contracts/interfaces/openzeppelin";
import { generatePermitSignature, generateUniTxData } from "./msc";

const { ethers } = require("hardhat");


const routerAddr = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
const ownerAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"

const wethAmount = ethers.parseEther("0.0001")
const usdcAmount = ethers.parseUnits("0.01", 6)

let USDC: IERC20
let WETH: IERC20


let mainnet = true
let Rainbow: RainbowRouter
async function main() {
  console.log("STARTING")
  let networkName = hre.network.name

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
    console.log("reset to OP")

    signer = await ethers.getSigner(ownerAddr)
    await setBalance(ownerAddr, ethers.parseEther("1000"))
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [ownerAddr],
    });
    console.log("Impersonated ", ownerAddr)
  } else {
    console.log("DEPLOYING TO LIVE NETWORK: ", networkName,)
    const provider = new ethers.JsonRpcProvider(process.env.OP_URL!)
    signer = new ethers.Wallet(process.env.MAINNET_PRIVATE_KEY!, provider)
  }

  USDC = IERC20__factory.connect("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", signer)
  WETH = IERC20__factory.connect("0x4200000000000000000000000000000000000006", signer)



  //await sigTest(signer)

  await tokenToToken(signer)


}

const sigTest = async (signer: Signer) => {
  //generate sig


}

const deploy = async (signer: Signer) => {
  //Rainbow = RainbowRouter__factory.connect("0x882f17ad0499AE24FAeCd3CF09e509B98038fd95", signer)

  Rainbow = await new RainbowRouter__factory(signer).deploy()

  //update swap target
  let tx = await Rainbow.connect(signer).updateSwapTargets(routerAddr, true)
  await tx.wait()

  //update valid signer
  tx = await Rainbow.connect(signer).updateValidSigner(await signer.getAddress(), true)
  await tx.wait()
  tx = await Rainbow.connect(signer).updateValidSigner(ZeroAddress, true)
  await tx.wait()

}

const tokenToToken = async (signer: Signer) => {

  /**
  if (!mainnet) {
    await deploy(signer)
  } else {
    Rainbow = RainbowRouter__factory.connect("0x882f17ad0499AE24FAeCd3CF09e509B98038fd95", signer)
  }
   */

  Rainbow = RainbowRouter__factory.connect("0x882f17ad0499AE24FAeCd3CF09e509B98038fd95", signer)


  //no permit yet
  //build tx data
  console.log("AMOUNT: ", wethAmount)
  const txData = await generateUniTxData(
    await USDC.getAddress(),
    await WETH.getAddress(),
    usdcAmount,
    routerAddr,
    500,
    await Rainbow.getAddress(),
    0n
  )
  //console.log("Got Tx Data; ", txData)

  // Get milliseconds since epoch
  const millisecondsSinceEpoch: number = Date.now();

  // Convert to seconds and floor to get the integer Unix timestamp
  const time: number = Math.floor(millisecondsSinceEpoch / 1000);

  const warrant = {
    nonce: await signer.getNonce(),
    validBefore: time + 5000,
    validAfter: time - 5000,
    verifyingSigner: ZeroAddress,
    signature: "0x"
  }


  if (mainnet) {

    //permit2
    const sigData = await generatePermitSignature(
      signer,
      10,
      await USDC.getAddress(),
      usdcAmount,
      await Rainbow.getAddress()
    )

    console.log("Got Sig Data: ")
    console.log(sigData)

    let tx = await Rainbow.connect(signer).fillQuoteTokenToTokenWithPermit(
      await USDC.getAddress(),
      await WETH.getAddress(),
      routerAddr,
      txData,
      usdcAmount,
      0n,
      sigData,
      warrant
    )
    await tx.wait()

  } else {
    //legacy approve
    let tx = await USDC.connect(signer).approve(await Rainbow.getAddress(), usdcAmount)
    await tx.wait()
    //console.log("approved")
    //console.log("WETH HAD: ", await WETH.balanceOf(await signer.getAddress()))
    tx = await Rainbow.connect(signer).fillQuoteTokenToToken(
      await USDC.getAddress(),
      await WETH.getAddress(),
      routerAddr,
      txData,
      usdcAmount,
      0n,
      warrant
    )
    await tx.wait()
  }

    console.log("complete")


}

main().catch(console.error);

