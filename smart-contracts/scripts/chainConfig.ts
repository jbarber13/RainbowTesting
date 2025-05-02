import { config } from "dotenv"
config()

export type ChainConfig = {
    name: string,
    chainId: number,
    rpcUrl: string,
    privateKey: string,
    rainbowDeploy?: string
    targetList?: string[]
}

export const chainConfigs: ChainConfig[] = [
    {
        name: "arbitrum",
        chainId: 42161,
        rpcUrl: process.env.ARB_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            "0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3: Router
            "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", // Uniswap V3: Router 2
            "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506", // SushiSwap: Router
            "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",  // KyberSwap: Aggregator Router (Arbitrum)
            //"0x0d6826e1F59F2134296f0555183C560237F82B91" // ParaSwap: AugustusSwapper v6 (Arbitrum)
        ]
    },
    {
        name: "optimism",
        chainId: 10,
        rpcUrl: process.env.OP_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        rainbowDeploy: "0x003CCe004267597A3FFDA5C1945DA0C2C9276c96",
        targetList: [
            "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // KyberSwap: Aggregator Router
            "0xf332761c673b59B21fF6dfa8adA44d78c12dEF09", // OpenOcean: Router V2
            "0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            "0xCa423977156BB05b13A2BA3b76Bc5419E2fE9680", // ParaSwap: Augustus Swapper v6
            "0x6352a56caadC4F1E25CD6c75970Fa768A3304e64", // SushiSwap: Router
            "0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8", // Curve.fi: Swap Router / Registry (often interacts with pools)
            "0x70cA548cF343B63E5B0542F0F3EC84c61Ca1086f", // WOOFi Swap Router
            "0x80EbA3855878739F4710233A8a19d89Bdd2ffB8E"  // Hashflow: Router
        ]
    },
    {
        name: "polygon",
        chainId: 137,
        rpcUrl: process.env.POLYGON_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            "0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3: Router
            "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506", // SushiSwap: Router
            "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", // QuickSwap: Router (V2 based)
            "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",  // KyberSwap: Aggregator Router (Polygon)
            "0xDef1C0ded9bec7F1a1670819833240f027b25EfF" // ParaSwap: AugustusSwapper v5 (Polygon) 
        ]
    },
    {
        name: "base",
        chainId: 8453,
        rpcUrl: process.env.BASE_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            "0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            "0x2626664c2603336E57B271c5C0b26F421741e481", // Uniswap V3: Router (Seems to be Universal Router address on Base)
            "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", // Balancer: Vault
            "0xd9a1eA1dA168484682849C0A307D3f177E1Ae833", // SushiSwap: Router
            "0x3145a413ff7e86d9b18028752b847307d6a691da", // Aerodrome: Router
            "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // KyberSwap: Aggregation Router (Base)
        ]
    },
    {
        name: "bsc", 
        chainId: 56,
        rpcUrl: process.env.BSC_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            "0x10ED43C718714eb63d5aA57B78B54704E256024E", // PancakeSwap: Router v2
            "0x1a1ec25DC08e98e5E93F1104B5e5cdD298707d31", // PancakeSwap: Smart Router (V3 focused)
            "0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // KyberSwap: Aggregator Router (BSC)
            "0xf332761c673b59B21fF6dfa8adA44d78c12dEF09", // OpenOcean: Router V2 (BSC)
            "0xDef1C0ded9bec7F1a1670819833240f027b25EfF" // ParaSwap: AugustusSwapper v5 (BSC)
        ]
    },
    {
        name: "zksync_era",
        chainId: 324,
        rpcUrl: process.env.ZKSYNC_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            "0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295", // SyncSwap: Classic Pool Router
            "0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            "0x8B791913eB07C32779a16750e3868AA8495F5964", // Mute.io: Router
            "0x38585e76Ee87524d5C678946669Fe67e718208d7", // Maverick: Router
            "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5"  // KyberSwap: Aggregator Router (zkSync)
        ]
    },
    {
        name: "scroll",
        chainId: 534352, 
        rpcUrl: process.env.SCROLL_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb", // SyncSwap: Router
            "0xAAA45c8F5ef92a000a121d102F4e89278a711Faa", // Nuri: Router
            //"0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5"  // KyberSwap: Aggregation Router (Scroll)
        ]
    },
    {
        name: "filecoin", 
        chainId: 314,
        rpcUrl: process.env.FILECOIN_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            //"0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506" // SushiSwap: Router //no liquidity currently 
        ]
    },
    {
        name: "moonbeam",
        chainId: 1284,
        rpcUrl: process.env.MOONBEAM_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            //"0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            "0x985BcA32293A7A496300a48081947321177a86FD", // Beamswap
            //"0xAA30eF758139ae4a7f798112902Bf6d65612045f", // Beamswap: Router V2
            "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506" // SushiSwap: Router V2
        ]
    },
    {
        name: "polygonzkevm",
        chainId: 1101,
        rpcUrl: process.env.POLYGONZKEVM_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            //"0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // KyberSwap: Aggregator Router (Polygon zkEVM)
            //"0x271F144463E37705C75A87A636A95978C938138F", // QuickSwap V3: Router (Gamma)
            //"0x445f51297ADC5406A86981aA87213675272a431e" // SushiSwap: Router
        ]
    },
    {
        name: "blast",
        chainId: 81457,
        rpcUrl: process.env.BLAST_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            //"0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // KyberSwap: Aggregator Router (Blast)
            //"0x1Ce7AE1f5D8949839b21DF85579b96e5Bc578904", // ThrusterV2: Router02
            //"0xfc729f3835894036145F82434B599Fc469AbC896", // Ring Protocol: Swap Router
            //"0x4AEd91c1677Ec772A501A38f0Ccce5a318F8b99F", // Ambient: CrocSwapDex
            //"0x63718b1eF52161721C7A05E7A86558c2F6D94f5d"  // Odos: Router V2 (Blast)
        ]
    },
    {
        name: "rootstock",
        chainId: 30,
        rpcUrl: process.env.ROOTSTOCK_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            // Rootstock has its own ecosystem, Sovryn is the most prominent DeFi platform.
            //"0x96734f95173C740F1440763FF0FF5f10A163C871" // Sovryn: Swap Network
        ]
    },
    {
        name: "mantapacific",
        chainId: 169,
        rpcUrl: process.env.MANTAPACIFIC_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            //"0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            //"0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // KyberSwap: Aggregator Router (Manta)
            //"0xb44a5f6f62548911319274f58949515Dec40b365", // ApertureSwap: Router (Uniswap V3 Fork)
            //"0x57560446958156F6A969488464E874D0f76210E2", // iZUMi Finance: iZiSwap Router
            //"0xEc087711b448181656f14417d1491Ff607465571"  // OpenOcean: Router V2 (Manta)
        ]
    },
    {
        name: "boba",
        chainId: 288,
        rpcUrl: process.env.BOBA_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            //"0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            //"0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // KyberSwap: Aggregator Router (Boba)
            //"0x49a1942b7877c9453E0D536406A58Af0B17A45F1" // OolongSwap: Router
        ]
    },
    {
        name: "linea",
        chainId: 59144,
        rpcUrl: process.env.LINEA_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            "0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V6
            "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // KyberSwap: Aggregator Router (Linea)
            "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb", // Pancake Router
            //"0x39C5523771a74069f8AbA4875495F261e8741e0B", // Velocore V2: Router
            //"0x4AEd91c1677Ec772A501A38f0Ccce5a318F8b99F"  // Ambient: CrocSwapDex (Linea)
        ]
    },
    {
        name: "taiko",
        chainId: 167000,
        rpcUrl: process.env.TAIKO_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            //"0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // KyberSwap: Aggregator Router (Taiko)
            //"0x1a5b48dca7581e6661b3045e67a35790a39a8f29", // Henjin DEX: Algebra Integral Router
            //"0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506" // SushiSwap: Router 
        ]
    },
    {
        name: "sei", // Using Mainnet EVM ID 1329, not 15000 from prompt
        chainId: 1329,
        rpcUrl: process.env.SEI_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            // Sei EVM is very new. DeFi ecosystem is still developing.
        ]
    },
    {
        name: "gnosis",
        chainId: 100,
        rpcUrl: process.env.GNOSIS_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506", // SushiSwap: Router
            //"0x965A4Ab555636554929904534A6C8991ABA93E41", // Curve.fi: Swap Router / Registry
            "0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            "0xBA12222222228d8Ba445958a75a0704d566BF2C8", // Balancer: Vault
            //"0x6131B5fae19EA4f9D964eAc0408E4408b66337b5" // KyberSwap: Aggregator Router (Gnosis)
        ]
    },
    {
        name: "bob",
        chainId: 60808,
        rpcUrl: process.env.BOB_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            // BOB Mainnet is very new. DeFi ecosystem still developing.
            //"0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506" // SushiSwap: Router 
        ]
    },
    {
        name: "xlayer", 
        chainId: 196,
        rpcUrl: process.env.XLAYER_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
             //"0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506" // SushiSwap: Router 
             // Potentially QuickSwap or others if deployed.
        ]
    },
    {
        name: "metall2",
        chainId: 1750,
        rpcUrl: process.env.METAL_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            // Metal L2 - Very new ecosystem.
        ]
    },
    {
        name: "mainnet", 
        chainId: 1,
        rpcUrl: process.env.MAINNET_URL!,
        privateKey: process.env.MAINNET_PRIVATE_KEY!,
        targetList: [
            "0x111111125421cA6dc452d289314280a0f8842A65", // 1inch: Aggregation Router V5
            "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2: Router 02
            "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3: Router
            "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", // Uniswap V3: Router 2
            "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F", // SushiSwap: Router
            "0xDef1C0ded9bec7F1a1670819833240f027b25EfF", // ZeroEx
            "0x9509665d015bfe3c77aa5ad6ca20c8afa1d98989", // ParaSwap Augustus
            "0x9008D19f58AAbD9eD0D60971565AA8510560ab41", // CoW Swap: GPv2Settlement
            "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5" // KyberSwap: Aggregator Router (Mainnet)
        ]
    }
]
