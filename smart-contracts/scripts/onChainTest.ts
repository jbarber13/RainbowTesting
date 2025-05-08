
import hre, { network } from "hardhat";
import { ERC20__factory, IERC20__factory, RainbowRouter, RainbowRouter__factory } from "../typechain-types";
import { AbiCoder, formatUnits, keccak256, Signer, ZeroAddress } from "ethers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { ERC20, IERC20 } from "../typechain-types/contracts/interfaces/openzeppelin";
import { generatePermitSignature, generateUniTxData, stealMoney } from "./msc";
import axios from "axios";
import { canoeParams, constructCanoeSwap, MarketId, RainbowTxType } from "./canoeHelper";

const { ethers } = require("hardhat");

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
  console.log("This one works: ")
  //await canoeTest(signer, ERC20__factory.connect(await USDC.getAddress(), signer), WETH, usdcAmount, await Rainbow.getAddress())
  await canoePackageTest(signer, ERC20__factory.connect(await USDC.getAddress(), signer), WETH, usdcAmount, await Rainbow.getAddress())

}

const setup = async (owner: Signer) => {

  //Rainbow = RainbowRouter__factory.connect("0x003CCe004267597A3FFDA5C1945DA0C2C9276c96", owner)


  await Rainbow.connect(owner).updateSwapTargets("0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", true)
  await Rainbow.connect(owner).updateValidSigner("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", true)
  await Rainbow.connect(owner).updateValidSigner("0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", true)

  await Rainbow.connect(owner).updateValidSigner(await owner.getAddress(), true)

}

const canoePackageTest = async (
  signer: Signer,
  usdcContract: ERC20,
  wethContract: IERC20,
  inputUsdcAmount: bigint, // raw BigInt amount
  rainbowRouterAddress: string
) => {

  console.log("")
  console.log("")
  console.log("")
  console.log("")
  console.log("Testing canoe package...")
  console.log("This one is borked: ")


  const currentNetwork = await ethers.provider.getNetwork();


  const Rainbow = RainbowRouter__factory.connect(rainbowRouterAddress, signer);

  // Format amount for API call
  const usdcDecimals = await usdcContract.decimals();
  const amountInFormattedForApi = formatUnits(inputUsdcAmount, usdcDecimals);

  const params: canoeParams = {
    chain: "optimism",
    account: await Rainbow.getAddress(),
    isExactIn: true,
    inTokenAddress: await USDC.getAddress(),
    outTokenAddress: await WETH.getAddress(),
    inTokenAmount: amountInFormattedForApi,
    slippage: 1,
  };

  if (!mainnet) {
    //steal money
    const usdcNativeWhale = "0x133FA49A01801264fC05A12EF5ef9Db6a302e93D"
    await stealMoney(usdcNativeWhale, await signer.getAddress(), await USDC.getAddress(), inputUsdcAmount)

  }

  await constructCanoeSwap(signer, params, Rainbow, RainbowTxType.TOKEN2TOKEN_PERMIT, currentNetwork.chainId, MarketId.KYBERSWAP)

}

const canoeTest = async (
  signer: Signer,
  usdcContract: ERC20,
  wethContract: IERC20,
  inputUsdcAmount: bigint, // raw BigInt amount
  rainbowRouterAddress: string
) => {
  const Rainbow = RainbowRouter__factory.connect(rainbowRouterAddress, signer);

  const feeAmount = 0n;
  const sellTokenAddress = await usdcContract.getAddress();
  const buyTokenAddress = await wethContract.getAddress();
  const rainbowAddress = await Rainbow.getAddress();
  const currentNetwork = await ethers.provider.getNetwork();

  // Format amount for API call
  const usdcDecimals = await usdcContract.decimals();
  const amountInFormattedForApi = formatUnits(inputUsdcAmount, usdcDecimals);

  console.log("Fetching quote from Canoe API...");
  const baseURL = "https://canoe.icarus.tools/market/kyberswap/swap_quote";
  const params = {
    chain: "optimism",
    account: rainbowAddress,
    isExactIn: true,
    inTokenAddress: sellTokenAddress,
    outTokenAddress: buyTokenAddress,
    inTokenAmount: amountInFormattedForApi,
    slippage: 1,
  };

  let apiData: any;
  try {
    const response = await axios.post(baseURL, params);
    console.log("API Response Status:", response.status);
    apiData = response.data;
  } catch (error: any) {
    console.error("Error fetching swap quote from Canoe:");
    if (axios.isAxiosError(error)) {
      console.error("Status:", error.response?.status);
      console.error("Response Data:", error.response?.data);
    } else {
      console.error("An unexpected error occurred:", error.message);
    }
    throw new Error("Failed to fetch quote from Canoe API");
  }

  if (!(apiData && apiData.candidateTrade && apiData.candidateTrade.data && apiData.candidateTrade.to)) {
    console.error("Invalid API response structure:", apiData);
    throw new Error("Invalid data from Canoe API");
  }

  const swapCallDataFromApi = apiData.candidateTrade.data;
  const routerAddrFromApi = apiData.candidateTrade.to;
  //console.log("ROUTER: ", routerAddrFromApi)

  //console.log("Constructing warrant and permit signatures...");
  //console.log("Router Address from API:", routerAddrFromApi);
  //console.log("Swap CallData from API:", swapCallDataFromApi);

  const swapCallDataHash = keccak256(swapCallDataFromApi);
  const dataHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'bytes32', 'uint256', 'uint256'],
      [sellTokenAddress, buyTokenAddress, routerAddrFromApi, swapCallDataHash, inputUsdcAmount, feeAmount]
    )
  );

  const clientCurrentTimeSec = 1746746165//Math.floor(Date.now() / 1000);
  const warrantValidAfter = BigInt(clientCurrentTimeSec - 300); // 5 minutes ago
  const warrantValidBefore = BigInt(clientCurrentTimeSec + 3600); // 1 hour from now

  const warrantNonce: bigint = 1n;

  const verifyingSignerAddress: string = await signer.getAddress();

  const packedValidationData = warrantNonce | (warrantValidBefore << 160n) | (warrantValidAfter << 208n);

  const warrantDomain = {
    name: RAINBOW_ROUTER_EIP712_NAME,
    version: RAINBOW_ROUTER_EIP712_VERSION,
    chainId: currentNetwork.chainId,
    verifyingContract: rainbowAddress,
  };

  const warrantTypes = {
    CanoeWarrant: [
      { name: 'packedValidationData', type: 'uint256' },
      { name: 'dataHash', type: 'bytes32' },
    ],
  };

  const warrantValueToSign = {
    packedValidationData: packedValidationData,
    dataHash: dataHash,
  };

  console.log("Domain: ", warrantDomain)
    console.log("Types: ", warrantTypes)
    console.log("WVTS: ", warrantValueToSign)

  //console.log("Signing warrant with EIP-712:", { warrantDomain, warrantTypes, warrantValueToSign });
  const warrantSignature = await signer.signTypedData(warrantDomain, warrantTypes, warrantValueToSign);

  const warrant = {
    nonce: warrantNonce,
    validBefore: warrantValidBefore,
    validAfter: warrantValidAfter,
    verifyingSigner: verifyingSignerAddress,
    signature: warrantSignature,
  };

  //console.log(`Generating permit signature for USDC on chain ${currentNetwork.chainId}...`);
  const permitData = await generatePermitSignature(
    signer,
    currentNetwork.chainId,
    sellTokenAddress,
    inputUsdcAmount,        // Raw BigInt amount
    rainbowAddress
  );
  //console.log("Generated permitData (sigData): ", permitData);

  if (!mainnet) {
    //steal money
    const usdcNativeWhale = "0x133FA49A01801264fC05A12EF5ef9Db6a302e93D"
    await stealMoney(usdcNativeWhale, await signer.getAddress(), sellTokenAddress, inputUsdcAmount)

  }

  //console.log("Calling fillQuoteTokenToTokenWithPermit...");
  const tx = await Rainbow.connect(signer).fillQuoteTokenToTokenWithPermit(
    sellTokenAddress,
    buyTokenAddress,
    routerAddrFromApi,
    swapCallDataFromApi,
    inputUsdcAmount,
    feeAmount,
    permitData,
    warrant
  );
  //console.log("Transaction sent:", tx.hash);
  await tx.wait();
  console.log("Transaction confirmed!");

  return tx;
};



const deploy = async (signer: Signer) => {
  //Rainbow = RainbowRouter__factory.connect("0x882f17ad0499AE24FAeCd3CF09e509B98038fd95", signer)

  Rainbow = await new RainbowRouter__factory(signer).deploy("Rainbow Router", "1.0")
  await Rainbow.waitForDeployment()
  await Rainbow.deploymentTransaction()
  console.log("Rainbow Deployed: ", await Rainbow.getAddress())

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

