/**
 * sanityTestOP.ts
 *
 * Optimism Network Sanity Test - Direct DEX Swaps (No Rainbow Router)
 * Tests routers with direct user swaps to validate backend quote accuracy.
 *
 * Usage: npx hardhat run scripts/testRouters/sanityTestOP.ts --network op
 */

import { formatUnits, parseUnits } from "ethers";
import hre from "hardhat";
import {
  setupTestEnvironment,
  getRouterQuote,
  TestSetup,
} from "../../util/canoeHelper";
import { canoeParams } from "../../util/canoeHelper";
import { Token } from "../canoeInterface";

// ============================================================================
// CONFIGURATION - Optimism Network (Direct Swaps)
// ============================================================================

const CONFIG = {
  // Network settings
  chain: "optimism",
  chainId: 10,
  userWalletAddress: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0",

  // Supported tokens
  tokens: {
    ETH: {
      address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // Native ETH
      decimals: 18,
      symbol: "ETH",
      isNative: true,
    },
    WETH: {
      address: "0x4200000000000000000000000000000000000006",
      decimals: 18,
      symbol: "WETH",
      isNative: false,
    },
    USDC: {
      address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      decimals: 6,
      symbol: "USDC",
      isNative: false,
    },
  },

  // Routers to test (same as main test)
  routers: [
    "enso",
    "odos",
  ],

  // Test settings
  testAmount: "0.001", // 0.001 ETH
  slippage: 1000, // 10%
  simulateOnly: true, // Only simulate, don't actually execute
  delayBetweenTests: 3000, // 3 seconds
};

// ============================================================================
// TEST EXECUTION
// ============================================================================

interface RouterTestResult {
  router: string;
  success: boolean;
  error?: string;
  gasUsed?: string;
  quoteTimeMs?: number;
  targetAddress?: string;
}

async function main() {
  console.log("🔧 Sanity Test - Direct DEX Swaps (No Rainbow Router)\n");
  console.log(`Network: ${CONFIG.chain} (chainId: ${CONFIG.chainId})`);
  console.log(`Test: ${CONFIG.testAmount} ETH → WETH (Direct)`);
  console.log(`Routers to test: ${CONFIG.routers.length}\n`);

  const results: RouterTestResult[] = [];

  // Test each router
  for (const router of CONFIG.routers) {
    try {
      const setup = await setupTestEnvironment();

      // Verify the signer matches our dev wallet
      const testAddress = await setup.testSigner.getAddress();
      if (testAddress.toLowerCase() !== CONFIG.userWalletAddress.toLowerCase()) {
        throw new Error(
          `Expected wallet ${CONFIG.userWalletAddress}, but got ${testAddress}`,
        );
      }

      const result = await testRouterDirect(router, setup);
      results.push(result);

      if (result.success) {
        console.log(`  ✅ ${router} (${result.quoteTimeMs}ms)`);
        console.log(`     Target: ${result.targetAddress}`);
      } else {
        console.log(`  ❌ ${router}: ${result.error}`);
      }
    } catch (error: any) {
      console.log(`  ❌ ${router}: ${error.message}`);
      results.push({
        router,
        success: false,
        error: error.message,
      });
    }

    // Add delay between tests
    if (CONFIG.routers.indexOf(router) < CONFIG.routers.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, CONFIG.delayBetweenTests));
    }
  }

  // Print summary
  printTestSummary(results);
}

async function testRouterDirect(
  router: string,
  setup: TestSetup,
): Promise<RouterTestResult> {
  const { testSigner } = setup;
  const testAddress = await testSigner.getAddress();

  // Use ETH → WETH for this test
  const inToken = CONFIG.tokens.ETH;
  const outToken = CONFIG.tokens.WETH;

  // Create token objects for API
  const originalInToken: Token = {
    address: inToken.address,
    decimals: inToken.decimals,
    symbol: inToken.symbol,
    chainId: CONFIG.chainId
  };

  const originalOutToken: Token = {
    address: outToken.address,
    decimals: outToken.decimals,
    symbol: outToken.symbol,
    chainId: CONFIG.chainId
  };

  // Set up test parameters - WITHOUT useRainbow
  const inputAmount = parseUnits(CONFIG.testAmount, inToken.decimals);
  const params: canoeParams = {
    chain: CONFIG.chain,
    account: testAddress, // User address directly, not Rainbow Router
    userAddress: testAddress,
    isExactIn: true,
    inTokenAddress: originalInToken.address,
    outTokenAddress: originalOutToken.address,
    inTokenAmount: CONFIG.testAmount,
    slippage: CONFIG.slippage,
    useRainbow: false, // 🔑 Direct swap - no Rainbow Router
    getCalldata: true,
    usePermit: false
  };

  try {
    // Step 1: Get quote (direct to DEX)
    console.log(`      [${router}] Getting direct quote...`);
    const quoteStart = Date.now();
    const quoteResponse = await getRouterQuote(router, params);
    const quoteEnd = Date.now();
    const quoteTimeMs = quoteEnd - quoteStart;

    if (!quoteResponse) {
      throw new Error("Failed to get valid quote response");
    }

    // Extract transaction data from the coupon structure
    // When useRainbow=false, data is in coupon.raw.executionInfo.trade
    const trade = quoteResponse.coupon?.raw?.executionInfo?.trade;

    if (!trade) {
      console.log(`      [${router}] Quote response keys:`, Object.keys(quoteResponse));
      console.log(`      [${router}] Full response:`, JSON.stringify(quoteResponse, null, 2));
      throw new Error("Invalid quote response - missing trade data in coupon");
    }

    const targetAddress = trade.to;
    const txData = trade.data;
    const txValue = trade.value;

    console.log(`      [${router}] Quote received in ${quoteTimeMs}ms`);
    console.log(`      [${router}] Target: ${targetAddress}`);

    // Handle outAmount - could be either wei string or human-readable string
    let outAmountFormatted: string;
    try {
      // Try parsing as wei (BigInt)
      outAmountFormatted = formatUnits(quoteResponse.outAmount, outToken.decimals);
    } catch {
      // If that fails, it's already human-readable
      outAmountFormatted = quoteResponse.outAmount.toString();
    }
    console.log(`      [${router}] Expected out: ${outAmountFormatted} ${outToken.symbol}`);

    // Step 2: Simulate the direct transaction
    console.log(`      [${router}] Simulating direct swap...`);
    const simStart = Date.now();

    let gasEstimate: bigint | undefined;
    try {
      gasEstimate = await hre.ethers.provider.estimateGas({
        to: targetAddress,
        data: txData,
        value: txValue,
        from: testAddress,
      });
      const simEnd = Date.now();
      console.log(`      [${router}] Simulation complete in ${simEnd - simStart}ms (gas: ${gasEstimate.toString()})`);
    } catch (simError: any) {
      const simEnd = Date.now();
      console.log(`      [${router}] Simulation failed in ${simEnd - simStart}ms`);
      console.log(`      ❌ Error: ${simError.message}`);
      throw new Error(`Simulation failed: ${simError.message}`);
    }

    return {
      router,
      success: true,
      gasUsed: gasEstimate?.toString(),
      quoteTimeMs,
      targetAddress,
    };
  } catch (error: any) {
    return {
      router,
      success: false,
      error: error.message,
    };
  }
}

function printTestSummary(results: RouterTestResult[]) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 SANITY TEST RESULTS (Direct Swaps)`);
  console.log(`${"=".repeat(80)}`);

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`\n✅ Success: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);

  if (successful.length > 0) {
    console.log(`\n✓ Working Routers (Direct):`);
    successful.forEach(r => {
      console.log(`  - ${r.router}: ${r.quoteTimeMs}ms, Target: ${r.targetAddress}`);
    });
  }

  if (failed.length > 0) {
    console.log(`\n✗ Failed Routers:`);
    failed.forEach(r => console.log(`  - ${r.router}: ${r.error}`));
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`\n💡 This test validates that backend returns correct DEX targets`);
  console.log(`   when useRainbow=false. Compare targets with Rainbow Router test.`);
}

main().catch(console.error);
