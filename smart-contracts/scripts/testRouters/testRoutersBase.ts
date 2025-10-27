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
    "kyberswap",
    "enso",
    "oneinch",
    "odos",
    "icecreamswap"
  ],

  /**
  Enso: 0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf
  Icecreamswap: 0xBb5e1777A331ED93E07cF043363e48d320eb96c4
  Oks: 0x5e2F47bD7D4B357fCfd0Bb224Eb665773B1B9801
  Odos: 0x19cEeAd7105607Cd444F5ad10dd51356436095a1
  1inch: 0x111111125421cA6dc452d289314280a0f8842A65\
  OpenOcean: 0x6352a56caadc4f1e25cd6c75970fa768a3304e64
  Velora: 0x6A000F20005980200259B80c5102003040001068
  Unison: 0xef58B643240178c2BC37681f8d4E50d7Ec37Ee22
  Luxor: 0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD
  0x (permit2): 0x000000000022D473030F116dDEE9F6B43aC78BA3
  Kyberswap: 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5
   */

  // Test configurations - array of trade pairs to test
  trades: [
    {
      name: "ETH → USDC",
      inToken: "ETH",
      outToken: "USDC",
      testAmount: "0.0005", // 0.0005 ETH (~$2)
      usePermit: false, // Native ETH doesn't need permits
    },
    {
      name: "USDC → ETH",
      inToken: "USDC",
      outToken: "ETH",
      testAmount: "1", // 1 USDC
      usePermit: true, // USDC supports EIP-2612 permits
    },
    {
      name: "USDC → WETH",
      inToken: "USDC",
      outToken: "WETH",
      testAmount: "1", // 1 USDC
      usePermit: true, // USDC supports EIP-2612 permits
    },
    {
      name: "WETH → USDC",
      inToken: "WETH",
      outToken: "USDC",
      testAmount: "0.0003", // 0.0003 WETH (~$1.20)
      usePermit: false, // WETH on Base does NOT support EIP-2612 permits
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
  console.log("🚀 Testing Base Routers\n");
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

    // Skip validation for native ETH placeholder address
    const ETH_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    if (targetAddress.toLowerCase() !== ETH_PLACEHOLDER.toLowerCase()) {
      const targetCode = await hre.ethers.provider.getCode(targetAddress);
      if (targetCode === "0x") {
        throw new Error(`Target contract ${targetAddress} does not exist`);
      }
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

      // Debug: Check balance
      const balance = await inTokenContract.balanceOf(testAddress);
      console.log(`  User ${inToken.symbol} balance: ${formatUnits(balance, inToken.decimals)} ${inToken.symbol}`);
      console.log(`  Required amount: ${formatUnits(inputAmount, inToken.decimals)} ${inToken.symbol}`);
      if (balance < inputAmount) {
        console.log(`  ⚠️ WARNING: Insufficient balance!`);
      }
    }

    // Debug: Check native ETH balance if needed
    if (inToken.isNative) {
      const ethBalance = await hre.ethers.provider.getBalance(testAddress);
      console.log(`  User ETH balance: ${formatUnits(ethBalance, 18)} ETH`);
      console.log(`  Required amount: ${formatUnits(inputAmount, 18)} ETH`);
      if (ethBalance < inputAmount) {
        console.log(`  ⚠️ WARNING: Insufficient ETH balance!`);
      }
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
        inTokenContract || outTokenContract!,
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
  console.log(`📊 BASE TEST RESULTS - ALL TRADES`);
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
