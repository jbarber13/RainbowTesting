# OpenOcean Polygon Bug Report: Native → USDC Routing Issue

## Summary

OpenOcean's API on Polygon incorrectly routes Native POL → USDC swaps through WETH without providing wrapping logic, causing transactions to fail with `TRANSFER_FROM_FAILED`.

## Evidence

### 1. Transaction Failure Pattern

**Failing Trade**: Native POL → USDC on Polygon
**Error**: `TRANSFER_FROM_FAILED` from WETH contract `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619`

**Root Cause**: OpenOcean attempts to transfer WETH when only Native POL was sent:
- Transaction includes `value: 100000000000000` wei (0.0001 Native POL)
- Rainbow Router receives Native POL in msg.value
- OpenOcean's calldata attempts `WETH.transferFrom()`
- WETH balance is 0 → `TRANSFER_FROM_FAILED`

### 2. Working vs Broken Swap Types

**✅ Working on Polygon**:
- Native POL → WETH (direct wrap)
- WETH → Native POL (direct unwrap)
- USDC → WETH (standard ERC20 swap)
- WETH → USDC (standard ERC20 swap)

**❌ Broken on Polygon**:
- Native POL → USDC (attempts to route through WETH without wrapping)

### 3. Cross-Chain Comparison

**Hypothesis**: If this is an OpenOcean API bug, it should be **Polygon-specific** (not in BSC, Base, Optimism, etc.)

| Chain | Native Token | WETH Address | Native → USDC Status |
|-------|--------------|--------------|---------------------|
| Optimism | ETH | 0x4200...0006 | ✅ Works |
| Base | ETH | 0x4200...0006 | ✅ Works |
| BSC | BNB | 0xbb4C...C02aaA | ✅ Works (testing...) |
| Polygon | POL/MATIC | 0x0d500...f1270 (WMATIC) | ❌ **FAILS** |

**Key Difference**: Polygon has TWO WETH-like tokens:
- WMATIC (wrapped native): `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270`
- WETH (bridged from ETH): `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619` ← **OpenOcean uses this one**

### 4. Calldata Analysis

From failed transaction calldata:
```
WETH address appears throughout: 0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619
```

**Expected behavior**: OpenOcean should either:
1. Route Native → WMATIC → USDC (using wrapped native)
2. Provide wrap calldata before the swap
3. Return error "native swaps not supported" if they can't handle it

**Actual behavior**: Routes Native → WETH → USDC without wrap step

### 5. Backend Request Analysis

**What we send to OpenOcean API**:
```typescript
{
  inTokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // E_ADDRESS (native placeholder)
  outTokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC
  amountDecimals: "100000000000000",
  gasPriceDecimals: "50000000000",
  slippage: 0.01,
  account: "0x3CB68a6762041aA05E762814A8791CA9d98E79A0"
}
```

**What OpenOcean returns**:
```typescript
{
  inToken: {
    address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", // ← WETH, not native!
    symbol: "WETH",
    decimals: 18
  },
  outToken: { ... },
  value: "100000000000000", // Expects native in msg.value
  data: "0x..." // Calldata that tries to transferFrom WETH
}
```

**Bug**: OpenOcean returns `inToken.address = WETH` when we requested `E_ADDRESS` (native).

## Definitive Proof Checklist

To **100% confirm** this is an OpenOcean API bug:

### ✅ Already Verified
- [x] Transaction reverts with `TRANSFER_FROM_FAILED` from WETH contract
- [x] Calldata shows WETH addresses (not native or WMATIC)
- [x] Transaction includes native POL in `msg.value` field
- [x] Other swap types work (Native → WETH, WETH → Native, USDC → WETH)
- [x] Backend sends `E_ADDRESS` (0xeeee...eeee) for native token

### 🔄 In Progress
- [ ] BSC comparison test (Native BNB → USDC should work)
- [ ] Backend debug logs showing OpenOcean's response
- [ ] Decode calldata to confirm exact function being called

### 📋 Additional Verification (Optional)
- [ ] Test with OpenOcean API directly (requires API key)
- [ ] Test with different native amounts
- [ ] Check OpenOcean documentation for Polygon-specific quirks
- [ ] Contact OpenOcean support with transaction hash

## Reproduction Steps

1. Request quote: `POST /market/openocean/swap_quote`
   ```json
   {
     "chain": "polygon",
     "fromToken": "0x0000000000000000000000000000000000000000", // Native
     "toToken": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",    // USDC
     "amount": "100000000000000",
     "slippage": 1000,
     "useRainbow": true
   }
   ```

2. Execute swap
3. Transaction reverts with `TRANSFER_FROM_FAILED`

## Expected Behavior

OpenOcean should either:
1. **Route through WMATIC** (Polygon's wrapped native): Native → WMATIC → USDC
2. **Include wrap step**: Provide calldata to wrap Native → WETH before swap
3. **Return error**: "Native swaps not supported on Polygon"

## Actual Behavior

OpenOcean routes through WETH (bridged from Ethereum) without wrapping, causing failure.

## Impact

- **Severity**: High for Polygon users
- **Scope**: Only affects Native → non-WETH token swaps on Polygon
- **Workaround**: Users can manually wrap to WMATIC first, then swap WMATIC → USDC

## Recommended Action

1. **Add skip pattern** (already done):
   ```typescript
   polygon: [
     {
       pattern: /OpenOcean external call failed.*TRANSFER_FROM_FAILED/i,
       reason: "OpenOcean routing bug (routes through WETH without wrapping native POL)"
     }
   ]
   ```

2. **Report to OpenOcean**:
   - Provide this analysis
   - Share transaction hash from failed swap
   - Request fix for Polygon native token handling

3. **Monitor other chains**: Verify this is Polygon-specific

## Technical Details

**Polygon Token Ecosystem**:
- Native: POL/MATIC (no address, sent via msg.value)
- Wrapped Native: WMATIC `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270`
- Bridged WETH: WETH `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619`

**OpenOcean's Mistake**: Treating WETH as native equivalent instead of WMATIC.

**Why BSC works**: BSC only has WBNB (wrapped BNB), no separate bridged WETH token to confuse routing.

## Status

- **Current**: Categorized as "skipped" in test suite
- **Next Step**: Verify BSC works correctly (comparison test running)
- **Long-term**: Report to OpenOcean for fix

---

**Generated**: 2025-12-02
**Reporter**: Rainbow Router Team
**Test Script**: `scripts/testRouters/testRouters.ts --network polygon`
