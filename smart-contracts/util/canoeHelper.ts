import { formatUnits, Signer, parseUnits, BigNumberish, AbiCoder, keccak256 } from "ethers";
import hre, { network } from "hardhat";
import { IERC20__factory, RainbowRouter, RainbowRouter__factory } from "../typechain-types";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { IERC20 } from "../typechain-types/contracts/interfaces/openzeppelin";
import axios from "axios";
import { ExecutionRequest, Coupon, Token, RainbowExecutionInfo } from "../scripts/canoeInterface";
import { generatePermitSignature } from "../scripts/msc";

// Re-export all the types and interfaces from the original canoeHelper
export * from "../scripts/canoeHelper";

// Constants
export const RAINBOW_ROUTER_EIP712_NAME = "Rainbow Router";
export const RAINBOW_ROUTER_EIP712_VERSION = "1.0";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const BACKEND_WARRANT_SIGNER = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";

// Network and token setup
export interface NetworkConfig {
    rainbowAddress: string;
    ownerAddr: string;
    usdcAddress: string;
    wethAddress: string;
    usdcWhale: string;
    forkUrl: string;
}

export const getNetworkConfig = (networkName: string): NetworkConfig => {
    // Default to Optimism config - can be extended for other networks
    return {
        rainbowAddress: "0x80dCD2C737cAFE9f86559bBCed9938eFfB7f7D1A",
        ownerAddr: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0", // Updated: ownership transferred to dev wallet
        usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        wethAddress: "0x4200000000000000000000000000000000000006",
        usdcWhale: "0xc0E17AD342AFABD36b3971F8305fF147006962ae",
        forkUrl: process.env.OP_URL!
    };
};

export interface TestSetup {
    testSigner: Signer;
    contractOwner: Signer;
    mainnet: boolean;
    Rainbow: RainbowRouter;
    USDC: IERC20;
    WETH: IERC20;
    config: NetworkConfig;
}

export const setupTestEnvironment = async (): Promise<TestSetup> => {
    const networkName = hre.network.name;
    const config = getNetworkConfig(networkName);
    let mainnet = true;
    let testSigner: Signer;
    let contractOwner: Signer;

    if (networkName === "hardhat" || networkName === "localhost") {
        mainnet = false;
        
        // Reset to fork with recent block
        await network.provider.request({
            method: "hardhat_reset",
            params: [{
                forking: {
                    jsonRpcUrl: config.forkUrl,
                    blockNumber: undefined // Use latest block, or specify a recent block number
                },
            }],
        });
        
        const blockNumber = await hre.ethers.provider.getBlockNumber();
        const chainId = (await hre.ethers.provider.getNetwork()).chainId;
        console.log(`✅ Reset to fork, block number: ${blockNumber}, chainId: ${chainId}`);
        
        const signers = await hre.ethers.getSigners();
        testSigner = signers[0];
        console.log("Test signer address:", await testSigner.getAddress());
        
        // Impersonate contract owner
        contractOwner = await hre.ethers.getSigner(config.ownerAddr);
        await setBalance(config.ownerAddr, hre.ethers.parseEther("1000"));
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [config.ownerAddr],
        });
        console.log("Impersonated contract owner:", config.ownerAddr);
        
    } else {
        const signers = await hre.ethers.getSigners();
        testSigner = signers[0];
        contractOwner = signers[0];
        
        const testAddress = await testSigner.getAddress();
        
        if (testAddress.toLowerCase() !== config.ownerAddr.toLowerCase()) {
            console.warn(`⚠️  Warning: Expected testing account ${config.ownerAddr}, got ${testAddress}`);
        }
    }

    // Initialize contracts
    const USDC = IERC20__factory.connect(config.usdcAddress, testSigner);
    const WETH = IERC20__factory.connect(config.wethAddress, testSigner);
    const Rainbow = RainbowRouter__factory.connect(config.rainbowAddress, testSigner);

    // Fund test account if on fork
    if (!mainnet) {
        await fundTestAccountWithUSDC(testSigner, USDC, config);
    } else {
        await checkLiveAccountBalances(testSigner, USDC, WETH);
    }

    return {
        testSigner,
        contractOwner,
        mainnet,
        Rainbow,
        USDC,
        WETH,
        config
    };
};

const fundTestAccountWithUSDC = async (testSigner: Signer, USDC: IERC20, config: NetworkConfig) => {
    console.log("\n💰 Funding test account with USDC...");
    
    const testAddress = await testSigner.getAddress();
    
    // Impersonate USDC whale
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [config.usdcWhale],
    });
    await setBalance(config.usdcWhale, hre.ethers.parseEther("1000"));
    
    const whaleUSDC = IERC20__factory.connect(config.usdcAddress, await hre.ethers.getSigner(config.usdcWhale));
    
    // Transfer USDC to test account
    const transferAmount = hre.ethers.parseUnits("1000", 6);
    await whaleUSDC.transfer(testAddress, transferAmount);
    
    const testBalance = await USDC.balanceOf(testAddress);
    console.log(`✅ Test account USDC balance: ${formatUnits(testBalance, 6)} USDC`);
    
    await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [config.usdcWhale],
    });
};

const checkLiveAccountBalances = async (testSigner: Signer, USDC: IERC20, WETH: IERC20) => {
    const testAddress = await testSigner.getAddress();
    const usdcBalance = await USDC.balanceOf(testAddress);

    const requiredAmount = parseUnits("5", 6);
    if (usdcBalance < requiredAmount) {
        throw new Error(`Insufficient USDC balance. Need: ${formatUnits(requiredAmount, 6)} USDC, Have: ${formatUnits(usdcBalance, 6)} USDC`);
    }
};

// Generic quote fetching
export const getRouterQuote = async (market: string, params: any, baseUrl?: string): Promise<any> => {
    const url = baseUrl || `http://localhost:3333/market/${market}/swap_quote`;

    try {
        const response = await axios.post(url, params);
        return response.data;
    } catch (error: any) {
        console.error(`Error fetching ${market} quote:`);
        if (axios.isAxiosError(error)) {
            console.error("Status:", error.response?.status);
            console.error("Response Data:", error.response?.data);
        } else {
            console.error("An unexpected error occurred:", error.message);
        }
        throw error;
    }
};

export const getRainbowExecution = async (
    coupon: Coupon,
    market: string,
    inToken: Token,
    outToken: Token,
    inputAmount: string,
    usePermit: boolean = false,
    permitSignature?: string,
    baseUrl?: string
): Promise<RainbowExecutionInfo> => {
    const url = baseUrl || `http://localhost:3333/market/${market}/execution_information`;

    const requestBody: ExecutionRequest = {
        coupon: coupon,
        inToken: inToken,
        outToken: outToken,
        inputAmount: inputAmount,
        useRainbow: true
    };

    if (usePermit) {
        if (permitSignature) {
            // @ts-ignore - permitSignature is not yet in ExecutionRequest interface
            requestBody.permitSignature = permitSignature;
        } else {
            requestBody.signingRequest = {};
        }
    }


    try {
        const response = await axios.post(url, requestBody);
        return response.data as RainbowExecutionInfo;
    } catch (error: any) {
        console.error(`❌ Error fetching ${market} Rainbow execution info:`);
        if (axios.isAxiosError(error)) {
            console.error("Status:", error.response?.status);
            console.error("Response Data:", error.response?.data);
        } else {
            console.error("An unexpected error occurred:", error.message);
        }
        throw error;
    }
};

// Contract interaction helpers
export const ensureTargetIsWhitelisted = async (ownerSigner: Signer, Rainbow: RainbowRouter, targetAddress: string) => {
    
    const isWhitelisted = await Rainbow.swapTargets(targetAddress);
    
    if (isWhitelisted) {
        return;
    }
    
    console.log("❌ Target not whitelisted. Adding to whitelist...");
    
    try {
        const tx = await Rainbow.connect(ownerSigner).updateSwapTargets(targetAddress, true);
        await tx.wait();
        
        console.log("✅ Target successfully whitelisted!");
        console.log(`Transaction hash: ${tx.hash}`);
        
        const nowWhitelisted = await Rainbow.swapTargets(targetAddress);
        if (!nowWhitelisted) {
            throw new Error("Target whitelisting verification failed");
        }
    } catch (error: any) {
        console.error("❌ Failed to whitelist target:", error.message);
        throw error;
    }
};

export const ensureSignerIsWhitelisted = async (ownerSigner: Signer, Rainbow: RainbowRouter, signerAddress: string) => {
    
    const isWhitelisted = await Rainbow.validSigners(signerAddress);
    
    if (isWhitelisted) {
        return;
    }
    
    console.log("❌ Signer not whitelisted. Adding to whitelist...");
    
    try {
        const tx = await Rainbow.connect(ownerSigner).updateValidSigner(signerAddress, true);
        await tx.wait();
        
        console.log("✅ Signer successfully whitelisted!");
        console.log(`Transaction hash: ${tx.hash}`);
        
        const nowWhitelisted = await Rainbow.validSigners(signerAddress);
        if (!nowWhitelisted) {
            throw new Error("Signer whitelisting verification failed");
        }
    } catch (error: any) {
        console.error("❌ Failed to whitelist signer:", error.message);
        throw error;
    }
};

export const handleERC20Approval = async (signer: Signer, USDC: IERC20, spenderAddress: string, amount: BigNumberish) => {
    const signerAddress = await signer.getAddress();
    
    console.log(`  Token to approve: USDC (${await USDC.getAddress()})`);
    console.log(`  Amount to approve: ${formatUnits(amount, 6)} USDC`);
    console.log(`  Spender: ${spenderAddress}`);
    console.log(`  Owner: ${signerAddress}`);
    
    const currentAllowance = await USDC.allowance(signerAddress, spenderAddress);
    console.log(`  Current allowance: ${formatUnits(currentAllowance, 6)} USDC`);
    
    if (currentAllowance >= BigInt(amount.toString())) {
        console.log(`✅ Sufficient allowance already exists`);
        return;
    }
    
    console.log(`❌ Insufficient allowance. Approving tokens...`);
    
    try {
        const approveTx = await USDC.connect(signer).approve(spenderAddress, amount);
        console.log(`📤 Approval transaction sent: ${approveTx.hash}`);
        
        const receipt = await approveTx.wait();
        console.log(`✅ Approval transaction confirmed in block ${receipt!.blockNumber}`);
        
        const newAllowance = await USDC.allowance(signerAddress, spenderAddress);
        console.log(`✅ New allowance: ${formatUnits(newAllowance, 6)} USDC`);
        
        if (newAllowance < BigInt(amount.toString())) {
            throw new Error(`Approval failed: expected ${formatUnits(amount, 6)}, got ${formatUnits(newAllowance, 6)}`);
        }
    } catch (error: any) {
        console.error(`❌ Approval failed: ${error.message}`);
        throw error;
    }
};

// Transaction execution and analysis
export const extractTargetFromRainbowData = (txData: string): string => {
    try {
        const rainbowInterface = RainbowRouter__factory.createInterface();
        const decoded = rainbowInterface.parseTransaction({ data: txData });
        
        if (decoded?.name === "fillQuoteTokenToToken") {
            return decoded.args[2] as string;
        }
        
        // Fallback: look for common patterns
        const match = txData.match(/6a000f20[0-9a-f]{32}/i);
        if (match) {
            return "0x" + match[0];
        }
        
        throw new Error("Could not extract target address from transaction data");
    } catch (error: any) {
        return "0x6A000F20005980200259B80c5102003040001068"; // Known fallback address
    }
};

export const rebuildTransactionDataWithModifiedWarrant = (originalTxData: string, modifiedWarrant: any): string => {
    try {
        const rainbowInterface = RainbowRouter__factory.createInterface();
        const decoded = rainbowInterface.parseTransaction({ data: originalTxData });
        
        if (decoded?.name === "fillQuoteTokenToToken") {
            const [sellToken, buyToken, target, swapCallData, sellAmount, feeAmount, originalWarrant] = decoded.args;
            
            const newWarrant = {
                nonce: originalWarrant.nonce || modifiedWarrant.nonce || "0",
                validBefore: originalWarrant.validBefore || modifiedWarrant.validBefore || "0", 
                validAfter: originalWarrant.validAfter || modifiedWarrant.validAfter || "0",
                verifyingSigner: modifiedWarrant.verifyingSigner,
                signature: originalWarrant.signature || modifiedWarrant.signature || "0x"
            };
            
            const newTxData = rainbowInterface.encodeFunctionData("fillQuoteTokenToToken", [
                sellToken, buyToken, target, swapCallData, sellAmount, feeAmount, newWarrant
            ]);
            
            console.log(`🔄 Warrant signer changed from ${originalWarrant.verifyingSigner} to ${newWarrant.verifyingSigner}`);
            return newTxData;
        } else if (decoded?.name === "fillQuoteTokenToEth") {
            const [sellToken, target, swapCallData, sellAmount, feePercentageBasisPoints, originalWarrant] = decoded.args;
            
            const newWarrant = {
                nonce: originalWarrant.nonce || modifiedWarrant.nonce || "0",
                validBefore: originalWarrant.validBefore || modifiedWarrant.validBefore || "0", 
                validAfter: originalWarrant.validAfter || modifiedWarrant.validAfter || "0",
                verifyingSigner: modifiedWarrant.verifyingSigner,
                signature: originalWarrant.signature || modifiedWarrant.signature || "0x"
            };
            
            const newTxData = rainbowInterface.encodeFunctionData("fillQuoteTokenToEth", [
                sellToken, target, swapCallData, sellAmount, feePercentageBasisPoints, newWarrant
            ]);
            
            console.log(`🔄 Warrant signer changed from ${originalWarrant.verifyingSigner} to ${newWarrant.verifyingSigner}`);
            return newTxData;
        } else if (decoded?.name === "fillQuoteEthToToken") {
            const [buyToken, target, swapCallData, feeAmount, originalWarrant] = decoded.args;
            
            const newWarrant = {
                nonce: originalWarrant.nonce || modifiedWarrant.nonce || "0",
                validBefore: originalWarrant.validBefore || modifiedWarrant.validBefore || "0", 
                validAfter: originalWarrant.validAfter || modifiedWarrant.validAfter || "0",
                verifyingSigner: modifiedWarrant.verifyingSigner,
                signature: originalWarrant.signature || modifiedWarrant.signature || "0x"
            };
            
            const newTxData = rainbowInterface.encodeFunctionData("fillQuoteEthToToken", [
                buyToken, target, swapCallData, feeAmount, newWarrant
            ]);
            
            console.log(`🔄 Warrant signer changed from ${originalWarrant.verifyingSigner} to ${newWarrant.verifyingSigner}`);
            return newTxData;
        } else {
            console.warn(`⚠️ Unknown function ${decoded?.name}, cannot rebuild transaction data`);
            return originalTxData;
        }
    } catch (error: any) {
        console.error("❌ Failed to rebuild transaction data:", error.message);
        console.log("🔄 Falling back to original transaction data");
        return originalTxData;
    }
};

export const executeRainbowTransaction = async (
    txSigner: Signer, 
    trade: any,
    rainbowExecution: RainbowExecutionInfo, 
    originalQuote: any,
    rainbowAddress: string
) => {
    const { to, data, value } = trade;
    const warrant = rainbowExecution.warrant;
    
    if (warrant) {
        console.log("Warrant Signer:", warrant.verifyingSigner);
    } else {
        console.log("No warrant (DEX doesn't use warrant system)");
    }
    
    const inputAmountBN = parseUnits(originalQuote.inAmount, originalQuote.inToken.decimals);
    const signerAddress = await txSigner.getAddress();
    
    // Verify transaction target is Rainbow Router
    if (to.toLowerCase() !== rainbowAddress.toLowerCase()) {
        throw new Error(`Expected Rainbow Router address ${rainbowAddress}, got ${to}`);
    }
    
    console.log(`🔄 Simulating swap transaction... (${(data.length / 2).toLocaleString()} bytes)`);
    
    const txRequest = {
        to: to,
        data: data,
        value: value,
        from: signerAddress
    };
    
    try {
        // Simulate the transaction
        const result = await txSigner.provider!.call(txRequest);
        const gasEstimate = await txSigner.provider!.estimateGas(txRequest);
        console.log(`✅ Swap simulation successful! Estimated gas: ${gasEstimate.toLocaleString()}`);
        
        // Execute the actual transaction
        console.log(`\n🚀 Executing actual swap transaction...`);
        const tx = await txSigner.sendTransaction(txRequest);
        console.log(`📤 Transaction sent: ${tx.hash}`);
        
        const receipt = await tx.wait();
        console.log(`✅ Transaction confirmed in block ${receipt!.blockNumber}`);
        console.log(`⛽ Gas used: ${receipt!.gasUsed.toLocaleString()}`);
        
        return {
            success: true,
            result: result,
            gasEstimate: gasEstimate.toString(),
            txHash: tx.hash,
            blockNumber: receipt!.blockNumber,
            gasUsed: receipt!.gasUsed.toString()
        };
        
    } catch (error: any) {
        console.error("❌ Transaction execution failed:", error.message);
        if (error.data) {
            console.error("Error data:", error.data);
        }
        throw error;
    }
};

// Balance reporting
export const reportBalanceChanges = async (
    testSigner: Signer,
    USDC: IERC20,
    WETH: IERC20,
    initialUsdcBalance: bigint,
    initialWethBalance: bigint,
    originalQuote: any
) => {
    const testAddress = await testSigner.getAddress();
    const finalUsdcBalance = await USDC.balanceOf(testAddress);
    const finalWethBalance = await WETH.balanceOf(testAddress);
    
    const usdcSpent = initialUsdcBalance - finalUsdcBalance;
    const wethReceived = finalWethBalance - initialWethBalance;
    
    console.log(`\n🎉 SWAP COMPLETED SUCCESSFULLY!`);
    console.log(`\n📊 FINAL BALANCES:`);
    console.log(`  USDC: ${formatUnits(finalUsdcBalance, 6)}`);
    console.log(`  WETH: ${formatUnits(finalWethBalance, 18)}`);
    
    console.log(`\n💰 NET CHANGES:`);
    console.log(`  📉 USDC Spent: ${formatUnits(usdcSpent, 6)} (~$${formatUnits(usdcSpent, 6)})`);
    console.log(`  📈 WETH Received: ${formatUnits(wethReceived, 18)}`);
    
    // Calculate approximate USD value
    const wethUsdValue = Number(formatUnits(wethReceived, 18)) * (Number(originalQuote.inAmount) / Number(originalQuote.outAmount));
    console.log(`  💵 WETH USD Value: ~$${wethUsdValue.toFixed(2)}`);
    
    return {
        usdcSpent: formatUnits(usdcSpent, 6),
        wethReceived: formatUnits(wethReceived, 18),
        wethUsdValue: wethUsdValue.toFixed(2)
    };
};