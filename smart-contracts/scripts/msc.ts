import { AbiCoder, AddressLike, BigNumberish, BytesLike, Interface, Signer, TransactionResponse, TypedDataDomain } from "ethers";
import { ERC20__factory, IERC20, IERC2612Extension__factory, IPermit2__factory, ISwapRouter02__factory, UniswapV3Pool } from "../typechain-types";
import { ethers, network } from "hardhat";
import { AllowanceTransfer } from "@uniswap/permit2-sdk";
import hre from "hardhat";
import { impersonateAccount, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { IERC20__factory } from "../typechain-types/factories/contracts/interfaces/openzeppelin";
import { Address } from "viem";

const abi = new AbiCoder()

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


/**
 * 
 * @param chainId 
 * @param expiration 
 * @return permitData and signature
 */
export const permitSingle = async (
    signer: Signer,
    chainId: number,
    token: string,
    amount: bigint,
    spender: string,
    permit2: string,
    nonce: number = 0,
    expiration?: number,
) => {
    if (expiration == undefined) {
        expiration = Math.floor(Date.now() / 1000) + 60 * 60 // 1 hour from now
    }

    const networkName = hre.network.name
    if (networkName == "hardhat" || networkName == "localhost") {
        console.log("IMPERSONATING", await signer.getAddress())
        signer = await ethers.getSigner(await signer.getAddress())
        await impersonateAccount(await signer.getAddress())
    }

    //verify token allowance
    const tokenContract = ERC20__factory.connect(token, signer)
    const tokenAllowance = await tokenContract.allowance(await signer.getAddress(), permit2)
    if (tokenAllowance < amount) {
        console.log(`No permit2 approval for ${await tokenContract.symbol()}, approving max now...`)
        const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        await tokenContract.connect(signer).approve(permit2, MAX_UINT256)
    }

    const PERMIT = IPermit2__factory.connect(permit2, signer)

    const allowance = await PERMIT.allowance(
        await signer.getAddress(),
        token,
        spender
    )

    nonce = Number(allowance[2])

    const permitDetails: PermitDetails = {
        token: token,
        amount: amount.toString(),
        expiration: expiration.toString(),
        nonce: nonce.toString(),
    }

    const permitSingle: PermitSingle = {
        details: permitDetails,
        spender: spender,
        sigDeadline: (expiration + 86400).toString()
    }

    const { domain, types, values } = AllowanceTransfer.getPermitData(permitSingle, permit2, chainId)

    const signature = await signer.signTypedData(domain as TypedDataDomain, types, values)

    return {
        signature: signature,
        permitSingle: permitSingle
    }
}
export function encodePermit2PayloadLegacy(permit: Permit2Payload): string {
    const abiCoder = new ethers.AbiCoder();
    const encodedData = abiCoder.encode(
        [
            "((" +
            "(address,uint160,uint48,uint48)," +
            "address,uint256)," +
            "bytes)",
        ],
        [
            [
                [
                    [
                        permit.permitSingle.details.token,
                        permit.permitSingle.details.amount,
                        permit.permitSingle.details.expiration,
                        permit.permitSingle.details.nonce,
                    ],
                    permit.permitSingle.spender,
                    permit.permitSingle.sigDeadline,
                ],
                permit.signature,
            ],
        ]
    );
    return encodedData
}
export const encodePermitSingle = async (signer: Signer,
    chainId: number,
    token: string,
    amount: bigint,
    spender: string,
    permit2: string,
    nonce: number = 0,
    expiration?: number) => {

    const permit: Permit2Payload = await permitSingle(signer, chainId, token, amount, spender, permit2, nonce, expiration)
    return encodePermit2PayloadLegacy(permit)

}

export interface PermitOutput {
    value: bigint;
    nonce: bigint;
    deadline: bigint;
    isDaiStylePermit: boolean;
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

    // --- End Impersonation Block ---

    // Connect to the ERC20 token contract
    // Use the factory if it includes 'nonces' and 'name', otherwise use the minimal ABI
    // const tokenContract = ERC20__factory.connect(tokenAddress, signer); // Use this if factory is complete
    const tokenContract = ERC20__factory.connect(tokenAddress, signer)
    let nonce: bigint = 0n; // Initialize nonce to 0n (BigInt zero) as the default

    try {
        // Attempt to fetch the nonce from the contract
        const contractNonce = await tokenContract.nonces(ownerAddress);
        // If the call succeeds, update the nonce variable
        nonce = contractNonce;
        //console.log(`Successfully fetched nonce: ${nonce}`);

    } catch (error: any) {
        // Check if the error indicates the function likely doesn't exist
        // Ethers errors often have a 'code' property. CALL_EXCEPTION is common for non-existent functions/reverts.
        // Or we can be less specific and catch any error during the call.F
        console.warn(`WARN: Could not fetch nonce for ${tokenAddress}. This token might not support EIP-2612 (permit). Defaulting nonce to 0.`);
        // Optional: Log the specific error for more detailed debugging if needed
        // console.debug("Nonce fetching error details:", error.code || error);

        // Nonce remains the default value of 0n set before the try block
    }

    // Fetch the token name for the EIP-712 domain
    // Add error handling in case the token doesn't have a name() function
    let tokenName = "Unknown Token"; // Default name
    try {
        tokenName = await tokenContract.name();
    } catch (e) {
        console.warn(`Could not fetch name for token ${tokenAddress}. Using default.`);
        // Some tokens might not implement name(), or use bytes32. Handle accordingly.
        // You might need a more robust way to get the name required for the domain.
    }


    // Define the EIP-712 domain separator based on EIP-2612
    const domain: TypedDataDomain = {
        name: tokenName,
        version: '2', // Standard version for EIP-2612 permits
        chainId: chainId,
        verifyingContract: tokenAddress, // Address of the ERC20 token itself
    };

    // Define the EIP-712 types for the Permit message
    const types = {
        Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
        ],
    };

    // Define the values for the Permit message
    const values = {
        owner: ownerAddress,
        spender: spender,
        value: amount.toString(), // Use string representation for signTypedData
        nonce: nonce.toString(),  // Use string representation for signTypedData
        deadline: deadline.toString(), // Use string representation for signTypedData
    };

    // Sign the typed data
    const signature = await signer.signTypedData(domain, types, values);
    // ^ Or use connectedSigner.signTypedData if you used that instance

    // Split the signature into v, r, s
    const { v, r, s } = ethers.Signature.from(signature);

    // Construct the final Permit struct data
    const permitData: PermitOutput = {
        value: amount,          // Keep as bigint
        nonce: nonce,           // Keep as bigint (fetched from contract)
        deadline: BigInt(deadline), // Convert deadline timestamp to bigint
        isDaiStylePermit: false, // Hardcoded as requested
        v: v,
        r: r,
        s: s,
    };

    return permitData;
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





