import { formatUnits, parseUnits } from "ethers";
import hre from "hardhat";
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
    BACKEND_WARRANT_SIGNER,
    TestSetup
} from "../util/canoeHelper";
import { canoeParams } from "../util/canoeHelper";

const bypass = false;
const usePermit = false;
const testAmount = "5";

async function debugOKX() {
    console.log("🐛 DEBUG: Testing OKX with detailed analysis");
    
    // Test with different slippage values
    const slippageValues = [500, 1000, 5000, 10000]; // 5%, 10%, 50%, 100%
    
    for (const slippage of slippageValues) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`🧪 TESTING OKX WITH ${slippage/100}% SLIPPAGE`);
        console.log(`${"=".repeat(60)}`);
        
        try {
            const setup = await setupTestEnvironment(usePermit, bypass);
            const { testSigner, contractOwner, mainnet, Rainbow, USDC, WETH, config } = setup;
            const testAddress = await testSigner.getAddress();
            
            const inputAmount = parseUnits(testAmount, 6);
            const params: canoeParams = {
                chain: "optimism",
                account: testAddress,
                isExactIn: true,
                inTokenAddress: await USDC.getAddress(),
                outTokenAddress: await WETH.getAddress(),
                inTokenAmount: testAmount,
                slippage: slippage,
            };

            console.log(`💱 Testing ${testAmount} USDC → WETH via OKX (${slippage/100}% slippage)`);
            
            // Get initial balances
            const initialUsdcBalance = await USDC.balanceOf(testAddress);
            const initialWethBalance = await WETH.balanceOf(testAddress);
            console.log(`📊 Initial USDC: ${formatUnits(initialUsdcBalance, 6)}`);
            console.log(`📊 Initial WETH: ${formatUnits(initialWethBalance, 18)}`);

            // Step 1: Get quote
            console.log(`\n1. Getting OKX quote...`);
            const quoteResponse = await getRouterQuote("okx", params);
            
            if (!quoteResponse || !quoteResponse.coupon) {
                throw new Error("Failed to get valid quote response");
            }
            
            console.log(`Quote: ${quoteResponse.inAmount} ${quoteResponse.inToken.symbol} -> ${quoteResponse.outAmount} ${quoteResponse.outToken.symbol}`);
            
            // Debug the quote response structure
            console.log("🔍 Quote Response Analysis:");
            console.log("  - Keys:", Object.keys(quoteResponse));
            if (quoteResponse.candidateTrade) {
                console.log("  - candidateTrade.to:", quoteResponse.candidateTrade.to);
                console.log("  - candidateTrade.data length:", quoteResponse.candidateTrade.data?.length || 0);
                console.log("  - candidateTrade.value:", quoteResponse.candidateTrade.value);
            }
            
            // Step 2: Get Rainbow execution
            console.log(`\n2. Getting Rainbow execution for OKX...`);
            const rainbowExecution = await getRainbowExecution(quoteResponse.coupon, "okx", usePermit);
            
            console.log("✅ Rainbow execution prepared");
            
            // Debug the execution response structure
            console.log("🔍 Rainbow Execution Analysis:");
            console.log("  - Keys:", Object.keys(rainbowExecution));
            if (rainbowExecution.warrant) {
                console.log("  - Warrant signer:", rainbowExecution.warrant.verifyingSigner);
                console.log("  - Backend signer match:", rainbowExecution.warrant.verifyingSigner.toLowerCase() === BACKEND_WARRANT_SIGNER.toLowerCase());
            }
            
            const trade = rainbowExecution.trade || rainbowExecution.executionInformation?.trade;
            if (!trade) {
                throw new Error("Invalid Rainbow execution response - no trade data found");
            }
            
            console.log(`Rainbow target: ${trade.to}`);
            console.log(`Transaction data length: ${trade.data.length} characters`);
            console.log(`Transaction value: ${trade.value}`);
            
            // Debug transaction data structure
            console.log("🔍 Transaction Data Analysis:");
            console.log("  - First 100 chars:", trade.data.substring(0, 100));
            console.log("  - Method signature:", trade.data.substring(0, 10));
            
            // Step 3: Ensure all permissions are in place
            const targetAddress = extractTargetFromRainbowData(trade.data);
            const authSigner = mainnet ? testSigner : contractOwner;
            await ensureTargetIsWhitelisted(authSigner, Rainbow, targetAddress);
            
            if (rainbowExecution.warrant) {
                const signerAddress = bypass ? ZERO_ADDRESS : rainbowExecution.warrant.verifyingSigner;
                await ensureSignerIsWhitelisted(authSigner, Rainbow, signerAddress);
            }
            
            await ensureSignerIsWhitelisted(authSigner, Rainbow, testAddress);
            await ensureSignerIsWhitelisted(authSigner, Rainbow, BACKEND_WARRANT_SIGNER);
            
            if (!usePermit) {
                await handleERC20Approval(testSigner, USDC, config.rainbowAddress, inputAmount);
            }
            
            // Step 4: Check balances and allowances right before execution
            console.log("\n🔍 Pre-execution State Check:");
            const preUsdcBalance = await USDC.balanceOf(testAddress);
            const preWethBalance = await WETH.balanceOf(testAddress);
            const allowance = await USDC.allowance(testAddress, config.rainbowAddress);
            console.log(`  - USDC Balance: ${formatUnits(preUsdcBalance, 6)}`);
            console.log(`  - WETH Balance: ${formatUnits(preWethBalance, 18)}`);
            console.log(`  - USDC Allowance: ${formatUnits(allowance, 6)}`);
            console.log(`  - Required Amount: ${formatUnits(inputAmount, 6)}`);
            console.log(`  - Sufficient Allowance: ${allowance >= inputAmount}`);
            
            // Step 5: Execute transaction with detailed logging
            console.log(`\n5. Executing OKX swap...`);
            
            let finalTradeData = trade.data;
            if (bypass && rainbowExecution.warrant) {
                console.log("🔧 Rebuilding transaction with warrant bypass...");
                finalTradeData = rebuildTransactionDataWithModifiedWarrant(trade.data, rainbowExecution.warrant);
            }
            
            const modifiedTrade = { ...trade, data: finalTradeData };
            
            // Try to simulate first to get more detailed error
            try {
                console.log("🔄 Simulating transaction...");
                const gasEstimate = await hre.ethers.provider.estimateGas({
                    to: modifiedTrade.to,
                    data: modifiedTrade.data,
                    value: modifiedTrade.value,
                    from: testAddress
                });
                console.log(`✅ Simulation successful! Gas estimate: ${gasEstimate.toLocaleString()}`);
                
                // Execute the actual transaction
                const executionResult = await executeRainbowTransaction(
                    testSigner, 
                    modifiedTrade, 
                    rainbowExecution, 
                    quoteResponse,
                    config.rainbowAddress
                );
                
                console.log(`✅ OKX swap successful with ${slippage/100}% slippage!`);
                
                await reportBalanceChanges(
                    testSigner,
                    USDC,
                    WETH,
                    initialUsdcBalance,
                    initialWethBalance,
                    quoteResponse
                );
                
                return; // Success, exit the loop
                
            } catch (simulationError: any) {
                console.error(`❌ Simulation failed with ${slippage/100}% slippage:`, simulationError.message);
                if (simulationError.data) {
                    console.error("Error data:", simulationError.data);
                }
                
                // Try to decode the error more
                if (simulationError.reason) {
                    console.error("Detailed reason:", simulationError.reason);
                }
            }
            
        } catch (error: any) {
            console.error(`❌ Test failed with ${slippage/100}% slippage:`, error.message);
        }
    }
    
    console.log("\n❌ All slippage values failed. Issue appears to be fundamental to OKX routing.");
}

debugOKX().catch(console.error);