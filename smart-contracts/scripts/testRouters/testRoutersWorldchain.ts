/**
 * testRoutersWorldchain.ts
 *
 * Worldchain Network Router Testing Script
 * Tests all supported routers on Worldchain mainnet.
 *
 * Usage: npx hardhat run scripts/testRouters/testRoutersWorldchain.ts --network worldchain
 */

import { formatUnits, parseUnits, Contract } from "ethers";
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
// CONFIGURATION - Worldchain Network
// ============================================================================

const CONFIG = {
  // Network settings
  chain: "worldchain",
  chainId: 480,
  rainbowRouterAddress: "0x25cf2128F603754179379351B805B4F8C0B8dCA4",
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
      address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
      decimals: 6,
      symbol: "USDC",
      isNative: false,
    },
    WLD: {
      address: "0x2cfc85d8e48f8eab294be644d9e25c3030863003",
      decimals: 18,
      symbol: "WLD",
      isNative: false,
    },
  },

  // Supported routers
  routers: [
    "icecreamswap",
    "enso",//bug returning base chain augustus router?
    //"kyberswap"//api says not supported
  ],

  // Test configurations - array of trade pairs to test
  trades: [
    {
      name: "USDC → WLD",
      inToken: "USDC",
      outToken: "WLD",
      testAmount: "1", // 1 USDC
      usePermit: true, // USDC supports EIP-2612 permits
    },
    {
      name: "WLD → USDC",
      inToken: "WLD",
      outToken: "USDC",
      testAmount: "1", // 1 WLD
      usePermit: false, // WLD does NOT support EIP-2612 permits (OptimismMintableERC20)
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
  tradeName: string;
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
  console.log("🚀 Testing Worldchain Routers\n");
  console.log(`Network: ${CONFIG.chain} (chainId: ${CONFIG.chainId})`);
  console.log(`Rainbow Router: ${CONFIG.rainbowRouterAddress}`);
  console.log(`Trades to test: ${CONFIG.trades.length}`);
  console.log(`Routers to test: ${CONFIG.routers.length}\n`);

  const allResults: Map<string, RouterTestResult[]> = new Map();

  // Test each trade configuration
  for (const trade of CONFIG.trades) {
    console.log(`\n📋 Testing ${trade.name} (${CONFIG.routers.length} routers)`);
    const results: RouterTestResult[] = [];

    // Test each router for this trade
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

        const result = await testRouter(router, setup, trade);
        results.push(result);

        if (result.success) {
          console.log(`  ✅ ${router}`);
        } else {
          console.log(`  ❌ ${router}: ${result.error}`);
        }
      } catch (error: any) {
        console.log(`  ❌ ${router}: ${error.message}`);
        results.push({
          tradeName: trade.name,
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

    allResults.set(trade.name, results);

    // Add delay between trade configurations
    if (CONFIG.trades.indexOf(trade) < CONFIG.trades.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  // Print comprehensive summary
  printTestSummary(allResults);
}

async function testRouter(
  router: string,
  setup: TestSetup,
  tradeConfig: typeof CONFIG.trades[0],
): Promise<RouterTestResult> {
  const { testSigner, contractOwner, mainnet, Rainbow } = setup;
  const testAddress = await testSigner.getAddress();

  // Get tokens from the trade configuration
  const inToken = CONFIG.tokens[tradeConfig.inToken as keyof typeof CONFIG.tokens];
  const outToken = CONFIG.tokens[tradeConfig.outToken as keyof typeof CONFIG.tokens];

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
  const inputAmount = parseUnits(tradeConfig.testAmount, inToken.decimals);
  const params: canoeParams = {
    chain: CONFIG.chain,
    account: CONFIG.rainbowRouterAddress,
    userAddress: testAddress,
    isExactIn: true,
    inTokenAddress: originalInToken.address,
    outTokenAddress: originalOutToken.address,
    inTokenAmount: tradeConfig.testAmount,
    slippage: CONFIG.slippage,
    useRainbow: true,
    getCalldata: true,
    usePermit: tradeConfig.usePermit
  };

  // Get token contracts for balance checking
  const inTokenContract = inToken.isNative
    ? null
    : IERC20__factory.connect(inToken.address, testSigner);
  const outTokenContract = outToken.isNative
    ? null
    : IERC20__factory.connect(outToken.address, testSigner);

  // Get initial balances
  const initialInTokenBalance = inToken.isNative
    ? await hre.ethers.provider.getBalance(testAddress)
    : await inTokenContract!.balanceOf(testAddress);
  const initialOutTokenBalance = outToken.isNative
    ? await hre.ethers.provider.getBalance(testAddress)
    : await outTokenContract!.balanceOf(testAddress);

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

    // Step 1.5: Sign permit if requested and rainbowPermitRequest exists
    let permitSignature: string | undefined;
    if (tradeConfig.usePermit && quoteResponse.rainbowPermitRequest) {
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
    }

    const rainbowExecution = await getRainbowExecution(
      executionRequest.coupon,
      router,
      executionRequest.inToken,
      executionRequest.outToken,
      executionRequest.inputAmount,
      tradeConfig.usePermit,
      permitSignature,
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

    // Handle approvals if not using permits (for ERC20 tokens only)
    if (!tradeConfig.usePermit && !inToken.isNative && inTokenContract) {
      await handleERC20Approval(
        testSigner,
        inTokenContract,
        CONFIG.rainbowRouterAddress,
        inputAmount,
        inToken.symbol,
        inToken.decimals,
      );
    }

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
        tradeName: tradeConfig.name,
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
        inTokenContract || outTokenContract!, // Pass any valid contract
        outTokenContract || inTokenContract!,
        initialInTokenBalance,
        initialOutTokenBalance,
        quoteResponse,
      );

      return {
        tradeName: tradeConfig.name,
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
      tradeName: tradeConfig.name,
      router,
      success: false,
      error: error.message,
    };
  }
}

function printTestSummary(allResults: Map<string, RouterTestResult[]>) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 WORLDCHAIN TEST RESULTS - ALL TRADES`);
  console.log(`${"=".repeat(80)}`);

  let totalTests = 0;
  let totalSuccess = 0;
  let totalFailed = 0;

  allResults.forEach((results, tradeName) => {
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    totalTests += results.length;
    totalSuccess += successful.length;
    totalFailed += failed.length;

    console.log(`\n📋 ${tradeName}:`);
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
