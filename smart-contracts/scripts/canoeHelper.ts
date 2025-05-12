import { AbiCoder, AddressLike, BigNumberish, BytesLike, formatUnits, Interface, keccak256, parseUnits, Signer, TransactionResponse, TypedDataDomain, ZeroAddress } from "ethers";
import { ERC20__factory, ISwapRouter02__factory, RainbowRouter, RainbowRouter__factory } from "../typechain-types";
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

export type RainbwoDomainInfo = {
    name: string,
    version: string,
    address: string
}

export type SimResult = {
    success: boolean,
    market: MarketId,
    txData: string
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

//depricated
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

export const getRawCanoeQuote = async (market: string, params: canoeParams) => {
    const baseURL = `https://canoe.icarus.tools/market/${market}/swap_quote`
    // console.log("Getting swap quote...", baseURL)
    //console.log(params)

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


export const constructCanoeSwap = async (
    signer: Signer,
    params: canoeParams,
    RainbwoDomainInfo: RainbwoDomainInfo,
    txType: RainbowTxType,
    market: MarketId,
    chainId?: number,//required to be set to currentNetwork by `await ethers.provider.getNetwork()` for testing
    retry?: boolean

): Promise<SimResult> => {

    let readyTx: SimResult = {
        success: false,
        market: market,
        txData: "0x"
    }


    //get quote
    const digest: SwapQuoteResponse = await getRawCanoeQuote(market, params) as SwapQuoteResponse
    //console.log(digest)

    if (!(digest && digest.candidateTrade && digest.candidateTrade.data && digest.candidateTrade.to)) {
        //console.error("Invalid API response structure:", digest);
        //throw new Error("Invalid data from Canoe API");
    } else {
        if (chainId == undefined) {
            chainId = digest.chainId
        }
        readyTx = await simulateSwap(signer, RainbwoDomainInfo, txType, market, digest, chainId)
    }

    if (readyTx.success) {
        console.log("Successful route found for ", market)
    } else {
        if (retry) {

            //try more routers until we have a success tx
            const markets = Object.values(MarketId)
            let i = 0
            while (!readyTx.success && i < markets.length) {
                const tryMarket = markets[i]
                console.log("")

                console.log("Retrying with ", tryMarket)

                //get quote
                const newDigest: SwapQuoteResponse = await getRawCanoeQuote(tryMarket, params) as SwapQuoteResponse

                if (!(newDigest && newDigest.candidateTrade && newDigest.candidateTrade.data && newDigest.candidateTrade.to)) {
                    //console.error("Invalid API response structure:", newDigest);
                    //throw new Error("Invalid data from Canoe API");
                } else {
                    if (chainId == undefined) {
                        chainId = digest.chainId
                    }
                    readyTx = await simulateSwap(signer, RainbwoDomainInfo, txType, tryMarket, newDigest, chainId)
                }
                i++
            }

        }
    }
    return readyTx
}


export const simulateSwap = async (signer: Signer, RainbwoDomainInfo: RainbwoDomainInfo, txType: RainbowTxType, market: MarketId, digest: SwapQuoteResponse, chainId: number): Promise<SimResult> => {

    //format input amount
    const inputAmount = parseUnits(digest.inAmount, digest.inToken.decimals);
    // console.log("input amount: ", inputAmount)

    const swapCallDataFromApi = digest.candidateTrade.data;
    const routerAddrFromApi = digest.candidateTrade.to;

    const swapCallDataHash = keccak256(swapCallDataFromApi);
    const dataHash = keccak256(
        AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'address', 'bytes32', 'uint256', 'uint256'],
            [digest.inToken.address, digest.outToken.address, routerAddrFromApi, swapCallDataHash, inputAmount, 0]
        )
    );

    const clientCurrentTimeSec = Math.floor(Date.now() / 1000);
    const warrantValidAfter = BigInt(clientCurrentTimeSec - 300); // 5 minutes ago
    const warrantValidBefore = BigInt(clientCurrentTimeSec + 3600); // 1 hour from now

    const warrantNonce: bigint = BigInt(await signer.getNonce());

    const verifyingSignerAddress: string = await signer.getAddress();

    const packedValidationData = warrantNonce | (warrantValidBefore << 160n) | (warrantValidAfter << 208n);


    const warrantDomain = {
        name: RainbwoDomainInfo.name,
        version: RainbwoDomainInfo.version,
        chainId: chainId,
        verifyingContract: RainbwoDomainInfo.address,
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




    //sim tx
    const Rainbow = RainbowRouter__factory.connect(RainbwoDomainInfo.address, signer);


    try {
        let SimResult: SimResult = {
            success: false,
            market: market,
            txData: "0x"
        }

        if (txType === RainbowTxType.TOKEN2TOKEN_PERMIT) {
            //format permit data 
            const permitData = await generatePermitSignature(
                signer,
                chainId,
                digest.inToken.address,
                inputAmount,        // Raw BigInt amount
                RainbwoDomainInfo.address
            );

            //simulate tx, this will revert if the inputs are bad
            await Rainbow.connect(signer)["fillQuoteTokenToTokenWithPermit"].staticCall(
                digest.inToken.address,
                digest.outToken.address,
                digest.candidateTrade.to,
                digest.candidateTrade.data,
                inputAmount,
                0n,
                permitData,
                warrant
            )

            //generate tx data so we can send the tx since it did not revert if we have reached this point
            const txData = await Rainbow.connect(signer).fillQuoteTokenToTokenWithPermit.populateTransaction(
                digest.inToken.address,
                digest.outToken.address,
                digest.candidateTrade.to,
                digest.candidateTrade.data,
                inputAmount,
                0n,
                permitData,
                warrant
            )

            SimResult.success = true
            SimResult.txData = txData.data
        }

        if (txType === RainbowTxType.TOKEN2ETH_PERMIT) {
            //format permit data 
            const permitData = await generatePermitSignature(
                signer,
                chainId,
                digest.inToken.address,
                inputAmount,        // Raw BigInt amount
                RainbwoDomainInfo.address
            );

            //simulate tx, this will revert if the inputs are bad
            await Rainbow.connect(signer)["fillQuoteTokenToEthWithPermit"].staticCall(
                digest.inToken.address,
                digest.candidateTrade.to,
                digest.candidateTrade.data,
                inputAmount,
                0n,
                permitData,
                warrant
            )

            //generate tx data so we can send the tx since it did not revert if we have reached this point
            const txData = await Rainbow.connect(signer).fillQuoteTokenToEthWithPermit.populateTransaction(
                digest.inToken.address,
                digest.candidateTrade.to,
                digest.candidateTrade.data,
                inputAmount,
                0n,
                permitData,
                warrant
            )

            SimResult.success = true
            SimResult.txData = txData.data
        }
        if (SimResult.success) {
            console.log("SUCCESS WITH ", market)
        }
        return SimResult

    } catch (error: any) {
        console.error("TRANSACTION SIMULATION FAILED or error during preparation.");
        if (error.code) {
            console.error(`Error Code: ${error.code}`); // E.g., CALL_EXCEPTION, UNPREDICTABLE_GAS_LIMIT
        }

        if (error.reason) {
            console.error(`Revert Reason (from error.reason): ${error.reason}`);
        }

        if (error.data && error.data !== "0x") {
            //console.error(`Revert Data (from error.data): ${error.data}`);
            try {
                const decodedError = Rainbow.interface.parseError(error.data);
                if (decodedError) {
                    console.error(`Decoded Custom Error: ${decodedError.name}(${decodedError.args.join(', ')})`);
                } else {
                    if (error.data.startsWith("0x08c379a0")) {
                        const reasonString = AbiCoder.defaultAbiCoder().decode(['string'], '0x' + error.data.substring(10))[0];
                        console.error(`Decoded string revert reason: ${reasonString}`);
                    } else {
                        console.error("Could not decode error data using RainbowRouter interface, or it's not a custom error.");
                    }
                }
            } catch (parseErr) {
                console.error("Failed to parse error data:", parseErr);
            }
        }

        // If the error object has a 'transaction' or 'receipt' property (less common for staticCall errors but possible)
        if (error.transaction) {
            console.error("Associated transaction (if any):", error.transaction);
        }

        let readyTx: SimResult = {
            success: false,
            market: market,
            txData: "0x"
        }

        return readyTx
    }



}
