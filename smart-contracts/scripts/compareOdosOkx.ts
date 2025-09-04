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
    ZERO_ADDRESS,
    BACKEND_WARRANT_SIGNER,
    TestSetup
} from "../util/canoeHelper";
import { canoeParams } from "../util/canoeHelper";

const bypass = false;
const usePermit = false;
const testAmount = "5";

async function compareRouters() {
    console.log("🔍 COMPARING ODOS (working) vs OKX (failing)");
    
    const routers = ["odos", "okx"];
    const results: any = {};
    
    for (const router of routers) {
        console.log(`\n${"=".repeat(80)}`);
        console.log(`🧪 ANALYZING ${router.toUpperCase()}`);
        console.log(`${"=".repeat(80)}`);
        
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
                slippage: 5000, // 50% for testing
            };

            console.log(`\n1. Getting ${router.toUpperCase()} quote...`);
            const quoteResponse = await getRouterQuote(router, params);
            
            if (!quoteResponse || !quoteResponse.coupon) {
                throw new Error("Failed to get valid quote response");
            }
            
            console.log(`Quote: ${quoteResponse.inAmount} ${quoteResponse.inToken.symbol} -> ${quoteResponse.outAmount} ${quoteResponse.outToken.symbol}`);

            console.log(`\n2. Getting Rainbow execution...`);
            const rainbowExecution = await getRainbowExecution(quoteResponse.coupon, router, usePermit);
            
            const trade = rainbowExecution.trade || rainbowExecution.executionInformation?.trade;
            if (!trade) {
                throw new Error("Invalid Rainbow execution response - no trade data found");
            }
            
            // Store detailed analysis
            results[router] = {
                quote: {
                    inAmount: quoteResponse.inAmount,
                    outAmount: quoteResponse.outAmount,
                    candidateTarget: quoteResponse.candidateTrade?.to,
                    candidateDataLength: quoteResponse.candidateTrade?.data?.length || 0,
                },
                execution: {
                    rainbowTarget: trade.to,
                    dataLength: trade.data.length,
                    value: trade.value,
                    methodSig: trade.data.substring(0, 10),
                    firstArg: trade.data.substring(10, 74), // First 32-byte argument
                    hasWarrant: !!rainbowExecution.warrant,
                },
                targetFromData: extractTargetFromRainbowData(trade.data)
            };
            
            console.log(`📊 ${router.toUpperCase()} Analysis:`);
            console.log(`  Quote Target: ${results[router].quote.candidateTarget}`);
            console.log(`  Extracted Target: ${results[router].targetFromData}`);
            console.log(`  Rainbow Target: ${results[router].execution.rainbowTarget}`);
            console.log(`  Data Length: ${results[router].execution.dataLength} chars`);
            console.log(`  Method Sig: ${results[router].execution.methodSig}`);
            console.log(`  Has Warrant: ${results[router].execution.hasWarrant}`);
            
            // Set up all permissions
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
            
            // Try to simulate the transaction
            console.log(`\n3. Testing transaction simulation...`);
            try {
                const gasEstimate = await hre.ethers.provider.estimateGas({
                    to: trade.to,
                    data: trade.data,
                    value: trade.value,
                    from: testAddress
                });
                console.log(`✅ ${router.toUpperCase()} simulation SUCCESS! Gas: ${gasEstimate.toLocaleString()}`);
                results[router].simulation = { success: true, gas: gasEstimate.toString() };
            } catch (simError: any) {
                console.log(`❌ ${router.toUpperCase()} simulation FAILED: ${simError.message}`);
                results[router].simulation = { success: false, error: simError.message, errorData: simError.data };
            }
            
        } catch (error: any) {
            console.error(`❌ ${router.toUpperCase()} analysis failed:`, error.message);
            results[router] = { error: error.message };
        }
    }
    
    // Compare results
    console.log(`\n${"=".repeat(80)}`);
    console.log(`🔬 DETAILED COMPARISON`);
    console.log(`${"=".repeat(80)}`);
    
    if (results.odos && results.okx) {
        console.log(`\n📊 Quote Comparison:`);
        console.log(`  ODOS Target: ${results.odos.quote?.candidateTarget}`);
        console.log(`  OKX Target:  ${results.okx.quote?.candidateTarget}`);
        console.log(`  Same Target: ${results.odos.quote?.candidateTarget === results.okx.quote?.candidateTarget}`);
        
        console.log(`\n📊 Execution Comparison:`);
        console.log(`  ODOS Rainbow Target: ${results.odos.execution?.rainbowTarget}`);
        console.log(`  OKX Rainbow Target:  ${results.okx.execution?.rainbowTarget}`);
        console.log(`  Same Rainbow Target: ${results.odos.execution?.rainbowTarget === results.okx.execution?.rainbowTarget}`);
        
        console.log(`\n📊 Extracted Target Comparison:`);
        console.log(`  ODOS Extracted: ${results.odos.targetFromData}`);
        console.log(`  OKX Extracted:  ${results.okx.targetFromData}`);
        console.log(`  Same Extracted: ${results.odos.targetFromData === results.okx.targetFromData}`);
        
        console.log(`\n📊 Method Signature Comparison:`);
        console.log(`  ODOS Method: ${results.odos.execution?.methodSig}`);
        console.log(`  OKX Method:  ${results.okx.execution?.methodSig}`);
        console.log(`  Same Method: ${results.odos.execution?.methodSig === results.okx.execution?.methodSig}`);
        
        console.log(`\n📊 Simulation Results:`);
        console.log(`  ODOS: ${results.odos.simulation?.success ? '✅ SUCCESS' : '❌ FAILED'}`);
        console.log(`  OKX:  ${results.okx.simulation?.success ? '✅ SUCCESS' : '❌ FAILED'}`);
        
        if (results.okx.simulation && !results.okx.simulation.success) {
            console.log(`\n🐛 OKX Failure Details:`);
            console.log(`  Error: ${results.okx.simulation.error}`);
            if (results.okx.simulation.errorData) {
                console.log(`  Data: ${results.okx.simulation.errorData}`);
            }
        }
        
        console.log(`\n💡 Analysis:`);
        if (results.odos.execution?.methodSig === results.okx.execution?.methodSig) {
            console.log(`  - Both use the same Rainbow Router method signature`);
        } else {
            console.log(`  - Different method signatures may indicate different router patterns`);
        }
        
        if (results.odos.targetFromData !== results.okx.targetFromData) {
            console.log(`  - Different extracted targets suggest different aggregators`);
            console.log(`  - Issue may be with OKX aggregator at: ${results.okx.targetFromData}`);
        }
    }
    
    console.log(`\n🎯 RECOMMENDATION:`);
    if (results.okx?.simulation && !results.okx.simulation.success) {
        if (results.okx.simulation.error.includes('SafeERC20: low-level call failed')) {
            console.log(`  - OKX aggregator (${results.okx.targetFromData}) appears to have issues`);
            console.log(`  - This could be due to:`);
            console.log(`    * Insufficient liquidity in OKX pools`);
            console.log(`    * OKX aggregator routing issues`);
            console.log(`    * Incompatible token pair or amounts`);
            console.log(`    * Stale price data causing execution failures`);
            console.log(`  - Try with different amounts or check OKX aggregator status`);
        }
    }
}

compareRouters().catch(console.error);