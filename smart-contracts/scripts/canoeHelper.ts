import { AbiCoder, AddressLike, BigNumberish, BytesLike, Interface, keccak256, parseUnits, Signer, TransactionResponse, TypedDataDomain, ZeroAddress } from "ethers";
import { ERC20__factory, ISwapRouter02__factory, RainbowRouter } from "../typechain-types";
import { ethers, network } from "hardhat";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { IERC20__factory } from "../typechain-types/factories/contracts/interfaces/openzeppelin";
import axios from "axios";
import { generatePermitSignature } from "./msc";


//response types
// A generic type for unknown nested objects, can be refined if their structure is known
type AnyObject = Record<string, any>;


interface BridgeInfo {
    sourceChainId?: number;
    destinationChainId?: number;
    tokenAddressOnSource?: string;
    tokenAddressOnDestination?: string;
}

interface TokenExtensions {
    bridgeInfo?: BridgeInfo | AnyObject;
}

interface Token {
    chainId: number;
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoURI: string;
    extensions?: TokenExtensions;
    price?: number;
}
interface Fees {
    gas: string;
}


interface RawCouponData {
    executionInformation: AnyObject;
    routeSummary: AnyObject;
}

interface Coupon {
    chainId: number;
    account: string;
    raw: RawCouponData;
}

interface CandidateTrade {
    chainId: number;
    data: string;
    to: string;
    value: string;
}

interface SwapQuoteResponse {
    inAmount: string;
    outAmount: string;
    slippage: number;
    fees: Fees;
    coupon: Coupon;
    candidateTrade: CandidateTrade;
    chainId: number;
    market: string; // Consider using the MarketId enum if this string is constrained to those values
    isExactIn: boolean;
    inToken: Token;
    outToken: Token;
    amountRatio: number;
    tokenInUsdValue?: number;
    gasInUsdValue?: number;
    inUsdValue?: number;
    tokenOutUsdValue?: number;
    outUsdValue?: number;
    timestamp: number;       // Unix timestamp 
}




export enum MarketId {
    AIRSWAP = 'airswap',
    ENSO = 'enso',
    KYBERSWAP = 'kyberswap',
    ODOS = 'odos',
    OKX = 'okx',
    ONEINCH = 'oneinch',
    OPENOCEAN = 'openocean',
    PARASWAP = 'paraswap',
    USOR = 'usor',
    ZEROEX = 'zeroex',
    COWSWAP = 'cowswap',
    ICECREAMSWAP = 'icecreamswap'
}

export enum RainbowTxType {
    ETH2TOKEN = "ETH2TOKEN",
    TOKEN2TOKEN = "TOKEN2TOKEN",
    TOKEN2ETH = "TOKEN2ETH",
    TOKEN2ETH_PERMIT = "TOKEN2ETH_PERMIT",
    TOKEN2TOKEN_PERMIT = "TOKEN2TOKEN_PERMIT",
}

export type canoeParams = {
    chain: string,
    account: string,
    isExactIn: boolean,
    inTokenAddress: string,
    outTokenAddress: string,
    inTokenAmount: string, //human readable terms
    slippage: number,
}

export const getRawCanoeQuote = async (market: string, params: canoeParams) => {
    const baseURL = `https://canoe.icarus.tools/market/${market}/swap_quote`

    let digest = {}

    try {
        const response = await axios.post(baseURL, params)
        digest = response.data


    }
    catch (error: any) {
        console.log("Error fetching swap quote:");
        if (axios.isAxiosError(error)) {
            console.error("Status:", error.response?.status);
            console.error("Response Data:", error.response?.data);
            // console.error("Headers:", error.response?.headers);
        } else {
            // Handle non-Axios errors (network issues, etc.)
            console.error("An unexpected error occurred:", error.message);
        }
    }

    return digest
}
export const getCanoeQuote = async (market: string, params: canoeParams) => {
    const baseURL = `https://canoe.icarus.tools/market/${market}/swap_quote`
    let txData = "0x"
    let recipient = ZeroAddress

    try {
        const response = await axios.post(baseURL, params)

        txData = response.data.candidateTrade.data
        recipient = response.data.candidateTrade.to

    }
    catch (error: any) {
        console.log("Error fetching swap quote:");
        if (axios.isAxiosError(error)) {
            console.error("Status:", error.response?.status);
            console.error("Response Data:", error.response?.data);
            // console.error("Headers:", error.response?.headers);
        } else {
            // Handle non-Axios errors (network issues, etc.)
            console.error("An unexpected error occurred:", error.message);
        }
    }

    return { txData, recipient, }
}

export const constructCanoeSwap = async (
    signer: Signer,
    params: canoeParams,
    Rainbow: RainbowRouter,
    txType: RainbowTxType,
    chainId?: number,//required to be set to currentNetwork by `await ethers.provider.getNetwork()` for testing
    market?: MarketId
) => {

    console.log("Package Start")

    const feeAmount = 0n;

    


    //get quote
    const digest: SwapQuoteResponse = await getRawCanoeQuote(MarketId.KYBERSWAP, params) as SwapQuoteResponse
    //console.log(digest)

    if (!(digest && digest.candidateTrade && digest.candidateTrade.data && digest.candidateTrade.to)) {
        console.error("Invalid API response structure:", digest);
        throw new Error("Invalid data from Canoe API");
    }

    if(chainId == undefined){
        chainId = digest.chainId
    }

    //format input amount
    const inputAmount = parseUnits(digest.inAmount, digest.inToken.decimals);
   // console.log("input amount: ", inputAmount)

    const swapCallDataFromApi = digest.candidateTrade.data;
    const routerAddrFromApi = digest.candidateTrade.to;

    const swapCallDataHash = keccak256(swapCallDataFromApi);
    const dataHash = keccak256(
        AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'address', 'bytes32', 'uint256', 'uint256'],
            [params.inTokenAddress, params.outTokenAddress, routerAddrFromApi, swapCallDataHash, inputAmount, feeAmount]
        )
    );

    const clientCurrentTimeSec = 1746746165//Math.floor(Date.now() / 1000);
    const warrantValidAfter = BigInt(clientCurrentTimeSec - 300); // 5 minutes ago
    const warrantValidBefore = BigInt(clientCurrentTimeSec + 3600); // 1 hour from now

    const warrantNonce: bigint = 1n;

    const verifyingSignerAddress: string = await signer.getAddress();

    const packedValidationData = warrantNonce | (warrantValidBefore << 160n) | (warrantValidAfter << 208n);

    //get name and version for signature validation
    const name = await Rainbow.name()
    const version = await Rainbow.version()
    //console.log("GOT: ", name, version)

    const warrantDomain = {
        name: name,
        version: version,
        chainId: chainId,
        verifyingContract: await Rainbow.getAddress(),
    };

    const warrantTypes = {
        CanoeWarrant: [
            { name: 'packedValidationData', type: 'uint256' },
            { name: 'dataHash', type: 'bytes32' },
        ],
    };

    const warrantValueToSign = {
        packedValidationData: packedValidationData,
        dataHash: dataHash,
    };

    console.log("Domain: ", warrantDomain)
    console.log("Types: ", warrantTypes)
    console.log("WVTS: ", warrantValueToSign)

    const warrantSignature = await signer.signTypedData(warrantDomain, warrantTypes, warrantValueToSign);
    const warrant = {
        nonce: warrantNonce,
        validBefore: warrantValidBefore,
        validAfter: warrantValidAfter,
        verifyingSigner: verifyingSignerAddress,
        signature: warrantSignature,
    };

    //console.log("Params: ")//verified match
    //console.log(params)

    //console.log("Warrant: ")//sig mismatch
    //console.log(warrant)



    //format permit data 
    const permitData = await generatePermitSignature(
        signer,
        chainId,
        params.inTokenAddress,
        inputAmount,        // Raw BigInt amount
        await Rainbow.getAddress()
    );

    const tx = await Rainbow.connect(signer).fillQuoteTokenToTokenWithPermit(
        params.inTokenAddress,
        params.outTokenAddress,
        routerAddrFromApi,
        swapCallDataFromApi,
        inputAmount,
        feeAmount,
        permitData,
        warrant
    );

    await tx.wait();
    console.log("Transaction confirmed!");

}

/**
 * @param signer
 * @param params canoe params 
 * @param Rainbow rainbow contract instance
 * @param txType determine what kind of tx we are doing
 * @param market optionally specify explicit aggregator
 * @returns txData to execute the transaction
 */
/**
 export const constructCanoeSwap_old = async (
    signer: Signer,
    params: canoeParams,
    Rainbow: RainbowRouter,
    txType: RainbowTxType,
    market?: MarketId
) => {

    //if market is defined, get the quote with this market
    if (market != undefined) {
        //get quote
        const digest: SwapQuoteResponse = await getRawCanoeQuote(MarketId.KYBERSWAP, params) as SwapQuoteResponse
        console.log(digest)

        if (!(digest && digest.candidateTrade && digest.candidateTrade.data && digest.candidateTrade.to)) {
            console.error("Invalid API response structure:", digest);
            throw new Error("Invalid data from Canoe API");
        }

        //format input amount
        const inputAmount = parseUnits(digest.inAmount, digest.inToken.decimals);
        console.log("input amount: ", inputAmount)

        //construct warrant
        const swapCallDataHash = keccak256(digest.candidateTrade.data);
        const dataHash = keccak256(
            AbiCoder.defaultAbiCoder().encode(
                ['address', 'address', 'address', 'bytes32', 'uint256', 'uint256'],
                [digest.inToken.address, digest.outToken.address, digest.candidateTrade.to, swapCallDataHash, inputAmount, 0n ]
            )
        );

        //use timestamp from api response
        const clientCurrentTimeSec = Math.floor(Date.now() / 1000)//digest.timestamp;
        const warrantValidAfter = BigInt(clientCurrentTimeSec - 300); // 5 minutes ago
        const warrantValidBefore = BigInt(clientCurrentTimeSec + 3600); // 1 hour from now
        console.log("test time: ", Math.floor(Date.now() / 1000))
        console.log("RESP time: ", clientCurrentTimeSec)

        const warrantNonce = BigInt(await signer.getNonce())
        //const warrantNonce: bigint = 1n;

        const verifyingSignerAddress: string = await signer.getAddress();
        const packedValidationData = warrantNonce | (warrantValidBefore << 160n) | (warrantValidAfter << 208n);

        //get domain
        const name = await Rainbow.name()
        const version = await Rainbow.version()

        const warrantDomain = {
            name: name,
            version: version,
            chainId: digest.chainId,
            verifyingContract: await Rainbow.getAddress(),
        };

        const warrantTypes = {
            CanoeWarrant: [
                { name: 'packedValidationData', type: 'uint256' },
                { name: 'dataHash', type: 'bytes32' },
            ],
        };

        const warrantValueToSign = {
            packedValidationData: packedValidationData,
            dataHash: dataHash,
        };

        const warrantSignature = await signer.signTypedData(warrantDomain, warrantTypes, warrantValueToSign);

        const warrant = {
            nonce: warrantNonce,
            validBefore: warrantValidBefore,
            validAfter: warrantValidAfter,
            verifyingSigner: verifyingSignerAddress,
            signature: warrantSignature,
        };

        //generate permit signature
        const permitData = await generatePermitSignature(
            signer,
            digest.chainId,
            digest.inToken.address,
            inputAmount,
            await Rainbow.getAddress()
        );


        //simulate swap
        if (txType == RainbowTxType.TOKEN2TOKEN_PERMIT) {

            
            //fillQuoteTokenToTokenWithPermit
            console.log("token to token")
            const result = await Rainbow.connect(signer)["fillQuoteTokenToTokenWithPermit"].staticCall(
                digest.inToken.address,
                digest.outToken.address,
                digest.candidateTrade.to,
                digest.candidateTrade.data,
                inputAmount,
                0n,
                permitData,
                warrant
            )
            console.log("Result: ")
            console.log(result)
             

            console.log("CALLING")

            await Rainbow.connect(signer).fillQuoteTokenToTokenWithPermit(
                digest.inToken.address,
                digest.outToken.address,
                digest.candidateTrade.to,
                digest.candidateTrade.data,
                inputAmount,
                0n,
                permitData,
                warrant
            )

            console.log("DONE")

        } else if (txType == RainbowTxType.ETH2TOKEN) {

        } else if (txType == RainbowTxType.TOKEN2ETH) {

        } else if (txType == RainbowTxType.TOKEN2ETH_PERMIT) {

        } else if (txType == RainbowTxType.TOKEN2TOKEN) {

        } else {
            console.error("Invalid Tx Type")
        }


    }
}
 */