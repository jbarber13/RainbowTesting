# Permit2 Testing Script Updates

## Summary
Updated `testRoutersOP.ts` and `canoeHelper.ts` to support Permit2 (SignatureTransfer) for ERC20 token swaps when using OkuRouter.

## Changes Made

### 1. `scripts/testRouters/testRoutersOP.ts`

#### Added Permit2 constant
```typescript
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
```

#### Updated quote parameters (line ~213-225)
- Added `usePermit2: !inToken.isNative` - Enable Permit2 for all ERC20 inputs
- Added `userAddress: testAddress` - Required for Permit2 signature generation
- Native ETH flows skip Permit2 (no permit needed for ETH)

#### Added Permit2 signature handling (line ~265-278)
```typescript
// Step 1.5: Handle Permit2 signature if required
let permit2Signature: string | undefined;
if (quoteResponse.signingRequest?.typedData && quoteResponse.signingRequest.typedData.length > 0) {
  console.log(`      [${router}] Signing Permit2 request...`);
  const typedDataPayload = quoteResponse.signingRequest.typedData[0].payload;

  // Sign the Permit2 typed data
  permit2Signature = await testSigner.signTypedData(
    typedDataPayload.domain,
    typedDataPayload.types,
    typedDataPayload.message
  );
  console.log(`      [${router}] Permit2 signature generated`);
}
```

#### Updated execution request (line ~285-289)
- Pass `permit2Signature` to `getRainbowExecution()`
- Backend receives signature and includes it in OkuRouter calldata

#### Updated approval verification (line ~310-323)
- Accept approvals to either Rainbow Router OR Permit2
- Validates approvee is one of the two expected addresses

#### Updated approval handling (line ~337-367)
- Dynamically determine approval target based on backend response
- Approve Permit2 if backend requests it, otherwise approve Rainbow Router
- Log which contract is being approved ("Permit2" vs "Rainbow Router")

#### Added documentation
- Added comprehensive comment block explaining Permit2 flow
- Documents 7-step process from quote to execution

### 2. `util/canoeHelper.ts`

#### Updated canoeParams type (line ~119-132)
```typescript
export type canoeParams = {
  chain: string,
  account: string,
  userAddress?: string, // Optional: User wallet address (for permit owner when using usePermit/usePermit2)
  isExactIn: boolean,
  inTokenAddress: string,
  outTokenAddress: string,
  inTokenAmount: string, //human readable terms
  slippage: number,
  useOkuRouter?: boolean, // Optional flag for Oku Router (Rainbow Router) optimization
  getCalldata?: boolean, // Optional flag to get calldata, needed for oneinch
  usePermit?: boolean, // Optional flag to enable EIP-2612 permit signatures (deprecated)
  usePermit2?: boolean // Optional flag to enable Permit2 signatures (recommended)
}
```

#### Updated getRainbowExecution signature (line ~644-664)
```typescript
export const getRainbowExecution = async (
    coupon: CouponInterface,
    market: string,
    permit2Signature?: string,  // NEW PARAMETER
    baseUrl?: string
): Promise<RainbowExecutionInfo> => {
    const url = baseUrl || `http://localhost:3333/market/${market}/execution_information`;

    // Build signing request if Permit2 signature is provided
    const signingRequest = permit2Signature ? {
        typedData: [{
            signature: permit2Signature
        }]
    } : undefined;

    // Minimal request body - Rainbow transformation already happened at quote time
    const requestBody: ExecutionRequest = {
        coupon: coupon,
        useOkuRouter: true,
        signingRequest: signingRequest  // NEW FIELD
    };
    // ... rest of function
}
```

## Flow Overview

### Quote Phase
1. **Client → Backend**: POST `/market/{router}/swap_quote`
   ```json
   {
     "useOkuRouter": true,
     "usePermit2": true,
     "userAddress": "0x...",
     // ... other params
   }
   ```

2. **Backend → Client**: Quote response includes:
   ```json
   {
     "coupon": { ... },
     "signingRequest": {
       "typedData": [{
         "payload": {
           "domain": { "name": "Permit2", "chainId": 10, ... },
           "types": { "PermitTransferFrom": [...], ... },
           "message": { "permitted": {...}, "nonce": ..., "deadline": ... }
         }
       }],
       "permit2Address": "0x000000000022D473030F116dDEE9F6B43aC78BA3"
     },
     "approvals": [{
       "approvee": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
       "amount": "max_uint160",
       // ...
     }]
   }
   ```

3. **Client**: Signs Permit2 typed data with `signer.signTypedData()`

### Execution Phase
4. **Client → Backend**: POST `/market/{router}/execution_information`
   ```json
   {
     "coupon": { ... },
     "useOkuRouter": true,
     "signingRequest": {
       "typedData": [{
         "signature": "0x..." // Permit2 signature
       }]
     }
   }
   ```

5. **Backend**: Builds OkuRouter calldata with Permit2 signature
   - Calls `fillQuoteTokenToTokenWithPermit()` or `fillQuoteTokenToEthWithPermit()`
   - Includes `permit: { permitStyle: 2, v, r, s, nonce, deadline }`

6. **Client**: Executes transaction
   - OkuRouter calls `Permit2.permitTransferFrom()` to pull tokens
   - Tokens transferred directly from user to OkuRouter via Permit2

7. **Approval**: User must approve Permit2 contract (one-time)
   - Target: `0x000000000022D473030F116dDEE9F6B43aC78BA3`
   - Amount: `max_uint160` (recommended for unlimited permits)

## Testing

Run the test script:
```bash
npx hardhat run scripts/testRouters/testRoutersOP.ts --network op
```

### Expected behavior:
- **ETH → WETH**: No Permit2 (native ETH input)
- **WETH → ETH**: Uses Permit2, approves Permit2 contract
- **USDC → WETH**: Uses Permit2, approves Permit2 contract

### Log output examples:
```
[router] Starting quote request...
[router] Quote received in 2500ms
[router] Signing Permit2 request...
[router] Permit2 signature generated
[router] Starting execution request...
[router] Execution received in 1200ms
[router] Handling USDC approval to Permit2...
[router] DEBUG Rainbow Router function: fillQuoteTokenToTokenWithPermit
```

## Backend Requirements

The backend must implement:
1. `generatePermit2Request()` in OkuRouterService
2. Return `signingRequest` in quote response when `usePermit2=true`
3. Accept `signingRequest.signature` in execution request
4. Transform signature to `permitStyle: 2` with v, r, s split
5. Return Permit2 approval in `approvals` array

See backend implementation plan for full details.

## Notes

- Permit2 address is the same on all EVM chains (deployed via CREATE2)
- Exception: zkSync uses different address due to modified CREATE2
- For this project (Optimism, Base, Mainnet, Worldchain), canonical address is correct
- Permit2 uses bitmap nonces (not sequential like EIP-2612)
- Each signature is one-time use (nonce bit marked as used)
- Unlimited approvals to Permit2 are safe (signatures are granular, time-limited)

## Future Improvements

- [ ] Add Permit2 allowance check before requesting approval
- [ ] Handle Permit2 signature expiration gracefully
- [ ] Add retry logic for Permit2 signature failures
- [ ] Support Permit2 batch transfers for multi-hop swaps
- [ ] Add Permit2 nonce management for sequential swaps
