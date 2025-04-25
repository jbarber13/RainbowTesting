import { RainbowRouter, RainbowRouter__factory } from "../../typechain-types";
import { ERC20, IERC20 } from "../../typechain-types/contracts/interfaces/openzeppelin";
import { network } from "hardhat";
import { AbiCoder, Interface, Signer, ZeroAddress } from "ethers";
import { ERC20__factory, IERC20__factory } from "../../typechain-types/factories/contracts/interfaces/openzeppelin";
import { generatePermitSignature, generateUniTxData, stealMoney } from "../../scripts/msc";
import { expect } from "chai";
const { ethers } = require("hardhat");

describe("Permit Signature", () => {
    let Rainbow: RainbowRouter;
    const routerAddr = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
    const universalRouter = "0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8"//"0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"//"0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8"//"0xE592427A0AEce92De3Edee1F18E0157C05861564"//0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8
    const ownerAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89";
    const wethAmount = ethers.parseEther("0.0001");
    const usdcAmount = ethers.parseUnits("0.01", 6);
    const usdcNativeWhale = "0x133FA49A01801264fC05A12EF5ef9Db6a302e93D"

    let USDC: ERC20;
    let WETH: IERC20;
    let signer: Signer;

    before(async () => {
        //console.log("Before");
    });

    it("Setup", async function (this: any) {
        this.timeout(10000);
        //console.log("STARTING");

        // reset
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.OP_URL!,
                    },
                },
            ],
        });
        //console.log("reset to OP");

        signer = (await ethers.getSigners())[0]

        const usdcAddress = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"//0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85 //0x7F5c764cBc14f9669B88837ca1490cCa17c31607
        USDC = ERC20__factory.connect(usdcAddress, signer)
        WETH = IERC20__factory.connect("0x4200000000000000000000000000000000000006", signer)


    });

    it("Deploy", async () => {
        Rainbow = await new RainbowRouter__factory(signer).deploy()

        //update swap target
        let tx = await Rainbow.connect(signer).updateSwapTargets(routerAddr, true)
        await tx.wait()
        tx = await Rainbow.connect(signer).updateSwapTargets(universalRouter, true)
        await tx.wait()
        tx = await Rainbow.connect(signer).updateSwapTargets("0xE592427A0AEce92De3Edee1F18E0157C05861564", true)
        await tx.wait()


        //update valid signer
        tx = await Rainbow.connect(signer).updateValidSigner(await signer.getAddress(), true)
        await tx.wait()
        tx = await Rainbow.connect(signer).updateValidSigner(ZeroAddress, true)
        await tx.wait()
    });

    it("Do Token => Token", async () => {
        const txData = await generateUniTxData(
            await USDC.getAddress(),
            await WETH.getAddress(),
            usdcAmount,
            routerAddr,
            500,
            await Rainbow.getAddress(),
            0n
        )

        // Get milliseconds since epoch
        const millisecondsSinceEpoch: number = Date.now();

        // Convert to seconds and floor to get the integer Unix timestamp
        const time: number = Math.floor(millisecondsSinceEpoch / 1000);

        const warrant = {
            nonce: await signer.getNonce(),
            validBefore: time + 5000,
            validAfter: time - 5000,
            verifyingSigner: ZeroAddress,
            signature: "0x"
        }

        //generate permit2 signature

        const network = await ethers.provider.getNetwork();
        //console.log("Chain ID:", network.chainId);

        const permitData = await generatePermitSignature(
            signer,
            network.chainId,
            await USDC.getAddress(),
            usdcAmount,
            await Rainbow.getAddress()
        )

        //fund transaction
        await stealMoney(usdcNativeWhale, await signer.getAddress(), await USDC.getAddress(), usdcAmount)
        console.log("Stole USDC")

        //send the tx 
        //console.log("SENDING")
        let tx = await Rainbow.connect(signer).fillQuoteTokenToTokenWithPermit(
            await USDC.getAddress(),
            await WETH.getAddress(),
            routerAddr,
            txData,
            usdcAmount,
            0n,
            permitData,
            warrant
        )
        await tx.wait()
        //console.log("done")
    })

    it("Test swapRouter", async () => {
        await stealMoney(usdcNativeWhale, await signer.getAddress(), await USDC.getAddress(), usdcAmount)
        console.log("Stole USDC")
        expect(await USDC.balanceOf(await signer.getAddress())).to.eq(usdcAmount, "Insufficient balance")


        const swapRouter = new ethers.Contract(
            "0xE592427A0AEce92De3Edee1F18E0157C05861564", // SwapRouter address
            [
                `function exactInputSingle(
                  tuple(
                    address tokenIn,
                    address tokenOut,
                    uint24 fee,
                    address recipient,
                    uint256 deadline,
                    uint256 amountIn,
                    uint256 amountOutMinimum,
                    uint160 sqrtPriceLimitX96
                  ) params
                ) external payable returns (uint256)`
            ],
            signer
        );

        await USDC.connect(signer).approve("0xE592427A0AEce92De3Edee1F18E0157C05861564", usdcAmount)
        const allowance = await USDC.allowance(await signer.getAddress(), "0xE592427A0AEce92De3Edee1F18E0157C05861564")
        //console.log("Allowance: ", allowance)

        const params = {
            tokenIn: await USDC.getAddress(),
            tokenOut: await WETH.getAddress(),
            fee: 500,
            recipient: await signer.getAddress(),
            deadline: Math.floor(Date.now() / 1000) + 1800,
            amountIn: usdcAmount,
            amountOutMinimum: 1,
            sqrtPriceLimitX96: 0
        };

        const result = await swapRouter.getFunction("exactInputSingle").staticCall(params);
    })

    it("Native Ether to Token", async () => {
        // --- Configuration ---
        const usdcAddress = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"; // Optimism USDC address
        const wethAddress = "0x4200000000000000000000000000000000000006"; // Optimism WETH address
        const uniswapV3RouterAddress = "0xE592427A0AEce92De3Edee1F18E0157C05861564"; // Uniswap V3 SwapRouter address on Optimism
        const wethUsdcPoolFee = 500; // Example: 0.05% fee tier. **VERIFY THIS for the specific Optimism pool**

        // --- ABI Fragment for Uniswap V3 exactInputSingle ---
        const uniswapV3RouterABI = [
            "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"
        ];
        const uniswapRouterInterface = new Interface(uniswapV3RouterABI);


        const [signer] = await ethers.getSigners();
        //console.log("Using signer:", signer.address);

        const USDC = ERC20__factory.connect(usdcAddress, signer);
        // WETH connection not strictly needed for this call structure, but good to have
        // const WETH = IERC20__factory.connect(wethAddress, signer);

        // Define amounts
        const wethAmount = ethers.parseEther("0.0001"); // ETH to send
        // *** IMPORTANT: amountOutMinimum should be calculated based on price and slippage ***
        // Using 0 for this example is DANGEROUS in production.
        // A very small non-zero value might be slightly better for testing basic flow.
        const usdcAmountOutMinimum = 0n; // Example: Expect at least 0 USDC (REPLACE WITH ACTUAL CALCULATION)
        // const usdcAmountOutMinimum = ethers.parseUnits("0.005", 6); // Alternative tiny minimum example

        // --- Prepare Function Arguments for fillQuoteEthToToken ---

        // 1. buyTokenAddress (remains USDC)
        const buyTokenAddress = await USDC.getAddress();

        // 2. target (payable) - THIS IS NOW THE UNISWAP ROUTER
        const targetAddress = uniswapV3RouterAddress;

        // 3. swapCallData - Generate data for Uniswap V3 exactInputSingle
        const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes from now

        const exactInputSingleParams = {
            tokenIn: wethAddress,           // Swapping WETH (router handles ETH deposit)
            tokenOut: usdcAddress,          // Getting USDC
            fee: wethUsdcPoolFee,           // Fee tier of the WETH/USDC pool
            recipient: await Rainbow.getAddress(),      // Send the output USDC to the signer
            deadline: BigInt(deadline),     // Deadline for the swap
            amountIn: wethAmount,           // The amount of ETH/WETH being swapped
            amountOutMinimum: usdcAmountOutMinimum, // Minimum USDC to receive (!! CALCULATE PROPERLY !!)
            sqrtPriceLimitX96: 0n           // No price limit
        };

        // Encode the function call data
        const swapCallData = uniswapRouterInterface.encodeFunctionData("exactInputSingle", [exactInputSingleParams]);

        // 4. feeAmount (remains 0 for this example)
        const feeAmount = 0n;

        // 5. warrant (remains the same as before)
        const millisecondsSinceEpoch: number = Date.now();
        const time: number = Math.floor(millisecondsSinceEpoch / 1000);
        const warrantNonce = Date.now(); // Example nonce

        const warrant = {
            nonce: warrantNonce,
            validBefore: BigInt(time + 5000),
            validAfter: BigInt(time - 5000),
            verifyingSigner: ZeroAddress,
            signature: "0x"
        };

        //console.log("--- Calling fillQuoteEthToToken ---");
        //console.log("Signer:", signer.address);
        //console.log("Your Contract:", await Rainbow.getAddress());
        //console.log("Buy Token (USDC):", buyTokenAddress);
        //console.log("Target (Uniswap Router):", targetAddress); // Updated Target
        ////console.log("Swap Call Data (for Uniswap):", swapCallData); // Generated Uniswap data
        //console.log("   -> Decoded Params:", exactInputSingleParams); // Show decoded params
        //console.log("Fee Amount:", feeAmount.toString());
        //console.log("Warrant:", warrant);
        //console.log("Sending ETH Value:", ethers.formatEther(wethAmount), "ETH");
        //console.log(`*** WARNING: amountOutMinimum set to ${usdcAmountOutMinimum}. Use a calculated value in production! ***`);


        // --- Execute the Transaction ---
        const tx = await Rainbow.fillQuoteEthToToken(
            buyTokenAddress,
            targetAddress,      // Sending to Uniswap Router
            swapCallData,       // Uniswap function call
            feeAmount,
            warrant,
            {
                value: wethAmount // Sending ETH along with the call
            }
        );

        //console.log("Transaction submitted:", tx.hash);
        //console.log("Waiting for transaction confirmation...");

        const receipt = await tx.wait();

        //console.log("Transaction confirmed in block:", receipt?.blockNumber);
        //console.log("Gas used:", receipt?.gasUsed.toString());

        // Optional: Check balances after the swap
        const signerEthBalanceAfter = await ethers.provider.getBalance(signer.address);
        const usdcBalanceAfter = await USDC.balanceOf(signer.address); // Check signer's balance
        //console.log("Signer ETH balance after:", ethers.formatEther(signerEthBalanceAfter));
        //console.log("Signer USDC balance after:", ethers.formatUnits(usdcBalanceAfter, 6)); // Assuming 6 decimals for USDC

    })


    it("Ether => Token via universal router", async () => {
        // --- Confirmed Addresses and Details ---
        const UNIVERSAL_ROUTER_ADDRESS_OPTIMISM = "0x851116d9223fabed8e56c0e6b8ad0c31d98b3507";
        const WETH_ADDRESS_OPTIMISM = "0x4200000000000000000000000000000000000006";
        const USDC_ADDRESS_OPTIMISM = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"; // Your USDC address
        const WETH_USDC_POOL_FEE = 500; // Your pool fee

        // --- Your Contract and Amounts ---
        const rainbowContractAddress = await Rainbow.getAddress(); // Your contract instance
        const usdcAmountToSell = ethers.parseUnits("0.01", 6); // Example amount
        const minNativeEthOut = 0n; // Minimum ETH expected from unwrap (set appropriately)
        const swapMinWethOut = 0n; // Minimum WETH expected from V3 swap step (set appropriately)

        // --- Get Universal Router Interface ---
        const universalRouterABI = [
            "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"
        ];
        const universalRouterInterface = new Interface(universalRouterABI);
        const abiCoder = AbiCoder.defaultAbiCoder();

        // --- Define Commands ---
        const COMMAND_V3_SWAP_EXACT_IN = "0x00";
        const COMMAND_UNWRAP_WETH = "0x0c";
        // Concatenate command bytes: V3_SWAP_EXACT_IN then UNWRAP_WETH
        const commands = COMMAND_V3_SWAP_EXACT_IN + COMMAND_UNWRAP_WETH.slice(2); // Results in "0x000c"

        // --- Encode Input for V3_SWAP_EXACT_IN (inputs[0]) ---
        // Path encoding for V3 requires packing: (tokenIn, fee, tokenOut)
        const path = ethers.solidityPacked(
            ["address", "uint24", "address"],
            [USDC_ADDRESS_OPTIMISM, WETH_USDC_POOL_FEE, WETH_ADDRESS_OPTIMISM]
        );

        // Encode parameters for V3_SWAP_EXACT_IN command
        const inputsV3Swap = abiCoder.encode(
            ["address", "uint256", "uint256", "bytes", "bool"],
            [
                ethers.ZeroAddress, // recipient: Send WETH to the UR itself for the next step
                usdcAmountToSell,   // amountIn
                swapMinWethOut,     // amountOutMinimum (for WETH output)
                path,               // encoded path
                false               // payerIsUser: false, as Rainbow contract pays via Permit2
            ]
        );

        // --- Encode Input for UNWRAP_WETH (inputs[1]) ---
        // Encode parameters for UNWRAP_WETH command
        const inputsUnwrapWETH = abiCoder.encode(
            ["address", "uint256"],
            [
                rainbowContractAddress, // recipient: Your contract receives the final native ETH
                minNativeEthOut         // amountMinimum: Minimum native ETH you must receive
            ]
        );

        // --- Prepare Execute Call Data ---
        const inputs = [inputsV3Swap, inputsUnwrapWETH];
        const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes from now

        const swapCallData = universalRouterInterface.encodeFunctionData("execute", [
            commands,
            inputs,
            BigInt(deadline)
        ]);

        // --- Set Target for your Rainbow contract call ---
        const targetAddress = UNIVERSAL_ROUTER_ADDRESS_OPTIMISM;

        // --- Log and Use ---
        //console.log("Target (Universal Router on Optimism):", targetAddress);
        //console.log("Swap Call Data (UR Execute):", swapCallData);
        //console.log("Decoded Commands:", commands);
        //console.log("Decoded Input[0] (V3 Swap Params):", abiCoder.decode(["address", "uint256", "uint256", "bytes", "bool"], inputsV3Swap));
        //console.log("Decoded Input[1] (Unwrap Params):", abiCoder.decode(["address", "uint256"], inputsUnwrapWETH));


    })

    it("Test warrant validation", async () => {
        // --- 1. Setup: Define Signer and Transaction Parameters ---
        const feeAmount = 0n;
        const sellTokenAddress = await USDC.getAddress();
        const buyTokenAddress = await WETH.getAddress();
        const rainbowAddress = await Rainbow.getAddress();
        
        console.log("TESTING WARRANT")
        console.log("USDC AMOUNT: ", Number(usdcAmount))
    

        const swapCallData = await generateUniTxData(
            sellTokenAddress, buyTokenAddress, usdcAmount, routerAddr,
            500, rainbowAddress, 0n
        );
    
        // --- 2. Prepare Warrant Data (excluding signature) ---
        const millisecondsSinceEpoch: number = Date.now();
        const time: number = Math.floor(millisecondsSinceEpoch / 1000);
        const validBefore: number = time + 3600;
        const validAfter: number = time - 300;
        const nonce: bigint = 1n; // Using BigInt 1n
        const verifyingSignerAddress: string = await signer.getAddress();
    
        // --- 3. Calculate Hashes for Signing (Off-Chain) ---
    
        // a) Hash the swapCallData
        const swapCallDataHash = ethers.keccak256(swapCallData);
    
        // b) Calculate dataHash
        const dataHash = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'address', 'bytes32', 'uint256', 'uint256'],
            [sellTokenAddress, buyTokenAddress, routerAddr, swapCallDataHash, usdcAmount, feeAmount]
          )
        );
        console.log("Off-Chain dataHash:", dataHash);
    
        // c) Pack warrant validation data (Nonce, Timestamps) using BIT SHIFTING
        // *** This now matches the contract's _packValidationData ***
        const nonceBI = BigInt(nonce);
        const validBeforeBI = BigInt(validBefore);
        const validAfterBI = BigInt(validAfter);
    
        // Replicates: uint160(nonce) | (uint256(validBefore) << 160) | (uint256(validAfter) << 208)
        const packedValueBI = nonceBI | (validBeforeBI << 160n) | (validAfterBI << 208n);
        console.log("Off-Chain packed uint256 value:", packedValueBI.toString());
    
    
        // d) Calculate the final hash to be signed (dataToVerify)
        // Matches: keccak256(abi.encode(packed_uint256_value, dataHash))
        const dataToVerify = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                 ['uint256', 'bytes32'], // Encode the packed uint256 and the dataHash
                 [packedValueBI, dataHash]
            )
        );
        console.log("Off-Chain dataToVerify:", dataToVerify); // Compare this with on-chain logs if needed
    
    
        // --- 4. Sign the Hash ---
        const signature = await signer.signMessage(ethers.getBytes(dataToVerify));
        console.log("Off-Chain Signature:", signature);
        console.log("Off-Chain Verifying Signer:", verifyingSignerAddress);
        console.log("Off-Chain swapCallDataHash:", swapCallDataHash);
        // --- 5. Construct the Warrant Struct ---
        const warrant = {
            nonce: nonce, // Use the original nonce value/type
            validBefore: validBefore, // Use the original number timestamp
            validAfter: validAfter, // Use the original number timestamp
            verifyingSigner: verifyingSignerAddress,
            signature: signature
        };
    
        // --- 6. Prepare Permit2 Signature ---
        const network = await ethers.provider.getNetwork();
        const permitData = await generatePermitSignature(
            signer, network.chainId, sellTokenAddress, usdcAmount, rainbowAddress
        );
    
        // --- 7. Prepare Funds ---
        await stealMoney(usdcNativeWhale, await signer.getAddress(), sellTokenAddress, usdcAmount);
    
        // --- 8. Execute Transaction ---
        console.log("Sending transaction with corrected warrant packing...");
    
        let tx = await Rainbow.connect(signer).fillQuoteTokenToTokenWithPermit(
            sellTokenAddress, buyTokenAddress, routerAddr, swapCallData,
            usdcAmount, feeAmount, permitData, warrant
        );
        await tx.wait();
        console.log("Transaction successful with warrant validation!");
    

    });


    /**
     it("Token to Native Ether with Permit2", async () => {
        // --- Configuration ---
        // Using Optimism Goerli addresses from your previous working example
        const usdcAddress = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85";
        const wethAddress = "0x4200000000000000000000000000000000000006";
        const uniswapV3RouterAddress = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
        const wethUsdcPoolFee = 500; // Verify pool fee for USDC/WETH

        // --- ABI Fragment for Uniswap V3 exactInputSingle ---
        const uniswapV3RouterABI = [
            "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"
        ];
        const uniswapRouterInterface = new Interface(uniswapV3RouterABI);

        // --- Setup ---
        const [signer] = await ethers.getSigners();
        const chainId = network.config.chainId; // Get chain ID for permit signature
        if (!chainId) {
            throw new Error("Chain ID not found in Hardhat network config");
        }
        //console.log("Using signer:", signer.address);
        //console.log("Chain ID:", chainId);

        // Assuming `Rainbow` is your deployed contract instance variable
        const rainbowContractAddress = await Rainbow.getAddress();
        //console.log("Your Contract (Rainbow):", rainbowContractAddress);

        const USDC = ERC20__factory.connect(usdcAddress, signer);
        const WETH = IERC20__factory.connect(wethAddress, signer); // Needed for wethAddress constant

        // --- Define Amounts ---
        const usdcAmount = ethers.parseUnits("0.01", 6); // Amount of USDC to sell (example: 0.01 USDC)
        const wethAmountOutMinimum = 0n; // Minimum WETH expected from swap (!! CALCULATE PROPERLY !!)

        // --- Prepare Function Arguments for fillQuoteTokenToEthWithPermit ---

        // 1. sellTokenAddress
        const sellTokenAddress = usdcAddress;

        // 2. target (payable) - Uniswap Router
        const targetAddress = uniswapV3RouterAddress;

        // 3. swapCallData - Generate data for Uniswap V3 exactInputSingle (USDC -> WETH)
        const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes from now

        const exactInputSingleParams = {
            tokenIn: usdcAddress,           // Selling USDC
            tokenOut: wethAddress,          // Buying WETH
            fee: wethUsdcPoolFee,
            recipient: rainbowContractAddress, // Rainbow contract receives the WETH
            deadline: BigInt(deadline),
            amountIn: usdcAmount,           // The amount of USDC being sold
            amountOutMinimum: wethAmountOutMinimum, // Minimum WETH to receive
            sqrtPriceLimitX96: 0n
        };

        const swapCallData = uniswapRouterInterface.encodeFunctionData("exactInputSingle", [exactInputSingleParams]);

        // 4. sellAmount (matches amountIn for the swap)
        const sellAmount = usdcAmount;

        // 5. feePercentageBasisPoints (assuming 0 for this example)
        const feePercentageBasisPoints = 0n;

        // 6. permitData - Generate Permit2 signature
        //console.log(`Generating Permit2 signature for ${ethers.formatUnits(usdcAmount, 6)} USDC...`);
        // Ensure the generatePermitSignature function correctly targets Permit2
        const permitData = await generatePermitSignature(
            signer,
            chainId, // Ensure chainId is BigInt if required by the function
            sellTokenAddress, // Token being permitted (USDC)
            sellAmount,       // Amount being permitted
            rainbowContractAddress // Spender (your contract)
        );
        //console.log("Permit generated:", permitData);
        // Note: Before running this, the signer must have approved the standard Permit2 contract
        // to spend their USDC (usually a one-time setup).

        // 7. warrant
        const millisecondsSinceEpoch: number = Date.now();
        const time: number = Math.floor(millisecondsSinceEpoch / 1000);
        const warrantNonce = Date.now(); // Example nonce
        const warrant = {
            nonce: warrantNonce,
            validBefore: BigInt(time + 5000),
            validAfter: BigInt(time - 5000),
            verifyingSigner: ZeroAddress,
            signature: "0x"
        };

        // --- Log Prepared Call Data ---
        //console.log("--- Calling fillQuoteTokenToEthWithPermit ---");
        //console.log("Sell Token (USDC):", sellTokenAddress);
        //console.log("Target (Uniswap Router):", targetAddress);
        //console.log("   -> Decoded Swap Params (Recipient is Contract):", exactInputSingleParams);
        //console.log("Sell Amount:", ethers.formatUnits(sellAmount, 6), "USDC");
        //console.log("Fee Basis Points:", feePercentageBasisPoints.toString());
        //// console.log("Permit Data:", permitData); // Already logged above
        //console.log("Warrant:", warrant);
        //console.log(`*** WARNING: amountOutMinimum set to ${wethAmountOutMinimum}. Use a calculated value in production! ***`);

        // --- Get Balances Before ---
        const contractEthBalanceBefore = await ethers.provider.getBalance(rainbowContractAddress);
        const signerUsdcBalanceBefore = await USDC.balanceOf(signer.address);
        //console.log("Contract ETH balance before:", ethers.formatEther(contractEthBalanceBefore));
        //console.log("Signer USDC balance before:", ethers.formatUnits(signerUsdcBalanceBefore, 6));

        // --- Execute the Transaction ---
        // NO { value: ... } needed here as we are sending tokens via Permit2
        const tx = await Rainbow.fillQuoteTokenToEthWithPermit(
            sellTokenAddress,
            targetAddress,
            swapCallData,
            sellAmount,
            feePercentageBasisPoints,
            permitData,
            warrant
        );

        //console.log("Transaction submitted:", tx.hash);
        //console.log("Waiting for transaction confirmation...");

        const receipt = await tx.wait();

        //console.log("Transaction confirmed in block:", receipt?.blockNumber);
        //console.log("Gas used:", receipt?.gasUsed.toString());

        // --- Check Balances After ---
        const contractEthBalanceAfter = await ethers.provider.getBalance(rainbowContractAddress);
        const signerUsdcBalanceAfter = await USDC.balanceOf(signer.address);
        //console.log("Contract ETH balance after:", ethers.formatEther(contractEthBalanceAfter));
        //console.log("Signer USDC balance after:", ethers.formatUnits(signerUsdcBalanceAfter, 6));

        // Assertions (Example)
        expect(signerUsdcBalanceAfter).to.be.lt(signerUsdcBalanceBefore); // Signer should have less USDC
        expect(contractEthBalanceAfter).to.be.gt(contractEthBalanceBefore); // Contract should have received ETH (assuming successful unwrap)

    });
     */


    /**
    it("Test Sweep", async () => {
        // Inside a new test case or modifying the existing one
        const sweepCommand = "0x01";
        const sweepInput = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint256"],
            [
                await USDC.getAddress(),       // token to sweep
                await signer.getAddress(),  // send to signer
                usdcAmount         // minimum amount (use full amount for test)
            ]
        );
        const sweepInputs = [sweepInput];
        const sweepDeadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

        // Ensure approval is set
        await USDC.connect(signer).approve(universalRouter, usdcAmount);
        const allowance = await USDC.allowance(await signer.getAddress(), universalRouter);
        expect(allowance).to.be.gte(usdcAmount);

        const universalRouterAbi = [
            "function execute(bytes commands, bytes[] inputs, uint256 deadline) external payable returns (bytes[] memory results)"
        ];
        const universalRouterContract = new ethers.Contract(
            universalRouter, // Use the verified string address
            universalRouterAbi,
            signer
        );

        const iface = new Interface([
            "function execute(bytes commands, bytes[] inputs, uint256 deadline)"
        ]);

        //console.log("SENDING")
        await signer.sendTransaction({
            to: universalRouter,
            data: iface.encodeFunctionData("execute", [
                sweepCommand,
                sweepInputs,
                sweepDeadline,
            ])
        })
        //console.log("SENT")

        try {
            // Try static call first
            await universalRouterContract.getFunction("execute").staticCall(
                sweepCommand,
                sweepInputs,
                sweepDeadline
            );
            //console.log("SWEEP command static call simulation successful.");
            // Optionally try actual transaction
            // const tx = await universalRouterContract.execute(sweepCommand, sweepInputs, sweepDeadline);
            // await tx.wait();
            //// console.log("SWEEP command actual transaction successful.");
        } catch (e) {
            console.error("SWEEP command failed:", e);
        }
    })
     */

    /**
    it("Test Eth Universal Router", async () => {
        // ... stealMoney etc ...
        expect(await USDC.balanceOf(await signer.getAddress())).to.be.gte(usdcAmount, "Insufficient balance");

        const recipientAddress = await signer.getAddress();
        const usdcAddress = await USDC.getAddress();
        const wethAddress = await WETH.getAddress();
        const routerAddressString = universalRouter.toString(); // Assuming universalRouter is AddressLike or has toString()
        const poolFee = 500;
        const amountOutMin = 1n;

        // --- Pre-computation Logging ---
        //console.log("--- Addresses ---");
        //console.log(`Signer (Recipient): ${recipientAddress}`);
        //console.log(`USDC Contract:      ${usdcAddress}`);
        //console.log(`WETH Contract:      ${wethAddress}`);
        //console.log(`Router Contract:    ${routerAddressString}`);
        //console.log(`Input Amount (USDC):${usdcAmount}`);

        const { commands, inputs, deadline, txData } = await generateUniversalRouterTxData(
            usdcAddress, // Explicitly pass address strings or verified AddressLike
            wethAddress,
            usdcAmount,
            poolFee,
            amountOutMin,
            recipientAddress,
        );

        // --- Pre-Call State Logging ---
        //console.log("\n--- State Before Approval & Call ---");
        const balanceBefore = await USDC.balanceOf(recipientAddress);
        const allowanceBefore = await USDC.allowance(recipientAddress, routerAddressString);
        //console.log(`USDC Balance:  ${balanceBefore}`);
        //console.log(`USDC Allowance for Router: ${allowanceBefore}`);
        expect(balanceBefore).to.be.gte(usdcAmount, "Insufficient balance before approval");

        //console.log(`Approving router (${routerAddressString}) for ${usdcAmount} USDC...`);
        await USDC.connect(signer).approve(routerAddressString, usdcAmount); // Use the verified string address

        const allowanceAfter = await USDC.allowance(recipientAddress, routerAddressString);
        //console.log(`Allowance check post-approve: ${allowanceAfter}`);
        expect(allowanceAfter).to.be.gte(usdcAmount, "Allowance not set correctly after approve"); // Use gte just in case

        const universalRouterAbi = [
            "function execute(bytes commands, bytes[] inputs, uint256 deadline) external payable returns (bytes[] memory results)"
        ];
        const universalRouterContract = new ethers.Contract(
            routerAddressString, // Use the verified string address
            universalRouterAbi,
            signer
        );

        // Corrected static call
        try {
            //console.log("\nSimulating transaction with staticCall...");
            const simulationProvider = universalRouterContract.connect(signer.provider);
            const result = await simulationProvider.getFunction("execute").staticCall(
                commands,
                inputs,
                deadline
            );
            //console.log("Simulated static call successful. Result:", result);
        } catch (error) {
            console.error("\nStatic call simulation failed:", error); // Log the full error
            // Add specific checks based on error
            const currentBalance = await USDC.balanceOf(recipientAddress);
            const currentAllowance = await USDC.allowance(recipientAddress, routerAddressString);
            console.error(`State during failure: Balance=${currentBalance}, Allowance=${currentAllowance} for Router=${routerAddressString}`);
        }

        // Send the transaction (optional for debugging static call)
        // ... (rest of the sendTransaction block) ...
    });
     */

});
/**
    it("Do Token => ETH", async () => {
        const txData = await generateUniversalRouterTxData(
            await USDC.getAddress(),
            await WETH.getAddress(),
            usdcAmount,
            500,
            0n,
            universalRouter,
            await Rainbow.getAddress()
        )

        //console.log("got data: ", txData)

        // Get milliseconds since epoch
        const millisecondsSinceEpoch: number = Date.now();

        // Convert to seconds and floor to get the integer Unix timestamp
        const time: number = Math.floor(millisecondsSinceEpoch / 1000);

        const warrant = {
            nonce: await signer.getNonce(),
            validBefore: time + 5000,
            validAfter: time - 5000,
            verifyingSigner: ZeroAddress,
            signature: "0x"
        }

        const network = await ethers.provider.getNetwork();
        //console.log("Chain ID:", network.chainId);

        const permitData = await generatePermitSignature(
            signer,
            network.chainId,
            await USDC.getAddress(),
            usdcAmount,
            await Rainbow.getAddress()
        )

        //fund transaction
        await stealMoney(usdcNativeWhale, await signer.getAddress(), await USDC.getAddress(), usdcAmount)

        await Rainbow.connect(signer).fillQuoteTokenToEthWithPermit(
            await USDC.getAddress(),
            universalRouter,
            txData,
            usdcAmount,
            0n,
            permitData,
            warrant
        )


    })
     */