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
    TestSetup,
    getNetworkConfig
} from "../util/canoeHelper";
import { canoeParams } from "../util/canoeHelper";

// Configuration
const bypass = false; // Set to true to bypass warrant validation
const usePermit = false; // Set to true to use ERC-2612 permits
const testAmount = "1"; // 5 USDC for better test success rate
const simulateOnly = true; // Set to false to actually send transactions to live network

// Network configuration (dev wallet is now both user and owner)
const DEV_WALLET_ADDRESS = "0x3CB68a6762041aA05E762814A8791CA9d98E79A0";


/**
  1. ODOS ✅ - Already confirmed working
  2. 1inch ✅ - Uses approvee: swap.tx.to
  3. ZeroEx ✅ - Uses approvee: newQuote.transaction.to
  4. Paraswap ✅ - Simple, no special approval logic
  5. Usor ✅ - Uses approvee: quote.trade.to
  6. OpenOcean ✅ - Uses approvee: quote.to
  7. IcereamSwap ✅ - Uses approvee: resp.tx.to
  8. Enso ✅ - Uses approvee: quote.tx.to
  9. Airswap ✅ - Uses approvee: tx.to!
 */
// All available routers to test
const ROUTERS = [
    //"airswap", //chain not supported
    //"cowswap", //incompatible
    //"enso", //'400 response from enso: {"message":["each value in fee must be a string","fee is required when feeReceiver is provided."],"error":"Bad Request","statusCode":400}
    //"icecreamswap", //timed out
    //"kyberswap", //WORKING live network only
    //"odos", //WORKING
    //"okx", //incompatible
    //"oneinch", //WORKING
    //"openocean", //incompatible
    "paraswap", //WORKING
    //"unizen", //UnizenRouter: Invalid-user
    //"usor", //incompatible, no recipient param on api 
    //"zeroex" //incompatible
];

interface RouterTestResult {
    router: string;
    success: boolean;
    error?: string;
    gasUsed?: string;
    txHash?: string;
    tokenReceived?: {
        amount: string;
        symbol: string;
        usdValue: string;
        wethUsdValue: string;
    };
}

async function main() {
    console.log("🚀 STARTING COMPREHENSIVE ROUTER TESTING");
    console.log(`Testing ${ROUTERS.length} routers: ${ROUTERS.join(", ")}`);
    
    const results: RouterTestResult[] = [];
    const networkName = hre.network.name;
    
    console.log(`\n🌐 Network: ${networkName} (LIVE NETWORK ONLY)`);
    console.log(`\n💱 Test Parameters:`);
    console.log(`  Amount: ${testAmount} USDC → WETH`);
    console.log(`  Slippage: 50% (for testing reliability)`);
    console.log(`  UsePermit: ${usePermit}`);
    console.log(`  Bypass: ${bypass}`);
    console.log(`  Simulate Only: ${simulateOnly ? '✅ YES (no actual transactions)' : '❌ NO (will send real transactions)'}`);
    
    console.log(`\n🔴 LIVE NETWORK MODE:`);
    console.log(`  - Dev Wallet (User & Owner): ${DEV_WALLET_ADDRESS}`);
    console.log(`  - Will generate Tenderly simulation data for failures`);
    if (simulateOnly) {
        console.log(`  - Will NOT send actual transactions (simulation only)`);
    } else {
        console.log(`  - Will send REAL transactions to live network`);
    }
    
    // Test each router with fresh setup
    for (const router of ROUTERS) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`🧪 TESTING ROUTER: ${router.toUpperCase()}`);
        console.log(`${"=".repeat(60)}`);
        
        try {
            // Fresh setup for each router to ensure clean state
            console.log("🔄 Setting up fresh test environment for", router.toUpperCase());
            const setup = await setupTestEnvironment(usePermit, bypass);
            
            // Verify the signer matches our dev wallet
            const testAddress = await setup.testSigner.getAddress();
            if (testAddress.toLowerCase() !== DEV_WALLET_ADDRESS.toLowerCase()) {
                throw new Error(`Expected dev wallet ${DEV_WALLET_ADDRESS}, but got ${testAddress}. Make sure your wallet is configured correctly.`);
            }
            console.log(`✅ Using dev wallet for all operations: ${testAddress}`);
            
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
        
        // Log quote timing to detect stale data
        const quoteTime = new Date().toISOString();
        console.log(`Quote received at: ${quoteTime}`);
        
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
        
        // Log execution timing to detect stale routing data
        const executionTime = new Date().toISOString();
        console.log(`Execution data received at: ${executionTime}`);
        
        // Extract target address first
        const targetAddress = extractTargetFromRainbowData(trade.data);
        
        // Analyze call data for potential backend issues
        console.log(`\n🔬 CALL DATA ANALYSIS:`);
        console.log(`  - Method: ${trade.data.substring(0, 10)} (fillQuoteTokenToToken)`);
        console.log(`  - Data size: ${trade.data.length} chars (${Math.round(trade.data.length/2)} bytes)`);
        console.log(`  - Target aggregator: ${targetAddress}`);
        
        // Compare with ODOS baseline if we have it
        if (router === 'okx') {
            console.log(`  - ODOS call data was ~1,482 chars, OKX is ${trade.data.length} chars`);
            console.log(`  - Size ratio: ${(trade.data.length / 1482).toFixed(1)}x larger than ODOS`);
            console.log(`  - This suggests much more complex routing or potential data bloat`);
        }
        
        // Step 2.5: Pre-validate target contract and Rainbow Router state
        console.log(`\n2.5. Validating target contract and Rainbow Router...`);
        console.log(`Target address: ${targetAddress}`);
        
        // Check if target contract exists and has reasonable state
        const targetCode = await hre.ethers.provider.getCode(targetAddress);
        if (targetCode === '0x') {
            throw new Error(`Target contract ${targetAddress} does not exist - router may be using stale data`);
        }
        
        // Validate Rainbow Router configuration
        console.log(`\n🔍 RAINBOW ROUTER VALIDATION:`);
        console.log(`  - Rainbow Router: ${config.rainbowAddress}`);
        console.log(`  - Expected Owner: ${DEV_WALLET_ADDRESS}`);
        
        // Check actual owner
        try {
            const actualOwner = await Rainbow.owner();
            console.log(`  - Actual Owner: ${actualOwner}`);
            console.log(`  - Owner Match: ${actualOwner.toLowerCase() === DEV_WALLET_ADDRESS.toLowerCase() ? '✅ YES' : '❌ NO'}`);
            
            if (actualOwner.toLowerCase() !== DEV_WALLET_ADDRESS.toLowerCase()) {
                console.log(`  ⚠️  WARNING: Owner mismatch may cause authorization issues`);
            }
        } catch (ownerError: any) {
            console.log(`  ❌ Could not check owner: ${ownerError.message}`);
        }
        
        // Check target balances for liquidity warning
        const targetUsdcBalance = await USDC.balanceOf(targetAddress);
        const targetWethBalance = await WETH.balanceOf(targetAddress);
        const targetEthBalance = await hre.ethers.provider.getBalance(targetAddress);
        
        console.log(`Target balances: USDC=${formatUnits(targetUsdcBalance, 6)}, WETH=${formatUnits(targetWethBalance, 18)}, ETH=${formatUnits(targetEthBalance, 18)}`);
        
        if (targetUsdcBalance === 0n && targetWethBalance === 0n && targetEthBalance === 0n) {
            console.log(`⚠️  WARNING: Target contract has zero balances - this may cause liquidity issues`);
        }
        
        // Step 3: Whitelist target
        console.log(`\n3. Checking target authorization...`);
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
        
        // Step 6.5: PRE-EXECUTION STATE CHECK (only show issues)
        const preUsdcBalance = await USDC.balanceOf(testAddress);
        const preWethBalance = await WETH.balanceOf(testAddress);
        const ethBalance = await hre.ethers.provider.getBalance(testAddress);
        const rainbowAllowance = await USDC.allowance(testAddress, config.rainbowAddress);
        
        // Check for issues
        const issues = [];
        if (preUsdcBalance < inputAmount) issues.push(`Insufficient USDC: need ${formatUnits(inputAmount - preUsdcBalance, 6)} more`);
        if (!usePermit && rainbowAllowance < inputAmount) issues.push("Insufficient Rainbow Router allowance");
        if (ethBalance < parseUnits("0.001", 18)) issues.push("Very low ETH balance for gas");
        
        // Only show diagnostics if there are issues or target mismatch
        const backendTarget = quoteResponse.candidateTrade?.to || 'N/A';
        const targetMatch = backendTarget === targetAddress;
        
        if (issues.length > 0 || !targetMatch || usePermit) {
            console.log(`\n🔍 PRE-EXECUTION DIAGNOSTICS:`);
            if (issues.length > 0) {
                console.log(`❌ Issues found:`);
                issues.forEach(issue => console.log(`  - ${issue}`));
            }
            if (!targetMatch) {
                console.log(`❌ Target mismatch: Backend(${backendTarget}) != Extracted(${targetAddress})`);
            }
            if (usePermit && rainbowExecution.signingRequest?.permit2Address) {
                console.log(`🔏 Using Permit2: ${rainbowExecution.signingRequest.permit2Address}`);
            }
        }
        
        // Step 7: Pre-simulate transaction to catch errors early
        console.log(`\n7. Pre-simulating ${router.toUpperCase()} transaction...`);
        
        let finalTradeData = trade.data;
        if (bypass && rainbowExecution.warrant) {
            console.log("🔧 Rebuilding transaction with warrant bypass...");
            finalTradeData = rebuildTransactionDataWithModifiedWarrant(trade.data, rainbowExecution.warrant);
        }
        
        const modifiedTrade = { ...trade, data: finalTradeData };
        
        // Try simulation first, but if it fails, execute actual transaction to get real revert
        let gasEstimate: bigint | undefined;
        try {
            gasEstimate = await hre.ethers.provider.estimateGas({
                to: modifiedTrade.to,
                data: modifiedTrade.data,
                value: modifiedTrade.value,
                from: testAddress
            });
            console.log(`✅ Pre-simulation successful, gas: ${gasEstimate.toLocaleString()}`);
        } catch (simError: any) {
            // Generate Tenderly simulation data for failed simulations
            console.log(`\n📊 TENDERLY SIMULATION DATA for ${router.toUpperCase()}:`);
            console.log(`${"=".repeat(50)}`);
            console.log(`To: ${modifiedTrade.to}`);
            console.log(`From: ${testAddress}`);
            console.log(`Data: ${modifiedTrade.data}`);
            console.log(`Value: ${modifiedTrade.value}`);
            console.log(`${"=".repeat(50)}`);
            console.log(`\n📋 Copy the above data to Tenderly for simulation`);
            
            if (simulateOnly) {
                console.log(`\n⏸️  SIMULATION ONLY MODE - Not executing actual transaction`);
                console.log(`❌ Pre-simulation failed with: ${simError.message}`);
                
                throw new Error(`${router.toUpperCase()} pre-simulation failed: ${simError.message}`);
            } else {
                console.log(`❌ Pre-simulation failed, executing actual transaction to get revert reason...`);
                
                // Execute actual transaction to get the real revert reason
                try {
                    const gasLimit = gasEstimate || 500000;
                    
                    const tx = await testSigner.sendTransaction({
                        to: modifiedTrade.to,
                        data: modifiedTrade.data,
                        value: modifiedTrade.value,
                        gasLimit: gasLimit
                    });
                    console.log(`Transaction sent: ${tx.hash}`);
                    console.log(`🌐 Live network transaction hash: ${tx.hash}`);
                    
                    await tx.wait();
                    console.log(`✅ Transaction succeeded unexpectedly!`);
                } catch (txError: any) {
                    console.log(`\n🔍 ACTUAL TRANSACTION REVERT REASON:`);
                    console.log(`  - Error: ${txError.message}`);
                    console.log(`  - Code: ${txError.code || 'N/A'}`);
                    console.log(`  - Data: ${txError.data || 'N/A'}`);
                    console.log(`  - Reason: ${txError.reason || 'N/A'}`);
                    
                    // Try to decode the revert reason
                    if (txError.data && txError.data.startsWith('0x')) {
                        try {
                            if (txError.data.length >= 10) {
                                const decoded = hre.ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + txError.data.slice(10));
                                console.log(`  - DECODED REVERT: "${decoded[0]}"`);
                            }
                        } catch {
                            console.log(`  - Could not decode revert data`);
                        }
                    }
                    
                    // Enhanced error message with actual revert
                    const actualRevert = txError.reason || (txError.data ? 'See decoded revert above' : 'Unknown');
                    
                    // Additional context for debugging backend vs contract issues
                    console.log(`\n💡 DEBUGGING CONTEXT:`);
                    console.log(`  - If this is a backend service issue: try getting a fresh quote and see if it works`);
                    console.log(`  - If this is a router-specific issue: the error will persist with fresh quotes`);
                    console.log(`  - Call data size: ${trade.data.length} chars suggests routing complexity`);
                    console.log(`  - Use Tenderly data above to simulate and debug the transaction`);
                    
                    throw new Error(`${router.toUpperCase()} transaction reverted: ${actualRevert}`);
                }
            }
        }
        
        // Step 8: Execute transaction (if not simulation only)
        if (simulateOnly) {
            console.log(`\n8. ⏸️  SIMULATION ONLY MODE - Skipping actual transaction execution`);
            console.log(`✅ Pre-simulation passed - transaction would likely succeed`);
            
            return {
                router,
                success: true,
                gasUsed: gasEstimate?.toString(),
                txHash: "SIMULATED",
                tokenReceived: {
                    amount: quoteResponse.outAmount,
                    symbol: quoteResponse.outToken.symbol,
                    usdValue: "~$5.00",
                    wethUsdValue: "~$5.00"
                }
            };
        } else {
            console.log(`\n8. Executing ${router.toUpperCase()} swap on LIVE NETWORK...`);
            const executionResult = await executeRainbowTransaction(
                testSigner, 
                modifiedTrade, 
                rainbowExecution, 
                quoteResponse,
                config.rainbowAddress
            );
            
            // Step 9: Report results
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
                tokenReceived: {
                    amount: balanceChanges.wethReceived,
                    symbol: "WETH",
                    usdValue: balanceChanges.wethUsdValue,
                    wethUsdValue: balanceChanges.wethUsdValue
                }
            };
        }
        
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
            if (result.tokenReceived) {
                console.log(`     💰 USDC spent: 5.0`);
                console.log(`     💎 WETH received: ${result.tokenReceived.amount}`);
                console.log(`     💵 USD value: ${result.tokenReceived.usdValue}`);
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
    
    console.log(`\n🌐 LIVE NETWORK TESTING NOTES:`);
    console.log(`  - Network: ${hre.network.name}`);
    console.log(`  - Mode: ${simulateOnly ? 'Simulation Only' : 'Real Transactions'}`);
    console.log(`  - All failed transactions include Tenderly simulation data above`);
    console.log(`  - Use the To/From/Data/Value to debug in Tenderly`);
    console.log(`  - Dev wallet used: ${DEV_WALLET_ADDRESS}`);
    
    console.log(`${"=".repeat(80)}`);
}

main().catch(console.error);