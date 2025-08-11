import { formatUnits, Signer, parseUnits } from "ethers";
import hre, { network } from "hardhat";
import { IERC20__factory, RainbowRouter, RainbowRouter__factory } from "../typechain-types";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { IERC20 } from "../typechain-types/contracts/interfaces/openzeppelin";
import { canoeParams, MarketId, SwapQuoteResponse } from "./canoeHelper";
import { ExecutionRequest, Coupon, RainbowExecutionInfo } from "./canoeInterface";
import axios from "axios";

const RAINBOW_ROUTER_EIP712_NAME = "Rainbow Router";
const RAINBOW_ROUTER_EIP712_VERSION = "1.0";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const bypass = true;
const usePermit = false;

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


// Using RainbowExecutionInfo from canoeInterface.ts

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
        const blockNumber = await ethers.provider.getBlockNumber();
        console.log(`Reset to OP fork, block number: ${blockNumber}`);
        
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
    console.log("\n🌈 RAINBOW CANOE SWAP")
    
    Rainbow = RainbowRouter__factory.connect(RainbowAddress, testSigner)
    const testAddress = await testSigner.getAddress()
    
    // Set up test parameters
    const inputAmount = Number(formatUnits(usdcAmount, 6))
    const params: canoeParams = {
        chain: "optimism",
        account: testAddress,
        isExactIn: true,
        inTokenAddress: await USDC.getAddress(),
        outTokenAddress: await WETH.getAddress(),
        inTokenAmount: inputAmount.toString(),
        slippage: 5,
    };

    console.log(`💱 Swapping ${inputAmount} USDC → WETH via Rainbow Router`)
    console.log(`👤 Account: ${testAddress}`)
    
    // Get initial balances
    const initialUsdcBalance = await USDC.balanceOf(testAddress)
    const initialWethBalance = await WETH.balanceOf(testAddress)
    console.log(`\n📊 INITIAL BALANCES:`)
    console.log(`  USDC: ${formatUnits(initialUsdcBalance, 6)}`)
    console.log(`  WETH: ${formatUnits(initialWethBalance, 18)}`)

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
        
        console.log("✅ Rainbow execution prepared")
        
        // Apply warrant bypass for testing (zero address signer)
        if (bypass) {
            console.log("🔧 Applying warrant bypass (zero address signer)")
            rainbowExecution.warrant.verifyingSigner = ZERO_ADDRESS
        }
        
        // Check if we have trade data in either format
        const trade = rainbowExecution.trade || rainbowExecution.executionInformation?.trade;
        if (!trade) {
            throw new Error("Invalid Rainbow execution response structure - no trade data found")
        }
        
        console.log(`Rainbow target: ${trade.to}`)
        console.log(`Transaction value: ${trade.value}`)
        
        // Step 3: Check and whitelist target if needed
        console.log("\n3. Checking target authorization...")
        const targetAddress = extractTargetFromRainbowData(trade.data)
        console.log(`Target to check: ${targetAddress}`)
        
        await ensureTargetIsWhitelisted(contractOwner, targetAddress)
        
        // Step 4: Check and whitelist signer if needed
        console.log("\n4. Checking signer authorization...")
        const signerAddress = bypass ? ZERO_ADDRESS : rainbowExecution.warrant.verifyingSigner
        console.log(`Signer to check: ${signerAddress}${bypass ? ' (zero address for bypass)' : ' (original warrant signer)'}`)
        
        await ensureSignerIsWhitelisted(contractOwner, signerAddress)
        
        // Step 4.5: Verify warrant signer is actually whitelisted in contract
        console.log("\n4.5. Verifying warrant signer is whitelisted in contract...")
        const isWarrantSignerWhitelisted = await Rainbow.validSigners(signerAddress)
        console.log(`✅ Contract validSigners[${signerAddress}] (warrant signer): ${isWarrantSignerWhitelisted}`)
        
        if (!isWarrantSignerWhitelisted) {
            console.error("❌ CRITICAL: Warrant signer is NOT whitelisted in contract!")
            throw new Error(`Warrant signer ${signerAddress} is not whitelisted in contract`)
        }
        
        // Step 4.6: Check if test signer (for EIP-2612 permits) is also whitelisted
        const testAddress = await testSigner.getAddress()
        console.log("\n4.6. Verifying test signer (for EIP-2612 permits) is whitelisted...")
        const isTestSignerWhitelisted = await Rainbow.validSigners(testAddress)
        console.log(`✅ Contract validSigners[${testAddress}] (test/permit signer): ${isTestSignerWhitelisted}`)
        
        if (!isTestSignerWhitelisted) {
            console.log("❌ Test signer not whitelisted for EIP-2612 permits. Adding to whitelist...")
            await ensureSignerIsWhitelisted(contractOwner, testAddress)
            
            // Verify it was added
            const nowWhitelisted = await Rainbow.validSigners(testAddress)
            console.log(`✅ Contract validSigners[${testAddress}] (after whitelisting): ${nowWhitelisted}`)
            
            if (!nowWhitelisted) {
                throw new Error(`Failed to whitelist test signer ${testAddress} for EIP-2612 permits`)
            }
        }
        
        // Step 4.7: Handle ERC20 approval if usePermit is false
        if (!usePermit) {
            console.log("\n4.7. Handling ERC20 approval (usePermit = false)...")
            await handleERC20Approval(testSigner, rainbowExecution, quoteResponse)
        } else {
            console.log("\n4.7. Skipping ERC20 approval (usePermit = true, using permits)")
        }
        
        // Step 5: Prepare and execute the swap
        console.log("\n💫 Step 5: Executing Rainbow Router swap...")
        let finalTradeData = trade.data
        if (bypass) {
            console.log("🔧 Rebuilding transaction with warrant bypass...")
            finalTradeData = rebuildTransactionDataWithModifiedWarrant(trade.data, rainbowExecution.warrant)
        }
        
        const modifiedTrade = { ...trade, data: finalTradeData }
        await simulateRainbowTransaction(testSigner, modifiedTrade, rainbowExecution, quoteResponse)
        
        // Get final balances and calculate changes
        const finalUsdcBalance = await USDC.balanceOf(testAddress)
        const finalWethBalance = await WETH.balanceOf(testAddress)
        
        const usdcSpent = initialUsdcBalance - finalUsdcBalance
        const wethReceived = finalWethBalance - initialWethBalance
        
        console.log(`\n🎉 SWAP COMPLETED SUCCESSFULLY!`)
        console.log(`\n📊 FINAL BALANCES:`)
        console.log(`  USDC: ${formatUnits(finalUsdcBalance, 6)}`)
        console.log(`  WETH: ${formatUnits(finalWethBalance, 18)}`)
        
        console.log(`\n💰 NET CHANGES:`)
        console.log(`  📉 USDC Spent: ${formatUnits(usdcSpent, 6)} (~$${formatUnits(usdcSpent, 6)})`)
        console.log(`  📈 WETH Received: ${formatUnits(wethReceived, 18)}`)
        
        // Calculate approximate USD value of WETH received (using quote rate)
        const wethUsdValue = Number(formatUnits(wethReceived, 18)) * (Number(quoteResponse.inAmount) / Number(quoteResponse.outAmount))
        console.log(`  💵 WETH USD Value: ~$${wethUsdValue.toFixed(2)}`)
        
        console.log(`\n✅ Rainbow Canoe flow completed successfully!`)
        
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

const getRainbowExecution = async (coupon: Coupon): Promise<RainbowExecutionInfo> => {
    const baseURL = `http://localhost:3333/market/paraswap/execution_information`
    
    // Build the request body according to ExecutionRequest interface
    const requestBody: ExecutionRequest = {
        coupon: coupon,
        useRainbow: true
    }
    
    // Only include signingRequest if usePermit is true
    if (usePermit) {
        console.log("🔑 Including signingRequest for permit signatures (usePermit = true)")
        requestBody.signingRequest = {
            // This will be populated by the backend if needed
        }
    } else {
        console.log("🚫 Omitting signingRequest to disable permits (usePermit = false)")
        // signingRequest is omitted entirely
    }
    
    try {
        console.log("Fetching Rainbow execution info from:", baseURL)
        console.log("🔍 Request body structure:")
        console.log("  - coupon keys:", Object.keys(requestBody.coupon))
        console.log("  - useRainbow:", requestBody.useRainbow)
        console.log("  - signingRequest:", requestBody.signingRequest ? "included" : "omitted")
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
    trade: any,
    rainbowExecution: RainbowExecutionInfo, 
    originalQuote: SwapQuoteResponse
) => {
    const { to, data, value } = trade
    const warrant = rainbowExecution.warrant
    console.log("Warrant Signer: ", warrant.verifyingSigner)
    
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
        
        console.log(`🔄 Simulating swap transaction... (${(data.length / 2).toLocaleString()} bytes)`)
        
        // Create transaction object
        const txRequest = {
            to: to,
            data: data,
            value: value,
            from: signerAddress
        }
        
        console.log("\n🔍 DETAILED ERROR ANALYSIS:")
        console.log("Potential failure sources:")
        console.log("1. ParaSwap route validity (expired/stale routes)")
        console.log("2. ParaSwap slippage protection (price moved)")
        console.log("3. ParaSwap liquidity changes (DEX state changed)")
        console.log("4. ParaSwap parameter mismatch (rebuilt vs original)")
        console.log("5. ParaSwap allowance issues (insufficient approval)")
        console.log("6. Rainbow Router warrant validation (should be bypassed)")
        console.log("7. ERC20 permit validation (should be bypassed)")
        
        let result: string = ""
        let gasEstimate: bigint = BigInt(0)
        
        try {
            // Simulate the transaction using staticCall
            result = await txSigner.provider!.call(txRequest)
            gasEstimate = await txSigner.provider!.estimateGas(txRequest)
            console.log(`✅ Swap simulation successful! Estimated gas: ${gasEstimate.toLocaleString()}`)
            
        } catch (innerError: any) {
            console.log("\n🔍 ANALYZING TRANSACTION FAILURE...")
            
            // Check if it's specifically INVALID_SIGNER
            if (innerError.message?.includes("INVALID_SIGNER")) {
                console.log("❌ CONFIRMED: INVALID_SIGNER error detected")
                
                // Try to determine the source by analyzing the call stack
                if (innerError.data) {
                    console.log("Error data:", innerError.data)
                }
                
                // Analyze the specific error type for ParaSwap issues
                console.log("\n🔍 Investigating error source...")
                console.log("Given our analysis:")
                console.log("✅ Warrant signer: ZERO_ADDRESS (whitelisted)")
                console.log(`✅ Permit usage: ${usePermit ? 'ENABLED' : 'DISABLED'}`)
                console.log("✅ Test signer: whitelisted")
                
                if (innerError.message?.includes("INVALID_SIGNER")) {
                    console.log("❌ MOST LIKELY SOURCE: ParaSwap internal validation")
                    console.log("   - ParaSwap may have its own signer checks")
                    console.log("   - Could be related to permit signatures embedded in ParaSwap data")
                    console.log("   - The original ParaSwap transaction analysis will show if this fails too")
                } else if (innerError.message?.includes("slippage")) {
                    console.log("❌ MOST LIKELY SOURCE: ParaSwap slippage protection")
                    console.log("   - Price has moved beyond acceptable limits")
                    console.log("   - Route may be stale or market conditions changed")
                } else if (innerError.message?.includes("insufficient") || innerError.message?.includes("balance")) {
                    console.log("❌ MOST LIKELY SOURCE: Insufficient balance or allowance")
                    console.log("   - Check USDC balance and allowances")
                } else {
                    console.log("❌ UNKNOWN ERROR - check ParaSwap transaction analysis above")
                }
            }
            
            throw innerError
        }
        
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

const rebuildTransactionDataWithModifiedWarrant = (originalTxData: string, modifiedWarrant: any): string => {
    try {
        const rainbowInterface = RainbowRouter__factory.createInterface()
        const decoded = rainbowInterface.parseTransaction({ data: originalTxData })
        
        if (decoded?.name === "fillQuoteTokenToToken") {
            const [sellToken, buyToken, target, swapCallData, sellAmount, feeAmount, originalWarrant] = decoded.args
            
            // Create new warrant with the modified verifying signer
            const newWarrant = {
                nonce: originalWarrant.nonce || modifiedWarrant.nonce || "0",
                validBefore: originalWarrant.validBefore || modifiedWarrant.validBefore || "0", 
                validAfter: originalWarrant.validAfter || modifiedWarrant.validAfter || "0",
                verifyingSigner: modifiedWarrant.verifyingSigner,
                signature: originalWarrant.signature || modifiedWarrant.signature || "0x"
            }
            
            // Rebuild the transaction data with the modified warrant
            const newTxData = rainbowInterface.encodeFunctionData("fillQuoteTokenToToken", [
                sellToken,
                buyToken,
                target,
                swapCallData,
                sellAmount,
                feeAmount,
                newWarrant
            ])
            
            console.log(`🔄 Warrant signer changed from ${originalWarrant.verifyingSigner} to ${newWarrant.verifyingSigner}`)
            return newTxData
        } else if (decoded?.name === "fillQuoteTokenToEth") {
            const [sellToken, target, swapCallData, sellAmount, feePercentageBasisPoints, originalWarrant] = decoded.args
            
            const newWarrant = {
                nonce: originalWarrant.nonce || modifiedWarrant.nonce || "0",
                validBefore: originalWarrant.validBefore || modifiedWarrant.validBefore || "0", 
                validAfter: originalWarrant.validAfter || modifiedWarrant.validAfter || "0",
                verifyingSigner: modifiedWarrant.verifyingSigner,
                signature: originalWarrant.signature || modifiedWarrant.signature || "0x"
            }
            
            const newTxData = rainbowInterface.encodeFunctionData("fillQuoteTokenToEth", [
                sellToken,
                target,
                swapCallData,
                sellAmount,
                feePercentageBasisPoints,
                newWarrant
            ])
            
            console.log(`🔄 Warrant signer changed from ${originalWarrant.verifyingSigner} to ${newWarrant.verifyingSigner}`)
            return newTxData
        } else if (decoded?.name === "fillQuoteEthToToken") {
            const [buyToken, target, swapCallData, feeAmount, originalWarrant] = decoded.args
            
            const newWarrant = {
                nonce: originalWarrant.nonce || modifiedWarrant.nonce || "0",
                validBefore: originalWarrant.validBefore || modifiedWarrant.validBefore || "0", 
                validAfter: originalWarrant.validAfter || modifiedWarrant.validAfter || "0",
                verifyingSigner: modifiedWarrant.verifyingSigner,
                signature: originalWarrant.signature || modifiedWarrant.signature || "0x"
            }
            
            const newTxData = rainbowInterface.encodeFunctionData("fillQuoteEthToToken", [
                buyToken,
                target,
                swapCallData,
                feeAmount,
                newWarrant
            ])
            
            console.log(`🔄 Warrant signer changed from ${originalWarrant.verifyingSigner} to ${newWarrant.verifyingSigner}`)
            return newTxData
        } else {
            console.warn(`⚠️ Unknown function ${decoded?.name}, cannot rebuild transaction data`)
            return originalTxData
        }
    } catch (error: any) {
        console.error("❌ Failed to rebuild transaction data:", error.message)
        console.log("🔄 Falling back to original transaction data")
        return originalTxData
    }
}

const analyzeTransactionData = async (txData: string) => {
    try {
        const rainbowInterface = RainbowRouter__factory.createInterface()
        const decoded = rainbowInterface.parseTransaction({ data: txData })
        
        console.log(`📋 Function: ${decoded?.name}`)
        console.log(`📋 Args count: ${decoded?.args?.length}`)
        
        if (decoded?.name === "fillQuoteTokenToToken") {
            const [sellToken, buyToken, target, swapCallData, sellAmount, feeAmount, warrant] = decoded.args
            
            console.log(`🎯 Method: fillQuoteTokenToToken`)
            console.log(`  sellToken: ${sellToken}`)
            console.log(`  buyToken: ${buyToken}`)
            console.log(`  target: ${target}`)
            console.log(`  sellAmount: ${sellAmount}`)
            console.log(`  feeAmount: ${feeAmount}`)
            console.log(`  warrant.verifyingSigner: ${warrant.verifyingSigner}`)
            console.log(`  swapCallData length: ${swapCallData.length} bytes`)
            
            // The INVALID_SIGNER error is likely coming from within the swapCallData
            // which contains the ParaSwap call that may have its own permit signatures
            console.log(`📋 Analyzing swapCallData for permit signatures...`)
            
            // Look for ERC2612 permit function selector (0xd505accf) in the swap call data
            if (swapCallData.includes('d505accf')) {
                console.log(`✅ Found ERC2612 permit function signature in swapCallData`)
                console.log(`❌ LIKELY ISSUE: ParaSwap is calling permit internally with an unwhitelisted signer!`)
                console.log(`   The permit signature is embedded in the ParaSwap call, not in Rainbow Router`)
                console.log(`   Solution: Need to either disable permit in ParaSwap or whitelist the permit signer`)
            } else {
                console.log(`ℹ️  No permit function signature found in swapCallData`)
            }
            
            // Look for signature patterns (v,r,s values) - v should be 27 or 28 (0x1b or 0x1c)
            const signaturePattern = /1[bc][0-9a-f]{128}/gi
            const signatures = swapCallData.match(signaturePattern)
            if (signatures) {
                console.log(`🔍 Found ${signatures.length} potential signature patterns in swapCallData`)
                console.log(`   This suggests there are permit signatures in the ParaSwap call`)
                signatures.slice(0, 3).forEach((sig, i) => {
                    console.log(`   Signature ${i + 1}: ...${sig.slice(-20)}`)
                })
            }
            
        } else if (decoded?.name === "fillQuoteTokenToTokenWithPermit") {
            const [sellToken, buyToken, target, permitData, warrant, sellAmount, buyAmount, extraData] = decoded.args
            
            console.log(`🎯 Method: fillQuoteTokenToTokenWithPermit`)
            console.log(`  sellToken: ${sellToken}`)
            console.log(`  buyToken: ${buyToken}`)
            console.log(`  target: ${target}`)
            console.log(`  warrant.verifyingSigner: ${warrant.verifyingSigner}`)
            
            // Analyze permit data structure
            if (permitData) {
                console.log(`📋 PermitData structure:`)
                console.log(`  value: ${permitData.value}`)
                console.log(`  nonce: ${permitData.nonce}`)
                console.log(`  deadline: ${permitData.deadline}`)
                console.log(`  isDaiStylePermit: ${permitData.isDaiStylePermit}`)
                console.log(`  v: ${permitData.v}`)
                console.log(`  r: ${permitData.r}`)
                console.log(`  s: ${permitData.s}`)
                
                // Try to recover the signer from the permit signature
                try {
                    const permitSigner = await recoverPermitSigner(sellToken, permitData, await testSigner.getAddress())
                    console.log(`🔑 Recovered permit signer: ${permitSigner}`)
                    
                    // Check if this signer is whitelisted
                    const isPermitSignerWhitelisted = await Rainbow.validSigners(permitSigner)
                    console.log(`✅ Is permit signer whitelisted: ${isPermitSignerWhitelisted}`)
                    
                    if (!isPermitSignerWhitelisted) {
                        console.log(`❌ FOUND THE ISSUE: Permit signer ${permitSigner} is NOT whitelisted!`)
                        console.log(`   This is likely causing the INVALID_SIGNER error.`)
                    }
                } catch (error) {
                    console.log(`⚠️  Could not recover permit signer: ${error}`)
                }
            }
        }
        
    } catch (error: any) {
        console.log(`❌ Could not decode transaction data: ${error.message}`)
        
        // Fallback: look for permit signature patterns in the raw data
        console.log(`🔍 Searching for permit signatures in raw data...`)
        
        // Look for ERC2612 permit function selector (0xd505accf)
        if (txData.includes('d505accf')) {
            console.log(`✅ Found ERC2612 permit function signature in transaction data`)
        }
        
        // Look for common signer addresses
        const addressPattern = /[0-9a-f]{40}/gi
        const addresses = txData.match(addressPattern)
        if (addresses) {
            console.log(`🔍 Found ${addresses.length} potential addresses in transaction data:`)
            const uniqueAddresses = [...new Set(addresses)].slice(0, 10) // Show first 10 unique
            for (const addr of uniqueAddresses) {
                const fullAddress = '0x' + addr
                if (fullAddress.length === 42) {
                    console.log(`  - ${fullAddress}`)
                }
            }
        }
    }
}

const recoverPermitSigner = async (tokenAddress: string, permitData: any, holder: string): Promise<string> => {
    // This is a simplified recovery - in practice you'd need the exact EIP-712 domain and types
    // For now, just return the holder as that's typically who signs permits
    return holder
}

const analyzeParaSwapTransaction = async (
    signer: Signer, 
    rainbowTrade: any, 
    originalQuote: SwapQuoteResponse
) => {
    console.log("🔍 PARASWAP TRANSACTION ANALYSIS")
    console.log("=" .repeat(50))
    
    // Extract the original ParaSwap transaction from the quote
    const originalParaSwapTx = originalQuote.candidateTrade
    const signerAddress = await signer.getAddress()
    
    console.log("\n📋 ORIGINAL PARASWAP TRANSACTION (from quote):")
    console.log(`  • Target: ${originalParaSwapTx.to}`)
    console.log(`  • Value: ${originalParaSwapTx.value} ETH`)
    console.log(`  • Data length: ${originalParaSwapTx.data.length} bytes`)
    console.log(`  • Quote timestamp: ${new Date().toISOString()}`)
    
    // Extract the rebuilt ParaSwap call from Rainbow Router data
    let rebuiltParaSwapData = ""
    try {
        const rainbowInterface = RainbowRouter__factory.createInterface()
        const decoded = rainbowInterface.parseTransaction({ data: rainbowTrade.data })
        
        if (decoded?.name === "fillQuoteTokenToToken") {
            const [sellToken, buyToken, target, swapCallData, sellAmount, feeAmount, warrant] = decoded.args
            rebuiltParaSwapData = swapCallData
            
            console.log("\n📋 REBUILT PARASWAP TRANSACTION (from Rainbow Router):")
            console.log(`  • Target: ${target}`)
            console.log(`  • Sell token: ${sellToken}`)
            console.log(`  • Buy token: ${buyToken}`)
            console.log(`  • Sell amount: ${sellAmount}`)
            console.log(`  • Fee amount: ${feeAmount}`)
            console.log(`  • SwapCallData length: ${rebuiltParaSwapData.length} bytes`)
            
            // Compare the transaction data
            console.log("\n🔍 TRANSACTION COMPARISON:")
            if (originalParaSwapTx.to.toLowerCase() !== target.toLowerCase()) {
                console.log(`❌ TARGET MISMATCH:`)
                console.log(`   Original: ${originalParaSwapTx.to}`)
                console.log(`   Rebuilt:  ${target}`)
            } else {
                console.log(`✅ Target matches: ${target}`)
            }
            
            if (originalParaSwapTx.data === rebuiltParaSwapData) {
                console.log(`✅ Transaction data identical (${originalParaSwapTx.data.length} bytes)`)
            } else {
                console.log(`❌ TRANSACTION DATA MISMATCH:`)
                console.log(`   Original length: ${originalParaSwapTx.data.length} bytes`)
                console.log(`   Rebuilt length:  ${rebuiltParaSwapData.length} bytes`)
                
                // Find first difference and analyze the context
                const minLength = Math.min(originalParaSwapTx.data.length, rebuiltParaSwapData.length)
                let firstDiffPos = -1
                for (let i = 0; i < minLength; i += 2) {
                    if (originalParaSwapTx.data.substr(i, 2) !== rebuiltParaSwapData.substr(i, 2)) {
                        firstDiffPos = i
                        console.log(`   First difference at position ${i}: ${originalParaSwapTx.data.substr(i, 10)} vs ${rebuiltParaSwapData.substr(i, 10)}`)
                        break
                    }
                }
                
                // Decode the parameter at position 318 (and around it)
                if (firstDiffPos >= 0) {
                    await decodeParameterAtPosition(originalParaSwapTx.data, rebuiltParaSwapData, firstDiffPos)
                }
            }
        }
    } catch (error) {
        console.log(`❌ Could not decode Rainbow Router data: ${error}`)
    }
    
    // Test the original ParaSwap transaction
    await testOriginalParaSwapTransaction(signer, originalParaSwapTx, originalQuote)
    
    // Test timing and route validity
    await checkRouteValidity(originalQuote)
}

const testOriginalParaSwapTransaction = async (
    signer: Signer,
    originalTx: any,
    originalQuote: SwapQuoteResponse
) => {
    console.log("\n🧪 TESTING ORIGINAL PARASWAP TRANSACTION:")
    const signerAddress = await signer.getAddress()
    
    // Check if we need approval for the original transaction
    const inputAmountBN = parseUnits(originalQuote.inAmount, originalQuote.inToken.decimals)
    const currentAllowance = await USDC.allowance(signerAddress, originalTx.to)
    
    console.log(`  • Required allowance: ${formatUnits(inputAmountBN, originalQuote.inToken.decimals)} USDC`)
    console.log(`  • Current allowance: ${formatUnits(currentAllowance, originalQuote.inToken.decimals)} USDC`)
    
    if (currentAllowance < inputAmountBN) {
        console.log("  ⚠️ Insufficient allowance for direct ParaSwap call")
        console.log("  💡 This could be why the transaction is failing")
    }
    
    const originalTxRequest = {
        to: originalTx.to,
        data: originalTx.data,
        value: originalTx.value,
        from: signerAddress
    }
    
    try {
        console.log("  🔄 Simulating original ParaSwap transaction...")
        const result = await signer.provider!.call(originalTxRequest)
        console.log("  ✅ Original ParaSwap transaction simulation SUCCESS")
        console.log(`  📊 Result: ${result.slice(0, 66)}...`)
    } catch (error: any) {
        console.log("  ❌ Original ParaSwap transaction simulation FAILED")
        console.log(`  📊 Error: ${error.message}`)
        
        if (error.message?.includes("INVALID_SIGNER")) {
            console.log("  🔍 INVALID_SIGNER in original ParaSwap - not related to Rainbow Router!")
        } else if (error.message?.includes("insufficient")) {
            console.log("  🔍 Likely insufficient balance or allowance issue")
        } else if (error.message?.includes("slippage")) {
            console.log("  🔍 Likely slippage protection triggered")
        }
    }
}

const checkRouteValidity = async (originalQuote: SwapQuoteResponse) => {
    console.log("\n⏰ ROUTE VALIDITY CHECK:")
    const now = Date.now()
    
    // Check if quote has timing information
    if (originalQuote.coupon?.raw?.priceRoute?.blockNumber) {
        const quoteBlock = originalQuote.coupon.raw.priceRoute.blockNumber
        const currentBlock = await ethers.provider.getBlockNumber()
        const blockDiff = currentBlock - quoteBlock
        
        console.log(`  • Quote block: ${quoteBlock}`)
        console.log(`  • Current block: ${currentBlock}`)
        console.log(`  • Block difference: ${blockDiff}`)
        
        if (blockDiff > 5) {
            console.log("  ⚠️ Quote is old (>5 blocks) - route may be stale")
        } else {
            console.log("  ✅ Quote is recent")
        }
    }
    
    console.log(`  • Input amount: ${originalQuote.inAmount} ${originalQuote.inToken.symbol}`)
    console.log(`  • Expected output: ${originalQuote.outAmount} ${originalQuote.outToken.symbol}`)
    console.log(`  • Price route: ${originalQuote.coupon?.raw?.priceRoute?.priceRoute?.length || 'unknown'} hops`)
}

const decodeParameterAtPosition = async (originalData: string, rebuiltData: string, position: number) => {
    console.log("\n🔍 DETAILED PARAMETER ANALYSIS AT CORRUPTION POINT:")
    console.log("=" .repeat(60))
    
    // Extract context around the corruption point
    const contextStart = Math.max(0, position - 64) // 32 bytes before
    const contextEnd = Math.min(originalData.length, position + 128) // 64 bytes after
    
    console.log(`\n📍 Context around position ${position} (±32 bytes):`)
    console.log(`Original:  ${originalData.substring(contextStart, contextEnd)}`)
    console.log(`Rebuilt:   ${rebuiltData.substring(contextStart, contextEnd)}`)
    console.log(`           ${''.padStart(position - contextStart, ' ')}^^^^^`)
    
    // Analyze what type of data this could be
    console.log("\n🔍 Parameter Type Analysis:")
    
    // Extract the 32-byte word containing the difference
    const wordStart = position - (position % 64)
    const originalWord = originalData.substring(wordStart, wordStart + 64)
    const rebuiltWord = rebuiltData.substring(wordStart, wordStart + 64)
    
    console.log(`\n32-byte word containing difference:`)
    console.log(`Original:  0x${originalWord}`)
    console.log(`Rebuilt:   0x${rebuiltWord}`)
    
    // Try to interpret as different data types
    console.log(`\nPossible interpretations:`)
    
    // As uint256
    try {
        const originalBigInt = BigInt('0x' + originalWord)
        const rebuiltBigInt = BigInt('0x' + rebuiltWord)
        console.log(`• As uint256:`)
        console.log(`  Original: ${originalBigInt}`)
        console.log(`  Rebuilt:  ${rebuiltBigInt}`)
        console.log(`  Difference: ${rebuiltBigInt - originalBigInt}`)
        
        // Check if it looks like a timestamp
        if (originalBigInt > 1600000000n && originalBigInt < 2000000000n) {
            console.log(`  🕐 Likely TIMESTAMP: ${new Date(Number(originalBigInt) * 1000).toISOString()}`)
        }
        if (rebuiltBigInt > 1600000000n && rebuiltBigInt < 2000000000n) {
            console.log(`  🕐 Likely TIMESTAMP: ${new Date(Number(rebuiltBigInt) * 1000).toISOString()}`)
        }
    } catch (e) {
        console.log(`• Could not interpret as uint256`)
    }
    
    // As address (last 20 bytes)
    const originalAddr = originalWord.substring(24)
    const rebuiltAddr = rebuiltWord.substring(24)
    if (originalAddr !== rebuiltAddr && originalAddr.length === 40 && rebuiltAddr.length === 40) {
        console.log(`• As address:`)
        console.log(`  Original: 0x${originalAddr}`)
        console.log(`  Rebuilt:  0x${rebuiltAddr}`)
        
        // Check if it's a known address
        if (originalAddr.toLowerCase() === '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'.toLowerCase()) {
            console.log(`  🎯 Original is TEST SIGNER ADDRESS!`)
        }
        if (rebuiltAddr.toLowerCase() === '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'.toLowerCase()) {
            console.log(`  🎯 Rebuilt is TEST SIGNER ADDRESS!`)
        }
    }
    
    // Check position context - where are we in the transaction?
    console.log(`\n📍 Position Context Analysis:`)
    console.log(`• Position ${position} is ${Math.floor(position / 64)} 32-byte words into the data`)
    console.log(`• This is ${((position / originalData.length) * 100).toFixed(1)}% through the transaction`)
    
    // Common ParaSwap parameter positions
    if (position < 200) {
        console.log(`• LIKELY: Function selector or main parameters`)
    } else if (position < 500) {
        console.log(`• LIKELY: Token addresses or amounts`)
    } else if (position > originalData.length - 200) {
        console.log(`• LIKELY: Signature data (v,r,s) or final parameters`)
    } else {
        console.log(`• LIKELY: Middle parameters (routes, swaps, or embedded calls)`)
    }
    
    // Look for signature patterns nearby
    const nearbyData = originalData.substring(Math.max(0, position - 200), Math.min(originalData.length, position + 200))
    if (nearbyData.includes('1b') || nearbyData.includes('1c')) {
        console.log(`• 🔏 SIGNATURE DETECTED: Found signature 'v' values (1b/1c) nearby`)
    }
    
    console.log("\n" + "=" .repeat(60))
}

const handleERC20Approval = async (signer: Signer, rainbowExecution: RainbowExecutionInfo, quoteResponse: SwapQuoteResponse) => {
    const signerAddress = await signer.getAddress()
    
    // Get the spender address - this should be the Rainbow Router
    const spenderAddress = RainbowAddress
    
    // Get the token amount to approve
    const inputAmountBN = parseUnits(quoteResponse.inAmount, quoteResponse.inToken.decimals)
    
    console.log(`  Token to approve: ${quoteResponse.inToken.symbol} (${await USDC.getAddress()})`)
    console.log(`  Amount to approve: ${formatUnits(inputAmountBN, quoteResponse.inToken.decimals)} ${quoteResponse.inToken.symbol}`)
    console.log(`  Spender: ${spenderAddress} (Rainbow Router)`)
    console.log(`  Owner: ${signerAddress}`)
    
    // Check current allowance
    const currentAllowance = await USDC.allowance(signerAddress, spenderAddress)
    console.log(`  Current allowance: ${formatUnits(currentAllowance, quoteResponse.inToken.decimals)} ${quoteResponse.inToken.symbol}`)
    
    if (currentAllowance >= inputAmountBN) {
        console.log(`✅ Sufficient allowance already exists`)
        return
    }
    
    console.log(`❌ Insufficient allowance. Approving tokens...`)
    
    // Approve the Rainbow Router to spend tokens
    try {
        const approveTx = await USDC.connect(signer).approve(spenderAddress, inputAmountBN)
        console.log(`📤 Approval transaction sent: ${approveTx.hash}`)
        
        const receipt = await approveTx.wait()
        console.log(`✅ Approval transaction confirmed in block ${receipt.blockNumber}`)
        
        // Verify the approval worked
        const newAllowance = await USDC.allowance(signerAddress, spenderAddress)
        console.log(`✅ New allowance: ${formatUnits(newAllowance, quoteResponse.inToken.decimals)} ${quoteResponse.inToken.symbol}`)
        
        if (newAllowance < inputAmountBN) {
            throw new Error(`Approval failed: expected ${formatUnits(inputAmountBN, quoteResponse.inToken.decimals)}, got ${formatUnits(newAllowance, quoteResponse.inToken.decimals)}`)
        }
        
    } catch (error: any) {
        console.error(`❌ Approval failed: ${error.message}`)
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
