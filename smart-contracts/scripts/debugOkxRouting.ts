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

const bypass = false;
const usePermit = false;
const testAmount = "5";

async function debugOkxRouting() {
    console.log("🔍 DEBUGGING OKX ROUTING LOGIC");
    
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
        slippage: 5000,
    };

    console.log("\n1. Getting OKX quote and execution...");
    const quoteResponse = await getRouterQuote("okx", params);
    const rainbowExecution = await getRainbowExecution(quoteResponse.coupon, "okx", usePermit);
    
    const trade = rainbowExecution.trade || rainbowExecution.executionInformation?.trade;
    const targetAddress = extractTargetFromRainbowData(trade.data);
    
    console.log(`OKX Target: ${targetAddress}`);
    console.log(`Transaction data length: ${trade.data.length}`);
    
    // Set up permissions
    const authSigner = mainnet ? testSigner : contractOwner;
    await ensureTargetIsWhitelisted(authSigner, Rainbow, targetAddress);
    await ensureSignerIsWhitelisted(authSigner, Rainbow, rainbowExecution.warrant.verifyingSigner);
    await ensureSignerIsWhitelisted(authSigner, Rainbow, testAddress);
    await ensureSignerIsWhitelisted(authSigner, Rainbow, BACKEND_WARRANT_SIGNER);
    await handleERC20Approval(testSigner, USDC, config.rainbowAddress, inputAmount);
    
    console.log("\n2. Decoding OKX transaction data to understand routing...");
    
    try {
        // Import the Rainbow Router interface
        const { RainbowRouter__factory } = await import("../typechain-types");
        const rainbowInterface = RainbowRouter__factory.createInterface();
        
        const decoded = rainbowInterface.parseTransaction({ data: trade.data });
        console.log("\n📊 Rainbow Router Call Decoded:");
        console.log(`  Function: ${decoded.name}`);
        console.log(`  Sell Token: ${decoded.args[0]} (USDC)`);
        console.log(`  Buy Token: ${decoded.args[1]} (WETH)`);
        console.log(`  Target: ${decoded.args[2]}`);
        console.log(`  Swap Call Data Length: ${decoded.args[3].length}`);
        console.log(`  Sell Amount: ${formatUnits(decoded.args[4], 6)} USDC`);
        console.log(`  Fee Amount: ${formatUnits(decoded.args[5], 6)} USDC`);
        
        const swapCallData = decoded.args[3];
        console.log(`\n🔍 OKX Aggregator Call Data Analysis:`);
        console.log(`  First 4 bytes (method): ${swapCallData.substring(0, 10)}`);
        console.log(`  Full length: ${swapCallData.length} chars`);
        
        // Try to understand what the OKX aggregator is calling
        console.log("\n3. Attempting to decode OKX aggregator call...");
        
        // Common DEX aggregator function signatures
        const commonSigs = {
            "0x12aa3caf": "swap(address,address,uint256,uint256,address[],bytes,bool[],uint256[])",
            "0xd9627aa4": "sellToUniswap(address[],uint256,uint256,bool)",
            "0x6af479b2": "addLiquidity(...)",
            "0x414bf389": "swapExactTokensForTokens(...)",
            "0x5ae401dc": "multicall(uint256,bytes[])",
            "0x49404b7c": "uniswapV3Swap(...)",
            "0x3593564c": "execute(bytes,bytes[])",
        };
        
        const methodSig = swapCallData.substring(0, 10);
        if (commonSigs[methodSig]) {
            console.log(`  ✅ Recognized method: ${commonSigs[methodSig]}`);
        } else {
            console.log(`  ❓ Unknown method signature: ${methodSig}`);
        }
        
        console.log("\n4. Attempting direct call to OKX target to isolate the issue...");
        
        // Try to call the OKX aggregator directly (not through Rainbow)
        try {
            // Approve tokens directly to OKX target
            console.log(`Approving USDC directly to OKX target: ${targetAddress}`);
            await USDC.connect(testSigner).approve(targetAddress, inputAmount);
            
            // Try to call the OKX aggregator directly
            console.log("Attempting direct call to OKX aggregator...");
            const directCallResult = await hre.ethers.provider.call({
                to: targetAddress,
                data: swapCallData,
                from: testAddress
            });
            
            console.log("✅ Direct call to OKX succeeded!");
            console.log(`Result: ${directCallResult}`);
            
        } catch (directError: any) {
            console.log("❌ Direct call to OKX failed:");
            console.log(`Error: ${directError.message}`);
            
            // Check if it's the same SafeERC20 error
            if (directError.message.includes('SafeERC20: low-level call failed')) {
                console.log("\n🎯 ANALYSIS: The error is in the OKX aggregator's routing logic itself");
                console.log("This could be due to:");
                console.log("  - OKX trying to route to a DEX with insufficient liquidity");
                console.log("  - OKX routing to a deprecated/inactive pool");
                console.log("  - Slippage protection failing in the underlying DEX");
                console.log("  - Token approval issues in the routing chain");
            }
        }
        
        console.log("\n5. Testing with ODOS for comparison...");
        
        // Get ODOS data for comparison
        const odosQuote = await getRouterQuote("odos", params);
        const odosExecution = await getRainbowExecution(odosQuote.coupon, "odos", usePermit);
        const odosTrade = odosExecution.trade || odosExecution.executionInformation?.trade;
        const odosDecoded = rainbowInterface.parseTransaction({ data: odosTrade.data });
        
        console.log("📊 ODOS vs OKX Comparison:");
        console.log(`  ODOS swap call data length: ${odosDecoded.args[3].length}`);
        console.log(`  OKX swap call data length: ${decoded.args[3].length}`);
        console.log(`  ODOS method: ${odosDecoded.args[3].substring(0, 10)}`);
        console.log(`  OKX method: ${decoded.args[3].substring(0, 10)}`);
        console.log(`  Different routing: ${odosDecoded.args[3].substring(0, 10) !== decoded.args[3].substring(0, 10)}`);
        
    } catch (decodeError: any) {
        console.error("Failed to decode transaction data:", decodeError.message);
    }
}

debugOkxRouting().catch(console.error);