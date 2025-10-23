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
        rainbowRouterAddress: "0x80dCD2C737cAFE9f86559bBCed9938eFfB7f7D1A",
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
            "unizen"
        ],
        ownerAddress: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0",
        rpcUrl: process.env.OP_URL
    },
    base: {
        networkName: "base",
        chainId: 8453,
        chainName: "base",
        rainbowRouterAddress: "0xA89A26c4d81A2cca4d0670F77f0FC88362b72248",
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
        rainbowRouterAddress: "0x25cf2128F603754179379351B805B4F8C0B8dCA4",
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
