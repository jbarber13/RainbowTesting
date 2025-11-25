/**
 * testRoutersOP.ts
 *
 * Optimism Network Router Testing Script
 * Tests all supported routers on Optimism mainnet.
 *
 * Usage: npx hardhat run scripts/testRouters/testRoutersOP.ts --network op
 *
 * Permit2 Flow (for ERC20 input tokens):
 * 1. Quote phase: Request quote with usePermit2=true
 * 2. Backend returns signingRequest with Permit2 TypedData
 * 3. Client signs the Permit2 typed data
 * 4. Execution phase: Send signature to backend
 * 5. Backend includes signature in OkuRouter fillQuote call
 * 6. OkuRouter uses Permit2.permitTransferFrom to pull tokens
 * 7. Tokens approved to Permit2 (0x000000000022D473030F116dDEE9F6B43aC78BA3)
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
import { IERC20__factory, RainbowRouter__factory } from "../../typechain-types";

// ============================================================================
// CONFIGURATION - Optimism Network
// ============================================================================

// Permit2 canonical address (same across all EVM chains)
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

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
    /**
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
     */
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
  warning?: string;
  gasUsed?: string;
  txHash?: string;
  usingPermit2?: boolean;
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
      console.log(`\n📋 Testing ${router} - ${scenario.name}`);

      try {
        const setup = await setupTestEnvironment();

        // Verify the signer matches our dev wallet
        const testAddress = await setup.testSigner.getAddress();
        if (testAddress.toLowerCase() !== CONFIG.userWalletAddress.toLowerCase()) {
          throw new Error(
            `Expected wallet ${CONFIG.userWalletAddress}, but got ${testAddress}`,
          );
        }

        const result = await testRouter(router, scenario, setup);
        results.push(result);

        if (!result.success) {
          console.log(`   ❌ Failed: ${result.error}`);
        }
      } catch (error: any) {
        console.log(`   ❌ Failed: ${error.message}`);
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
    getCalldata: true,
    usePermit2: !inToken.isNative, // Use Permit2 for ERC20 inputs, not for native ETH
    userAddress: testAddress // Required for Permit2 signature generation
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
    const quoteResponse = await getRouterQuote(router, params);

    if (!quoteResponse || !quoteResponse.coupon) {
      throw new Error("Failed to get valid quote response");
    }

    // Debug: Check what backend returned
    console.log(`      📊 Backend Quote Response Analysis:`);
    console.log(`         Has signingRequest: ${!!quoteResponse.signingRequest}`);

    // Step 1.5: Handle Permit2 signature if required
    let permit2SigningRequest: any = undefined;
    let permit2SignatureGenerated = false;

    if (quoteResponse.signingRequest?.typedData && quoteResponse.signingRequest.typedData.length > 0) {
      try {
        const typedDataPayload = quoteResponse.signingRequest.typedData[0].payload;

        // Sign the Permit2 typed data
        const signature = await testSigner.signTypedData(
          typedDataPayload.domain,
          typedDataPayload.types,
          typedDataPayload.message
        );

        // Build the signing request with both payload and signature
        permit2SigningRequest = {
          typedData: [{
            payload: typedDataPayload,
            signature: signature
          }]
        };
        permit2SignatureGenerated = true;
      } catch (error: any) {
        throw new Error(`Permit2 signature failed: ${error.message}`);
      }
    } else if (params.usePermit2 && !inToken.isNative) {
      throw new Error("Backend did not return Permit2 signingRequest despite usePermit2=true");
    }

    // Step 2: Get Rainbow execution
    const rainbowExecution = await getRainbowExecution(
      quoteResponse.coupon,
      router,
      permit2SigningRequest // Pass the full signing request (payload + signature)
    );

    // Get trade data
    const trade = rainbowExecution.trade;
    if (!trade) {
      throw new Error("Invalid Rainbow execution response - no trade data found");
    }

    // Verify transaction target is Rainbow Router (not DEX aggregator)
    if (trade.to.toLowerCase() !== CONFIG.rainbowRouterAddress.toLowerCase()) {
      throw new Error(
        `Expected Rainbow Router address ${CONFIG.rainbowRouterAddress}, got ${trade.to}`
      );
    }

    // Decode the transaction to check function and parameters
    const rainbowInterface = RainbowRouter__factory.createInterface();
    const decoded = rainbowInterface.parseTransaction({ data: trade.data });

    if (!decoded) {
      throw new Error("Failed to decode Rainbow Router transaction");
    }

    // Extract target address and approvalTarget
    const targetAddress = extractTargetFromRainbowData(trade.data);
    const approvalTarget = decoded.args[3] as string;

    // Validate target contract exists
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    if (targetAddress.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) {
      const targetCode = await hre.ethers.provider.getCode(targetAddress);
      if (targetCode === "0x") {
        throw new Error(`Target contract ${targetAddress} does not exist`);
      }
    }

    // ============================================================================
    // PERMIT2 VERIFICATION
    // ============================================================================
    let usingPermit2 = false;
    const functionName = decoded.name;

    // Check 1: Is the function using Permit2?
    if (functionName === "fillQuoteTokenToTokenWithPermit") {
      usingPermit2 = true;
    }

    // Check 2: Verify we actually generated a Permit2 signature
    let permit2Warning = "";
    if (params.usePermit2 && !inToken.isNative) {
      if (!permit2SignatureGenerated) {
        permit2Warning = "Expected Permit2 signature but none was generated";
      } else if (!usingPermit2) {
        permit2Warning = `Expected fillQuoteTokenToTokenWithPermit but got ${functionName}`;
      }
    }

    // Log Permit2 status
    if (usingPermit2) {
      console.log(`      ✅ USING PERMIT2`);
      console.log(`         - Function: ${functionName}`);
      console.log(`         - Signature generated: ${permit2SignatureGenerated}`);
      console.log(`         - Approval target: Permit2 (${PERMIT2_ADDRESS})`);
    } else if (permit2Warning) {
      console.log(`      ⚠️  PERMIT2 WARNING: ${permit2Warning}`);
      console.log(`      ⚠️  Falling back to legacy approve`);
      console.log(`         - Function: ${functionName}`);
    } else {
      console.log(`      ℹ️  Using legacy approve (expected for this token)`);
      console.log(`         - Function: ${functionName}`);
    }

    // Handle token approvals for ERC20 input tokens
    if (!inToken.isNative) {
      const tokenContract = scenario.inToken === "WETH"
        ? WETH
        : scenario.inToken === "USDC"
        ? USDC
        : IERC20__factory.connect(inToken.address, testSigner);

      // Determine approval target based on what function is actually being used
      let approvalTargetAddress: string;
      let approvalTargetName: string;

      if (usingPermit2) {
        // Using Permit2 - approve Permit2 contract
        approvalTargetAddress = PERMIT2_ADDRESS;
        approvalTargetName = "Permit2";
      } else if (permit2Warning) {
        // Expected Permit2 but falling back - approve Rainbow Router
        approvalTargetAddress = CONFIG.rainbowRouterAddress;
        approvalTargetName = "Rainbow Router (fallback)";
      } else {
        // Legacy approve (expected) - approve Rainbow Router
        approvalTargetAddress = CONFIG.rainbowRouterAddress;
        approvalTargetName = "Rainbow Router";
      }

      console.log(`      Approving ${approvalTargetName}...`);
      await handleERC20Approval(
        testSigner,
        tokenContract,
        approvalTargetAddress,
        inputAmount,
        inToken.symbol,
        inToken.decimals
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

    // Pre-simulate transaction
    let gasEstimate: bigint | undefined;

    try {
      gasEstimate = await hre.ethers.provider.estimateGas({
        to: trade.to,
        data: trade.data,
        value: trade.value,
        from: testAddress,
      });
    } catch (simError: any) {
      console.log(`      ❌ Simulation failed: ${simError.message}`);
      console.log(`         📊 Tenderly Debug:`);
      console.log(`         To: ${trade.to}`);
      console.log(`         From: ${testAddress}`);
      console.log(`         Value: ${trade.value}`);
      console.log(`         Data: ${trade.data}`);

      if (CONFIG.simulateOnly) {
        throw new Error(`Simulation failed: ${simError.message}`);
      }
    }

    // Execute transaction (if not simulation only)
    if (CONFIG.simulateOnly) {
      console.log(`      ✅ SWAP SUCCESSFUL (simulated)`);
      console.log(`         Gas estimate: ${gasEstimate?.toString()}`);
      console.log(`         Expected output: ${quoteResponse.outAmount} ${quoteResponse.outToken.symbol}`);

      return {
        router,
        scenario: scenario.name,
        success: true,
        warning: permit2Warning || undefined,
        usingPermit2,
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
        trade,
        rainbowExecution,
        quoteResponse,
        CONFIG.rainbowRouterAddress,
      );

      const balanceChanges = await reportBalanceChanges(
        testSigner,
        WETH,
        WETH,
        initialInTokenBalance,
        initialOutTokenBalance,
        quoteResponse,
      );

      console.log(`      ✅ SWAP SUCCESSFUL (executed)`);
      console.log(`         TX: ${executionResult.txHash}`);
      console.log(`         Gas used: ${executionResult.gasUsed}`);
      console.log(`         Received: ${balanceChanges.wethReceived} ${outToken.symbol}`);

      return {
        router,
        scenario: scenario.name,
        success: true,
        warning: permit2Warning || undefined,
        usingPermit2,
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
  const withWarnings = results.filter((r) => r.success && r.warning);
  const usingPermit2 = results.filter((r) => r.success && r.usingPermit2);

  console.log(`\n✅ Success: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);
  if (withWarnings.length > 0) {
    console.log(`⚠️  Warnings: ${withWarnings.length}/${results.length}`);
  }

  if (usingPermit2.length > 0) {
    console.log(`\n🎉 Using Permit2:`);
    usingPermit2.forEach(r => console.log(`  - ${r.router} - ${r.scenario}`));
  }

  if (successful.length > 0 && usingPermit2.length < successful.length) {
    console.log(`\n✓ Successful Tests (Legacy Approve):`);
    successful.filter(r => !r.usingPermit2).forEach(r => {
      const warningText = r.warning ? ` (⚠️  ${r.warning})` : '';
      console.log(`  - ${r.router} - ${r.scenario}${warningText}`);
    });
  }

  if (failed.length > 0) {
    console.log(`\n✗ Failed Tests:`);
    failed.forEach(r => console.log(`  - ${r.router} - ${r.scenario}: ${r.error}`));
  }

  console.log(`\n${"=".repeat(80)}`);
}

main().catch(console.error);
