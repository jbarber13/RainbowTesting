/**
 * testRoutersOP.ts
 *
 * Optimism Network Router Testing Script
 * Tests all supported routers on Optimism mainnet.
 *
 * Usage: npx hardhat run scripts/testRouters/testRoutersOP.ts --network op
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
// CONFIGURATION - Optimism Network
// ============================================================================


/**todo - de-slow the back end: 
 * 
  - Location: util/canoeHelper.ts:184 - getRouterQuote() function
  - Issue: Backend API at http://localhost:3333/market/{router}/swap_quote is taking 74-111 seconds to respond
  - Root cause: Your backend is likely:
    - Making slow calls to external DEX aggregator APIs
    - Experiencing network latency
    - Performing complex route calculations
    - Potentially timing out and retrying internally
 */

const CONFIG = {
  // Network settings
  chain: "optimism",
  chainId: 10,
  rainbowRouterAddress: "0xA90845CFc60488cCB917169EeDCF3577092Df29f",  // NEW DEPLOYMENT with approvalTarget support
  userWalletAddress: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0",

  // Supported tokens
  tokens: {
    ETH: {
      address: "0x0000000000000000000000000000000000000000", // Native ETH (zero address)
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

  // Supported routers
  routers: [
    "enso",
    //"icecreamswap",
    //"odos",
    //"oneinch",
    //"paraswap",
    //"kyberswap",
    //"unizen",
    //"okx",
    //"zeroex"
  ],

  // Test scenarios
  testScenarios: [
    {
      name: "ETH → WETH",
      inToken: "ETH",
      outToken: "WETH",
      amount: "0.001",
    },
    {
      name: "WETH → ETH",
      inToken: "WETH",
      outToken: "ETH",
      amount: "0.001",
    },
    {
      name: "USDC → WETH",
      inToken: "USDC",
      outToken: "WETH",
      amount: "5", // $5 USDC
    },
  ],

  // Test settings
  slippage: 1000, // 10%
  simulateOnly: true,
  delayBetweenTests: 3000, // 3 seconds
};

// ============================================================================
// TEST EXECUTION
// ============================================================================

interface RouterTestResult {
  router: string;
  scenario: string;
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
  console.log("🚀 Testing Optimism Routers\n");
  console.log(`Network: ${CONFIG.chain} (chainId: ${CONFIG.chainId})`);
  console.log(`Rainbow Router: ${CONFIG.rainbowRouterAddress}`);
  console.log(`Routers: ${CONFIG.routers.length}, Scenarios: ${CONFIG.testScenarios.length}\n`);

  const results: RouterTestResult[] = [];

  // Test each router with each scenario
  for (const router of CONFIG.routers) {
    for (const scenario of CONFIG.testScenarios) {
      try {
        const setup = await setupTestEnvironment();

        // Verify the signer matches our dev wallet
        const testAddress = await setup.testSigner.getAddress();
        if (testAddress.toLowerCase() !== CONFIG.userWalletAddress.toLowerCase()) {
          throw new Error(
            `Expected wallet ${CONFIG.userWalletAddress}, but got ${testAddress}`,
          );
        }

        console.log(`\n📋 Testing ${router} - ${scenario.name}`);
        const result = await testRouter(router, scenario, setup);
        results.push(result);

        if (result.success) {
          console.log(`  ✅ ${router} - ${scenario.name}`);
        } else {
          console.log(`  ❌ ${router} - ${scenario.name}: ${result.error}`);
        }
      } catch (error: any) {
        console.log(`  ❌ ${router} - ${scenario.name}: ${error.message}`);
        results.push({
          router,
          scenario: scenario.name,
          success: false,
          error: error.message,
        });
      }

      // Add delay between tests
      await new Promise((resolve) => setTimeout(resolve, CONFIG.delayBetweenTests));
    }
  }

  // Print summary
  printTestSummary(results);
}

async function testRouter(
  router: string,
  scenario: { name: string; inToken: string; outToken: string; amount: string },
  setup: TestSetup,
): Promise<RouterTestResult> {
  const { testSigner, contractOwner, mainnet, Rainbow, USDC, WETH } = setup;
  const testAddress = await testSigner.getAddress();

  // Get token configs based on scenario
  const inToken = CONFIG.tokens[scenario.inToken as keyof typeof CONFIG.tokens];
  const outToken = CONFIG.tokens[scenario.outToken as keyof typeof CONFIG.tokens];

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
  const inputAmount = parseUnits(scenario.amount, inToken.decimals);
  const params: canoeParams = {
    chain: CONFIG.chain,
    account: CONFIG.rainbowRouterAddress,
    isExactIn: true,
    inTokenAddress: originalInToken.address,
    outTokenAddress: originalOutToken.address,
    inTokenAmount: scenario.amount,
    slippage: CONFIG.slippage,
    useOkuRouter: true,
    getCalldata: true
  };

  // Get initial balances based on token types
  let initialInTokenBalance: bigint;
  let initialOutTokenBalance: bigint;

  if (inToken.isNative) {
    initialInTokenBalance = await hre.ethers.provider.getBalance(testAddress);
  } else {
    const inTokenContract = scenario.inToken === "WETH"
      ? WETH
      : scenario.inToken === "USDC"
      ? USDC
      : IERC20__factory.connect(inToken.address, testSigner);
    initialInTokenBalance = await inTokenContract.balanceOf(testAddress);
  }

  if (outToken.isNative) {
    initialOutTokenBalance = await hre.ethers.provider.getBalance(testAddress);
  } else {
    const outTokenContract = scenario.outToken === "WETH"
      ? WETH
      : scenario.outToken === "USDC"
      ? USDC
      : IERC20__factory.connect(outToken.address, testSigner);
    initialOutTokenBalance = await outTokenContract.balanceOf(testAddress);
  }

  try {
    // Step 1: Get quote
    console.log(`      [${router}] Starting quote request...`);
    const quoteStart = Date.now();
    const quoteResponse = await getRouterQuote(router, params);
    const quoteEnd = Date.now();
    console.log(`      [${router}] Quote received in ${quoteEnd - quoteStart}ms`);

    if (!quoteResponse || !quoteResponse.coupon) {
      throw new Error("Failed to get valid quote response");
    }

    // Step 2: Get Rainbow execution
    // Rainbow transformation already happened at quote time
    console.log(`      [${router}] Starting execution request...`);
    const execStart = Date.now();

    const rainbowExecution = await getRainbowExecution(
      quoteResponse.coupon,
      router
    );
    const execEnd = Date.now();
    console.log(`      [${router}] Execution received in ${execEnd - execStart}ms`);

    // Get trade data
    console.log(`      [${router}] Processing trade data...`);
    const trade = rainbowExecution.trade;
    if (!trade) {
      throw new Error("Invalid Rainbow execution response - no trade data found");
    }

    // Verify transaction target is Rainbow Router (not DEX aggregator)
    if (trade.to.toLowerCase() !== CONFIG.rainbowRouterAddress.toLowerCase()) {
      throw new Error(
        `Expected Rainbow Router address ${CONFIG.rainbowRouterAddress}, got ${trade.to}. ` +
        `Backend may not have transformed to Rainbow Router correctly.`
      );
    }

    // Verify approvals (if any) target Rainbow Router
    if (rainbowExecution.approvals && rainbowExecution.approvals.length > 0) {
      for (const approval of rainbowExecution.approvals) {
        if (approval.approvee &&
            approval.approvee.toLowerCase() !== CONFIG.rainbowRouterAddress.toLowerCase()) {
          throw new Error(
            `Approval targets ${approval.approvee} instead of Rainbow Router ${CONFIG.rainbowRouterAddress}`
          );
        }
      }
    }

    // Extract and validate target address
    const targetAddress = extractTargetFromRainbowData(trade.data);

    // Skip validation for zero address (native ETH)
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    if (targetAddress.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) {
      const targetCode = await hre.ethers.provider.getCode(targetAddress);
      if (targetCode === "0x") {
        throw new Error(`Target contract ${targetAddress} does not exist`);
      }
    }

    // Handle token approvals for ERC20 input tokens
    if (!inToken.isNative) {
      console.log(`      [${router}] Handling ${inToken.symbol} approval...`);
      const tokenContract = scenario.inToken === "WETH"
        ? WETH
        : scenario.inToken === "USDC"
        ? USDC
        : IERC20__factory.connect(inToken.address, testSigner);

      await handleERC20Approval(
        testSigner,
        tokenContract,
        CONFIG.rainbowRouterAddress,
        inputAmount,
        inToken.symbol,
        inToken.decimals
      );
    }

    // Setup: Whitelist target and signers
    console.log(`      [${router}] Whitelisting addresses...`);
    const whitelistStart = Date.now();
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
    const whitelistEnd = Date.now();
    console.log(`      [${router}] Whitelisting complete in ${whitelistEnd - whitelistStart}ms`);

    // Pre-simulate transaction
    console.log(`      [${router}] Simulating transaction...`);
    const simStart = Date.now();
    const modifiedTrade = trade;
    let gasEstimate: bigint | undefined;

    try {
      gasEstimate = await hre.ethers.provider.estimateGas({
        to: modifiedTrade.to,
        data: modifiedTrade.data,
        value: modifiedTrade.value,
        from: testAddress,
      });
      const simEnd = Date.now();
      console.log(`      [${router}] Simulation complete in ${simEnd - simStart}ms`);
    } catch (simError: any) {
      const simEnd = Date.now();
      console.log(`      [${router}] Simulation failed in ${simEnd - simStart}ms`);
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
        scenario: scenario.name,
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
        scenario: scenario.name,
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
      scenario: scenario.name,
      success: false,
      error: error.message,
    };
  }
}

function printTestSummary(results: RouterTestResult[]) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 OPTIMISM TEST RESULTS`);
  console.log(`${"=".repeat(80)}`);

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`\n✅ Success: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);

  if (successful.length > 0) {
    console.log(`\n✓ Successful Tests:`);
    successful.forEach(r => console.log(`  - ${r.router} - ${r.scenario}`));
  }

  if (failed.length > 0) {
    console.log(`\n✗ Failed Tests:`);
    failed.forEach(r => console.log(`  - ${r.router} - ${r.scenario}: ${r.error}`));
  }

  console.log(`\n${"=".repeat(80)}`);
}

main().catch(console.error);
