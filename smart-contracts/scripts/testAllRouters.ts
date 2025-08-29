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
import { canoeParams } from "../scripts/canoeHelper";

// Configuration
const bypass = false; // Set to true to bypass warrant validation
const usePermit = false; // Set to true to use ERC-2612 permits
const testAmount = "5"; // 5 USDC for better test success rate

// All available routers to test
const ROUTERS = [
    "airswap",
    "cowswap", 
    "enso",
    "icecreamswap",
    "kyberswap",
    "odos",
    "okx",
    "oneinch",
    "openocean",
    "paraswap",
    "unizen",
    "usor",
    "zeroex"
];

interface RouterTestResult {
    router: string;
    success: boolean;
    error?: string;
    gasUsed?: string;
    txHash?: string;
    balanceChanges?: {
        usdcSpent: string;
        wethReceived: string;
        wethUsdValue: string;
    };
}

async function main() {
    console.log("🚀 STARTING COMPREHENSIVE ROUTER TESTING");
    console.log(`Testing ${ROUTERS.length} routers: ${ROUTERS.join(", ")}`);
    
    const results: RouterTestResult[] = [];
    const setup = await setupTestEnvironment(usePermit, bypass);
    
    console.log(`\n💱 Test Parameters:`);
    console.log(`  Amount: ${testAmount} USDC → WETH`);
    console.log(`  Slippage: 50% (for testing reliability)`);
    console.log(`  UsePermit: ${usePermit}`);
    console.log(`  Bypass: ${bypass}`);
    
    // Test each router
    for (const router of ROUTERS) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`🧪 TESTING ROUTER: ${router.toUpperCase()}`);
        console.log(`${"=".repeat(60)}`);
        
        try {
            const result = await testRouter(router, setup);
            results.push(result);
            
            if (result.success) {
                console.log(`✅ ${router.toUpperCase()} - SUCCESS`);
            } else {
                console.log(`❌ ${router.toUpperCase()} - FAILED: ${result.error}`);
            }
        } catch (error: any) {
            console.log(`❌ ${router.toUpperCase()} - FAILED: ${error.message}`);
            results.push({
                router,
                success: false,
                error: error.message
            });
        }
        
        // Add delay between tests to avoid rate limiting
        if (ROUTERS.indexOf(router) < ROUTERS.length - 1) {
            console.log("⏱️  Waiting 2 seconds before next test...");
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    // Print comprehensive results
    printTestSummary(results);
}

async function testRouter(router: string, setup: TestSetup): Promise<RouterTestResult> {
    const { testSigner, contractOwner, mainnet, Rainbow, USDC, WETH, config } = setup;
    const testAddress = await testSigner.getAddress();
    
    // Set up test parameters
    const inputAmount = parseUnits(testAmount, 6);
    const params: canoeParams = {
        chain: "optimism",
        account: testAddress,
        isExactIn: true,
        inTokenAddress: await USDC.getAddress(),
        outTokenAddress: await WETH.getAddress(),
        inTokenAmount: testAmount,
        slippage: 5000, // 50% slippage tolerance for testing
    };

    console.log(`💱 Testing ${testAmount} USDC → WETH via ${router.toUpperCase()}`);
    
    // Get initial balances
    const initialUsdcBalance = await USDC.balanceOf(testAddress);
    const initialWethBalance = await WETH.balanceOf(testAddress);
    console.log(`📊 Initial USDC: ${formatUnits(initialUsdcBalance, 6)}`);
    console.log(`📊 Initial WETH: ${formatUnits(initialWethBalance, 18)}`);

    try {
        // Step 1: Get quote
        console.log(`\n1. Getting ${router.toUpperCase()} quote...`);
        const quoteResponse = await getRouterQuote(router, params);
        
        if (!quoteResponse || !quoteResponse.coupon) {
            throw new Error("Failed to get valid quote response");
        }
        
        console.log(`Quote: ${quoteResponse.inAmount} ${quoteResponse.inToken.symbol} -> ${quoteResponse.outAmount} ${quoteResponse.outToken.symbol}`);
        
        // Step 2: Get Rainbow execution
        console.log(`\n2. Getting Rainbow execution for ${router.toUpperCase()}...`);
        const rainbowExecution = await getRainbowExecution(quoteResponse.coupon, router, usePermit);
        
        console.log("✅ Rainbow execution prepared");
        
        // Debug warrant info
        if (rainbowExecution.warrant) {
            console.log(`  - Warrant signer: ${rainbowExecution.warrant.verifyingSigner}`);
            console.log(`  - Backend signer match: ${rainbowExecution.warrant.verifyingSigner.toLowerCase() === BACKEND_WARRANT_SIGNER.toLowerCase()}`);
        } else {
            console.log(`  - No warrant (${router} doesn't use warrant system)`);
        }
        
        // Apply bypass if enabled
        if (bypass && rainbowExecution.warrant) {
            console.log("🔧 Applying warrant bypass (zero address signer)");
            rainbowExecution.warrant.verifyingSigner = ZERO_ADDRESS;
        }
        
        // Get trade data
        const trade = rainbowExecution.trade || rainbowExecution.executionInformation?.trade;
        if (!trade) {
            throw new Error("Invalid Rainbow execution response - no trade data found");
        }
        
        console.log(`Rainbow target: ${trade.to}`);
        
        // Step 3: Whitelist target
        console.log(`\n3. Checking target authorization...`);
        const targetAddress = extractTargetFromRainbowData(trade.data);
        const authSigner = mainnet ? testSigner : contractOwner;
        await ensureTargetIsWhitelisted(authSigner, Rainbow, targetAddress);
        
        // Step 4: Whitelist signers if warrant exists
        if (rainbowExecution.warrant) {
            console.log(`\n4. Checking signer authorization...`);
            const signerAddress = bypass ? ZERO_ADDRESS : rainbowExecution.warrant.verifyingSigner;
            await ensureSignerIsWhitelisted(authSigner, Rainbow, signerAddress);
        }
        
        // Step 5: Whitelist test signer and backend signer
        console.log(`\n5. Ensuring all signers are whitelisted...`);
        await ensureSignerIsWhitelisted(authSigner, Rainbow, testAddress);
        await ensureSignerIsWhitelisted(authSigner, Rainbow, BACKEND_WARRANT_SIGNER);
        
        // Step 6: Handle approvals if not using permits
        if (!usePermit) {
            console.log(`\n6. Handling ERC20 approval...`);
            await handleERC20Approval(testSigner, USDC, config.rainbowAddress, inputAmount);
        } else {
            console.log(`\n6. Skipping ERC20 approval (using permits)`);
        }
        
        // Step 7: Execute transaction
        console.log(`\n7. Executing ${router.toUpperCase()} swap...`);
        
        let finalTradeData = trade.data;
        if (bypass && rainbowExecution.warrant) {
            console.log("🔧 Rebuilding transaction with warrant bypass...");
            finalTradeData = rebuildTransactionDataWithModifiedWarrant(trade.data, rainbowExecution.warrant);
        }
        
        const modifiedTrade = { ...trade, data: finalTradeData };
        const executionResult = await executeRainbowTransaction(
            testSigner, 
            modifiedTrade, 
            rainbowExecution, 
            quoteResponse,
            config.rainbowAddress
        );
        
        // Step 8: Report results
        const balanceChanges = await reportBalanceChanges(
            testSigner,
            USDC,
            WETH,
            initialUsdcBalance,
            initialWethBalance,
            quoteResponse
        );
        
        return {
            router,
            success: true,
            gasUsed: executionResult.gasUsed,
            txHash: executionResult.txHash,
            balanceChanges
        };
        
    } catch (error: any) {
        console.error(`\n❌ ${router.toUpperCase()} test failed:`, error.message);
        return {
            router,
            success: false,
            error: error.message
        };
    }
}

function printTestSummary(results: RouterTestResult[]) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📊 COMPREHENSIVE ROUTER TEST RESULTS`);
    console.log(`${"=".repeat(80)}`);
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`\n📈 SUMMARY:`);
    console.log(`  ✅ Successful: ${successful.length}/${results.length} routers`);
    console.log(`  ❌ Failed: ${failed.length}/${results.length} routers`);
    console.log(`  📊 Success Rate: ${((successful.length / results.length) * 100).toFixed(1)}%`);
    
    if (successful.length > 0) {
        console.log(`\n✅ SUCCESSFUL ROUTERS:`);
        successful.forEach(result => {
            console.log(`  🟢 ${result.router.toUpperCase()}`);
            if (result.balanceChanges) {
                console.log(`     💰 USDC spent: ${result.balanceChanges.usdcSpent}`);
                console.log(`     💎 WETH received: ${result.balanceChanges.wethReceived}`);
                console.log(`     💵 USD value: ~$${result.balanceChanges.wethUsdValue}`);
            }
            if (result.gasUsed) {
                console.log(`     ⛽ Gas used: ${parseInt(result.gasUsed).toLocaleString()}`);
            }
            if (result.txHash) {
                console.log(`     🔗 TX: ${result.txHash}`);
            }
            console.log();
        });
    }
    
    if (failed.length > 0) {
        console.log(`\n❌ FAILED ROUTERS:`);
        failed.forEach(result => {
            console.log(`  🔴 ${result.router.toUpperCase()}: ${result.error}`);
        });
    }
    
    console.log(`\n🎯 RECOMMENDATIONS:`);
    if (successful.length > 0) {
        const bestRouter = successful[0]; // First successful router
        console.log(`  - ${bestRouter.router.toUpperCase()} is confirmed working and can be used as a reference`);
    }
    
    if (failed.length > 0) {
        console.log(`  - Failed routers may need:`);
        console.log(`    * Different slippage tolerance`);
        console.log(`    * Route availability at test time`);
        console.log(`    * Different permit/warrant settings`);
        console.log(`    * Specific token pair support`);
    }
    
    console.log(`\n🔄 To retry specific routers, modify the ROUTERS array in this script`);
    console.log(`${"=".repeat(80)}`);
}

main().catch(console.error);