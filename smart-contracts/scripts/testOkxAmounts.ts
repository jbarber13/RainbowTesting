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
    BACKEND_WARRANT_SIGNER,
    TestSetup
} from "../util/canoeHelper";
import { canoeParams } from "../util/canoeHelper";

async function testOkxAmounts() {
    console.log("🧪 TESTING OKX WITH DIFFERENT AMOUNTS");
    
    // Test different amounts from small to large
    const testAmounts = ["0.1", "0.5", "1", "2", "5", "10"];
    
    for (const amount of testAmounts) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`🧪 TESTING OKX WITH ${amount} USDC`);
        console.log(`${"=".repeat(60)}`);
        
        try {
            const setup = await setupTestEnvironment(false, false);
            const { testSigner, contractOwner, mainnet, Rainbow, USDC, WETH, config } = setup;
            const testAddress = await testSigner.getAddress();
            
            const inputAmount = parseUnits(amount, 6);
            const params: canoeParams = {
                chain: "optimism",
                account: testAddress,
                isExactIn: true,
                inTokenAddress: await USDC.getAddress(),
                outTokenAddress: await WETH.getAddress(),
                inTokenAmount: amount,
                slippage: 5000, // 50% slippage
            };

            console.log(`💱 Testing ${amount} USDC → WETH via OKX`);
            
            // Step 1: Get quote
            console.log(`\n1. Getting OKX quote...`);
            const quoteResponse = await getRouterQuote("okx", params);
            
            if (!quoteResponse || !quoteResponse.coupon) {
                throw new Error("Failed to get valid quote response");
            }
            
            console.log(`Quote: ${quoteResponse.inAmount} ${quoteResponse.inToken.symbol} -> ${quoteResponse.outAmount} ${quoteResponse.outToken.symbol}`);
            
            // Step 2: Get Rainbow execution
            console.log(`\n2. Getting Rainbow execution...`);
            const rainbowExecution = await getRainbowExecution(quoteResponse.coupon, "okx", false);
            
            const trade = rainbowExecution.trade || rainbowExecution.executionInformation?.trade;
            if (!trade) {
                throw new Error("No trade data found");
            }
            
            const targetAddress = extractTargetFromRainbowData(trade.data);
            console.log(`Target: ${targetAddress}`);
            console.log(`Data length: ${trade.data.length} chars`);
            
            // Step 3: Set up permissions quickly
            const authSigner = mainnet ? testSigner : contractOwner;
            await ensureTargetIsWhitelisted(authSigner, Rainbow, targetAddress);
            await ensureSignerIsWhitelisted(authSigner, Rainbow, rainbowExecution.warrant.verifyingSigner);
            await ensureSignerIsWhitelisted(authSigner, Rainbow, testAddress);
            await ensureSignerIsWhitelisted(authSigner, Rainbow, BACKEND_WARRANT_SIGNER);
            await handleERC20Approval(testSigner, USDC, config.rainbowAddress, inputAmount);
            
            // Step 4: Test simulation
            console.log(`\n3. Testing simulation...`);
            
            try {
                const gasEstimate = await hre.ethers.provider.estimateGas({
                    to: trade.to,
                    data: trade.data,
                    value: trade.value,
                    from: testAddress
                });
                
                console.log(`✅ ${amount} USDC - SIMULATION SUCCESS! Gas: ${gasEstimate.toLocaleString()}`);
                
                // If simulation works, let's try the actual execution
                console.log(`\n4. Attempting execution...`);
                const tx = await testSigner.sendTransaction({
                    to: trade.to,
                    data: trade.data,
                    value: trade.value
                });
                
                const receipt = await tx.wait();
                console.log(`🎉 ${amount} USDC - EXECUTION SUCCESS! Gas used: ${receipt!.gasUsed.toLocaleString()}`);
                console.log(`TX: ${tx.hash}`);
                
                // Report balances
                const finalUsdcBalance = await USDC.balanceOf(testAddress);
                const finalWethBalance = await WETH.balanceOf(testAddress);
                console.log(`Final USDC: ${formatUnits(finalUsdcBalance, 6)}`);
                console.log(`Final WETH: ${formatUnits(finalWethBalance, 18)}`);
                
                return; // Exit on first success
                
            } catch (simError: any) {
                console.log(`❌ ${amount} USDC - SIMULATION FAILED: ${simError.message}`);
                
                if (simError.message.includes('SafeERC20: low-level call failed')) {
                    console.log(`   Still hitting SafeERC20 error - trying next amount...`);
                } else {
                    console.log(`   Different error: ${simError.message}`);
                }
            }
            
        } catch (error: any) {
            console.error(`❌ ${amount} USDC failed:`, error.message);
        }
    }
    
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎯 CONCLUSION`);
    console.log(`${"=".repeat(60)}`);
    console.log(`All tested amounts failed with OKX routing.`);
    console.log(`This suggests the issue is not trade size but:`);
    console.log(`  - OKX aggregator routing to inactive/broken pools`);
    console.log(`  - OKX using outdated routing data`);
    console.log(`  - Fundamental incompatibility with current Optimism state`);
    console.log(`\nRecommendation: Contact backend service to investigate OKX routing`);
}

testOkxAmounts().catch(console.error);