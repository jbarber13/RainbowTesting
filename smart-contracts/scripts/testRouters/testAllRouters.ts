/**
 * testAllRouters.ts
 *
 * Generic router testing script for live network execution.
 *
 * This script tests multiple DEX aggregator routers in a systematic way, allowing
 * you to validate different token pairs and networks by simply updating the CONFIG
 * object below.
 *
 * Usage:
 * 1. Update the CONFIG object to specify:
 *    - Token pair (inToken/outToken with symbol, decimals)
 *    - Network settings (chain, chainId)
 *    - Test parameters (amount, slippage)
 *    - Routers to test
 * 2. Run the script: npx hardhat run scripts/testAllRouters.ts --network <network>
 *
 * The script will:
 * - Test each router sequentially with fresh state
 * - Generate Tenderly simulation data for failures
 * - Provide comprehensive success/failure reports
 * - Support both simulation-only and real transaction modes
 *
 * Future enhancements:
 * - Native ETH support (set isNative: true in token config)
 * - Additional network configurations
 * - Custom token addresses (optional address field)
 */

import { formatUnits, parseUnits } from "ethers";
import hre, { network } from "hardhat";
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
} from "../util/canoeHelper";
import { canoeParams } from "../util/canoeHelper";
import { Token } from "./canoeInterface";

// ============================================================================
// CONFIGURATION - Modify these values to customize test behavior
// ============================================================================

interface TokenConfig {
  address?: string; // Optional: Will be fetched from setup if not provided
  symbol: string;
  decimals: number;
  isNative?: boolean; // For native ETH/MATIC/etc support
}

interface TestConfig {
  // Execution settings
  usePermit: boolean; // Use ERC-2612 permits
  simulateOnly: boolean; // Simulation only (no actual transactions)

  // Network settings
  chain: string; // e.g., "optimism", "ethereum", "polygon"
  chainId: number; // e.g., 10 for Optimism, 1 for Ethereum
  userWalletAddress: string; // User/owner wallet address

  // Trade settings
  testAmount: string; // Amount to swap (in token decimals)
  slippage: number; // Slippage in basis points (1000 = 10%)

  // Token pair configuration
  inToken: TokenConfig;
  outToken: TokenConfig;

  // Router settings
  routers: string[]; // List of routers to test
  delayBetweenTests: number; // Milliseconds between tests
}

// Test configurations - add multiple test scenarios here
const TEST_CONFIGS: TestConfig[] = [
  // Test 1: ETH → WETH on Worldchain (Native ETH as input)
  {
    // Execution settings
    usePermit: false, // No permits needed for native ETH
    simulateOnly: true,

    // Network settings
    chain: "worldchain",
    chainId: 480,
    userWalletAddress: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0",

    // Trade settings
    testAmount: "0.001", // 0.001 ETH
    slippage: 1000, // 10%

    // Token pair
    inToken: {
      symbol: "ETH",
      decimals: 18,
      isNative: true,
    },
    outToken: {
      symbol: "WETH",
      decimals: 18,
      isNative: false,
    },

    // Routers to test
    routers: [
      "enso",
      "icecreamswap",
      "kyberswap",
    ],

    delayBetweenTests: 3000,
  },

  /**
  // Test 2: ETH → WETH (Native ETH as input)
  {
    usePermit: false, // No permits needed for native ETH
    simulateOnly: true,

    chain: "optimism",
    chainId: 10,
    userWalletAddress: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0",

    testAmount: "0.001", // 0.001 ETH
    slippage: 1000,

    inToken: {
      symbol: "ETH",
      decimals: 18,
      isNative: true,
    },
    outToken: {
      symbol: "WETH",
      decimals: 18,
      isNative: false,
    },

    routers: [
      "enso",
      "icecreamswap",
      "odos",
      "oneinch",
      "paraswap",
      "kyberswap",
      "unizen"
    ],
    delayBetweenTests: 3000,
  },

  // Test 3: USDC → ETH (Native ETH as output)
  {
    usePermit: true, // Permits for USDC input
    simulateOnly: true,

    chain: "optimism",
    chainId: 10,
    userWalletAddress: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0",

    testAmount: "5",
    slippage: 1000,

    inToken: {
      symbol: "USDC",
      decimals: 6,
      isNative: false,
    },
    outToken: {
      symbol: "ETH",
      decimals: 18,
      isNative: true,
    },

    routers: [
      "enso",
      "icecreamswap",
      "odos",
      "oneinch",
      "paraswap",
      "kyberswap",
      "unizen"
    ],
    delayBetweenTests: 3000,
  },
   */
];

// ============================================================================
// EXAMPLE CONFIGURATIONS
// ============================================================================
/**
 * To test different scenarios, simply update the CONFIG object above:
 *
 * Example 1: WETH → USDC on Optimism
 * {
 *   ...CONFIG,
 *   testAmount: "0.01",
 *   inToken: { symbol: "WETH", decimals: 18, isNative: false },
 *   outToken: { symbol: "USDC", decimals: 6, isNative: false },
 * }
 *
 * Example 2: Test single router with real transactions
 * {
 *   ...CONFIG,
 *   simulateOnly: false,
 *   routers: ["odos"],
 * }
 *
 * Example 3: Higher slippage for volatile pairs
 * {
 *   ...CONFIG,
 *   slippage: 2000, // 20%
 * }
 */

// ============================================================================
// Router Status Reference (for configuration)
// ============================================================================
/**
 * Working routers:
 *  - enso: ✅ Working
 *  - icecreamswap: ✅ Working
 *  - odos: ✅ Working
 *  - oneinch: ✅ Working
 *  - paraswap: ✅ Working
 *  - kyberswap: ✅ Working (live network only)
 *  - unizen: ✅ Working
 *
 * Incompatible routers:
 *  - airswap: Chain not supported - should work on Ethereum, Polygon, BNB Chain, Linea
 *  - cowswap: Incompatible
 *  - okx: Incompatible
 *  - openocean: Incompatible
 *  - usor: Needs a separate local service to run, might be compatible
 *  - zeroex: Incompatible
 */

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
  console.log("🚀 Testing routers across multiple configurations...\n");

  const allResults: Map<string, RouterTestResult[]> = new Map();

  // Run tests for each configuration
  for (let configIndex = 0; configIndex < TEST_CONFIGS.length; configIndex++) {
    const CONFIG = TEST_CONFIGS[configIndex];
    const configName = `${CONFIG.inToken.symbol} → ${CONFIG.outToken.symbol}`;

    console.log(`\n📋 ${configName} (${CONFIG.routers.length} routers)`);

    const results: RouterTestResult[] = [];

    // Test each router with fresh setup
    for (const router of CONFIG.routers) {
      try {
        const setup = await setupTestEnvironment();

        // Verify the signer matches our dev wallet
        const testAddress = await setup.testSigner.getAddress();
        if (testAddress.toLowerCase() !== CONFIG.userWalletAddress.toLowerCase()) {
          throw new Error(
            `Expected dev wallet ${CONFIG.userWalletAddress}, but got ${testAddress}`,
          );
        }

        const result = await testRouter(router, setup, CONFIG);
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

      // Add delay between tests to avoid rate limiting
      if (CONFIG.routers.indexOf(router) < CONFIG.routers.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, CONFIG.delayBetweenTests));
      }
    }

    allResults.set(configName, results);

    // Add delay between configurations
    if (configIndex < TEST_CONFIGS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  // Print comprehensive results for all configurations
  printTestSummaryAllConfigs(allResults);
}

async function testRouter(
  router: string,
  setup: TestSetup,
  CONFIG: TestConfig,
): Promise<RouterTestResult> {
  const { testSigner, contractOwner, mainnet, Rainbow, USDC, WETH, config } =
    setup;
  const testAddress = await testSigner.getAddress();

  // Native ETH address used by aggregators
  const NATIVE_ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

  // Get token contracts and addresses (handle native ETH)
  let inTokenContract = CONFIG.inToken.symbol === "USDC" ? USDC : WETH;
  let outTokenContract = CONFIG.outToken.symbol === "WETH" ? WETH : USDC;

  // Create original token objects that must be preserved throughout the flow
  const originalInToken: Token = {
    address: CONFIG.inToken.isNative
      ? NATIVE_ETH_ADDRESS
      : (CONFIG.inToken.address || await inTokenContract.getAddress()),
    decimals: CONFIG.inToken.decimals,
    symbol: CONFIG.inToken.symbol,
    chainId: CONFIG.chainId
  };

  const originalOutToken: Token = {
    address: CONFIG.outToken.isNative
      ? NATIVE_ETH_ADDRESS
      : (CONFIG.outToken.address || await outTokenContract.getAddress()),
    decimals: CONFIG.outToken.decimals,
    symbol: CONFIG.outToken.symbol,
    chainId: CONFIG.chainId
  };

  // Set up test parameters - using new optimized Rainbow Router flow
  const inputAmount = parseUnits(CONFIG.testAmount, CONFIG.inToken.decimals);
  const params: canoeParams = {
    chain: CONFIG.chain,
    account: config.rainbowAddress, // Rainbow Router address (for DEX routing)
    userAddress: testAddress, // User wallet address (for permit owner/signer)
    isExactIn: true,
    inTokenAddress: originalInToken.address,
    outTokenAddress: originalOutToken.address,
    inTokenAmount: CONFIG.testAmount,
    slippage: CONFIG.slippage,
    useRainbow: true, // 🎯 Enables optimized Rainbow Router flow from start
    getCalldata: true, //needed for oneinch to get the actual calldata for the swap
    usePermit: CONFIG.usePermit // 🔑 Request permit signature flow
  };

  // Get initial balances (handle native ETH)
  const initialInTokenBalance = CONFIG.inToken.isNative
    ? await hre.ethers.provider.getBalance(testAddress)
    : await inTokenContract.balanceOf(testAddress);
  const initialOutTokenBalance = CONFIG.outToken.isNative
    ? await hre.ethers.provider.getBalance(testAddress)
    : await outTokenContract.balanceOf(testAddress);

  try {
    // Step 1: Get quote
    const quoteResponse = await getRouterQuote(router, params);

    if (!quoteResponse || !quoteResponse.coupon) {
      throw new Error("Failed to get valid quote response");
    }

    // Log quote timing to detect stale data
    const quoteTime = new Date();

    // Step 1.5: Sign permit if rainbowPermitRequest exists
    let permitSignature: string | undefined;
    if (CONFIG.usePermit && quoteResponse.rainbowPermitRequest) {
      const permitRequest = quoteResponse.rainbowPermitRequest;
      try {
        permitSignature = await testSigner.signTypedData(
          permitRequest.domain,
          permitRequest.types,
          permitRequest.message
        );
      } catch (error: any) {
        throw new Error(`Permit signing failed: ${error.message}`);
      }
    } else if (CONFIG.usePermit && !quoteResponse.rainbowPermitRequest) {
      console.log(`      ⚠️  Permit requested but not provided by backend`);
    }

    // Step 2: Get Rainbow execution - MUST use original token objects, not quote response tokens
    // Create ExecutionRequest with required fields
    const executionRequest = {
      coupon: quoteResponse.coupon,
      useRainbow: true,
      inToken: {
        address: originalInToken.address,
        chainId: originalInToken.chainId,
        decimals: originalInToken.decimals,
        symbol: originalInToken.symbol
      },
      outToken: {
        address: originalOutToken.address,
        chainId: originalOutToken.chainId,
        decimals: originalOutToken.decimals,
        symbol: originalOutToken.symbol
      },
      inputAmount: inputAmount.toString()
    };

    const rainbowExecution = await getRainbowExecution(
      executionRequest.coupon,
      router,
      executionRequest.inToken,
      executionRequest.outToken,
      executionRequest.inputAmount,
      CONFIG.usePermit,
      permitSignature,
    );

    // Get trade data
    const trade =
      rainbowExecution.trade || rainbowExecution.executionInformation?.trade;
    if (!trade) {
      throw new Error(
        "Invalid Rainbow execution response - no trade data found",
      );
    }

    // Log execution timing to detect stale routing data
    const executionTime = new Date();

    // Check if too much time has passed between quote and execution
    const timeDiff = executionTime.getTime() - quoteTime.getTime();
    if (timeDiff > 30000) {
      // 30 seconds
      console.log(
        `      ⚠️  ${timeDiff / 1000}s elapsed - route may be stale`,
      );
    }

    // Extract target address first
    const targetAddress = extractTargetFromRainbowData(trade.data);

    // Check if target contract exists and has reasonable state
    const targetCode = await hre.ethers.provider.getCode(targetAddress);
    if (targetCode === "0x") {
      throw new Error(
        `Target contract ${targetAddress} does not exist - router may be using stale data`,
      );
    }

    // Validate Rainbow Router configuration
    try {
      const actualOwner = await Rainbow.owner();
      if (actualOwner.toLowerCase() !== CONFIG.userWalletAddress.toLowerCase()) {
        console.log(`      ⚠️  Rainbow Router owner mismatch (expected: ${CONFIG.userWalletAddress}, actual: ${actualOwner})`);
      }
    } catch (ownerError: any) {
      console.log(`      ❌ Could not check owner: ${ownerError.message}`);
    }

    // Check target balances for liquidity warning
    const targetInTokenBalance = await inTokenContract.balanceOf(targetAddress);
    const targetOutTokenBalance = await outTokenContract.balanceOf(targetAddress);
    const targetEthBalance =
      await hre.ethers.provider.getBalance(targetAddress);

    if (
      targetInTokenBalance === 0n &&
      targetOutTokenBalance === 0n &&
      targetEthBalance === 0n
    ) {
      console.log(
        `      ⚠️  Target contract has zero balances - may cause liquidity issues`,
      );
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

    // Handle approvals if not using permits (skip for native ETH)
    if (!CONFIG.inToken.isNative && !CONFIG.usePermit) {
      await handleERC20Approval(
        testSigner,
        inTokenContract,
        config.rainbowAddress,
        inputAmount,
      );
    }

    // Step 6.5: PRE-EXECUTION STATE CHECK (only show issues)
    const preInTokenBalance = CONFIG.inToken.isNative
      ? await hre.ethers.provider.getBalance(testAddress)
      : await inTokenContract.balanceOf(testAddress);
    const preOutTokenBalance = CONFIG.outToken.isNative
      ? await hre.ethers.provider.getBalance(testAddress)
      : await outTokenContract.balanceOf(testAddress);
    const ethBalance = await hre.ethers.provider.getBalance(testAddress);
    const rainbowAllowance = CONFIG.inToken.isNative
      ? inputAmount // Native ETH doesn't need allowance
      : await inTokenContract.allowance(testAddress, config.rainbowAddress);

    // Check for issues
    const issues = [];
    if (preInTokenBalance < inputAmount)
      issues.push(
        `Insufficient ${CONFIG.inToken.symbol}: need ${formatUnits(inputAmount - preInTokenBalance, CONFIG.inToken.decimals)} more`,
      );
    if (!CONFIG.usePermit && rainbowAllowance < inputAmount)
      issues.push("Insufficient Rainbow Router allowance");
    if (ethBalance < parseUnits("0.001", 18))
      issues.push("Very low ETH balance for gas");

    // Only show diagnostics if there are issues
    if (issues.length > 0) {
      console.log(`      ❌ Issues:`);
      issues.forEach((issue) => console.log(`         - ${issue}`));
    }

    // Pre-simulate transaction to catch errors early
    const modifiedTrade = trade;

    // Try simulation first, but if it fails, execute actual transaction to get real revert
    let gasEstimate: bigint | undefined;
    try {
      gasEstimate = await hre.ethers.provider.estimateGas({
        to: modifiedTrade.to,
        data: modifiedTrade.data,
        value: modifiedTrade.value,
        from: testAddress,
      });
    } catch (simError: any) {
      // Simulation failed - log error and generate Tenderly data
      console.log(`      ❌ Simulation failed: ${simError.message}`);
      console.log(`         📊 Tenderly: To=${modifiedTrade.to}, From=${testAddress}, Value=${modifiedTrade.value}`);
      console.log(`         📊 Tenderly Data: ${modifiedTrade.data}`);

      if (CONFIG.simulateOnly) {
        throw new Error(
          `Simulation failed: ${simError.message}`,
        );
      } else {
        // Execute actual transaction to get the real revert reason
        try {
          const gasLimit = gasEstimate || 500000;

          const tx = await testSigner.sendTransaction({
            to: modifiedTrade.to,
            data: modifiedTrade.data,
            value: modifiedTrade.value,
            gasLimit: gasLimit,
          });
          console.log(`      🔗 TX: ${tx.hash}`);

          await tx.wait();
        } catch (txError: any) {
          console.log(`      ❌ TX reverted: ${txError.reason || txError.message}`);
          console.log(`         📊 Tenderly: To=${modifiedTrade.to}, From=${testAddress}, Value=${modifiedTrade.value}`);
          console.log(`         📊 Tenderly Data: ${modifiedTrade.data}`);

          throw new Error(
            `Transaction reverted: ${txError.reason || txError.message}`,
          );
        }
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
        config.rainbowAddress,
      );

      // Step 9: Report results
      const balanceChanges = await reportBalanceChanges(
        testSigner,
        inTokenContract,
        outTokenContract,
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
          symbol: CONFIG.outToken.symbol,
          usdValue: balanceChanges.wethUsdValue,
          wethUsdValue: balanceChanges.wethUsdValue,
        },
      };
    }
  } catch (error: any) {
    console.error(`\n❌ ${router.toUpperCase()} test failed:`, error.message);
    return {
      router,
      success: false,
      error: error.message,
    };
  }
}

function printTestSummaryAllConfigs(allResults: Map<string, RouterTestResult[]>) {
  console.log(`\n\n${"=".repeat(80)}`);
  console.log(`📊 COMPREHENSIVE TEST RESULTS - ALL CONFIGURATIONS`);
  console.log(`${"=".repeat(80)}`);

  let totalTests = 0;
  let totalSuccess = 0;
  let totalFailed = 0;

  allResults.forEach((results, configName) => {
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    totalTests += results.length;
    totalSuccess += successful.length;
    totalFailed += failed.length;

    console.log(`\n📋 ${configName}:`);
    console.log(`  ✅ Success: ${successful.length}/${results.length}`);
    console.log(`  ❌ Failed: ${failed.length}/${results.length}`);

    if (successful.length > 0) {
      console.log(`  ✓ Working: ${successful.map(r => r.router).join(", ")}`);
    }
    if (failed.length > 0) {
      console.log(`  ✗ Failed: ${failed.map(r => r.router).join(", ")}`);
    }
  });

  console.log(`\n${"=".repeat(80)}`);
  console.log(`📈 OVERALL SUMMARY:`);
  console.log(`  Total Tests: ${totalTests}`);
  console.log(`  ✅ Successful: ${totalSuccess} (${((totalSuccess / totalTests) * 100).toFixed(1)}%)`);
  console.log(`  ❌ Failed: ${totalFailed} (${((totalFailed / totalTests) * 100).toFixed(1)}%)`);
  console.log(`${"=".repeat(80)}`);
}

main().catch(console.error);
