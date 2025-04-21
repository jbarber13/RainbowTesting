/**
 * This file tests all the possible combinations of:
 * TOKEN => ETH
 * TOKEN => TOKEN
 * ETH => TOKEN
 *
 * through both aggregators (0x and 1inch)
 *
 * with different fees (0%, 0.5% and 1%)
 *
 * based on the input amount
 *
 */

import path from "path";
// eslint-disable-next-line import/no-extraneous-dependencies
import { expect } from "chai";
import { network } from "hardhat";
import { Sources } from "../types";
import {
  DAI_ADDRESS,
  ETH_ADDRESS,
  getQuoteFromFile,
  getVaultBalanceForToken,
  init,
  Logger,
  showGasUsage,
  WETH_ADDRESS,
} from "../utils";
import {
  Address,
  formatEther,
  formatUnits,
  parseEther,
  zeroAddress,
} from "viem";
import hre from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const SELL_AMOUNT = "0.1";
const TESTDATA_DIR = path.resolve(__dirname, "testdata/input");

describe("RainbowRouter Aggregators", function () {
  let swapTokenToToken: any,
    swapETHtoToken: any,
    swapTokenToETH: any,
    currentVaultAddress: Address;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_RPC_ENDPOINT!,
            blockNumber: 15214922
          },
        },
      ],
    })
    console.log("RESET")

    const {
      signer,
      rainbowRouterInstance,
      getEthVaultBalance,
      getSignerBalance,
      publicClient,
    } = await init();
    currentVaultAddress = rainbowRouterInstance.address;

    swapTokenToToken = async (
      source: Sources,
      inputAsset: Address,
      outputAsset: Address,
      sellAmount: bigint,
      feePercentageBasisPoints: bigint,
    ) => {
      const initialVaultInputTokenBalance = await getVaultBalanceForToken(
        inputAsset,
        rainbowRouterInstance.address,
      );
      const initialVaultOutputTokenBalance = await getVaultBalanceForToken(
        outputAsset,
        rainbowRouterInstance.address,
      );

      const inputAssetContract = await hre.viem.getContractAt(
        "IWETH",
        inputAsset,
      );
      const inputAssetSymbol = await inputAssetContract.read.symbol();
      const inputAssetDecimals = await inputAssetContract.read.decimals();

      const outputAssetContract = await hre.viem.getContractAt(
        "IWETH",
        outputAsset,
      );

      const outputAssetSymbol = await outputAssetContract.read.symbol();
      const outputAssetDecimals = await outputAssetContract.read.decimals();

      const sellAmountWei = parseEther(sellAmount.toString());

      const quote = await getQuoteFromFile(
        TESTDATA_DIR,
        source,
        "input",
        inputAsset,
        outputAsset,
        sellAmountWei.toString(),
        feePercentageBasisPoints.toString(),
      );
      if (!quote) return;

      Logger.log(
        "Input amount",
        formatUnits(sellAmountWei, inputAssetDecimals),
        inputAssetSymbol,
      );
      Logger.log(
        "Fee",
        formatUnits(quote.fee, inputAssetDecimals),
        inputAssetSymbol,
      );
      Logger.log(
        `User will get ~ `,
        formatUnits(quote.buyAmount, outputAssetDecimals),
        outputAssetSymbol,
      );

      if (inputAsset === WETH_ADDRESS) {
        Logger.log(
          `User wrapping ${sellAmount} into WETH to have input token available...`,
        );
        const depositTx = await inputAssetContract.write.deposit({
          value: sellAmountWei,
        });
        await publicClient.waitForTransactionReceipt({ hash: depositTx });
      }

      const initialInputAssetBalance = await inputAssetContract.read.balanceOf([
        signer.account.address,
      ]);
      const initialOutputAssetBalance =
        await outputAssetContract.read.balanceOf([signer.account.address]);

      Logger.log(
        `Initial user ${inputAssetSymbol} balance`,
        formatUnits(initialInputAssetBalance, inputAssetDecimals),
      );
      Logger.log(
        `Initial user balance ${outputAssetSymbol}: `,
        formatUnits(initialOutputAssetBalance, outputAssetDecimals),
      );

      // Grant the contact an allowance to spend our token.
      const approveTx = await inputAssetContract.write.approve([
        rainbowRouterInstance.address,
        sellAmountWei,
      ]);

      await publicClient.waitForTransactionReceipt({ hash: approveTx });
      Logger.log(`Approved token allowance of `, sellAmountWei.toString());

      Logger.log(`Executing swap...`);
      const swapTx = await rainbowRouterInstance.write.fillQuoteTokenToToken(
        [
          quote.sellTokenAddress,
          quote.buyTokenAddress,
          quote.to || "0x",
          quote.data || "0x",
          quote.sellAmount,
          quote.fee,
          {
            verifyingSigner: zeroAddress,
            nonce: 0n,
            signature: "0x",
            validBefore: 0,
            validAfter: 0,
          },
        ],
        {
          value: quote.value,
        },
      );

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: swapTx,
      });

      showGasUsage &&
        Logger.info("      ⛽  Gas usage: ", receipt.gasUsed.toString());

      const finalInputAssetBalance = await inputAssetContract.read.balanceOf([
        signer.account.address,
      ]);
      const finalOutputAssetBalance = await outputAssetContract.read.balanceOf([
        signer.account.address,
      ]);
      const inputTokenBalanceVault = await inputAssetContract.read.balanceOf([
        currentVaultAddress,
      ]);
      Logger.log(
        `Final user balance (${outputAssetSymbol}): `,
        formatUnits(finalOutputAssetBalance, outputAssetDecimals),
      );
      Logger.log(
        `Final VAULT balance (${inputAssetSymbol}): `,
        formatUnits(inputTokenBalanceVault, inputAssetDecimals),
      );

      const finalVaultInputTokenBalance = await getVaultBalanceForToken(
        inputAsset,
        rainbowRouterInstance.address,
      );
      const finalVaultOutputTokenBalance = await getVaultBalanceForToken(
        outputAsset,
        rainbowRouterInstance.address,
      );

      expect(finalInputAssetBalance < initialInputAssetBalance).to.be.equal(
        true,
      );
      expect(finalOutputAssetBalance > initialOutputAssetBalance).to.be.equal(
        true,
      );
      expect(inputTokenBalanceVault >= quote.fee).to.be.equal(true);

      expect(
        finalVaultInputTokenBalance >= initialVaultInputTokenBalance,
      ).to.be.equal(true);
      expect(
        finalVaultOutputTokenBalance >= initialVaultOutputTokenBalance,
      ).to.be.equal(true);

      return true;
    };

    swapETHtoToken = async (
      source: Sources,
      outputAsset: Address,
      sellAmount: bigint,
      feePercentageBasisPoints: bigint,
    ) => {
      const initialVaultOutputTokenBalance = await getVaultBalanceForToken(
        outputAsset,
        rainbowRouterInstance.address,
      );

      const tokenContract = await hre.viem.getContractAt("IWETH", outputAsset);
      const initialEthBalance = await getSignerBalance();
      const initialTokenBalance = await tokenContract.read.balanceOf([
        signer.account.address,
      ]);
      const tokenSymbol = await tokenContract.read.symbol();
      const tokenDecimals = await tokenContract.read.decimals();

      Logger.log("Initial user balance (ETH)", formatEther(initialEthBalance));
      Logger.log(
        `Initial user balance (${tokenSymbol}): `,
        formatUnits(initialTokenBalance, tokenDecimals),
      );

      const sellAmountWei = parseEther(sellAmount.toString());

      const quote = await getQuoteFromFile(
        TESTDATA_DIR,
        source,
        "input",
        ETH_ADDRESS,
        outputAsset,
        sellAmountWei.toString(),
        feePercentageBasisPoints.toString(),
      );
      if (!quote) return;

      Logger.log("Input amount", formatEther(sellAmountWei), "ETH");
      Logger.log("Fee", formatEther(quote.fee), "ETH");
      Logger.log(
        "Amount to be swapped",
        formatEther(quote.sellAmountMinusFees),
        "ETH",
      );
      Logger.log(
        `User will get ~ `,
        formatUnits(quote.buyAmount, tokenDecimals),
        tokenSymbol,
      );

      const ethBalanceVaultBeforeSwap = await getEthVaultBalance();

      Logger.log(`Executing swap... with `, formatEther(sellAmountWei));
      Logger.log("calldata is: ", quote.data);
      Logger.log("target is: ", quote.to);
      const swapTx = await rainbowRouterInstance.write.fillQuoteEthToToken(
        [
          quote.buyTokenAddress,
          quote.to || "0x",
          quote.data || "0x",
          quote.fee,
          {
            verifyingSigner: zeroAddress,
            nonce: 0n,
            validBefore: 0,
            validAfter: 0,
            signature: "0x",
          },
        ],
        {
          value: quote.value,
        },
      );

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: swapTx,
      });
      showGasUsage &&
        Logger.info("      ⛽  Gas usage: ", receipt.gasUsed.toString());

      const tokenBalanceSigner = await tokenContract.read.balanceOf([
        signer.account.address,
      ]);
      const ethBalanceSigner = await getSignerBalance();
      const ethBalanceVault = await getEthVaultBalance();
      const ethVaultDiff = ethBalanceVault - ethBalanceVaultBeforeSwap;
      Logger.log(
        `Final user balance (${tokenSymbol}): `,
        formatEther(tokenBalanceSigner),
      );
      Logger.log("Final user balance (ETH): ", formatEther(ethBalanceSigner));
      Logger.log("Final vault balance (ETH): ", formatEther(ethBalanceVault));
      Logger.log("Vault increase (ETH): ", formatEther(ethVaultDiff));

      const finalVaultOutputTokenBalance = await getVaultBalanceForToken(
        outputAsset,
        rainbowRouterInstance.address,
      );

      expect(tokenBalanceSigner > initialTokenBalance).to.be.equal(true);
      expect(ethBalanceSigner < initialEthBalance).to.be.equal(true);
      expect(formatEther(ethVaultDiff)).to.be.equal(formatEther(quote.fee));

      expect(ethBalanceVault >= ethBalanceVaultBeforeSwap).to.be.equal(true);
      expect(
        finalVaultOutputTokenBalance >= initialVaultOutputTokenBalance,
      ).to.be.equal(true);
    };

    swapTokenToETH = async (
      source: Sources,
      inputAsset: Address,
      _: bigint,
      feePercentageBasisPoints: bigint,
    ) => {
      const initialVaultInputTokenBalance = await getVaultBalanceForToken(
        inputAsset,
        rainbowRouterInstance.address,
      );
      const tokenContract = await hre.viem.getContractAt("IWETH", inputAsset);
      const initialEthBalance = await getSignerBalance();
      const initialTokenBalance = await tokenContract.read.balanceOf([
        signer.account.address,
      ]);
      const tokenSymbol = await tokenContract.read.symbol();
      const tokenDecimals = await tokenContract.read.decimals();
      const ethBalanceVaultBeforeSwap = await getEthVaultBalance();

      Logger.log(
        `Initial user balance (${tokenSymbol}): `,
        formatUnits(initialTokenBalance, tokenDecimals),
      );
      Logger.log("Initial user balance (ETH)", formatEther(initialEthBalance));

      const sellAmountWei = initialTokenBalance;

      const quote = await getQuoteFromFile(
        TESTDATA_DIR,
        source,
        "input",
        inputAsset,
        ETH_ADDRESS,
        sellAmountWei.toString(),
        feePercentageBasisPoints.toString(),
      );
      if (!quote) return;

      Logger.log(
        "Input amount",
        formatUnits(sellAmountWei, tokenDecimals),
        tokenSymbol,
      );
      Logger.log("Fee", formatEther(quote.fee), "ETH");
      Logger.log(
        "Amount to be swapped",
        formatUnits(quote.sellAmountMinusFees, tokenDecimals),
        tokenSymbol,
      );
      Logger.log(`User will get ~ `, formatEther(quote.buyAmount), "ETH");

      // Grant the allowance target an allowance to spend our WETH.
      const approveTx = await tokenContract.write.approve([
        rainbowRouterInstance.address,
        sellAmountWei,
      ]);

      await publicClient.waitForTransactionReceipt({ hash: approveTx });

      Logger.log(`Executing swap...`);
      Logger.log("calldata is: ", quote.data);
      Logger.log("target is: ", quote.to);

      const swapTx = await rainbowRouterInstance.write.fillQuoteTokenToEth(
        [
          quote.sellTokenAddress,
          quote.to || "0x",
          quote.data || "0x",
          quote.sellAmount,
          BigInt(quote.feePercentageBasisPoints),
          {
            verifyingSigner: zeroAddress,
            nonce: 0n,
            validBefore: 0,
            validAfter: 0,
            signature: "0x",
          },
        ],
        {
          value: quote.value,
        },
      );

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: swapTx,
      });

      showGasUsage &&
        Logger.info("      ⛽  Gas usage: ", receipt.gasUsed.toString());

      const tokenBalanceSigner = await tokenContract.read.balanceOf([
        signer.account.address,
      ]);
      const ethBalanceSigner = await getSignerBalance();
      const ethBalanceVault = await getEthVaultBalance();
      const ethVaultDiff = ethBalanceVault - ethBalanceVaultBeforeSwap;

      Logger.log(
        `Final user balance (${tokenSymbol}): `,
        formatUnits(tokenBalanceSigner, tokenDecimals),
      );
      Logger.log("Final user balance (ETH): ", formatEther(ethBalanceSigner));
      Logger.log("Final VAULT balance (ETH): ", formatEther(ethBalanceVault));
      Logger.log("Vault increase (ETH): ", formatEther(ethVaultDiff));

      const finalVaultInputTokenBalance = await getVaultBalanceForToken(
        inputAsset,
        rainbowRouterInstance.address,
      );

      expect(tokenBalanceSigner).to.be.equal(0n);
      expect(ethBalanceSigner < initialEthBalance).to.be.equal(true);
      if (feePercentageBasisPoints > 0n) {
        expect(ethVaultDiff > 0n).to.be.equal(true);
      }
      expect(ethBalanceVault >= ethBalanceVaultBeforeSwap).to.be.equal(true);
      expect(
        finalVaultInputTokenBalance >= initialVaultInputTokenBalance,
      ).to.be.equal(true);
    };
  });

  describe("Trades based on input amount", function () {
    // =====> 1inch trades

    // No fee
    it("Should be able to swap wETH to DAI with no fee on 1inch", async function () {
      return swapTokenToToken(
        "1inch",
        WETH_ADDRESS,
        DAI_ADDRESS,
        SELL_AMOUNT,
        0,
      );
    });

    it("Should be able to swap DAI to wETH with no fee on 1inch", async function () {
      return swapTokenToToken(
        "1inch",
        DAI_ADDRESS,
        WETH_ADDRESS,
        SELL_AMOUNT,
        0,
      );
    });

    it("Should be able to swap ETH to DAI with no fee on 1inch", async function () {
      return swapETHtoToken("1inch", DAI_ADDRESS, SELL_AMOUNT, 0);
    });

    it("Should be able to swap DAI to ETH with no fee on 1inch", async function () {
      return swapTokenToETH("1inch", DAI_ADDRESS, SELL_AMOUNT, 0);
    });

    // 0.5 % fee
    it("Should be able to swap wETH to DAI with a 0.5% fee on 1inch", async function () {
      return swapTokenToToken(
        "1inch",
        WETH_ADDRESS,
        DAI_ADDRESS,
        SELL_AMOUNT,
        50,
      );
    });

    it("Should be able to swap DAI to wETH with a 0.5% fee on 1inch", async function () {
      return swapTokenToToken(
        "1inch",
        DAI_ADDRESS,
        WETH_ADDRESS,
        SELL_AMOUNT,
        50,
      );
    });

    it("Should be able to swap ETH to DAI with a 0.5% fee on 1inch", async function () {
      return swapETHtoToken("1inch", DAI_ADDRESS, SELL_AMOUNT, 50);
    });

    it("Should be able to swap DAI to ETH with a 0.5% fee on 1inch", async function () {
      return swapETHtoToken("1inch", DAI_ADDRESS, SELL_AMOUNT, 50);
    });

    // 1% fee
    it("Should be able to swap wETH to DAI with a 1% fee on 1inch", async function () {
      return swapTokenToToken(
        "1inch",
        WETH_ADDRESS,
        DAI_ADDRESS,
        SELL_AMOUNT,
        100,
      );
    });

    it("Should be able to swap DAI to wETH with a 1% fee on 1inch", async function () {
      return swapTokenToToken(
        "1inch",
        DAI_ADDRESS,
        WETH_ADDRESS,
        SELL_AMOUNT,
        100,
      );
    });

    it("Should be able to swap ETH to DAI with a 1% fee on 1inch", async function () {
      return swapETHtoToken("1inch", DAI_ADDRESS, SELL_AMOUNT, 100);
    });

    it("Should be able to swap DAI to ETH with a 1% fee on 1inch", async function () {
      return swapETHtoToken("1inch", DAI_ADDRESS, SELL_AMOUNT, 100);
    });

    // ====>  0x trades

    // No fee
    it("Should be able to swap wETH to DAI with no fee on 0x", async function () {
      return swapTokenToToken("0x", WETH_ADDRESS, DAI_ADDRESS, SELL_AMOUNT, 0);
    });

    it("Should be able to swap DAI to wETH with no fee on 0x", async function () {
      return swapTokenToToken("0x", DAI_ADDRESS, WETH_ADDRESS, SELL_AMOUNT, 0);
    });

    it("Should be able to swap ETH to DAI with no fee on 0x", async function () {
      return swapETHtoToken("0x", DAI_ADDRESS, SELL_AMOUNT, 0);
    });

    it("Should be able to swap DAI to ETH with no fee on 0x", async function () {
      return swapTokenToETH("0x", DAI_ADDRESS, SELL_AMOUNT, 0);
    });

    // 0.5 % fee
    it("Should be able to swap wETH to DAI with a 0.5% fee on 0x", async function () {
      return swapTokenToToken("0x", WETH_ADDRESS, DAI_ADDRESS, SELL_AMOUNT, 50);
    });

    it("Should be able to swap DAI to wETH with a 0.5% fee on 0x", async function () {
      return swapTokenToToken("0x", DAI_ADDRESS, WETH_ADDRESS, SELL_AMOUNT, 50);
    });

    it("Should be able to swap ETH to DAI with a 0.5% fee on 0x", async function () {
      return swapETHtoToken("0x", DAI_ADDRESS, SELL_AMOUNT, 50);
    });

    it("Should be able to swap DAI to ETH with a 0.5% fee on 0x", async function () {
      return swapETHtoToken("0x", DAI_ADDRESS, SELL_AMOUNT, 50);
    });

    // 1% fee
    it("Should be able to swap wETH to DAI with a 1% fee on 0x", async function () {
      return swapTokenToToken(
        "0x",
        WETH_ADDRESS,
        DAI_ADDRESS,
        SELL_AMOUNT,
        100,
      );
    });

    it("Should be able to swap DAI to wETH with a 1% fee on 0x", async function () {
      return swapTokenToToken(
        "0x",
        DAI_ADDRESS,
        WETH_ADDRESS,
        SELL_AMOUNT,
        100,
      );
    });

    it("Should be able to swap ETH to DAI with a 1% fee on 0x", async function () {
      return swapETHtoToken("0x", DAI_ADDRESS, SELL_AMOUNT, 100);
    });

    it("Should be able to swap DAI to ETH with a 1% fee on 0x", async function () {
      return swapETHtoToken("0x", DAI_ADDRESS, SELL_AMOUNT, 100);
    });
  });
});
