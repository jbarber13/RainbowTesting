/**
 * testRoutersOP.ts
 *
 * Optimism Network Router Testing Script
 * Tests all supported routers on Optimism mainnet.
 *
 * Usage: npx hardhat run scripts/testRouters/testRoutersOP.ts --network op
 */

import { parseUnits } from "ethers";
import hre from "hardhat";
import {
  setupTestEnvironment,
  getRouterQuote,
  getRainbowExecution,
  ensureTargetIsWhitelisted,
  ensureSignerIsWhitelisted,
  handleERC20Approval,
  extractTargetsFromRainbowData,
  executeRainbowTransaction,
  reportBalanceChanges,
  BACKEND_WARRANT_SIGNER,
  TestSetup,
} from "../../util/canoeHelper";
import { canoeParams } from "../../util/canoeHelper";
import { Token } from "../canoeInterface";
import { IERC20__factory, RainbowRouter__factory } from "../../typechain-types";

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const CONFIG = {
  chain: "optimism",
  chainId: 10,
  rainbowRouterAddress: "0xA90845CFc60488cCB917169EeDCF3577092Df29f",
  userWalletAddress: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0",

  tokens: {
    ETH: {
      address: "0x0000000000000000000000000000000000000000",
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

  routers: [
    // Transfer proxy routers
    "okx",
    "zeroex",
    // Standard routers (confirmed working)
    // "enso",
    // "icecreamswap",
    // "odos",
    // "oneinch",
    // "paraswap",
    // "kyberswap",
    // "unizen",
  ],

  trades: [
    {
      name: "ETH → USDC",
      inToken: "ETH",
      outToken: "USDC",
      testAmount: "0.001",
    },
    {
      name: "USDC → ETH",
      inToken: "USDC",
      outToken: "ETH",
      testAmount: "5",
    },
    {
      name: "USDC → WETH",
      inToken: "USDC",
      outToken: "WETH",
      testAmount: "5",
    },
    {
      name: "WETH → USDC",
      inToken: "WETH",
      outToken: "USDC",
      testAmount: "0.001",
    },
  ],

  slippage: 1000,
  simulateOnly: true,
  delayBetweenTests: 3000,
};

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
  console.log(`Trades: ${CONFIG.trades.length}, Routers: ${CONFIG.routers.length}\n`);

  const results: RouterTestResult[] = [];

  for (const trade of CONFIG.trades) {
    console.log(`\n📋 Testing ${trade.name} (${CONFIG.routers.length} routers)`);

    for (const router of CONFIG.routers) {
      try {
        const setup = await setupTestEnvironment();
        const testAddress = await setup.testSigner.getAddress();

        if (testAddress.toLowerCase() !== CONFIG.userWalletAddress.toLowerCase()) {
          throw new Error(
            `Expected wallet ${CONFIG.userWalletAddress}, but got ${testAddress}`,
          );
        }

        const result = await testRouter(router, trade, setup);
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
          scenario: trade.name,
          success: false,
          error: error.message,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, CONFIG.delayBetweenTests));
    }

    if (CONFIG.trades.indexOf(trade) < CONFIG.trades.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  printTestSummary(results);
}

async function testRouter(
  router: string,
  tradeConfig: typeof CONFIG.trades[0],
  setup: TestSetup,
): Promise<RouterTestResult> {
  const { testSigner, contractOwner, mainnet, Rainbow, USDC, WETH } = setup;
  const testAddress = await testSigner.getAddress();

  const inToken = CONFIG.tokens[tradeConfig.inToken as keyof typeof CONFIG.tokens];
  const outToken = CONFIG.tokens[tradeConfig.outToken as keyof typeof CONFIG.tokens];

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

  const inputAmount = parseUnits(tradeConfig.testAmount, inToken.decimals);
  const params: canoeParams = {
    chain: CONFIG.chain,
    account: CONFIG.rainbowRouterAddress,
    isExactIn: true,
    inTokenAddress: originalInToken.address,
    outTokenAddress: originalOutToken.address,
    inTokenAmount: tradeConfig.testAmount,
    slippage: CONFIG.slippage,
    useOkuRouter: true,
    getCalldata: true,
    usePermit2: !inToken.isNative,
    userAddress: testAddress
  };

  const inTokenContract = inToken.isNative ? null :
    tradeConfig.inToken === "WETH" ? WETH :
    tradeConfig.inToken === "USDC" ? USDC :
    IERC20__factory.connect(inToken.address, testSigner);

  const outTokenContract = outToken.isNative ? null :
    tradeConfig.outToken === "WETH" ? WETH :
    tradeConfig.outToken === "USDC" ? USDC :
    IERC20__factory.connect(outToken.address, testSigner);

  const initialInTokenBalance = inToken.isNative
    ? await hre.ethers.provider.getBalance(testAddress)
    : await inTokenContract!.balanceOf(testAddress);

  const initialOutTokenBalance = outToken.isNative
    ? await hre.ethers.provider.getBalance(testAddress)
    : await outTokenContract!.balanceOf(testAddress);

  try {
    const quoteResponse = await getRouterQuote(router, params);

    if (!quoteResponse || !quoteResponse.coupon) {
      throw new Error("Failed to get valid quote response");
    }

    let permit2SigningRequest: any = undefined;
    let permit2SignatureGenerated = false;

    if (quoteResponse.signingRequest?.typedData && quoteResponse.signingRequest.typedData.length > 0) {
      try {
        const typedDataPayload = quoteResponse.signingRequest.typedData[0].payload;
        const signature = await testSigner.signTypedData(
          typedDataPayload.domain,
          typedDataPayload.types,
          typedDataPayload.message
        );

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
      throw new Error("Backend did not return Permit2 signingRequest");
    }

    const rainbowExecution = await getRainbowExecution(
      quoteResponse.coupon,
      router,
      permit2SigningRequest
    );

    const trade = rainbowExecution.trade;
    if (!trade) {
      throw new Error("No trade data found");
    }

    if (trade.to.toLowerCase() !== CONFIG.rainbowRouterAddress.toLowerCase()) {
      throw new Error(`Expected Rainbow Router, got ${trade.to}`);
    }

    const rainbowInterface = RainbowRouter__factory.createInterface();
    const decoded = rainbowInterface.parseTransaction({ data: trade.data });

    if (!decoded) {
      throw new Error("Failed to decode transaction");
    }

    const extractedTargets = extractTargetsFromRainbowData(trade.data);
    const { target: targetAddress, approvalTarget: approvalTargetAddress } = extractedTargets;
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    console.log(`      📍 Target: ${targetAddress}`);
    if (approvalTargetAddress && approvalTargetAddress.toLowerCase() !== targetAddress.toLowerCase()) {
      console.log(`      📍 ApprovalTarget: ${approvalTargetAddress}`);
    }

    if (targetAddress.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) {
      const targetCode = await hre.ethers.provider.getCode(targetAddress);
      if (targetCode === "0x") {
        throw new Error(`Target contract ${targetAddress} does not exist`);
      }
    }

    const functionName = decoded.name;
    const usingPermit2 = functionName.includes("WithPermit");

    let permit2Warning = "";
    if (params.usePermit2 && !inToken.isNative) {
      if (!permit2SignatureGenerated) {
        permit2Warning = "Expected Permit2 signature but none was generated";
        console.log(`      ⚠️  ${permit2Warning}`);
      } else if (!usingPermit2) {
        permit2Warning = `Expected Permit2 function but got ${functionName}`;
        console.log(`      ⚠️  ${permit2Warning}`);
      } else {
        console.log(`      ✅ Using Permit2`);
      }
    }

    if (!inToken.isNative && inTokenContract) {
      const tokenApprovalTarget = usingPermit2
        ? PERMIT2_ADDRESS
        : CONFIG.rainbowRouterAddress;

      await handleERC20Approval(
        testSigner,
        inTokenContract,
        tokenApprovalTarget,
        inputAmount,
        inToken.symbol,
        inToken.decimals
      );
    }

    const authSigner = mainnet ? testSigner : contractOwner;

    // Whitelist the target address
    await ensureTargetIsWhitelisted(authSigner, Rainbow, targetAddress);

    // Also whitelist the approvalTarget if it's different from target (for transfer proxy dexes)
    if (approvalTargetAddress &&
        approvalTargetAddress.toLowerCase() !== targetAddress.toLowerCase() &&
        approvalTargetAddress.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) {
      console.log(`      🔄 Also whitelisting approvalTarget (transfer proxy): ${approvalTargetAddress}`);
      await ensureTargetIsWhitelisted(authSigner, Rainbow, approvalTargetAddress);
    }

    if (rainbowExecution.warrant) {
      await ensureSignerIsWhitelisted(authSigner, Rainbow, rainbowExecution.warrant.verifyingSigner);
    }

    await ensureSignerIsWhitelisted(authSigner, Rainbow, testAddress);
    await ensureSignerIsWhitelisted(authSigner, Rainbow, BACKEND_WARRANT_SIGNER);

    let gasEstimate: bigint | undefined;
    try {
      gasEstimate = await hre.ethers.provider.estimateGas({
        to: trade.to,
        data: trade.data,
        value: trade.value,
        from: testAddress,
      });
    } catch (simError: any) {
      if (CONFIG.simulateOnly) {
        console.log(`      ❌ Simulation error details:`);
        console.log(`         Target: ${targetAddress}`);
        console.log(`         ApprovalTarget: ${approvalTargetAddress || "N/A"}`);
        console.log(`         Function: ${functionName}`);
        console.log(`         Error: ${simError.message}`);

        // Check whitelist status
        const targetWhitelisted = await Rainbow.swapTargets(targetAddress);
        console.log(`         Target whitelisted: ${targetWhitelisted}`);
        if (approvalTargetAddress && approvalTargetAddress !== targetAddress) {
          const approvalTargetWhitelisted = await Rainbow.swapTargets(approvalTargetAddress);
          console.log(`         ApprovalTarget whitelisted: ${approvalTargetWhitelisted}`);
        }

        // Try to decode the revert reason if available
        if (simError.data) {
          console.log(`         Revert data: ${simError.data}`);
        }

        // Print full decoded transaction for debugging
        console.log(`         Full decoded args:`);
        for (let i = 0; i < decoded.args.length; i++) {
          const arg = decoded.args[i];
          if (typeof arg === 'object' && arg !== null) {
            console.log(`           [${i}]: ${JSON.stringify(arg, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
          } else {
            console.log(`           [${i}]: ${arg}`);
          }
        }

        throw new Error(`Simulation failed: ${simError.message}`);
      }
    }

    if (CONFIG.simulateOnly) {
      return {
        router,
        scenario: tradeConfig.name,
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
        inTokenContract || outTokenContract!,
        outTokenContract || inTokenContract!,
        initialInTokenBalance,
        initialOutTokenBalance,
        quoteResponse,
      );

      return {
        router,
        scenario: tradeConfig.name,
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
      scenario: tradeConfig.name,
      success: false,
      error: error.message,
    };
  }
}

function printTestSummary(results: RouterTestResult[]) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 OPTIMISM TEST RESULTS`);
  console.log(`${"=".repeat(80)}`);

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const withWarnings = results.filter(r => r.success && r.warning);
  const usingPermit2 = results.filter(r => r.success && r.usingPermit2);

  console.log(`\n✅ Success: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);
  if (withWarnings.length > 0) {
    console.log(`⚠️  Warnings: ${withWarnings.length}/${results.length}`);
  }

  if (usingPermit2.length > 0) {
    console.log(`\n🎉 Using Permit2:`);
    usingPermit2.forEach(r => console.log(`  - ${r.router} - ${r.scenario}`));
  }

  if (withWarnings.length > 0) {
    console.log(`\n⚠️  Tests with Warnings:`);
    withWarnings.forEach(r => console.log(`  - ${r.router} - ${r.scenario}: ${r.warning}`));
  }

  if (failed.length > 0) {
    console.log(`\n✗ Failed Tests:`);
    failed.forEach(r => console.log(`  - ${r.router} - ${r.scenario}: ${r.error}`));
  }

  console.log(`\n${"=".repeat(80)}`);
}

main().catch(console.error);
