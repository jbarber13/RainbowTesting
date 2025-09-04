import { formatUnits, parseUnits } from "ethers";
import hre from "hardhat";
import {
    setupTestEnvironment,
    getRouterQuote,
    getRainbowExecution,
    extractTargetFromRainbowData,
    TestSetup
} from "../util/canoeHelper";
import { canoeParams } from "../util/canoeHelper";

async function analyzeOkxCallData() {
    console.log("🔍 ANALYZING OKX CALL DATA FOR ROUTING DESTINATIONS");
    
    const setup = await setupTestEnvironment(false, false);
    const { testSigner, USDC, WETH } = setup;
    const testAddress = await testSigner.getAddress();
    
    const params: canoeParams = {
        chain: "optimism",
        account: testAddress,
        isExactIn: true,
        inTokenAddress: await USDC.getAddress(),
        outTokenAddress: await WETH.getAddress(),
        inTokenAmount: "5",
        slippage: 5000,
    };

    console.log("\n1. Getting OKX routing data...");
    const quoteResponse = await getRouterQuote("okx", params);
    const rainbowExecution = await getRainbowExecution(quoteResponse.coupon, "okx", false);
    
    const trade = rainbowExecution.trade || rainbowExecution.executionInformation?.trade;
    
    // Import and decode using Rainbow Router interface
    const { RainbowRouter__factory } = await import("../typechain-types");
    const rainbowInterface = RainbowRouter__factory.createInterface();
    const decoded = rainbowInterface.parseTransaction({ data: trade.data });
    
    const swapCallData = decoded.args[3]; // The call data sent to OKX aggregator
    
    console.log(`\n🔍 OKX Swap Call Data Analysis:`);
    console.log(`Method: ${swapCallData.substring(0, 10)}`);
    console.log(`Length: ${swapCallData.length} chars`);
    
    // Look for common Optimism DEX addresses in the call data
    const knownAddresses = {
        // Uniswap V3
        "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45": "Uniswap V3 SwapRouter02",
        "0xE592427A0AEce92De3Edee1F18E0157C05861564": "Uniswap V3 SwapRouter",
        "0x1F98431c8aD98523631AE4a59f267346ea31F984": "Uniswap V3 Factory",
        
        // Uniswap V2 style
        "0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2": "Beethoven X",
        "0x9Ddd8c6ec5F41D89C44F46a77F6D7ABF54e2B4e5": "Velodrome V1 Router",
        "0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858": "Velodrome V2 Router",
        
        // Curve
        "0x445FE580eF8d70FF569aB36e80c647af338db351": "Curve 3Pool",
        
        // Common tokens that might appear in routing
        "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85": "USDC",
        "0x4200000000000000000000000000000000000006": "WETH",
        "0x7F5c764cBc14f9669B88837ca1490cCa17c31607": "USDC.e",
        "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58": "USDT",
        "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1": "DAI",
        "0x68f180fcCe6836688e9084f035309E29Bf0A2095": "WBTC",
    };
    
    console.log(`\n🎯 Scanning for known addresses in OKX routing...`);
    let foundAddresses = [];
    
    // Convert to lowercase for case-insensitive search
    const lowerCallData = swapCallData.toLowerCase();
    
    for (const [address, name] of Object.entries(knownAddresses)) {
        const addressNoPrefix = address.substring(2).toLowerCase();
        
        // Look for the address (with padding for function parameters)
        if (lowerCallData.includes(addressNoPrefix)) {
            foundAddresses.push({ address, name });
            console.log(`  ✅ Found: ${name} (${address})`);
        }
    }
    
    if (foundAddresses.length === 0) {
        console.log(`  ❓ No known addresses found in routing`);
    }
    
    console.log(`\n📊 Breakdown of call data structure:`);
    
    // Try to identify patterns in the call data
    const callDataBytes = swapCallData.substring(2); // Remove 0x
    console.log(`  - Method signature: ${swapCallData.substring(0, 10)}`);
    console.log(`  - Remaining data: ${callDataBytes.length / 2} bytes`);
    
    // Look for potential function calls within the data (4-byte signatures)
    console.log(`\n🔍 Looking for nested function calls...`);
    const potentialMethods = [];
    
    // Scan through the data looking for method signatures
    for (let i = 8; i < callDataBytes.length - 6; i += 2) { // Skip first method sig
        const potential = "0x" + callDataBytes.substring(i, i + 8);
        
        // Common DEX method signatures
        const knownMethods = {
            "0x414bf389": "swapExactTokensForTokens",
            "0x5ae401dc": "multicall",
            "0x12aa3caf": "swap",
            "0xc04b8d59": "exactInputSingle",
            "0x09b81346": "exactInput",
            "0x49404b7c": "uniswapV3Swap",
            "0x83bd37f9": "swapExactAmountIn",
            "0x128acb08": "exchange",
            "0xd9627aa4": "sellToUniswap",
        };
        
        if (knownMethods[potential]) {
            potentialMethods.push({ sig: potential, name: knownMethods[potential] });
        }
    }
    
    if (potentialMethods.length > 0) {
        console.log(`  Found potential nested calls:`);
        for (const method of potentialMethods.slice(0, 5)) { // Show first 5
            console.log(`    - ${method.sig}: ${method.name}`);
        }
    } else {
        console.log(`  ❓ No recognizable nested method signatures found`);
    }
    
    console.log(`\n💡 DIAGNOSTIC SUMMARY:`);
    console.log(`  - OKX is using a complex routing strategy (${callDataBytes.length / 2} bytes)`);
    console.log(`  - Found ${foundAddresses.length} known protocol addresses in routing`);
    console.log(`  - Found ${potentialMethods.length} potential nested function calls`);
    
    if (foundAddresses.length > 0) {
        console.log(`\n🎯 LIKELY ISSUE:`);
        console.log(`  OKX is trying to route through: ${foundAddresses.map(a => a.name).join(", ")}`);
        console.log(`  One of these protocols likely has:`);
        console.log(`    - Insufficient liquidity for the 5 USDC → WETH swap`);
        console.log(`    - Slippage protection that's rejecting the trade`);
        console.log(`    - Pool that's been deprecated or deactivated`);
        console.log(`    - Incorrect routing parameters`);
        
        console.log(`\n🔧 POTENTIAL SOLUTIONS:`);
        console.log(`    - Try smaller trade amounts (e.g., 1 USDC instead of 5)`);
        console.log(`    - Try different token pairs`);
        console.log(`    - Check if OKX routing is using stale pool data`);
        console.log(`    - Contact backend service to update OKX routing configuration`);
    } else {
        console.log(`\n❓ The OKX routing uses unknown protocols or custom logic`);
        console.log(`  This suggests the issue may be deeper in the aggregator implementation`);
    }
}

analyzeOkxCallData().catch(console.error);