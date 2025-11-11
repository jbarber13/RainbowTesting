import { AbiCoder, AddressLike, BigNumberish, BytesLike, Interface, Signer, TransactionResponse, TypedDataDomain, ZeroAddress } from "ethers";
import { ERC20__factory, ISwapRouter02__factory, RainbowRouter } from "../typechain-types";
import { ethers, network } from "hardhat";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { IERC20__factory } from "../typechain-types/factories/contracts/interfaces/openzeppelin";
import axios from "axios";


type PermitDetails = {
    token: string
    amount: string
    expiration: string
    nonce: string
}

type PermitSingle = {
    details: PermitDetails
    spender: string
    sigDeadline: string
}

export interface Permit2Payload {
    permitSingle: PermitSingle;
    signature: string;
}

export type ExactInputSingleParams = {
    tokenIn: AddressLike,
    tokenOut: AddressLike,
    fee: BigNumberish,
    recipient: AddressLike,
    amountIn: BigNumberish,
    amountOutMinimum: BigNumberish,
    sqrtPriceLimitX96: BigNumberish
}

export const getGas = async (result: TransactionResponse) => {
    return Number((await result.wait())?.gasUsed)
}


export const generateUniTxData = async (
    tokenIn: AddressLike,
    tokenOut: AddressLike,
    amountIn: bigint,
    router: AddressLike,
    poolFee: number,
    target: AddressLike,
    amountOutMin: bigint
): Promise<BytesLike> => {
    const signer = await ethers.getSigner(target.toString())
    const ROUTER = ISwapRouter02__factory.connect(router.toString(), signer)
    const params: ExactInputSingleParams = {
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        fee: poolFee,
        recipient: target,
        amountIn: amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n
    }

    const txData = (await ROUTER.exactInputSingle.populateTransaction(params)).data
    return txData
}

export const UNIVERSAL_ROUTER_COMMANDS = {
    V3_SWAP_EXACT_IN: "0x00",
    UNWRAP_WETH: "0x0b"
}

/**
 * Encodes the path for a Uniswap V3 swap.
 * * @param tokens An array of token addresses, e.g., [USDC, WETH] for a single hop.
 * @param fees An array of pool fees (uint24), e.g., [500] for a single hop. 
 * The length must be tokens.length - 1.
 * @returns The encoded path as a hex string.
 */
function encodePath(tokens: AddressLike[], fees: number[]): string {
    if (!tokens || !fees || tokens.length !== fees.length + 1) {
        throw new Error(
            "Invalid input: tokens length must be 1 greater than fees length."
        );
    }

    // Define the types for solidityPacked dynamically
    const types: string[] = [];
    const values: any[] = [];

    types.push("address");
    values.push(tokens[0]); // Start with the first token

    for (let i = 0; i < fees.length; i++) {
        types.push("uint24"); // Add the fee
        values.push(fees[i]);
        types.push("address"); // Add the next token address
        values.push(tokens[i + 1]);
    }

    // Pack all parts together
    return ethers.solidityPacked(types, values);
}


export const generateUniversalRouterTxData = async (
    tokenIn: AddressLike,
    tokenOut: AddressLike, // Changed WETH_ADDRESS to tokenOut for clarity
    amountIn: bigint,
    poolFee: number,
    amountOutMin: bigint,
    // universalRouter: AddressLike, // Not needed inside this function if txData is returned
    recipient: AddressLike, // Final recipient of the output token (WETH in this case)
    // signer: Signer // Not needed inside this function if txData is returned
): Promise<{ commands: BytesLike, inputs: BytesLike[], deadline: bigint, txData: BytesLike }> => {
    const abi = AbiCoder.defaultAbiCoder(); // Use defaultAbiCoder in ethers v6

    // 1. Command byte (0x00 = V3_SWAP_EXACT_IN)
    const commands = "0x00"; // Just the swap

    // 2. Inputs

    // Encode V3_SWAP_EXACT_IN input
    // Parameters: (address recipient, uint256 amountIn, uint256 amountOutMinimum, bytes path, bool payerIsUser)

    // Use the corrected encodePath function
    const encodedPath = encodePath([tokenIn, tokenOut], [poolFee]); // Use tokenOut

    const swapInput = abi.encode(
        ["address", "uint256", "uint256", "bytes", "bool"], // Correct types including bool
        [
            recipient,       // Recipient of the output token (WETH)
            amountIn,
            amountOutMin,
            encodedPath,
            false,           // <--- FIX: payerIsUser = false (Router pulls tokens via transferFrom)
        ]
    );

    const inputs = [swapInput];

    // 3. Deadline
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 mins from now

    // 4. Encode final UniversalRouter call data
    const iface = new Interface([
        "function execute(bytes commands, bytes[] inputs, uint256 deadline)"
    ]);

    const txData = iface.encodeFunctionData("execute", [
        commands,
        inputs,
        deadline,
    ]);

    // Return all components for potential use in static call etc.
    return { commands, inputs, deadline, txData };
};



export interface PermitOutput {
    value: bigint;
    nonce: bigint;
    deadline: bigint;
    permitStyle: 0 | 1 | 2;  // 0 = DAI, 1 = EIP-2612, 2 = PERMIT_2
    v: number;
    r: string;
    s: string;
}

export const generatePermitSignature = async (
    signer: Signer,
    chainId: number,
    tokenAddress: string, // Address of the ERC-20 token
    amount: bigint,      // The 'value' for the permit
    spender: string,     // Address granted allowance
    permitStyle: 0 | 1 | 2 = 1, // 0 = DAI, 1 = EIP-2612 (default), 2 = PERMIT_2
    // Nonce will be fetched from the token contract
    expiration?: number, // Optional: custom expiration timestamp (in seconds)
): Promise<PermitOutput> => { // Return the desired Permit struct data

    const ownerAddress = await signer.getAddress();
    let deadline: number;

    if (expiration == undefined) {
        deadline = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now (default)
    } else {
        deadline = expiration;
    }

    // Handle Permit2 separately (different signature structure)
    if (permitStyle === 2) {
        // Permit2 SignatureTransfer
        const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

        // Generate a unique nonce (Permit2 SignatureTransfer uses bitmap, not sequential nonces)
        // Each nonce bit can only be used once. Common practice: use timestamp or random value
        const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

        // Define Permit2 domain
        const domain: TypedDataDomain = {
            name: 'Permit2',
            chainId: chainId,
            verifyingContract: PERMIT2_ADDRESS,
        };

        // Define Permit2 SignatureTransfer types
        const types = {
            PermitTransferFrom: [
                { name: 'permitted', type: 'TokenPermissions' },
                { name: 'spender', type: 'address' },
                { name: 'nonce', type: 'uint256' },
                { name: 'deadline', type: 'uint256' }
            ],
            TokenPermissions: [
                { name: 'token', type: 'address' },
                { name: 'amount', type: 'uint256' }
            ]
        };

        // Define values
        const values = {
            permitted: {
                token: tokenAddress,
                amount: amount.toString()
            },
            spender: spender,
            nonce: nonce.toString(),
            deadline: deadline.toString()
        };

        // Sign the typed data
        const signature = await signer.signTypedData(domain, types, values);
        const { v, r, s } = ethers.Signature.from(signature);

        return {
            value: amount,
            nonce: nonce,
            deadline: BigInt(deadline),
            permitStyle: 2,
            v, r, s
        };
    }

    // Handle DAI and EIP-2612 permits (both use token-based nonces)
    const tokenContract = ERC20__factory.connect(tokenAddress, signer);
    let nonce: bigint = 0n;

    try {
        nonce = await tokenContract.nonces(ownerAddress);
    } catch (error: any) {
        console.warn(`WARN: Could not fetch nonce for ${tokenAddress}. This token might not support EIP-2612 (permit). Defaulting nonce to 0.`);
    }

    // Fetch the token name for the EIP-712 domain
    let tokenName = "Unknown Token";
    try {
        tokenName = await tokenContract.name();
    } catch (e) {
        console.warn(`Could not fetch name for token ${tokenAddress}. Using default.`);
    }

    // Define the EIP-712 domain separator
    const domain: TypedDataDomain = {
        name: tokenName,
        version: permitStyle === 0 ? '1' : '2', // DAI uses version '1', EIP-2612 uses '2'
        chainId: chainId,
        verifyingContract: tokenAddress,
    };

    // Define the EIP-712 types (DAI vs EIP-2612)
    let types: any;
    let values: any;

    if (permitStyle === 0) {
        // DAI-style permit
        types = {
            Permit: [
                { name: "holder", type: "address" },
                { name: "spender", type: "address" },
                { name: "nonce", type: "uint256" },
                { name: "expiry", type: "uint256" },
                { name: "allowed", type: "bool" }
            ]
        };
        values = {
            holder: ownerAddress,
            spender: spender,
            nonce: nonce.toString(),
            expiry: deadline.toString(),
            allowed: true
        };
    } else {
        // EIP-2612 permit
        types = {
            Permit: [
                { name: "owner", type: "address" },
                { name: "spender", type: "address" },
                { name: "value", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
            ],
        };
        values = {
            owner: ownerAddress,
            spender: spender,
            value: amount.toString(),
            nonce: nonce.toString(),
            deadline: deadline.toString(),
        };
    }

    // Sign the typed data
    const signature = await signer.signTypedData(domain, types, values);
    const { v, r, s } = ethers.Signature.from(signature);

    return {
        value: amount,
        nonce: nonce,
        deadline: BigInt(deadline),
        permitStyle: permitStyle,
        v, r, s
    };
};

export const stealMoney = async (
    from: string,
    to: string,
    tokenAddr: string,
    amount: BigNumberish
) => {
    //fund with eth so we can steal from any addr that holds the token, including contracts
    await setBalance(from, ethers.parseEther("5"))

    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [from],
    });
    const robberee = await ethers.provider.getSigner(from);
    const money = IERC20__factory.connect(tokenAddr, robberee);
    await money.connect(robberee).transfer(to, amount);
    await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [from],
    });
    return;
};





