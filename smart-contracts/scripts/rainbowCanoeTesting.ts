import { formatUnits, Signer, parseUnits } from "ethers";
import hre, { network } from "hardhat";
import { IERC20__factory, RainbowRouter, RainbowRouter__factory } from "../typechain-types";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { IERC20 } from "../typechain-types/contracts/interfaces/openzeppelin";
import { canoeParams, MarketId, SwapQuoteResponse } from "./canoeHelper";
import axios from "axios";

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

let signer: Signer
let owner: Signer
let mainnet = true
let Rainbow: RainbowRouter

let USDC: IERC20
let WETH: IERC20

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

    await testRainbowCanoeFlow(signer)
}

const testRainbowCanoeFlow = async (signer: Signer) => {
    console.log("\n=== Testing Rainbow Canoe Flow ===")
    
    Rainbow = RainbowRouter__factory.connect(RainbowAddress, signer)
    const signerAddress = await signer.getAddress()
    
    // Set up test parameters
    const inputAmount = Number(formatUnits(usdcAmount, 6))
    const params: canoeParams = {
        chain: "optimism",
        account: signerAddress, // Use actual signer address instead of Rainbow contract
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
        const rainbowExecution = await getRainbowExecution(quoteResponse.coupon, signerAddress)
        
        console.log("Rainbow execution response:", JSON.stringify(rainbowExecution, null, 2))
        
        if (!rainbowExecution.executionInformation || !rainbowExecution.executionInformation.trade) {
            throw new Error("Invalid Rainbow execution response structure")
        }
        
        console.log(`Rainbow target: ${rainbowExecution.executionInformation.trade.to}`)
        console.log(`Transaction value: ${rainbowExecution.executionInformation.trade.value}`)
        
        // Step 3: Simulate the Rainbow Router transaction
        console.log("\n3. Simulating Rainbow Router transaction...")
        await simulateRainbowTransaction(signer, rainbowExecution, quoteResponse)
        
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

const getRainbowExecution = async (coupon: any, signerAddress: string): Promise<RainbowExecutionInfo> => {
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
    signer: Signer, 
    rainbowExecution: RainbowExecutionInfo, 
    originalQuote: SwapQuoteResponse
) => {
    const { trade, to, data, value } = rainbowExecution.executionInformation.trade
    const warrant = rainbowExecution.warrant
    
    // Ensure we have enough tokens for the test
    const inputAmountBN = parseUnits(originalQuote.inAmount, originalQuote.inToken.decimals)
    const signerAddress = await signer.getAddress()
    
    // Set token balance for testing
    await setBalance(signerAddress, ethers.parseEther("1000"))
    
    // For USDC, we need to ensure the signer has enough tokens
    if (originalQuote.inToken.address.toLowerCase() !== "0x4200000000000000000000000000000000000006") {
        // This is not WETH, so we need to mock token balance
        console.log(`Setting ${originalQuote.inToken.symbol} balance for testing...`)
        // Note: In a real fork test, you might want to use setStorageAt to set token balances
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
        const result = await signer.provider!.call(txRequest)
        console.log("✅ Transaction simulation successful!")
        console.log(`Result data: ${result}`)
        
        // If simulation passes, we could also estimate gas
        const gasEstimate = await signer.provider!.estimateGas(txRequest)
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

main().catch(console.error);
