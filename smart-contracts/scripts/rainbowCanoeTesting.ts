import { formatUnits, Signer, parseUnits } from "ethers";
import hre, { network } from "hardhat";
import { IERC20__factory, RainbowRouter, RainbowRouter__factory } from "../typechain-types";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { IERC20 } from "../typechain-types/contracts/interfaces/openzeppelin";
import { canoeParams, MarketId, SwapQuoteResponse } from "./canoeHelper";
import axios from "axios";

const RAINBOW_ROUTER_EIP712_NAME = "Rainbow Router";
const RAINBOW_ROUTER_EIP712_VERSION = "1.0";

/**
 I can see your backend improvements are working! The transformation is definitely happening correctly:

  ✅ Backend Transformation is Working Perfectly!

  Looking at the logs, I can confirm:

  1. ✅ Correct Target: trade.to is 0x80dCD2C737cAFE9f86559bBCed9938eFfB7f7D1A (Rainbow Router)
  2. ✅ Has Warrant: Complete warrant structure with signature
  3. ✅ Proper Response Structure: {executionInformation, warrant, warrantTypedData}
  4. ✅ Real Data: Using actual token addresses and amounts
  5. ✅ New DataHash: 0xb692fe531a3fc16e3f24e6c1e9aa3eb0237c181c0fe0494500632c5622a56aa4 (shows real
  calculation)

  🔍 Still Getting CANOE: INVALID_SIGNATURE

  However, we're still getting the signature validation error. Since the transformation is working correctly,
  this suggests the signature itself is valid but the contract is calculating a different dataHash than your
  backend.

  🎯 Key Questions for Server Logs

  Can you check if you're seeing these debug logs in your server console:

  1. 🔍 Full coupon structure: - Complete coupon data
  2. 🔍 Token addresses for warrant: - inToken/outToken addresses used
  3. 🔍 Input amount for warrant: - Amount used in calculation
  4. 🔏 Warrant Signature Debug: - Backend's calculation details

  💡 Likely Remaining Issue

  The dataHash calculation might have subtle differences between:
  - Backend calculation: Using extracted token addresses/amounts
  - Contract calculation: Using the actual transaction data

  Your backend fix is working perfectly for the transformation! We just need to align the dataHash calculation
   between backend and contract. What do your server logs show for the warrant calculation details?
 */


// Rainbow Router execution information response interface
interface RainbowExecutionInfo {
    executionInformation: {
        trade: {
            to: string;
            data: string;
            value: string;
        }
    };
    warrant: {
        nonce: string;
        validBefore: string;
        validAfter: string;
        verifyingSigner: string;
        signature: string;
    };
    warrantTypedData: {
        domain: any;
        types: any;
        value: any;
    };
}

const RainbowAddress = "0x80dCD2C737cAFE9f86559bBCed9938eFfB7f7D1A" //testing OP
const ownerAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"
const { ethers } = require("hardhat");

const wethAmount = ethers.parseEther("0.01")
const usdcAmount = ethers.parseUnits("10", 6) // Increased to 10 USDC for better liquidity

let testSigner: Signer  // Hardhat signer with known private key
let contractOwner: Signer  // Impersonated account for contract admin
let mainnet = true
let Rainbow: RainbowRouter

let USDC: IERC20
let WETH: IERC20

// Known USDC whale on Optimism for funding our test account
const USDC_WHALE = "0xf89d7b9c864f589bbF53a82105107622B35EaA40" // Binance 8

async function main() {
    console.log("STARTING Rainbow Canoe Testing")
    let networkName = hre.network.name

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
        console.log("Reset to OP fork")
        
        const signers = await ethers.getSigners()
        testSigner = signers[0] // Use Hardhat's first signer (has known private key)
        console.log("Test signer address:", await testSigner.getAddress())
        
        // Impersonate the contract owner for admin operations
        contractOwner = await ethers.getSigner(ownerAddr)
        await setBalance(ownerAddr, ethers.parseEther("1000"))
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [ownerAddr],
        });
        console.log("Impersonated contract owner:", ownerAddr)
        
    } else {
        console.log("DEPLOYING TO LIVE NETWORK: ", networkName,)
        const provider = new ethers.JsonRpcProvider(process.env.OP_URL!)
        testSigner = new ethers.Wallet(process.env.MAINNET_PRIVATE_KEY!, provider)
        contractOwner = new ethers.Wallet(process.env.MAINNET_PRIVATE_KEY!, provider)
    }

    // Initialize token contracts
    USDC = IERC20__factory.connect("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", testSigner)
    WETH = IERC20__factory.connect("0x4200000000000000000000000000000000000006", testSigner)
    
    // Fund the test signer with USDC (only on fork)
    if (networkName == "hardhat" || networkName == "localhost") {
        await fundTestAccountWithUSDC()
    }

    await testRainbowCanoeFlow()
}

const fundTestAccountWithUSDC = async () => {
    console.log("\n💰 Funding test account with USDC...")
    
    const testAddress = await testSigner.getAddress()
    console.log("Test account address:", testAddress)
    
    // Impersonate USDC whale
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [USDC_WHALE],
    });
    await setBalance(USDC_WHALE, ethers.parseEther("1000"))
    
    const whaleUSDC = IERC20__factory.connect("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", await ethers.getSigner(USDC_WHALE))
    
    // Check whale balance
    const whaleBalance = await whaleUSDC.balanceOf(USDC_WHALE)
    console.log(`USDC whale balance: ${formatUnits(whaleBalance, 6)} USDC`)
    
    // Transfer USDC to test account
    const transferAmount = ethers.parseUnits("1000", 6) // 1000 USDC
    await whaleUSDC.transfer(testAddress, transferAmount)
    
    // Verify transfer
    const testBalance = await USDC.balanceOf(testAddress)
    console.log(`✅ Test account USDC balance: ${formatUnits(testBalance, 6)} USDC`)
    
    // Stop impersonating whale
    await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [USDC_WHALE],
    });
}

const testRainbowCanoeFlow = async () => {
    console.log("\n=== Testing Rainbow Canoe Flow ===")
    
    Rainbow = RainbowRouter__factory.connect(RainbowAddress, testSigner)
    const testAddress = await testSigner.getAddress()
    
    // Set up test parameters
    const inputAmount = Number(formatUnits(usdcAmount, 6))
    const params: canoeParams = {
        chain: "optimism",
        account: testAddress, // Use test signer address (has known private key)
        isExactIn: true,
        inTokenAddress: await USDC.getAddress(),
        outTokenAddress: await WETH.getAddress(),
        inTokenAmount: inputAmount.toString(),
        slippage: 5, // Increased slippage tolerance to 5% for better success rate
    };

    console.log("Parameters:", params)

    try {
        // Step 1: Get Paraswap quote with coupon
        console.log("\n1. Getting Paraswap quote...")
        const quoteResponse: SwapQuoteResponse = await getParaswapQuote(params)
        
        if (!quoteResponse || !quoteResponse.coupon) {
            throw new Error("Failed to get valid quote response")
        }
        
        console.log(`Quote: ${quoteResponse.inAmount} ${quoteResponse.inToken.symbol} -> ${quoteResponse.outAmount} ${quoteResponse.outToken.symbol}`)
        console.log(`Original target: ${quoteResponse.candidateTrade.to}`)
        
        // Debug: Show the exact coupon being sent
        console.log("\n📋 Coupon data being sent to execution_information:")
        console.log("Coupon keys:", Object.keys(quoteResponse.coupon))
        console.log("Coupon.chainId:", quoteResponse.coupon.chainId)
        console.log("Coupon.account:", quoteResponse.coupon.account)
        if (quoteResponse.coupon.raw) {
            console.log("Coupon.raw keys:", Object.keys(quoteResponse.coupon.raw))
        }
        
        // Step 2: Transform quote to Rainbow Router execution
        console.log("\n2. Transforming to Rainbow Router execution...")
        console.log("⚠️  Watch server logs now for debug output!")
        const rainbowExecution = await getRainbowExecution(quoteResponse.coupon)
        
        console.log("Rainbow execution response:", JSON.stringify(rainbowExecution, null, 2))
        
        // Add detailed warrant signature debug logging
        console.log("\n🔏 Warrant Signature Debug:")
        console.log("  signerAddress:", rainbowExecution.warrant.verifyingSigner)
        console.log("  domain:", JSON.stringify(rainbowExecution.warrantTypedData.domain, null, 4))
        console.log("  types:", JSON.stringify(rainbowExecution.warrantTypedData.types, null, 4))
        console.log("  message:", JSON.stringify(rainbowExecution.warrantTypedData.message, null, 4))
        console.log("  signature:", rainbowExecution.warrant.signature)
        
        if (!rainbowExecution.executionInformation || !rainbowExecution.executionInformation.trade) {
            throw new Error("Invalid Rainbow execution response structure")
        }
        
        console.log(`Rainbow target: ${rainbowExecution.executionInformation.trade.to}`)
        console.log(`Transaction value: ${rainbowExecution.executionInformation.trade.value}`)
        
        // Step 3: Check and whitelist target if needed
        console.log("\n3. Checking target authorization...")
        const targetAddress = extractTargetFromRainbowData(rainbowExecution.executionInformation.trade.data)
        console.log(`Target to check: ${targetAddress}`)
        
        await ensureTargetIsWhitelisted(contractOwner, targetAddress)
        
        // Step 4: Check and whitelist signer if needed
        console.log("\n4. Checking signer authorization...")
        const signerAddress = rainbowExecution.warrant.verifyingSigner
        console.log(`Signer to check: ${signerAddress}`)
        
        await ensureSignerIsWhitelisted(contractOwner, signerAddress)
        
        // Step 5: Simulate the Rainbow Router transaction
        console.log("\n5. Simulating Rainbow Router transaction...")
        await simulateRainbowTransaction(testSigner, rainbowExecution, quoteResponse)
        
        console.log("\n✅ Rainbow Canoe flow completed successfully!")
        
    } catch (error: any) {
        console.error("\n❌ Rainbow Canoe flow failed:", error.message)
        if (error.response?.data) {
            console.error("API Error Details:", error.response.data)
        }
        throw error
    }
}

const getParaswapQuote = async (params: canoeParams): Promise<SwapQuoteResponse> => {
    const baseURL = `http://localhost:3333/market/paraswap/swap_quote`
    
    try {
        console.log("Fetching Paraswap quote from:", baseURL)
        const response = await axios.post(baseURL, params)
        return response.data as SwapQuoteResponse
    } catch (error: any) {
        console.error("Error fetching Paraswap quote:")
        if (axios.isAxiosError(error)) {
            console.error("Status:", error.response?.status)
            console.error("Response Data:", error.response?.data)
        } else {
            console.error("An unexpected error occurred:", error.message)
        }
        throw error
    }
}

const getRainbowExecution = async (coupon: any): Promise<RainbowExecutionInfo> => {
    const baseURL = `http://localhost:3333/market/paraswap/execution_information`
    
    const requestBody = {
        coupon: coupon,
        useRainbow: true
    }
    
    try {
        console.log("Fetching Rainbow execution info from:", baseURL)
        console.log("🔍 Request body structure:")
        console.log("  - coupon keys:", Object.keys(requestBody.coupon))
        console.log("  - useRainbow:", requestBody.useRainbow)
        console.log("📤 Making POST request...")
        
        const response = await axios.post(baseURL, requestBody)
        
        console.log("📥 Response received:")
        console.log("  - Status:", response.status)
        console.log("  - Response keys:", Object.keys(response.data))
        
        return response.data as RainbowExecutionInfo
    } catch (error: any) {
        console.error("❌ Error fetching Rainbow execution info:")
        if (axios.isAxiosError(error)) {
            console.error("Status:", error.response?.status)
            console.error("Response Data:", error.response?.data)
        } else {
            console.error("An unexpected error occurred:", error.message)
        }
        throw error
    }
}

const simulateRainbowTransaction = async (
    txSigner: Signer, 
    rainbowExecution: RainbowExecutionInfo, 
    originalQuote: SwapQuoteResponse
) => {
    const { trade, to, data, value } = rainbowExecution.executionInformation.trade
    const warrant = rainbowExecution.warrant
    
    // Ensure we have enough tokens for the test
    const inputAmountBN = parseUnits(originalQuote.inAmount, originalQuote.inToken.decimals)
    const signerAddress = await txSigner.getAddress()
    
    // Check current USDC balance (should already be funded)
    const currentBalance = await USDC.balanceOf(signerAddress)
    console.log(`Current USDC balance: ${formatUnits(currentBalance, 6)} USDC`)
    
    if (currentBalance < inputAmountBN) {
        throw new Error(`Insufficient USDC balance. Need: ${formatUnits(inputAmountBN, 6)}, Have: ${formatUnits(currentBalance, 6)}`)
    }
    
    try {
        // Verify the transaction target is Rainbow Router
        if (to.toLowerCase() !== RainbowAddress.toLowerCase()) {
            throw new Error(`Expected Rainbow Router address ${RainbowAddress}, got ${to}`)
        }
        
        console.log("Simulating transaction with Rainbow Router...")
        console.log(`Target: ${to}`)
        console.log(`Value: ${value} ETH`)
        console.log(`Data length: ${data.length} bytes`)
        
        // Create transaction object
        const txRequest = {
            to: to,
            data: data,
            value: value,
            from: signerAddress
        }
        
        // Simulate the transaction using staticCall
        const result = await txSigner.provider!.call(txRequest)
        console.log("✅ Transaction simulation successful!")
        console.log(`Result data: ${result}`)
        
        // If simulation passes, we could also estimate gas
        const gasEstimate = await txSigner.provider!.estimateGas(txRequest)
        console.log(`Estimated gas: ${gasEstimate.toString()}`)
        
        return {
            success: true,
            result: result,
            gasEstimate: gasEstimate.toString()
        }
        
    } catch (error: any) {
        console.error("❌ Transaction simulation failed:")
        console.error("Error:", error.message)
        if (error.data) {
            console.error("Error data:", error.data)
        }
        throw error
    }
}

const extractTargetFromRainbowData = (txData: string): string => {
    // Rainbow Router calldata format: the target address is typically passed as a parameter
    // For fillQuoteTokenToToken, the target is the 3rd parameter (after inToken and outToken)
    // Let's decode the function call to extract the target address
    
    try {
        const rainbowInterface = RainbowRouter__factory.createInterface()
        const decoded = rainbowInterface.parseTransaction({ data: txData })
        
        if (decoded?.name === "fillQuoteTokenToToken") {
            // The target is the 3rd parameter (index 2)
            return decoded.args[2] as string
        }
        
        // Fallback: look for common patterns in the data
        // Paraswap addresses often start with 0x6a000f20...
        const match = txData.match(/6a000f20[0-9a-f]{32}/i)
        if (match) {
            return "0x" + match[0]
        }
        
        throw new Error("Could not extract target address from transaction data")
    } catch (error: any) {
        console.warn("Failed to decode transaction data, using fallback method")
        // Fallback: return the known Paraswap address from the original quote
        return "0x6A000F20005980200259B80c5102003040001068"
    }
}

const ensureTargetIsWhitelisted = async (ownerSigner: Signer, targetAddress: string) => {
    console.log(`Checking if target ${targetAddress} is whitelisted...`)
    
    const isWhitelisted = await Rainbow.swapTargets(targetAddress)
    
    if (isWhitelisted) {
        console.log("✅ Target is already whitelisted")
        return
    }
    
    console.log("❌ Target not whitelisted. Adding to whitelist...")
    
    try {
        // Use the owner account to whitelist the target
        const tx = await Rainbow.connect(ownerSigner).updateSwapTargets(targetAddress, true)
        await tx.wait()
        
        console.log("✅ Target successfully whitelisted!")
        console.log(`Transaction hash: ${tx.hash}`)
        
        // Verify it was added
        const nowWhitelisted = await Rainbow.swapTargets(targetAddress)
        if (!nowWhitelisted) {
            throw new Error("Target whitelisting verification failed")
        }
        
    } catch (error: any) {
        console.error("❌ Failed to whitelist target:", error.message)
        throw error
    }
}

const ensureSignerIsWhitelisted = async (ownerSigner: Signer, signerAddress: string) => {
    console.log(`Checking if signer ${signerAddress} is whitelisted...`)
    
    const isWhitelisted = await Rainbow.validSigners(signerAddress)
    
    if (isWhitelisted) {
        console.log("✅ Signer is already whitelisted")
        return
    }
    
    console.log("❌ Signer not whitelisted. Adding to whitelist...")
    
    try {
        // Use the owner account to whitelist the signer
        const tx = await Rainbow.connect(ownerSigner).updateValidSigner(signerAddress, true)
        await tx.wait()
        
        console.log("✅ Signer successfully whitelisted!")
        console.log(`Transaction hash: ${tx.hash}`)
        
        // Verify it was added
        const nowWhitelisted = await Rainbow.validSigners(signerAddress)
        if (!nowWhitelisted) {
            throw new Error("Signer whitelisting verification failed")
        }
        
    } catch (error: any) {
        console.error("❌ Failed to whitelist signer:", error.message)
        throw error
    }
}

main().catch(console.error);
