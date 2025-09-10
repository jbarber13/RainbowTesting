import { formatUnits, parseUnits } from "ethers";
import {
    setupTestEnvironment,
    getRouterQuote,
    getRainbowExecution,
    ensureTargetIsWhitelisted,
    ensureSignerIsWhitelisted,
    handleERC20Approval,
    extractTargetFromRainbowData,
    rebuildTransactionDataWithModifiedWarrant,
    executeRainbowTransaction,
    reportBalanceChanges,
    ZERO_ADDRESS,
    BACKEND_WARRANT_SIGNER
} from "../util/canoeHelper";
import { canoeParams, SwapQuoteResponse } from "../util/canoeHelper";
import { RainbowExecutionInfo } from "./canoeInterface";

// Configuration
const bypass = false;
const usePermit = false;
const testAmount = "5"; // 5 USDC for better test success rate
const simulateOnly = true

async function main() {
    console.log("STARTING Rainbow Canoe Testing")
    
    // Use the generic setup function
    const setup = await setupTestEnvironment(usePermit, bypass);
    
    await testRainbowCanoeFlow(setup)
}

const testRainbowCanoeFlow = async (setup: any) => {
    console.log("\n🌈 RAINBOW CANOE SWAP")
    
    const { testSigner, contractOwner, mainnet, Rainbow, USDC, WETH, config } = setup;
    const testAddress = await testSigner.getAddress()
    
    // Set up test parameters
    const params: canoeParams = {
        chain: "optimism",
        account: testAddress,
        isExactIn: true,
        inTokenAddress: await USDC.getAddress(),
        outTokenAddress: await WETH.getAddress(),
        inTokenAmount: testAmount,
        slippage: 5000, // 50% slippage tolerance (5000 bips) for testing
    };

    console.log(`💱 Swapping ${testAmount} USDC → WETH via Rainbow Router (ODOS backend, 50% slippage)`)
    console.log(`👤 Account: ${testAddress}`)
    
    // Get initial balances
    const initialUsdcBalance = await USDC.balanceOf(testAddress)
    const initialWethBalance = await WETH.balanceOf(testAddress)
    console.log(`\n📊 INITIAL BALANCES:`)
    console.log(`  USDC: ${formatUnits(initialUsdcBalance, 6)}`)
    console.log(`  WETH: ${formatUnits(initialWethBalance, 18)}`)

    try {
        // Step 1: Get ODOS quote with coupon
        console.log("\n1. Getting ODOS quote...")
        const quoteResponse: SwapQuoteResponse = await getRouterQuote("odos", params)
        
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
        const rainbowExecution = await getRainbowExecution(quoteResponse.coupon, "odos", usePermit)
        
        console.log("✅ Rainbow execution prepared")
        
        // Debug the response structure
        console.log("🔍 Rainbow execution structure:")
        console.log("  - Keys:", Object.keys(rainbowExecution))
        console.log("  - Has warrant:", !!rainbowExecution.warrant)
        if (rainbowExecution.warrant) {
            console.log("  - Warrant keys:", Object.keys(rainbowExecution.warrant))
            console.log("  - Warrant verifyingSigner from API:", rainbowExecution.warrant.verifyingSigner)
            console.log("  - Expected backend signer:", BACKEND_WARRANT_SIGNER)
            console.log("  - Signers match:", rainbowExecution.warrant.verifyingSigner.toLowerCase() === BACKEND_WARRANT_SIGNER.toLowerCase())
            console.log("  - Warrant nonce:", rainbowExecution.warrant.nonce)
            console.log("  - Warrant validBefore:", rainbowExecution.warrant.validBefore)
            console.log("  - Warrant validAfter:", rainbowExecution.warrant.validAfter)
            console.log("  - Warrant signature:", rainbowExecution.warrant.signature)
            console.log("  - Warrant signature length:", rainbowExecution.warrant.signature?.length || 'undefined')
            
            // Log warrant typed data if available
            if (rainbowExecution.warrantTypedData) {
                console.log("🔍 Warrant Typed Data from API:")
                console.log("  - Domain:", JSON.stringify(rainbowExecution.warrantTypedData.domain, null, 2))
                console.log("  - Message:", JSON.stringify(rainbowExecution.warrantTypedData.message, null, 2))
                console.log("  - Types:", JSON.stringify(rainbowExecution.warrantTypedData.types, null, 2))
            }
        }
        
        // Apply warrant bypass for testing (zero address signer)
        if (bypass) {
            if (!rainbowExecution.warrant) {
                console.log("⚠️  ODOS backend doesn't return warrant data - this DEX may not use the warrant system")
                console.log("🔧 Skipping warrant bypass (not needed for this DEX)")
            } else {
                console.log("🔧 Applying warrant bypass (zero address signer)")
                console.log("  Original signer:", rainbowExecution.warrant.verifyingSigner)
                rainbowExecution.warrant.verifyingSigner = ZERO_ADDRESS
                console.log("  ✅ Overridden with zero address:", ZERO_ADDRESS)
            }
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
        
        // On live networks, only the testing account has owner privileges
        const authSigner = mainnet ? testSigner : contractOwner
        await ensureTargetIsWhitelisted(authSigner, Rainbow, targetAddress)
        
        // Step 4: Check and whitelist signer if needed (only if warrant exists)
        if (rainbowExecution.warrant) {
            console.log("\n4. Checking signer authorization...")
            const signerAddress = bypass ? ZERO_ADDRESS : rainbowExecution.warrant.verifyingSigner
            console.log(`Signer to check: ${signerAddress}${bypass ? ' (zero address for bypass)' : ' (original warrant signer)'}`)
            
            // On live networks, only the testing account has owner privileges
            const authSigner = mainnet ? testSigner : contractOwner
            await ensureSignerIsWhitelisted(authSigner, Rainbow, signerAddress)
        } else {
            console.log("\n4. Skipping signer authorization (no warrant system for this DEX)")
        }
        
        // Step 4.5: Verify warrant signer is actually whitelisted in contract (only if warrant exists)
        if (rainbowExecution.warrant) {
            console.log("\n4.5. Verifying warrant signer is whitelisted in contract...")
            const signerAddress = bypass ? ZERO_ADDRESS : rainbowExecution.warrant.verifyingSigner
            const isWarrantSignerWhitelisted = await Rainbow.validSigners(signerAddress)
            console.log(`✅ Contract validSigners[${signerAddress}] (warrant signer): ${isWarrantSignerWhitelisted}`)
            
            if (!isWarrantSignerWhitelisted) {
                console.error("❌ CRITICAL: Warrant signer is NOT whitelisted in contract!")
                throw new Error(`Warrant signer ${signerAddress} is not whitelisted in contract`)
            }
        } else {
            console.log("\n4.5. Skipping warrant signer verification (no warrant system for this DEX)")
        }
        
        // Step 4.6: Check if test signer (for EIP-2612 permits) is also whitelisted
        const testAddress = await testSigner.getAddress()
        console.log("\n4.6. Verifying test signer (for EIP-2612 permits) is whitelisted...")
        const isTestSignerWhitelisted = await Rainbow.validSigners(testAddress)
        console.log(`✅ Contract validSigners[${testAddress}] (test/permit signer): ${isTestSignerWhitelisted}`)
        
        if (!isTestSignerWhitelisted) {
            console.log("❌ Test signer not whitelisted for EIP-2612 permits. Adding to whitelist...")
            // On live networks, only the testing account has owner privileges
            const authSigner = mainnet ? testSigner : contractOwner
            await ensureSignerIsWhitelisted(authSigner, Rainbow, testAddress)
            
            // Verify it was added
            const nowWhitelisted = await Rainbow.validSigners(testAddress)
            console.log(`✅ Contract validSigners[${testAddress}] (after whitelisting): ${nowWhitelisted}`)
            
            if (!nowWhitelisted) {
                throw new Error(`Failed to whitelist test signer ${testAddress} for EIP-2612 permits`)
            }
        }
        
        // Step 4.65: Check if backend warrant signer is whitelisted
        console.log("\n4.65. Verifying backend warrant signer is whitelisted...")
        const isBackendSignerWhitelisted = await Rainbow.validSigners(BACKEND_WARRANT_SIGNER)
        console.log(`✅ Contract validSigners[${BACKEND_WARRANT_SIGNER}] (backend warrant signer): ${isBackendSignerWhitelisted}`)
        
        if (!isBackendSignerWhitelisted) {
            console.log("❌ Backend warrant signer not whitelisted. Adding to whitelist...")
            // On live networks, only the testing account has owner privileges
            const authSigner = mainnet ? testSigner : contractOwner
            await ensureSignerIsWhitelisted(authSigner, Rainbow, BACKEND_WARRANT_SIGNER)
            
            // Verify it was added
            const nowWhitelistedBackend = await Rainbow.validSigners(BACKEND_WARRANT_SIGNER)
            console.log(`✅ Contract validSigners[${BACKEND_WARRANT_SIGNER}] (after whitelisting): ${nowWhitelistedBackend}`)
            
            if (!nowWhitelistedBackend) {
                throw new Error(`Failed to whitelist backend warrant signer ${BACKEND_WARRANT_SIGNER}`)
            }
        }
        
        // Step 4.7: Handle ERC20 approval if usePermit is false
        if (!usePermit) {
            console.log("\n4.7. Handling ERC20 approval (usePermit = false)...")
            const inputAmountBN = parseUnits(quoteResponse.inAmount, quoteResponse.inToken.decimals)
            await handleERC20Approval(testSigner, USDC, config.rainbowAddress, inputAmountBN)
        } else {
            console.log("\n4.7. Skipping ERC20 approval (usePermit = true, using permits)")
        }
        
        // Step 4: Prepare and execute the swap
        console.log("\n💫 Step 4: Executing Rainbow Router swap...")
        
        let finalTradeData = trade.data
        if (bypass && rainbowExecution.warrant) {
            console.log("🔧 Rebuilding transaction with warrant bypass...")
            finalTradeData = rebuildTransactionDataWithModifiedWarrant(trade.data, rainbowExecution.warrant)
        } else if (bypass) {
            console.log("🔧 No warrant reconstruction needed (DEX doesn't use warrants)")
        }
        
        const modifiedTrade = { ...trade, data: finalTradeData }
        await executeRainbowTransaction(testSigner, modifiedTrade, rainbowExecution, quoteResponse, config.rainbowAddress)
        
        // Get final balances and calculate changes using generic helper
        await reportBalanceChanges(
            testSigner,
            USDC,
            WETH,
            initialUsdcBalance,
            initialWethBalance,
            quoteResponse
        )
        
        console.log(`\n✅ Rainbow Canoe flow completed successfully!`)
        
    } catch (error: any) {
        console.error("\n❌ Rainbow Canoe flow failed:", error.message)
        if (error.response?.data) {
            console.error("API Error Details:", error.response.data)
        }
        throw error
    }
}

main().catch(console.error);