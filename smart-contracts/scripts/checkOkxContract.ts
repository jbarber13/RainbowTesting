import { formatUnits } from "ethers";
import hre from "hardhat";
import {
    setupTestEnvironment,
    TestSetup
} from "../util/canoeHelper";

const okxTargetAddress = "0x86F752f1F662f39BFbcBeF95EE56B6C20d178969";

async function checkOkxContract() {
    console.log("🔍 CHECKING OKX TARGET CONTRACT STATUS");
    console.log(`Target Address: ${okxTargetAddress}`);
    
    const setup = await setupTestEnvironment(false, false);
    const { testSigner, USDC, WETH } = setup;
    
    console.log("\n📊 Contract Analysis:");
    
    // Check if contract exists
    const code = await hre.ethers.provider.getCode(okxTargetAddress);
    console.log(`  - Contract exists: ${code !== '0x'}`);
    console.log(`  - Code length: ${code.length} chars`);
    
    if (code === '0x') {
        console.log("❌ CONTRACT NOT DEPLOYED - This explains the failure!");
        return;
    }
    
    // Check contract balances
    console.log("\n💰 Contract Balances:");
    const usdcBalance = await USDC.balanceOf(okxTargetAddress);
    const wethBalance = await WETH.balanceOf(okxTargetAddress);
    const ethBalance = await hre.ethers.provider.getBalance(okxTargetAddress);
    
    console.log(`  - USDC: ${formatUnits(usdcBalance, 6)}`);
    console.log(`  - WETH: ${formatUnits(wethBalance, 18)}`);
    console.log(`  - ETH: ${formatUnits(ethBalance, 18)}`);
    
    // Try to check recent transactions to this address
    console.log("\n📈 Recent Activity Check:");
    try {
        const latestBlock = await hre.ethers.provider.getBlockNumber();
        console.log(`  - Current block: ${latestBlock}`);
        
        // Check if there are any recent transactions to this address
        let foundActivity = false;
        for (let i = 0; i < 10; i++) {
            const blockNum = latestBlock - i;
            try {
                const block = await hre.ethers.provider.getBlock(blockNum, true);
                if (block && block.transactions) {
                    for (const tx of block.transactions) {
                        if (tx.to?.toLowerCase() === okxTargetAddress.toLowerCase()) {
                            console.log(`  - Found transaction to OKX in block ${blockNum}: ${tx.hash}`);
                            foundActivity = true;
                        }
                    }
                }
            } catch (e) {
                // Skip failed blocks
            }
        }
        
        if (!foundActivity) {
            console.log(`  - No recent transactions found to ${okxTargetAddress}`);
        }
    } catch (error) {
        console.log(`  - Could not check recent activity: ${error}`);
    }
    
    // Check if it's a known contract type
    console.log("\n🔍 Contract Type Analysis:");
    
    // Try to call some common functions to identify contract type
    try {
        // Check if it's an aggregator router by looking for common function signatures
        const provider = hre.ethers.provider;
        
        // Try to call owner() - common in many contracts
        try {
            const ownerSig = "0x8da5cb5b"; // owner()
            const result = await provider.call({
                to: okxTargetAddress,
                data: ownerSig
            });
            if (result && result !== '0x') {
                console.log(`  - Has owner() function - result: ${result}`);
            }
        } catch (e) {
            console.log(`  - No owner() function`);
        }
        
        // Try to check if it's paused
        try {
            const pausedSig = "0x5c975abb"; // paused()
            const result = await provider.call({
                to: okxTargetAddress,
                data: pausedSig
            });
            if (result && result !== '0x') {
                const isPaused = result === "0x0000000000000000000000000000000000000000000000000000000000000001";
                console.log(`  - Contract paused: ${isPaused}`);
            }
        } catch (e) {
            console.log(`  - No paused() function`);
        }
        
    } catch (error) {
        console.log(`  - Error analyzing contract: ${error}`);
    }
    
    console.log("\n🎯 DIAGNOSIS:");
    if (code === '0x') {
        console.log("  ❌ The OKX target contract does not exist at this address");
        console.log("  💡 This indicates the OKX routing data is pointing to an invalid address");
        console.log("  🔧 Possible solutions:");
        console.log("    - Check if OKX API is returning stale/incorrect routing data");
        console.log("    - Verify the current block number matches OKX's expectations");
        console.log("    - Contact the backend service to update OKX router configuration");
    } else {
        if (usdcBalance === 0n && wethBalance === 0n && ethBalance === 0n) {
            console.log("  ⚠️  The OKX contract exists but has no balances");
            console.log("  💡 This could indicate liquidity issues or inactive router");
        } else {
            console.log("  ✅ Contract exists and has some balances");
            console.log("  💡 The issue may be in the specific swap logic or parameters");
        }
    }
}

checkOkxContract().catch(console.error);