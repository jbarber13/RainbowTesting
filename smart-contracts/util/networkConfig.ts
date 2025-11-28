/**
 * networkConfig.ts
 *
 * Centralized network configuration for Rainbow Router deployments.
 * This file contains all network-specific addresses, supported routers,
 * and token configurations for Optimism, Base, and Worldchain.
 */

export interface NetworkConfig {
    networkName: string;
    chainId: number;
    chainName: string; // Backend chain name (e.g., "optimism", "base", "worldchain")
    rainbowRouterAddress: string;
    deploymentBlock: number; // Block number when the contract was deployed
    wethAddress: string;
    usdcAddress?: string; // Optional - some networks may not have USDC
    nativeSymbol: string; // "ETH" for most networks
    supportedRouters: string[]; // Backend router names
    ownerAddress: string; // Rainbow Router owner address
    rpcUrl?: string; // Optional RPC URL from env
}

// Network configurations indexed by network name
export const NETWORK_CONFIGS: Record<string, NetworkConfig> = {
    op: {
        networkName: "op",
        chainId: 10,
        chainName: "optimism",
        rainbowRouterAddress: "0xA90845CFc60488cCB917169EeDCF3577092Df29f",  // NEW DEPLOYMENT with approvalTarget support
        deploymentBlock: 143955053, // Nov 18, 2025 - tx: 0x6c495af96a3af0848131a132951d635419a9558b30a391bdb7094575fd5413c5
        wethAddress: "0x4200000000000000000000000000000000000006",
        usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        nativeSymbol: "ETH",
        supportedRouters: [
            "enso",
            "icecreamswap",
            "odos",
            "oneinch",
            "paraswap",
            "kyberswap",
            "unizen",
            "okx",     // Now supported with transfer proxy!
            "zeroex"  // Now supported with transfer proxy!
        ],
        ownerAddress: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0",
        rpcUrl: process.env.OP_URL
    },
    base: {
        networkName: "base",
        chainId: 8453,
        chainName: "base",
        rainbowRouterAddress: "0x816cd361284003e722dbcc3597ca6e3bdb4d46dd",
        deploymentBlock: 38624971,
        wethAddress: "0x4200000000000000000000000000000000000006",
        usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
        nativeSymbol: "ETH",
        supportedRouters: [
            "kyberswap"  // Testing just one router for detailed error messages
            // "enso",
            // "icecreamswap",
            // "oks",
            // "odos",
            // "oneinch",
            // "openocean",
            // "velora",  // Commented - may need verification
            // "unison",  // Commented - may need verification
            // "luxor",   // Commented - may need verification
            // "zeroex",  // Commented - may need verification
        ],
        ownerAddress: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0",
        rpcUrl: process.env.BASE_URL
    },
    worldchain: {
        networkName: "worldchain",
        chainId: 480,
        chainName: "worldchain",
        rainbowRouterAddress: "0x2b53aec27d45a0021c514cdfd6496f99a5e0be21",
        deploymentBlock: 22351271,
        wethAddress: "0x4200000000000000000000000000000000000006",
        usdcAddress: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", // Native USDC on World Chain
        nativeSymbol: "ETH",
        supportedRouters: [
            "icecreamswap",
            "enso",
            "kyberswap",
            // "lusor"  // Commented - may need verification
        ],
        ownerAddress: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0",
        rpcUrl: process.env.WORLDCHAIN_URL
    }
};

// Get network config by network name (e.g., "op", "base", "worldchain")
export function getNetworkConfig(networkName: string): NetworkConfig {
    const config = NETWORK_CONFIGS[networkName];

    if (!config) {
        throw new Error(
            `No configuration found for network: ${networkName}. ` +
            `Available networks: ${Object.keys(NETWORK_CONFIGS).join(", ")}`
        );
    }

    return config;
}

// Get network config by chain ID
export function getNetworkConfigByChainId(chainId: number): NetworkConfig {
    const config = Object.values(NETWORK_CONFIGS).find(c => c.chainId === chainId);

    if (!config) {
        throw new Error(
            `No configuration found for chain ID: ${chainId}. ` +
            `Available chain IDs: ${Object.values(NETWORK_CONFIGS).map(c => c.chainId).join(", ")}`
        );
    }

    return config;
}

// Check if a network supports a specific router
export function isRouterSupported(networkName: string, routerName: string): boolean {
    const config = NETWORK_CONFIGS[networkName];
    return config ? config.supportedRouters.includes(routerName) : false;
}

// Get all supported network names
export function getSupportedNetworks(): string[] {
    return Object.keys(NETWORK_CONFIGS);
}
