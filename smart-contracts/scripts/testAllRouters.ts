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
  rebuildTransactionDataWithModifiedWarrant,
  executeRainbowTransaction,
  reportBalanceChanges,
  ZERO_ADDRESS,
  BACKEND_WARRANT_SIGNER,
  TestSetup,
  getNetworkConfig,
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
  bypass: boolean; // Bypass warrant validation
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

// Default configuration for USDC → WETH on Optimism
const CONFIG: TestConfig = {
  // Execution settings
  bypass: false,
  usePermit: false,
  simulateOnly: true,

  // Network settings
  chain: "optimism",
  chainId: 10,
  userWalletAddress: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0",

  // Trade settings
  testAmount: "5",
  slippage: 1000, // 10%

  // Token pair
  inToken: {
    symbol: "USDC",
    decimals: 6,
    isNative: false,
  },
  outToken: {
    symbol: "WETH",
    decimals: 18,
    isNative: false,
  },

  // Routers to test
  routers: [
    //"enso",
    //"icecreamswap",
    //"odos",
    //"oneinch",
    //"paraswap",
    "kyberswap",
    "unizen"
    
  ],

  delayBetweenTests: 3000,
};

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
  console.log("🚀 STARTING COMPREHENSIVE ROUTER TESTING");
  console.log(`Testing ${CONFIG.routers.length} routers: ${CONFIG.routers.join(", ")}`);

  const results: RouterTestResult[] = [];
  const networkName = hre.network.name;

  console.log(`\n🌐 Network: ${networkName} (${CONFIG.chain})`);
  console.log(`\n💱 Test Parameters:`);
  console.log(`  Amount: ${CONFIG.testAmount} ${CONFIG.inToken.symbol} → ${CONFIG.outToken.symbol}`);
  console.log(`  Slippage: ${CONFIG.slippage / 100}% (${CONFIG.slippage} basis points)`);
  console.log(`  UsePermit: ${CONFIG.usePermit}`);
  console.log(`  Bypass: ${CONFIG.bypass}`);
  console.log(
    `  Simulate Only: ${CONFIG.simulateOnly ? "✅ YES (no actual transactions)" : "❌ NO (will send real transactions)"}`,
  );

  console.log(`\n🔴 LIVE NETWORK MODE:`);
  console.log(`  - Dev Wallet (User & Owner): ${CONFIG.userWalletAddress}`);
  console.log(
    `  - Quote Strategy: Optimized Rainbow Router (useRainbow: true)`,
  );
  console.log(`  - Backend: No rebuild needed - 50% faster performance`);
  console.log(`  - Will generate Tenderly simulation data for failures`);
  if (CONFIG.simulateOnly) {
    console.log(`  - Will NOT send actual transactions (simulation only)`);
  } else {
    console.log(`  - Will send REAL transactions to live network`);
  }

  // Test each router with fresh setup
  for (const router of CONFIG.routers) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🧪 TESTING ROUTER: ${router.toUpperCase()}`);
    console.log(`${"=".repeat(60)}`);

    try {
      // Fresh setup for each router to ensure clean state
      console.log(
        "🔄 Setting up fresh test environment for",
        router.toUpperCase(),
      );
      const setup = await setupTestEnvironment(CONFIG.usePermit, CONFIG.bypass);

      // Verify the signer matches our dev wallet
      const testAddress = await setup.testSigner.getAddress();
      if (testAddress.toLowerCase() !== CONFIG.userWalletAddress.toLowerCase()) {
        throw new Error(
          `Expected dev wallet ${CONFIG.userWalletAddress}, but got ${testAddress}. Make sure your wallet is configured correctly.`,
        );
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
        error: error.message,
      });
    }

    // Add delay between tests to avoid rate limiting
    if (CONFIG.routers.indexOf(router) < CONFIG.routers.length - 1) {
      console.log(`⏱️  Waiting ${CONFIG.delayBetweenTests / 1000} seconds before next test...`);
      await new Promise((resolve) => setTimeout(resolve, CONFIG.delayBetweenTests));
    }
  }

  // Print comprehensive results
  printTestSummary(results);
}

async function testRouter(
  router: string,
  setup: TestSetup,
): Promise<RouterTestResult> {
  const { testSigner, contractOwner, mainnet, Rainbow, USDC, WETH, config } =
    setup;
  const testAddress = await testSigner.getAddress();

  // Get token addresses from setup (USDC and WETH are still available from setup)
  // In the future, this could be extended to support arbitrary tokens
  const inTokenContract = CONFIG.inToken.symbol === "USDC" ? USDC : WETH;
  const outTokenContract = CONFIG.outToken.symbol === "WETH" ? WETH : USDC;

  // Create original token objects that must be preserved throughout the flow
  const originalInToken: Token = {
    address: CONFIG.inToken.address || await inTokenContract.getAddress(),
    decimals: CONFIG.inToken.decimals,
    symbol: CONFIG.inToken.symbol,
    chainId: CONFIG.chainId
  };

  const originalOutToken: Token = {
    address: CONFIG.outToken.address || await outTokenContract.getAddress(),
    decimals: CONFIG.outToken.decimals,
    symbol: CONFIG.outToken.symbol,
    chainId: CONFIG.chainId
  };

  // Set up test parameters - using new optimized Rainbow Router flow
  const inputAmount = parseUnits(CONFIG.testAmount, CONFIG.inToken.decimals);
  const params: canoeParams = {
    chain: CONFIG.chain,
    account: config.rainbowAddress, //fetch quote as rainbow => dex => rainbow
    isExactIn: true,
    inTokenAddress: originalInToken.address,
    outTokenAddress: originalOutToken.address,
    inTokenAmount: CONFIG.testAmount,
    slippage: CONFIG.slippage,
    useRainbow: true, // 🎯 Enables optimized Rainbow Router flow from start
    getCalldata: true //needed for oneinch to get the actual calldata for the swap
  };

  console.log(`🚀 Using optimized Rainbow Router flow with useRainbow flag`);

  console.log(
    `💱 Testing ${CONFIG.testAmount} ${CONFIG.inToken.symbol} → ${CONFIG.outToken.symbol} via ${router.toUpperCase()}`,
  );

  // Get initial balances
  const initialInTokenBalance = await inTokenContract.balanceOf(testAddress);
  const initialOutTokenBalance = await outTokenContract.balanceOf(testAddress);
  console.log(`📊 Initial ${CONFIG.inToken.symbol}: ${formatUnits(initialInTokenBalance, CONFIG.inToken.decimals)}`);
  console.log(`📊 Initial ${CONFIG.outToken.symbol}: ${formatUnits(initialOutTokenBalance, CONFIG.outToken.decimals)}`);

  try {
    // Step 1: Get quote
    console.log(`\n1. Getting ${router.toUpperCase()} quote...`);
    const quoteResponse = await getRouterQuote(router, params);

    if (!quoteResponse || !quoteResponse.coupon) {
      throw new Error("Failed to get valid quote response");
    }

    console.log(
      `Quote: ${quoteResponse.inAmount} ${quoteResponse.inToken.symbol} -> ${quoteResponse.outAmount} ${quoteResponse.outToken.symbol}`,
    );

    console.log("\n🔍 COUPON DEBUG:");
    console.log("Coupon account:", quoteResponse.coupon.account);
    console.log("Expected user address:", testAddress);
    console.log("Expected rainbow address:", config.rainbowAddress);

    // Log quote timing to detect stale data
    const quoteTime = new Date();
    console.log(`Quote received at: ${quoteTime.toISOString()}`);

    // Step 2: Get Rainbow execution - MUST use original token objects, not quote response tokens
    console.log(
      `\n2. Getting Rainbow execution for ${router.toUpperCase()}...`,
    );

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
    );

    console.log("✅ Rainbow execution prepared");

    // Debug warrant info
    if (rainbowExecution.warrant) {
      console.log(
        `  - Warrant signer: ${rainbowExecution.warrant.verifyingSigner}`,
      );
      console.log(
        `  - Backend signer match: ${rainbowExecution.warrant.verifyingSigner.toLowerCase() === BACKEND_WARRANT_SIGNER.toLowerCase()}`,
      );
    } else {
      console.log(`  - No warrant (${router} doesn't use warrant system)`);
    }

    // Apply bypass if enabled
    if (CONFIG.bypass && rainbowExecution.warrant) {
      console.log("🔧 Applying warrant bypass (zero address signer)");
      rainbowExecution.warrant.verifyingSigner = ZERO_ADDRESS;
    }

    // Get trade data
    const trade =
      rainbowExecution.trade || rainbowExecution.executionInformation?.trade;
    if (!trade) {
      throw new Error(
        "Invalid Rainbow execution response - no trade data found",
      );
    }

    console.log(`Rainbow target: ${trade.to}`);

    // Log execution timing to detect stale routing data
    const executionTime = new Date();
    console.log(`Execution data received at: ${executionTime.toISOString()}`);

    // Check if too much time has passed between quote and execution
    const timeDiff = executionTime.getTime() - quoteTime.getTime();
    if (timeDiff > 30000) {
      // 30 seconds
      console.log(
        `⚠️  WARNING: ${timeDiff / 1000}s elapsed between quote and execution - route may be stale`,
      );
    }

    // Extract target address first
    const targetAddress = extractTargetFromRainbowData(trade.data);

    // Analyze call data for potential backend issues
    console.log(`\n🔬 CALL DATA ANALYSIS:`);
    console.log(
      `  - Method: ${trade.data.substring(0, 10)} (fillQuoteTokenToToken)`,
    );
    console.log(
      `  - Data size: ${trade.data.length} chars (${Math.round(trade.data.length / 2)} bytes)`,
    );
    console.log(`  - Target aggregator: ${targetAddress}`);

    // Compare with ODOS baseline if we have it
    if (router === "okx") {
      console.log(
        `  - ODOS call data was ~1,482 chars, OKX is ${trade.data.length} chars`,
      );
      console.log(
        `  - Size ratio: ${(trade.data.length / 1482).toFixed(1)}x larger than ODOS`,
      );
      console.log(
        `  - This suggests much more complex routing or potential data bloat`,
      );
    }

    // Step 2.5: Pre-validate target contract and Rainbow Router state
    console.log(`\n2.5. Validating target contract and Rainbow Router...`);
    console.log(`Target address: ${targetAddress}`);

    // Check if target contract exists and has reasonable state
    const targetCode = await hre.ethers.provider.getCode(targetAddress);
    if (targetCode === "0x") {
      throw new Error(
        `Target contract ${targetAddress} does not exist - router may be using stale data`,
      );
    }

    // Validate Rainbow Router configuration
    console.log(`\n🔍 RAINBOW ROUTER VALIDATION:`);
    console.log(`  - Rainbow Router: ${config.rainbowAddress}`);
    console.log(`  - Expected Owner: ${CONFIG.userWalletAddress}`);

    // Check actual owner
    try {
      const actualOwner = await Rainbow.owner();
      console.log(`  - Actual Owner: ${actualOwner}`);
      console.log(
        `  - Owner Match: ${actualOwner.toLowerCase() === CONFIG.userWalletAddress.toLowerCase() ? "✅ YES" : "❌ NO"}`,
      );

      if (actualOwner.toLowerCase() !== CONFIG.userWalletAddress.toLowerCase()) {
        console.log(
          `  ⚠️  WARNING: Owner mismatch may cause authorization issues`,
        );
      }
    } catch (ownerError: any) {
      console.log(`  ❌ Could not check owner: ${ownerError.message}`);
    }

    // Check target balances for liquidity warning
    const targetInTokenBalance = await inTokenContract.balanceOf(targetAddress);
    const targetOutTokenBalance = await outTokenContract.balanceOf(targetAddress);
    const targetEthBalance =
      await hre.ethers.provider.getBalance(targetAddress);

    console.log(
      `Target balances: ${CONFIG.inToken.symbol}=${formatUnits(targetInTokenBalance, CONFIG.inToken.decimals)}, ${CONFIG.outToken.symbol}=${formatUnits(targetOutTokenBalance, CONFIG.outToken.decimals)}, ETH=${formatUnits(targetEthBalance, 18)}`,
    );

    if (
      targetInTokenBalance === 0n &&
      targetOutTokenBalance === 0n &&
      targetEthBalance === 0n
    ) {
      console.log(
        `⚠️  WARNING: Target contract has zero balances - this may cause liquidity issues`,
      );
    }

    // Step 3: Whitelist target
    console.log(`\n3. Checking target authorization...`);
    const authSigner = mainnet ? testSigner : contractOwner;
    await ensureTargetIsWhitelisted(authSigner, Rainbow, targetAddress);

    // Step 4: Whitelist signers if warrant exists
    if (rainbowExecution.warrant) {
      console.log(`\n4. Checking signer authorization...`);
      const signerAddress = CONFIG.bypass
        ? ZERO_ADDRESS
        : rainbowExecution.warrant.verifyingSigner;
      await ensureSignerIsWhitelisted(authSigner, Rainbow, signerAddress);
    }

    // Step 5: Whitelist test signer and backend signer
    console.log(`\n5. Ensuring all signers are whitelisted...`);
    await ensureSignerIsWhitelisted(authSigner, Rainbow, testAddress);
    await ensureSignerIsWhitelisted(
      authSigner,
      Rainbow,
      BACKEND_WARRANT_SIGNER,
    );

    // Step 6: Handle approvals if not using permits
    if (!CONFIG.usePermit) {
      console.log(`\n6. Handling ERC20 approval...`);
      await handleERC20Approval(
        testSigner,
        inTokenContract,
        config.rainbowAddress,
        inputAmount,
      );
    } else {
      console.log(`\n6. Skipping ERC20 approval (using permits)`);
    }

    // Step 6.5: PRE-EXECUTION STATE CHECK (only show issues)
    const preInTokenBalance = await inTokenContract.balanceOf(testAddress);
    const preOutTokenBalance = await outTokenContract.balanceOf(testAddress);
    const ethBalance = await hre.ethers.provider.getBalance(testAddress);
    const rainbowAllowance = await inTokenContract.allowance(
      testAddress,
      config.rainbowAddress,
    );

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

    // Only show diagnostics if there are issues or target mismatch
    const backendTarget = quoteResponse.candidateTrade?.to || "N/A";
    const targetMatch = backendTarget === targetAddress;

    if (issues.length > 0 || !targetMatch || CONFIG.usePermit) {
      console.log(`\n🔍 PRE-EXECUTION DIAGNOSTICS:`);
      if (issues.length > 0) {
        console.log(`❌ Issues found:`);
        issues.forEach((issue) => console.log(`  - ${issue}`));
      }
      if (!targetMatch) {
        console.log(
          `❌ Target mismatch: Backend(${backendTarget}) != Extracted(${targetAddress})`,
        );
      }
      if (CONFIG.usePermit && rainbowExecution.signingRequest?.permit2Address) {
        console.log(
          `🔏 Using Permit2: ${rainbowExecution.signingRequest.permit2Address}`,
        );
      }
    }

    // Step 7: Pre-simulate transaction to catch errors early
    console.log(`\n7. Pre-simulating ${router.toUpperCase()} transaction...`);

    let finalTradeData = trade.data;
    if (CONFIG.bypass && rainbowExecution.warrant) {
      console.log("🔧 Rebuilding transaction with warrant bypass...");
      finalTradeData = rebuildTransactionDataWithModifiedWarrant(
        trade.data,
        rainbowExecution.warrant,
      );
    }

    const modifiedTrade = { ...trade, data: finalTradeData };

    // Try simulation first, but if it fails, execute actual transaction to get real revert
    let gasEstimate: bigint | undefined;
    try {
      gasEstimate = await hre.ethers.provider.estimateGas({
        to: modifiedTrade.to,
        data: modifiedTrade.data,
        value: modifiedTrade.value,
        from: testAddress,
      });
      console.log(
        `✅ Pre-simulation successful, gas: ${gasEstimate.toLocaleString()}`,
      );
    } catch (simError: any) {
      // Simulation failed - log error and generate Tenderly data
      console.log(`❌ Pre-simulation failed: ${simError.message}`);

      // Generate Tenderly simulation data for failed simulations
      console.log(`\n📊 TENDERLY SIMULATION DATA for ${router.toUpperCase()}:`);
      console.log(`${"=".repeat(50)}`);
      console.log(`To: ${modifiedTrade.to}`);
      console.log(`From: ${testAddress}`);
      console.log(`Data: ${modifiedTrade.data}`);
      console.log(`Value: ${modifiedTrade.value}`);
      console.log(`${"=".repeat(50)}`);
      console.log(`\n📋 Copy the above data to Tenderly for simulation`);

      if (CONFIG.simulateOnly) {
        console.log(
          `\n⏸️  SIMULATION ONLY MODE - Not executing actual transaction`,
        );
        console.log(`❌ Pre-simulation failed with: ${simError.message}`);

        throw new Error(
          `${router.toUpperCase()} pre-simulation failed: ${simError.message}`,
        );
      } else {
        console.log(
          `❌ Pre-simulation failed, executing actual transaction to get revert reason...`,
        );

        // Execute actual transaction to get the real revert reason
        try {
          const gasLimit = gasEstimate || 500000;

          const tx = await testSigner.sendTransaction({
            to: modifiedTrade.to,
            data: modifiedTrade.data,
            value: modifiedTrade.value,
            gasLimit: gasLimit,
          });
          console.log(`Transaction sent: ${tx.hash}`);
          console.log(`🌐 Live network transaction hash: ${tx.hash}`);

          await tx.wait();
          console.log(`✅ Transaction succeeded unexpectedly!`);
        } catch (txError: any) {
          console.log(`\n🔍 ACTUAL TRANSACTION REVERT REASON:`);
          console.log(`  - Error: ${txError.message}`);
          console.log(`  - Code: ${txError.code || "N/A"}`);
          console.log(`  - Data: ${txError.data || "N/A"}`);
          console.log(`  - Reason: ${txError.reason || "N/A"}`);

          // Try to decode the revert reason
          if (txError.data && txError.data.startsWith("0x")) {
            try {
              if (txError.data.length >= 10) {
                const decoded = hre.ethers.AbiCoder.defaultAbiCoder().decode(
                  ["string"],
                  "0x" + txError.data.slice(10),
                );
                console.log(`  - DECODED REVERT: "${decoded[0]}"`);
              }
            } catch {
              console.log(`  - Could not decode revert data`);
            }
          }

          // Enhanced error message with actual revert
          const actualRevert =
            txError.reason ||
            (txError.data ? "See decoded revert above" : "Unknown");

          // Additional context for debugging backend vs contract issues
          console.log(`\n💡 DEBUGGING CONTEXT:`);
          console.log(
            `  - If this is a backend service issue: try getting a fresh quote and see if it works`,
          );
          console.log(
            `  - If this is a router-specific issue: the error will persist with fresh quotes`,
          );
          console.log(
            `  - Call data size: ${trade.data.length} chars suggests routing complexity`,
          );
          console.log(
            `  - Use Tenderly data above to simulate and debug the transaction`,
          );

          throw new Error(
            `${router.toUpperCase()} transaction reverted: ${actualRevert}`,
          );
        }
      }
    }

    // Step 8: Execute transaction (if not simulation only)
    if (CONFIG.simulateOnly) {
      console.log(
        `\n8. ⏸️  SIMULATION ONLY MODE - Skipping actual transaction execution`,
      );
      console.log(
        `✅ Pre-simulation passed - transaction would likely succeed`,
      );

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
      console.log(
        `\n8. Executing ${router.toUpperCase()} swap on LIVE NETWORK...`,
      );
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

function printTestSummary(results: RouterTestResult[]) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 COMPREHENSIVE ROUTER TEST RESULTS`);
  console.log(`${"=".repeat(80)}`);

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`\n📈 SUMMARY:`);
  console.log(
    `  ✅ Successful: ${successful.length}/${results.length} routers`,
  );
  console.log(`  ❌ Failed: ${failed.length}/${results.length} routers`);
  console.log(
    `  📊 Success Rate: ${((successful.length / results.length) * 100).toFixed(1)}%`,
  );

  if (successful.length > 0) {
    console.log(`\n✅ SUCCESSFUL ROUTERS:`);
    successful.forEach((result) => {
      console.log(`  🟢 ${result.router.toUpperCase()}`);
      if (result.tokenReceived) {
        console.log(`     💰 ${CONFIG.inToken.symbol} spent: ${CONFIG.testAmount}`);
        console.log(`     💎 ${result.tokenReceived.symbol} received: ${result.tokenReceived.amount}`);
        console.log(`     💵 USD value: ${result.tokenReceived.usdValue}`);
      }
      if (result.gasUsed) {
        console.log(
          `     ⛽ Gas used: ${parseInt(result.gasUsed).toLocaleString()}`,
        );
      }
      if (result.txHash) {
        console.log(`     🔗 TX: ${result.txHash}`);
      }
      console.log();
    });
  }

  if (failed.length > 0) {
    console.log(`\n❌ FAILED ROUTERS:`);
    failed.forEach((result) => {
      console.log(`  🔴 ${result.router.toUpperCase()}: ${result.error}`);
    });
  }

  console.log(`\n🎯 RECOMMENDATIONS:`);
  if (successful.length > 0) {
    const bestRouter = successful[0]; // First successful router
    console.log(
      `  - ${bestRouter.router.toUpperCase()} is confirmed working and can be used as a reference`,
    );
  }

  if (failed.length > 0) {
    console.log(`  - Failed routers may need:`);
    console.log(`    * Different slippage tolerance`);
    console.log(`    * Route availability at test time`);
    console.log(`    * Different permit/warrant settings`);
    console.log(`    * Specific token pair support`);
  }

  console.log(
    `\n🔄 To retry specific routers, modify the CONFIG.routers array in this script`,
  );

  console.log(`\n🌐 LIVE NETWORK TESTING NOTES:`);
  console.log(`  - Network: ${hre.network.name} (${CONFIG.chain})`);
  console.log(
    `  - Mode: ${CONFIG.simulateOnly ? "Simulation Only" : "Real Transactions"}`,
  );
  console.log(
    `  - All failed transactions include Tenderly simulation data above`,
  );
  console.log(`  - Use the To/From/Data/Value to debug in Tenderly`);
  console.log(`  - Dev wallet used: ${CONFIG.userWalletAddress}`);
  console.log(`  - Token pair: ${CONFIG.inToken.symbol} → ${CONFIG.outToken.symbol}`);

  console.log(`${"=".repeat(80)}`);
}

main().catch(console.error);
