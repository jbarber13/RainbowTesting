# Rainbow Router v2 - Backend Integration Guide

## 🚨 BREAKING CHANGES - New Contract Deployment

**New Optimism Deployment:** `0xA90845CFc60488cCB917169EeDCF3577092Df29f`

This deployment includes **transfer proxy pattern support** with a new `approvalTarget` parameter.

---

## What Changed

### Old Contract Signature (v1)
```solidity
function fillQuoteTokenToToken(
    address sellTokenAddress,
    address buyTokenAddress,
    address payable target,           // Single address
    bytes calldata swapCallData,
    uint256 sellAmount,
    uint256 feeAmount,
    Warrant calldata warrant
)
```

### New Contract Signature (v2)
```solidity
function fillQuoteTokenToToken(
    address sellTokenAddress,
    address buyTokenAddress,
    address payable target,           // Execution target
    address approvalTarget,           // NEW: Approval target
    bytes calldata swapCallData,
    uint256 sellAmount,
    uint256 feeAmount,
    Warrant calldata warrant
)
```

**Similar changes apply to:**
- `fillQuoteTokenToTokenWithPermit()`
- `fillQuoteTokenToEth()`
- `fillQuoteTokenToEthWithPermit()`
- `fillQuoteEthToToken()` remains unchanged (no approvals needed for ETH input)

---

## Backend Changes Required

### 1. Update Contract ABI

**Location:** Wherever you store the Rainbow Router ABI

**Action:** Replace with the new ABI from:
```
smart-contracts/artifacts/contracts/RainbowRouter.sol/RainbowRouter.json
```

### 2. Add `approvalTarget` Parameter

**All Rainbow Router transaction builders must now include `approvalTarget`**

#### Example: Before (v1)
```typescript
// OLD - 7 parameters
const txData = rainbowRouter.encodeFunctionData("fillQuoteTokenToToken", [
    sellToken,
    buyToken,
    target,              // Single address
    swapCallData,
    sellAmount,
    feeAmount,
    warrant
]);
```

#### Example: After (v2)
```typescript
// NEW - 8 parameters
const txData = rainbowRouter.encodeFunctionData("fillQuoteTokenToToken", [
    sellToken,
    buyToken,
    target,              // Execution target
    approvalTarget,      // NEW: Approval target
    swapCallData,
    sellAmount,
    feeAmount,
    warrant
]);
```

### 3. Aggregator Configuration

You need to configure which aggregators use transfer proxy patterns:

```typescript
// TRANSFER PROXY AGGREGATORS (target ≠ approvalTarget)
const TRANSFER_PROXY_ROUTERS = {
    okx: {
        target: "0xC44C6550a3B13116F6fD593e1ec963d5aE78C4C8",       // OKX Router
        approvalTarget: "0x68D6B739D2020067D1e2F713b999dA97E4d54812" // OKX Approval Proxy
    },
    zeroex: {
        target: "0xDEF1ABE32c034e558Cdd535791643C58a13aCC10",       // 0x Exchange Proxy
        approvalTarget: "0x0000000000001fF3684f28c67538d4D072C22734" // 0x AllowanceHolder
    },
    cowswap: {
        target: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",       // CoW Settlement
        approvalTarget: "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110" // CoW VaultRelayer
    }
};

// SINGLE CONTRACT AGGREGATORS (target = approvalTarget)
const SINGLE_CONTRACT_ROUTERS = [
    "enso",
    "icecreamswap",
    "odos",
    "oneinch",
    "paraswap",
    "kyberswap",
    "unizen"
];
```

### 4. Rainbow Router Transformation Logic

Update your transformation function:

```typescript
function transformToRainbowRouter(
    dexQuote: any,
    routerName: string,
    rainbowRouterAddress: string
): RainbowExecutionInfo {
    // Get aggregator-specific config
    const isTransferProxy = TRANSFER_PROXY_ROUTERS[routerName];

    let target: string;
    let approvalTarget: string;

    if (isTransferProxy) {
        // Transfer proxy pattern
        target = isTransferProxy.target;
        approvalTarget = isTransferProxy.approvalTarget;
    } else {
        // Single contract pattern
        target = dexQuote.to;  // DEX router address
        approvalTarget = dexQuote.to;  // Same address
    }

    // Build Rainbow Router calldata
    const rainbowCalldata = rainbowRouter.encodeFunctionData("fillQuoteTokenToToken", [
        sellToken,
        buyToken,
        target,
        approvalTarget,  // NEW parameter
        dexQuote.data,   // Original DEX calldata
        sellAmount,
        feeAmount,
        warrant
    ]);

    return {
        trade: {
            to: rainbowRouterAddress,  // User calls Rainbow Router
            data: rainbowCalldata,
            value: dexQuote.value
        },
        approvals: [{
            token: sellToken,
            approvee: rainbowRouterAddress,  // User approves Rainbow Router
            amount: sellAmount
        }],
        warrant: warrant
    };
}
```

### 5. Quote Endpoint (`getPriceQuoteFromMarket`)

**Current behavior:** You mentioned this endpoint already transforms at quote time.

**Required changes:**
1. Add `approvalTarget` to the transformation
2. Store both `target` and `approvalTarget` in `coupon.executionInfo`

```typescript
// In getPriceQuoteFromMarket (src/services/market.service.ts:228-251)
if (useOkuRouter) {
    const routerConfig = TRANSFER_PROXY_ROUTERS['okx'];

    quote.coupon.executionInfo = {
        ...originalExecutionInfo,
        target: routerConfig.target,
        approvalTarget: routerConfig.approvalTarget,  // NEW
        trade: {
            to: rainbowRouterAddress,  // Changed from DEX address
            data: transformedCalldata,  // Rainbow Router calldata
            value: originalExecutionInfo.trade.value
        },
        approvals: [{
            token: sellToken,
            approvee: rainbowRouterAddress,  // Changed from DEX address
            amount: sellAmount
        }]
    };
}
```

### 6. Execution Info Endpoint (`getExecutionInformationFromMarket`)

**Current behavior:** Does NOT apply transformation (line 372-426).

**Problem:** This gets fresh execution info from the DEX, ignoring the transformed info in the coupon.

**Required changes:**

```typescript
// In getExecutionInformationFromMarket (src/services/market.service.ts:372-426)
async getExecutionInformationFromMarket(coupon: Coupon): Promise<RainbowExecutionInfo> {
    // Option A: Reuse transformed executionInfo from coupon (RECOMMENDED)
    if (coupon.executionInfo && coupon.executionInfo.trade.to === rainbowRouterAddress) {
        // Already transformed at quote time, return as-is
        return coupon.executionInfo;
    }

    // Option B: Re-transform (if you need fresh data)
    const freshDexQuote = await this.market.GetExecutionInformation(coupon);
    const routerName = coupon.routerName;  // You need to store this

    return transformToRainbowRouter(
        freshDexQuote,
        routerName,
        rainbowRouterAddress
    );
}
```

---

## Testing Your Changes

### 1. Verify Deployment
```bash
# Check that new contract is deployed
cast code 0xA90845CFc60488cCB917169EeDCF3577092Df29f --rpc-url $OP_URL
```

### 2. Test Quote Endpoint
```bash
curl -X POST http://localhost:3333/market/okx/swap_quote \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "optimism",
    "inToken": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    "outToken": "0x4200000000000000000000000000000000000006",
    "inTokenAmount": "1000000",
    "slippage": 1000,
    "useOkuRouter": true
  }'
```

**Verify:**
- ✅ `quote.coupon.executionInfo.trade.to` = `0xA90845CFc60488cCB917169EeDCF3577092Df29f` (Rainbow Router)
- ✅ `quote.coupon.executionInfo.approvals[0].approvee` = `0xA90845CFc60488cCB917169EeDCF3577092Df29f`
- ✅ Decode `trade.data` and verify it calls `fillQuoteTokenToToken` with 8 parameters

### 3. Run Smart Contract Tests
```bash
cd smart-contracts
npx hardhat run scripts/testRouters/testRoutersOP.ts --network op
```

---

## Migration Checklist

- [ ] Update Rainbow Router contract address in config: `0xA90845CFc60488cCB917169EeDCF3577092Df29f`
- [ ] Update contract ABI to v2
- [ ] Add `approvalTarget` parameter to all transaction builders
- [ ] Configure aggregator transfer proxy settings
- [ ] Update `getPriceQuoteFromMarket` transformation
- [ ] Update `getExecutionInformationFromMarket` to reuse transformed data
- [ ] Test quote endpoint returns Rainbow Router address
- [ ] Test execution endpoint returns valid calldata
- [ ] Run end-to-end swap test with OKX router
- [ ] Verify approval targets are correct

---

## Troubleshooting

### "Transaction reverts with TARGET_NOT_AUTH"
**Cause:** The `approvalTarget` address is not whitelisted.

**Fix:** Both `target` and `approvalTarget` must be whitelisted:
```typescript
await rainbowRouter.updateSwapTargets(target, true);
await rainbowRouter.updateSwapTargets(approvalTarget, true);
```

### "Wrong number of parameters"
**Cause:** Using old v1 contract signature (7 params instead of 8).

**Fix:** Add `approvalTarget` parameter after `target`.

### "Execution shows DEX address instead of Rainbow Router"
**Cause:** Backend is not transforming the transaction.

**Fix:** Ensure both quote and execution endpoints apply the Rainbow Router transformation.

---

## Chain-Specific Deployment Addresses

| Chain | Chain ID | Rainbow Router v2 | Status |
|-------|----------|-------------------|--------|
| Optimism | 10 | `0xA90845CFc60488cCB917169EeDCF3577092Df29f` | ✅ Deployed |
| Base | 8453 | TBD | ⏳ Pending |
| World Chain | 480 | TBD | ⏳ Pending |

---

## Questions?

Contact the smart contracts team or reference:
- Contract code: `smart-contracts/contracts/routers/BaseAggregator.sol`
- Test examples: `smart-contracts/test/rainbow/testTransferProxy*.ts`
- Deployment script: `smart-contracts/scripts/deploy.ts`
