
import hre, { network } from "hardhat";
import { ERC20__factory, IERC20__factory, RainbowRouter, RainbowRouter__factory } from "../typechain-types";
import { AbiCoder, formatUnits, keccak256, Signer, ZeroAddress } from "ethers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { ERC20, IERC20 } from "../typechain-types/contracts/interfaces/openzeppelin";
import { generatePermitSignature, generateUniTxData, stealMoney } from "./msc";
import axios from "axios";
import { canoeParams, constructCanoeSwap, MarketId, RainbowTxType, RainbwoDomainInfo, SimResult } from "./canoeHelper";

const { ethers } = require("hardhat");

let RainbowAddress = "0x80dCD2C737cAFE9f86559bBCed9938eFfB7f7D1A"//"0xC8d2b5e0E28946AF983CECa6966f9def2c9A913F"
const RAINBOW_ROUTER_EIP712_NAME = "Rainbow Router";
const RAINBOW_ROUTER_EIP712_VERSION = "1.0";

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
  let owner: Signer


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
    const signers = await ethers.getSigners()
    signer = signers[0]

    owner = await ethers.getSigner(ownerAddr)
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
    owner = new ethers.Wallet(process.env.MAINNET_PRIVATE_KEY!, provider)
  }

  USDC = IERC20__factory.connect("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", signer)
  WETH = IERC20__factory.connect("0x4200000000000000000000000000000000000006", signer)



  //await sigTest(signer)

  //await tokenToToken(signer)
  await deploy(owner)
  await setup(owner)

  if (!mainnet) {
    //steal money
    const usdcNativeWhale = "0x133FA49A01801264fC05A12EF5ef9Db6a302e93D"
    await stealMoney(usdcNativeWhale, await signer.getAddress(), await USDC.getAddress(), usdcAmount)
  }
  await canoePackageTestTokenToTokenWithPermit(
    signer,
    await USDC.getAddress(),
    await WETH.getAddress(),
    Number(formatUnits(usdcAmount, 6)),
    Rainbow
  )

}

const deploy = async (signer: Signer) => {
  //Rainbow = RainbowRouter__factory.connect("0x882f17ad0499AE24FAeCd3CF09e509B98038fd95", signer)

  Rainbow = await new RainbowRouter__factory(signer).deploy("Rainbow Router", "1.0")
  await Rainbow.waitForDeployment()
  await Rainbow.deploymentTransaction()
  console.log("Rainbow Deployed: ", await Rainbow.getAddress())
  RainbowAddress = await Rainbow.getAddress()

  //update swap target
  let tx = await Rainbow.connect(signer).updateSwapTargets(routerAddr, true)
  await tx.wait()

  //update valid signer
  tx = await Rainbow.connect(signer).updateValidSigner(await signer.getAddress(), true)
  await tx.wait()
  tx = await Rainbow.connect(signer).updateValidSigner(ZeroAddress, true)
  await tx.wait()

}

const setup = async (owner: Signer) => {

  //Rainbow = RainbowRouter__factory.connect("0x003CCe004267597A3FFDA5C1945DA0C2C9276c96", owner)
  const targets = [
    "0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf", // enso
    "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // kyberswap 
    "0xCa423977156BB05b13A2BA3b76Bc5419E2fE9680", // odos
    "0x6352a56caadC4F1E25CD6c75970Fa768A3304e64", // openocean
    "0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8", // usor
    "0xc82384da1318f167ff453760eb71dd6012896240"  // zeroex
  ]

  for (let i = 0; i < targets.length; i++) {
    await Rainbow.connect(owner).updateSwapTargets(targets[i], true)
  }

  await Rainbow.connect(owner).updateValidSigner("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", true)
  await Rainbow.connect(owner).updateValidSigner("0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", true)

  await Rainbow.connect(owner).updateValidSigner(await owner.getAddress(), true)

}

const canoePackageTestTokenToTokenWithPermit = async (
  signer: Signer,
  inputToken: string,
  outputToken: string,
  inputAmount: number, // human readable terms - inputAmount==1 to indicate 1 USDC or 1000000 wei 
  Rainbow: RainbowRouter
) => {

  console.log("")
  console.log("")
  console.log("")
  console.log("")
  console.log("")
  console.log("")
  console.log("")
  console.log("")
  console.log("Testing canoe package...")


  const currentNetwork = await ethers.provider.getNetwork();


  const domainInfo: RainbwoDomainInfo = {
    name: RAINBOW_ROUTER_EIP712_NAME,
    version: RAINBOW_ROUTER_EIP712_VERSION,
    address: await Rainbow.getAddress()
  }

  const params: canoeParams = {
    chain: "optimism",
    account: await Rainbow.getAddress(),
    isExactIn: true,
    inTokenAddress: inputToken,
    outTokenAddress: outputToken,
    inTokenAmount: inputAmount.toString(),
    slippage: 1,
  };

  const result: SimResult = await constructCanoeSwap(signer, params, domainInfo, RainbowTxType.TOKEN2TOKEN_PERMIT, MarketId.KYBERSWAP, currentNetwork.chainId, true)

  if (result.success) {
    //send transaction for real
    console.log("Sending Transaction...")

    //todo handle for non-permit and native ether, which will require on chain approvals and msg.value

    const tx = await signer.sendTransaction({
      to: RainbowAddress,
      data: result.txData
    })

    const receipt = await tx.wait()
    console.log("TX: ", receipt?.hash)
  }

}




main().catch(console.error);

