# Archive RPC Required Tests

These tests require an **archive node RPC** (e.g., Alchemy, Infura paid tier) because they:
1. Fork live networks at specific historical blocks
2. Execute transactions that require querying historical state

## Why Archive Data is Needed

When Hardhat forks a network and executes transactions, it needs to distinguish between:
- State that existed at the fork block (queried from RPC)
- State created by local transactions

This requires the RPC to support `eth_getStorageAt`, `eth_getBalance`, and `eth_getCode` calls at historical blocks, which public free RPCs do not support.

## Required Environment Variables

```bash
# Optimism archive RPC (for most tests)
OP_URL="https://opt-mainnet.g.alchemy.com/v2/YOUR_KEY"

# Arbitrum archive RPC (for Arbitrum tests)
ARB_URL="https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY"
```

## Running These Tests

```bash
# Run only archive-rpc tests (when you have archive access)
npx hardhat test test/archive-rpc/*.ts

# Run a specific test file
npx hardhat test test/archive-rpc/testSignature.ts
```

## Test Files

| File | Network | Tests |
|------|---------|-------|
| `testDeterministicDeploy.ts` | Optimism | CREATE2 deterministic deployment |
| `testSignature.ts` | Optimism | Permit signatures (EIP-2612, DAI, Permit2) |
| `testRainbow.ts` | Optimism | Rainbow-specific functions |
| `testRainbowComplete.ts` | Optimism | Comprehensive coverage |
| `testTransferProxy.ts` | Optimism | Transfer proxy pattern (OKX, 0x) |
| `testTransferProxyArbitrum.ts` | Arbitrum | Transfer proxy pattern (CoW Protocol) |

## Free Archive RPC Options

- **Alchemy**: Free tier includes archive access (recommended)
- **Infura**: Paid plans only
- **QuickNode**: Paid plans only
- **Tenderly**: Has forking capabilities
