/**
 * testRoutersBase.ts
 *
 * Base Network Router Testing Script
 * Tests all supported routers on Base mainnet.
 *
 * Usage: npx hardhat run scripts/testRouters/testRoutersBase.ts --network base
 */

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
  executeRainbowTransaction,
  reportBalanceChanges,
  BACKEND_WARRANT_SIGNER,
  TestSetup,
} from "../../util/canoeHelper";
import { canoeParams } from "../../util/canoeHelper";
import { Token } from "../canoeInterface";
import { IERC20__factory } from "../../typechain-types";

// ============================================================================
// CONFIGURATION - Base Network
// ============================================================================

const CONFIG = {
  // Network settings
  chain: "base",
  chainId: 8453,
  rainbowRouterAddress: "0xA89A26c4d81A2cca4d0670F77f0FC88362b72248",
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
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
      symbol: "USDC",
      isNative: false,
    },
  },

  // Supported routers
  routers: [
    "kyberswap"
  ],

  // Test settings
  testAmount: "0.001", // 0.001 ETH
  slippage: 1000, // 10%
  usePermit: false, // No permits needed for native ETH
  simulateOnly: true,
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
  txHash?: string;
  tokenReceived?: {
    amount: string;
    symbol: string;
    usdValue: string;
    wethUsdValue: string;
  };
}

async function main() {
  console.log("🚀 Testing Base Routers\n");
  console.log(`Network: ${CONFIG.chain} (chainId: ${CONFIG.chainId})`);
  console.log(`Rainbow Router: ${CONFIG.rainbowRouterAddress}`);
  console.log(`Test: ${CONFIG.testAmount} ETH → WETH`);
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

      const result = await testRouter(router, setup);
      results.push(result);

      if (result.success) {
        console.log(`  ✅ ${router}`);
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

async function testRouter(
  router: string,
  setup: TestSetup,
): Promise<RouterTestResult> {
  const { testSigner, contractOwner, mainnet, Rainbow } = setup;
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

  // Set up test parameters
  const inputAmount = parseUnits(CONFIG.testAmount, inToken.decimals);
  const params: canoeParams = {
    chain: CONFIG.chain,
    account: CONFIG.rainbowRouterAddress,
    userAddress: testAddress,
    isExactIn: true,
    inTokenAddress: originalInToken.address,
    outTokenAddress: originalOutToken.address,
    inTokenAmount: CONFIG.testAmount,
    slippage: CONFIG.slippage,
    useRainbow: true,
    getCalldata: true,
    usePermit: CONFIG.usePermit
  };

  // Get initial balances
  const WETH = IERC20__factory.connect(outToken.address, testSigner);
  const initialInTokenBalance = await hre.ethers.provider.getBalance(testAddress);
  const initialOutTokenBalance = await WETH.balanceOf(testAddress);

  try {
    // Step 1: Get quote
    const quoteResponse = await getRouterQuote(router, params);

    if (!quoteResponse || !quoteResponse.coupon) {
      throw new Error("Failed to get valid quote response");
    }

    // Step 2: Get Rainbow execution
    const executionRequest = {
      coupon: quoteResponse.coupon,
      useRainbow: true,
      inToken: originalInToken,
      outToken: originalOutToken,
      inputAmount: inputAmount.toString()
    };

    const rainbowExecution = await getRainbowExecution(
      executionRequest.coupon,
      router,
      executionRequest.inToken,
      executionRequest.outToken,
      executionRequest.inputAmount,
      CONFIG.usePermit,
      undefined, // no permit signature for native ETH
    );

    // Get trade data
    const trade =
      rainbowExecution.trade || rainbowExecution.executionInformation?.trade;
    if (!trade) {
      throw new Error("Invalid Rainbow execution response - no trade data found");
    }

    // Extract and validate target address
    const targetAddress = extractTargetFromRainbowData(trade.data);
    const targetCode = await hre.ethers.provider.getCode(targetAddress);
    if (targetCode === "0x") {
      throw new Error(`Target contract ${targetAddress} does not exist`);
    }

    // Setup: Whitelist target and signers
    const authSigner = mainnet ? testSigner : contractOwner;
    await ensureTargetIsWhitelisted(authSigner, Rainbow, targetAddress);

    if (rainbowExecution.warrant) {
      const signerAddress = rainbowExecution.warrant.verifyingSigner;
      await ensureSignerIsWhitelisted(authSigner, Rainbow, signerAddress);
    }

    await ensureSignerIsWhitelisted(authSigner, Rainbow, testAddress);
    await ensureSignerIsWhitelisted(
      authSigner,
      Rainbow,
      BACKEND_WARRANT_SIGNER,
    );

    // Pre-simulate transaction
    const modifiedTrade = trade;
    let gasEstimate: bigint | undefined;

    try {
      gasEstimate = await hre.ethers.provider.estimateGas({
        to: modifiedTrade.to,
        data: modifiedTrade.data,
        value: modifiedTrade.value,
        from: testAddress,
      });
    } catch (simError: any) {
      console.log(`      ❌ Simulation failed: ${simError.message}`);
      console.log(`         📊 Tenderly: To=${modifiedTrade.to}, From=${testAddress}, Value=${modifiedTrade.value}`);
      console.log(`         📊 Tenderly Data: ${modifiedTrade.data}`);

      if (CONFIG.simulateOnly) {
        throw new Error(`Simulation failed: ${simError.message}`);
      }
    }

    // Execute transaction (if not simulation only)
    if (CONFIG.simulateOnly) {
      return {
        router,
        success: true,
        gasUsed: gasEstimate?.toString(),
        txHash: "SIMULATED",
        tokenReceived: {
          amount: quoteResponse.outAmount,
          symbol: quoteResponse.outToken.symbol,
          usdValue: "~$5.00",
          wethUsdValue: "~$5.00",
        },
      };
    } else {
      const executionResult = await executeRainbowTransaction(
        testSigner,
        modifiedTrade,
        rainbowExecution,
        quoteResponse,
        CONFIG.rainbowRouterAddress,
      );

      const balanceChanges = await reportBalanceChanges(
        testSigner,
        WETH, // Using WETH as both contracts (will handle properly)
        WETH,
        initialInTokenBalance,
        initialOutTokenBalance,
        quoteResponse,
      );

      return {
        router,
        success: true,
        gasUsed: executionResult.gasUsed,
        txHash: executionResult.txHash,
        tokenReceived: {
          amount: balanceChanges.wethReceived,
          symbol: outToken.symbol,
          usdValue: balanceChanges.wethUsdValue,
          wethUsdValue: balanceChanges.wethUsdValue,
        },
      };
    }
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
  console.log(`📊 BASE TEST RESULTS`);
  console.log(`${"=".repeat(80)}`);

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`\n✅ Success: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);

  if (successful.length > 0) {
    console.log(`\n✓ Working Routers:`);
    successful.forEach(r => console.log(`  - ${r.router}`));
  }

  if (failed.length > 0) {
    console.log(`\n✗ Failed Routers:`);
    failed.forEach(r => console.log(`  - ${r.router}: ${r.error}`));
  }

  console.log(`\n${"=".repeat(80)}`);
}

main().catch(console.error);
