# Rainbow Router Smart Contract System

## Overview

**Rainbow Router** is a swap aggregator intermediary smart contract that provides a unified, secure interface for executing token swaps across multiple DEX aggregators (1inch, Odos, Paraswap, Enso, KyberSwap, etc.).

### Key Benefits

- **Gasless Approvals**: Supports 3 permit standards (EIP-2612, DAI-style, Permit2) for one-transaction swaps
- **Backend Authorization**: Warrant signature system prevents stale/malicious swap calldata
- **Multi-Aggregator Support**: Single interface for multiple DEX aggregators
- **Fee Collection**: Configurable fees on input tokens or output ETH
- **Enhanced Security**: Reentrancy protection, target whitelisting, balance verification

### Architecture

```
User → Backend API → Rainbow Router → DEX Aggregator → DEX Protocol → Token Swap
         (quote +        (security     (1inch, Odos,   (Uniswap,
          warrant)        validation)    Paraswap...)    Curve...)
```

The Rainbow Router acts as a security and convenience layer between users and DEX aggregators, providing:
1. Authorization via backend-signed warrants
2. Gasless token approvals via permit signatures
3. Fee collection capability
4. Whitelisting and validation

---

## Core Capabilities

### Swap Types

Rainbow Router supports **3 swap types** with **6 total functions**:

#### 1. ETH to Token (1 function)

**`fillQuoteEthToToken()`**
- Swaps native ETH → ERC20 token
- Fee: Flat amount deducted from input ETH
- No permit variant (ETH doesn't require approval)

```solidity
function fillQuoteEthToToken(
    address buyTokenAddress,
    address payable target,        // DEX aggregator contract
    bytes calldata swapCallData,   // Aggregator's swap calldata
    uint256 feeAmount,             // Flat fee in ETH
    CanoeHelper.Warrant calldata warrant
) external payable
```

#### 2. Token to Token (2 functions)

**`fillQuoteTokenToToken()`** - Requires pre-approval
- Swaps ERC20 → ERC20
- Requires user to `approve()` Rainbow Router first
- Fee: Flat amount deducted from input tokens
- Supports transfer proxy pattern (separate approval/execution targets)

**`fillQuoteTokenToTokenWithPermit()`** - Gasless approval
- Same as above but includes permit signature
- No prior approval transaction needed
- Supports EIP-2612, DAI-style, or Permit2

```solidity
function fillQuoteTokenToToken(
    address sellTokenAddress,
    address buyTokenAddress,
    address payable target,        // Execution target (router)
    address approvalTarget,        // Approval target (for transfer proxy)
    bytes calldata swapCallData,
    uint256 sellAmount,
    uint256 feeAmount,             // Flat fee in sell tokens
    CanoeHelper.Warrant calldata warrant
) external payable

function fillQuoteTokenToTokenWithPermit(
    // ... same parameters as above ...
    address approvalTarget,        // Approval target (for transfer proxy)
    PermitHelper.Permit calldata permitData,
    CanoeHelper.Warrant calldata warrant
) external payable
```

#### 3. Token to ETH (2 functions)

**`fillQuoteTokenToEth()`** - Requires pre-approval
- Swaps ERC20 → Native ETH
- Fee: Percentage-based on output ETH (basis points with 1e18 precision)
- Supports transfer proxy pattern (separate approval/execution targets)

**`fillQuoteTokenToEthWithPermit()`** - Gasless approval
- Same as above but includes permit signature

```solidity
function fillQuoteTokenToEth(
    address sellTokenAddress,
    address payable target,        // Execution target (router)
    address approvalTarget,        // Approval target (for transfer proxy)
    bytes calldata swapCallData,
    uint256 sellAmount,
    uint256 feePercentageBasisPoints,  // e.g., 100000000000000000 = 1%
    CanoeHelper.Warrant calldata warrant
) external payable
```

### Fee Mechanisms

**Input Fees** (Token→Token, ETH→Token):
- Flat amount deducted from input
- Example: Swap 100 USDC with 1 USDC fee = 99 USDC sent to aggregator
- Fees held in contract for owner withdrawal

**Output Fees** (Token→ETH):
- Percentage-based using 1e18 precision
- Formula: `fees = (ethReceived * feePercentageBasisPoints) / 1e18`
- Example: `100000000000000000` = 1% = 100 basis points with 14 extra decimals
- User receives: `ethReceived - fees`

---

## Permit Support

Rainbow Router supports **3 permit standards** plus **legacy approvals**, making it compatible with virtually all ERC20 tokens.

### 1. EIP-2612 Standard Permit (PermitStyle: 1)

**Most common** permit implementation for modern ERC20 tokens.

```solidity
struct Permit {
    uint256 value;      // Amount to permit
    uint256 nonce;      // Token's nonce for owner
    uint256 deadline;   // Unix timestamp
    uint8 permitStyle;  // = 1 for EIP-2612
    uint8 v;           // Signature components
    bytes32 r;
    bytes32 s;
}
```

**EIP-712 Message Structure:**
```typescript
{
    owner: address,
    spender: address,
    value: uint256,
    nonce: uint256,
    deadline: uint256
}
```

**How it works:**
1. PermitHelper calls `token.permit(owner, spender, value, deadline, v, r, s)`
2. Token grants allowance to Rainbow Router
3. Rainbow Router calls `safeTransferFrom()` to pull tokens
4. Tokens transferred from user to Rainbow Router

**Supported tokens:** USDC (Optimism/Base), WETH, most modern ERC20s

---

### 2. DAI-Style Permit (PermitStyle: 0)

Used by **DAI** and some older tokens with custom permit implementations.

**Key differences from EIP-2612:**
- Uses `holder` instead of `owner`
- Uses `expiry` instead of `deadline`
- Includes `allowed` boolean parameter
- Domain version "1" instead of "2"

**EIP-712 Message Structure:**
```typescript
{
    holder: address,
    spender: address,
    nonce: uint256,
    expiry: uint256,
    allowed: bool
}
```

**How it works:** Same as EIP-2612 but with DAI's custom permit function signature.

---

### 3. Permit2 (Uniswap Universal Permit) (PermitStyle: 2)

**Most advanced** and **gas-efficient** option. Works with ANY ERC20 token via one-time approval.

**Canonical Permit2 Address (all chains):**
`0x000000000022D473030F116dDEE9F6B43aC78BA3`

**CRITICAL DIFFERENCE:** Permit2 uses **SignatureTransfer** pattern:
- Tokens are **transferred immediately** during the `permitTransferFrom()` call
- No separate `safeTransferFrom()` needed (Rainbow Router skips it)
- One-shot signature authorization + transfer in single call

**Prerequisites:**
1. User must approve Permit2 contract to spend tokens (one-time, any amount)
2. User signs a Permit2 signature for specific amount + nonce + deadline
3. Contract calls Permit2's `permitTransferFrom()` which validates signature AND transfers tokens

**EIP-712 Message Structure:**
```typescript
{
    permitted: {
        token: address,
        amount: uint256
    },
    spender: address,
    nonce: uint256,        // Unique nonce (timestamp-based)
    deadline: uint256
}
```

**Nonce Generation:**
- Permit2 uses **bitmap nonce system** (not sequential)
- Each nonce bit can only be used once
- Rainbow Router generates: `Date.now() * 1000 + random(1000)`

**How it works:**
1. User approves Permit2 contract once: `token.approve(PERMIT2, type(uint256).max)`
2. PermitHelper constructs `PermitTransferFrom` struct from function parameters
3. PermitHelper calls Permit2's `permitTransferFrom()`:
   - Validates EIP-712 signature
   - Checks nonce hasn't been used
   - **Transfers tokens directly** from user to Rainbow Router
4. Rainbow Router skips `safeTransferFrom()` (tokens already transferred)

**Benefits:**
- Works with any ERC20 (even non-permit tokens)
- More gas-efficient than EIP-2612 (combined signature verification + transfer)
- One-time approval, unlimited permit signatures
- Industry standard (used by Uniswap, many aggregators)

**Implementation Detail:**
```solidity
// Rainbow Router constructs the struct in-contract (no parameter confusion risk)
IPermit2.PermitTransferFrom memory permitTransferFrom = IPermit2.PermitTransferFrom({
    permitted: IPermit2.TokenPermissions({
        token: tokenAddress,  // From function parameter
        amount: permitData.value
    }),
    nonce: permitData.nonce,
    deadline: permitData.deadline
});

IPermit2.SignatureTransferDetails memory transferDetails = IPermit2.SignatureTransferDetails({
    to: address(this),              // Rainbow Router receives tokens
    requestedAmount: permitData.value
});

// Signature verification + token transfer in one call
permit2.permitTransferFrom(permitTransferFrom, transferDetails, msg.sender, signature);
```

---

### 4. Legacy Approve Support

**Yes**, Rainbow Router fully supports traditional `approve()` + `transferFrom()` flow.

Users can:
1. Call `token.approve(rainbowRouter, amount)`
2. Call `fillQuoteTokenToToken()` or `fillQuoteTokenToEth()`

**No permit signature required.**

---

### Permit Comparison

| Feature | EIP-2612 | DAI-Style | Permit2 | Legacy Approve |
|---------|----------|-----------|---------|----------------|
| **Gasless** | ✅ | ✅ | ✅ | ❌ (requires tx) |
| **Token Support** | Modern ERC20s | DAI, older tokens | **ANY ERC20** | All |
| **Setup Required** | None | None | One-time approve | Per-swap approve |
| **Transfer Timing** | After permit | After permit | **During permit** | After approve |
| **Gas Efficiency** | Medium | Medium | **Highest** | Lowest |
| **Nonce Type** | Sequential | Sequential | **Bitmap** | N/A |

---

## Warrant System

The **warrant system** is Rainbow Router's backend authorization mechanism that ensures swap calldata is fresh, valid, and authorized.

### Purpose

- Prevent execution of stale/expired swap quotes
- Prevent parameter tampering (amounts, tokens, calldata)
- Prevent front-running with outdated prices
- Ensure backend has verified the swap route

### How It Works

```
1. User requests quote from backend
   ↓
2. Backend queries DEX aggregator (1inch, Odos, etc.)
   ↓
3. Backend generates swap calldata + warrant signature
   ↓
4. User submits transaction with warrant
   ↓
5. Rainbow Router verifies warrant before executing swap
```

### Warrant Structure

```solidity
struct Warrant {
    uint160 nonce;              // Replay protection
    uint48 validBefore;         // Unix timestamp (must execute before)
    uint48 validAfter;          // Unix timestamp (must execute after)
    address verifyingSigner;    // Must be whitelisted backend signer
    bytes signature;            // EIP-712 signature
}
```

### EIP-712 Signature

The warrant signature covers a **hash of transaction parameters** to prevent tampering:

**For Token→Token:**
```typescript
dataHash = keccak256(abi.encode(
    sellTokenAddress,
    buyTokenAddress,
    targetAddress,
    approvalTargetAddress,    // Included to prevent parameter tampering
    keccak256(swapCallData),  // Hash of aggregator calldata
    sellAmount,
    feeAmount
))
```

**For Token→ETH:**
```typescript
dataHash = keccak256(abi.encode(
    sellTokenAddress,
    targetAddress,
    approvalTargetAddress,    // Included to prevent parameter tampering
    keccak256(swapCallData),
    sellAmount,
    feePercentageBasisPoints
))
```

**For ETH→Token:**
```typescript
dataHash = keccak256(abi.encode(
    buyTokenAddress,
    targetAddress,
    keccak256(swapCallData),
    feeAmount
))
```

**Packed Validation Data:**
```solidity
packedValidationData = nonce | (validBefore << 160) | (validAfter << 208)
```

**EIP-712 Message:**
```typescript
{
    name: "Rainbow Router",
    version: "1.0",
    chainId: <network chain id>,
    verifyingContract: <rainbow router address>
}

{
    packedValidationData: uint256,
    dataHash: bytes32
}
```

### Validation Checks

```solidity
// 1. Timestamp validation
require(block.timestamp > validAfter, "CANOE: NOT_YET");
require(block.timestamp < validBefore, "CANOE: EXPIRED");

// 2. Signer validation
require(validSigners[verifyingSigner], "INVALID_SIGNER");

// 3. Signature validation (ECDSA + EIP-712)
address recoveredSigner = ECDSA.recover(digest, signature);
require(recoveredSigner == verifyingSigner, "CANOE: INVALID_SIGNATURE");
```

### Bypassing Warrants

Warrants can be **disabled per-transaction** by setting:
```solidity
warrant.verifyingSigner = address(0)
```

This requires `address(0)` to be added to `validSigners` whitelist by owner.

**Use cases:**
- Testing
- Emergency swaps
- Direct integrations without backend

---

## Backend Integration

The Rainbow Router is designed to work with a backend routing service that queries DEX aggregators and generates signed warrants.

### Architecture Flow

#### 1. Quote Phase

**Endpoint:** `POST /market/{router}/swap_quote`

**Request:**
```json
{
    "chain": "optimism",
    "fromToken": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",  // USDC
    "toToken": "0x4200000000000000000000000000000000000006",    // WETH
    "amount": "1000000",  // 1 USDC
    "slippage": 1000,     // 10%
    "useRainbow": true
}
```

**Backend Processing:**
1. Query DEX aggregator API (1inch, Odos, etc.)
2. Receive aggregator's calldata (targets aggregator contract)
3. **Transform calldata**: Wrap into Rainbow Router function call
4. Return quote + "coupon" (quote ID) for later execution

**Response:**
```json
{
    "quote": {
        "fromToken": "...",
        "toToken": "...",
        "fromAmount": "1000000",
        "toAmount": "328042",  // Estimated output
        "data": "0x...",       // Rainbow Router calldata
        "to": "0x80dC...",     // Rainbow Router address
        "value": "0"
    },
    "coupon": "quote_12345"
}
```

#### 2. Execution Phase

**Endpoint:** `POST /market/{router}/execute`

**Request:**
```json
{
    "coupon": "quote_12345"
}
```

**Backend Processing:**
1. Retrieve cached quote from coupon
2. Generate warrant signature (signs transaction parameters)
3. Determine if permit should be used (check token support)
4. Return complete transaction data

**Response:**
```json
{
    "trade": {
        "to": "0x80dCD2C737cAFE9f86559bBCed9938eFfB7f7D1A",
        "data": "0x...",  // Complete calldata with warrant
        "value": "0"
    },
    "warrant": {
        "nonce": 123,
        "validBefore": 1704067200,
        "validAfter": 1704063600,
        "verifyingSigner": "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
        "signature": "0x..."
    },
    "approvals": []  // Or permit data if needed
}
```

### Supported DEX Aggregators

**Optimism:**
- enso
- icecreamswap
- odos
- oneinch (1inch)
- paraswap
- kyberswap
- unizen
- okx
- zeroex (0x)
- openocean

**Base:**
- kyberswap
- icecreamswap
- openocean

**Worldchain:**
- icecreamswap
- enso

**BSC:**
- oneinch (1inch)
- odos
- kyberswap
- paraswap
- zeroex (0x)
- okx
- icecreamswap
- openocean

**Polygon:**
- (Aggregators configured in networkConfig.ts)

**Arbitrum:**
- (Aggregators configured in networkConfig.ts)

**Note:** Rainbow Router fully supports aggregators using transfer proxy patterns (see [Transfer Proxy Pattern Support](#resolved-transfer-proxy-pattern-support) for implementation details).

### Backend Responsibilities

1. **Query Aggregators**: Get best swap routes from multiple aggregators
2. **Transform Calldata**: Wrap aggregator calldata into Rainbow Router calls
3. **Generate Warrants**: Sign transaction parameters with backend private key
4. **Cache Quotes**: Store quotes between `/swap_quote` and `/execute` calls
5. **Determine Permit Usage**: Check if token supports permits vs legacy approve
6. **Calculate Fees**: Apply Rainbow Router fee structure
7. **Validate Slippage**: Ensure amounts meet user's slippage tolerance

### Backend Signer

**Address:** `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf`

This address must be added to the `validSigners` whitelist on each Rainbow Router deployment.

---

## Security Features

### 1. Reentrancy Protection

```solidity
modifier nonReentrant() {
    require(status != 2, "NON_REENTRANT");
    status = 2;
    _;
    status = 1;
}
```

All swap functions use `nonReentrant` modifier to prevent reentrancy attacks via:
- Malicious tokens (ERC20 with callbacks)
- Malicious aggregator contracts
- Malicious target contracts

### 2. Swap Target Whitelist

```solidity
mapping(address => bool) public swapTargets;

modifier onlyApprovedTarget(address target) {
    require(swapTargets[target], "TARGET_NOT_AUTH");
    _;
}
```

**Only whitelisted DEX aggregator contracts can be called.**

Owner must explicitly approve each aggregator:
```solidity
function updateSwapTargets(address target, bool isValid) external onlyOwner
```

This prevents:
- Calls to arbitrary contracts
- Rug pulls via malicious aggregators
- Unauthorized fee extraction

### 3. Valid Signer Whitelist

```solidity
mapping(address => bool) public validSigners;

modifier onlyApprovedSigner(address signer) {
    require(validSigners[signer], "INVALID_SIGNER");
    _;
}
```

**Only whitelisted signers can create valid warrants.**

Typically includes:
- Backend signer address (`0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf`)
- `address(0)` (to allow bypassing warrant validation)

### 4. Allowance Verification

After every swap, Rainbow Router verifies the aggregator consumed the full allowance:

```solidity
uint256 allowance = IERC20(sellTokenAddress).allowance(address(this), target);
require(allowance == 0, "ALLOWANCE_NOT_ZERO");
```

This prevents:
- Partial fills leaving allowance exposed
- Aggregator bugs that don't consume full amount
- Potential future exploits via leftover allowances

### 5. Balance Checks

**For Token Swaps:**
```solidity
uint256 initialBalance = IERC20(buyTokenAddress).balanceOf(address(this));
// ... execute swap ...
uint256 finalBalance = IERC20(buyTokenAddress).balanceOf(address(this));
require(initialBalance < finalBalance, "NO_TOKENS");
```

**For ETH Swaps:**
```solidity
require(ethDiff > 0, "NO_ETH_BACK");
```

Ensures tokens/ETH were actually received, preventing:
- Failed swaps from succeeding silently
- Aggregator bugs
- Slippage protection failures

### 6. Owner Access Control

All admin functions use OpenZeppelin's `Ownable`:

```solidity
function updateSwapTargets(address target, bool isValid) external onlyOwner
function updateValidSigner(address signer, bool isValid) external onlyOwner
function withdrawToken(address token, address to, uint256 amount) external onlyOwner
function withdrawEth(address payable to, uint256 amount) external onlyOwner
function transferOwnership(address newOwner) public override onlyOwner
```

**Ownership transfer validation:**
```solidity
require(newOwner != address(0), "NO_ZERO");
require(newOwner != owner(), "SAME_OWNER");
```

### 7. ETH Receive Protection

```solidity
receive() external payable {
    // Only allow ETH from owner or during swaps (status == 2)
    require(msg.sender == owner() || status == 2, "RAINBOW: ONLY_OWNER_OR_SWAP");
}
```

Prevents:
- Accidental ETH loss from users sending ETH directly
- Unauthorized ETH deposits
- Griefing attacks

Only allows ETH from:
- Owner (for testing/recovery)
- Aggregator contracts during swap execution (status == 2)

---

## Deployment Information

### Contract Addresses

**Optimism (Chain ID: 10)**
- Rainbow Router: `0xA90845CFc60488cCB917169EeDCF3577092Df29f`

**Base (Chain ID: 8453)**
- Rainbow Router: `0x816cd361284003e722dbcc3597ca6e3bdb4d46dd`

**Worldchain (Chain ID: 480)**
- Rainbow Router: `0x2b53aec27d45a0021c514cdfd6496f99a5e0be21`

**BSC (Chain ID: 56)**
- Rainbow Router: `0x31750d38d8d1f69af94407002b9322f5765d869a`

**Polygon (Chain ID: 137)**
- Rainbow Router: `0xA89A26c4d81A2cca4d0670F77f0FC88362b72248`

**Arbitrum (Chain ID: 42161)**
- Rainbow Router: `0xA89A26c4d81A2cca4d0670F77f0FC88362b72248`

### Permit2 Canonical Address

**All Networks:**
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`

This is the **universal Permit2 address** deployed on all major EVM chains.

### Backend Signer

**All Networks:**
- Backend Signer: `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf`

This address signs all warrants and must be whitelisted in `validSigners`.

### Solidity Version

- `0.8.27` (exact, not `^0.8.27`)

### EIP-712 Domain

```solidity
{
    name: "Rainbow Router",
    version: "1.0",
    chainId: <network specific>,
    verifyingContract: <rainbow router address>
}
```

---

## Limitations

### ✅ RESOLVED: Transfer Proxy Pattern Support

✅ **NOW SUPPORTED**: As of the latest implementation, Rainbow Router **fully supports** DEX aggregators that use a **transfer proxy pattern** (dual-contract architecture) where the approval target differs from the swap execution target.

**Security Enhancement:** Transfer proxy functionality requires valid warrant signatures - warrant bypass via `address(0)` is not allowed when `target != approvalTarget`. This ensures backend validation of the target/approvalTarget pairing.

#### What is the Transfer Proxy Pattern?

Some DEX aggregators separate their architecture into two contracts:
- **Router Contract**: Receives swap calldata and executes the swap logic
- **Approval Target Contract**: Separate contract that needs ERC20 token approval

**Example: OKX DEX Aggregator on Optimism**
- Router (swap target): `0xC44C6550a3B13116F6fD593e1ec963d5aE78C4C8`
- Approval Target: `0x68D6B739D2020067D1e2F713b999dA97E4d54812`

#### Implementation Solution

Rainbow Router now includes an `approvalTarget` parameter in all token swap functions:

**Updated function signatures:**
```solidity
function fillQuoteTokenToToken(
    address sellTokenAddress,
    address buyTokenAddress,
    address payable target,          // Router contract for execution
    address approvalTarget,          // Approval contract for token allowance
    bytes calldata swapCallData,
    uint256 sellAmount,
    uint256 feeAmount,
    CanoeHelper.Warrant calldata warrant
) external payable
```

**How it works:**
```solidity
// 1. Approve to approvalTarget (not target)
SafeERC20.safeIncreaseAllowance(
    IERC20(sellTokenAddress),
    approvalTarget,  // Separate approval target
    sellAmount
);

// 2. Call target for execution
(bool success, bytes memory res) = target.call{value: msg.value}(swapCallData);

// 3. Verify allowance consumed from approvalTarget
uint256 allowance = IERC20(sellTokenAddress).allowance(address(this), approvalTarget);
require(allowance == 0, "ALLOWANCE_NOT_ZERO");
```

#### Security Requirements

**1. Whitelisting:** Both addresses must be whitelisted:
```solidity
modifier onlyApprovedTarget(target)
modifier onlyApprovedTarget(approvalTarget)
```

**2. Warrant Validation:** When using transfer proxy pattern (different addresses), warrant validation **cannot be bypassed**:
```solidity
require(
    target == approvalTarget || warrant.verifyingSigner != address(0),
    "CANOE: WARRANT_REQUIRED_FOR_PROXY"
);
```

This ensures:
- Standard aggregators (`target == approvalTarget`): Can use warrant bypass for testing/direct integration
- Transfer proxy aggregators (`target != approvalTarget`): **Must use valid warrant signatures**
- Backend validates the target/approvalTarget pairing is correct
- Prevents accidental misuse of whitelisted-but-incompatible address pairs

**3. Parameter Integrity:** The warrant signature includes `approvalTarget` to prevent parameter tampering.

#### Usage for Different Aggregator Types

**For standard aggregators (single contract):**
```typescript
// Same address for both parameters - warrant bypass allowed
fillQuoteTokenToToken(
    sellToken,
    buyToken,
    aggregatorAddress,  // target
    aggregatorAddress,  // approvalTarget (same)
    swapCallData,
    sellAmount,
    feeAmount,
    warrant  // Can use ZeroAddress signer for bypass
)
```

**For transfer proxy aggregators (dual contract):**
```typescript
// Different addresses - MUST use valid warrant
fillQuoteTokenToToken(
    sellToken,
    buyToken,
    routerAddress,         // target (execution)
    approvalTargetAddress, // approvalTarget (approval) - DIFFERENT
    swapCallData,
    sellAmount,
    feeAmount,
    warrant  // MUST have real signature, cannot use ZeroAddress
)
```

#### Security Model & Risk Tradeoffs

**Dual Validation Approach:**

Rainbow Router employs two layers of validation for transfer proxy patterns:

1. **Warrant Signature Validation** (Cryptographic)
   - Warrant signature includes `approvalTarget` in the dataHash (line 336-340)
   - Backend cryptographically commits to the specific `(target, approvalTarget)` pairing
   - Users cannot substitute a different `approvalTarget` without invalidating the signature
   - Provides cryptographic guarantee of parameter integrity

2. **On-Chain Whitelist Validation** (Defense-in-Depth)
   - Both `target` and `approvalTarget` must be whitelisted via `onlyApprovedTarget` modifier
   - Technically redundant with warrant signature validation
   - Retained as operational safety net

**Why Keep Both?**

The warrant signature alone is sufficient to prevent malicious parameter substitution. However, the on-chain whitelist provides additional protection against:

- **Backend Software Bugs**: Non-malicious bugs in backend validation logic (typos, config errors, database corruption)
- **Operational Errors**: Admin configuration mistakes that result in warrants with incorrect addresses
- **Contract Upgrade Issues**: Backend referencing deprecated/old contract addresses after aggregator upgrades
- **Clear Security Invariant**: On-chain enforcement that "Rainbow Router will never approve arbitrary addresses"

**Cost-Benefit Analysis:**

| Aspect | With Dual Validation | Warrant-Only |
|--------|---------------------|--------------|
| **Gas Cost** | ~2,100 gas/tx (SLOAD) | Saves gas |
| **Admin Overhead** | Whitelist 2 addresses per aggregator | Whitelist 1 address |
| **Backend Bug Protection** | ✓ Caught on-chain before execution | ✗ Relies on backend correctness |
| **Malicious Parameter Protection** | ✓✓ Two layers | ✓ Warrant signature sufficient |
| **Attack Surface** | Smaller (on-chain validation) | Larger (trust backend software) |

**Threat Model Assumptions:**

The transfer proxy implementation assumes:
- Backend signing key is secure (compromise = total system failure regardless of whitelist)
- Backend software may have non-malicious bugs
- Admin may make operational mistakes
- Users/frontends may attempt parameter manipulation

**Attack Vector Analysis:**

With warrant validation + whitelist, the following attacks are mitigated:

1. **User Substitution Attack**: User provides malicious `approvalTarget`
   - Mitigation: Warrant signature validation fails (dataHash mismatch)

2. **Frontend Substitution Attack**: Compromised frontend swaps addresses
   - Mitigation: Warrant signature validation fails

3. **ZeroAddress Bypass Attack**: Attempt to use warrant bypass with arbitrary `approvalTarget`
   - Mitigation: `WARRANT_REQUIRED_FOR_PROXY` check (line 167-169)

4. **Backend Bug Attack**: Backend software generates warrant with incorrect address
   - Mitigation: On-chain whitelist validation fails
   - Note: Warrant signature is valid (backend signed it), but on-chain check catches error

**Comparison to Old Design:**

| Aspect | Old (Single Target) | New (Transfer Proxy) |
|--------|---------------------|---------------------|
| **Trust Surface** | 1 whitelisted contract | 2 whitelisted contracts + relationship |
| **Validation Layers** | Whitelist only | Whitelist + warrant signature |
| **Backend Complexity** | Signs `(target, calldata)` | Signs `(target, approvalTarget, calldata)` |
| **Attack Vectors** | User provides bad target | User provides bad target OR bad approvalTarget |
| **Protection** | Whitelist | Warrant signature + whitelist |
| **DEX Compatibility** | Standard routers only | Standard + transfer proxy routers |

**Recommended Operational Practices:**

1. **Pair Validation**: Backend should maintain database of known-good `(target, approvalTarget)` pairs
2. **Address Validation**: Backend should validate addresses with checksums and network checks
3. **Monitoring**: Log all warrant generations with both addresses for anomaly detection
4. **Testing**: Backend should have comprehensive unit tests for address pairing logic
5. **Gradual Rollout**: Test new aggregator integrations with small amounts first

**Residual Risks (Excluding Backend Key Compromise):**

- Backend software bug generates warrant with wrong address (caught by whitelist ✓)
- Admin whitelists wrong address + backend configured with same wrong address (operational error, low probability)
- Aggregator upgrades contract while backend still references old address (caught by backend version checks)

#### Test Verification

See `test/rainbow/testTransferProxy.ts` for comprehensive tests demonstrating transfer proxy pattern support:

```bash
npx hardhat test test/rainbow/testTransferProxy.ts
```

**Test coverage:**
- ✅ USDC → WETH swap via OKX transfer proxy
- ✅ WETH → USDC swap via OKX transfer proxy
- ✅ Warrant requirement enforcement (target != approvalTarget requires warrant)
- ✅ Valid warrant allows transfer proxy
- ✅ ZeroAddress warrant still works for standard pattern (target == approvalTarget)
- ✅ Approval validation
- ✅ Large amount handling
- ✅ Minimum amount handling
- ✅ Fee parameter respect
- ✅ Warrant timestamp boundaries
- ✅ Signer authorization

All 12 transfer proxy tests passing.

---

### What Rainbow Router CANNOT Do

1. **Execute swaps without valid warrants** (unless `address(0)` signer enabled)
   - All swaps require backend authorization
   - Stale warrants (expired validBefore) will revert

2. **Swap tokens not supported by whitelisted aggregators**
   - Depends entirely on aggregator capabilities
   - Exotic/new tokens may not have liquidity

3. **Modify swap routes or pricing**
   - Rainbow Router is a pass-through to aggregators
   - Cannot improve on aggregator's routing
   - Cannot split orders across multiple aggregators in one tx

4. **Refund failed swaps automatically**
   - If swap fails, user must retry
   - Balance checks prevent silent failures

5. **Guarantee best price**
   - Depends on backend's aggregator selection
   - No built-in aggregator comparison logic
   - Backend responsible for finding best route

6. **Execute cross-chain swaps**
   - Single-chain only
   - No bridge integration

7. **Handle rebasing tokens safely**
   - Balance checks may fail for tokens that rebase during tx
   - Not designed for fee-on-transfer tokens

8. **Process transactions after warrant expiration**
   - Warrants are time-sensitive (typically 5-10 minute window)
   - Users must execute quickly after receiving warrant

9. **Execute without whitelisted aggregators**
   - Owner must maintain aggregator whitelist
   - New aggregators require owner action

10. **Provide slippage protection beyond aggregator**
    - Slippage protection is aggregator's responsibility
    - Rainbow Router only validates tokens were received

### Edge Cases & Constraints

**Gas Costs:**
- Complex multi-hop swaps can be gas-intensive
- Permit signatures add ~50k gas vs pre-approved
- Warrant verification adds ~20k gas

**Token Compatibility:**
- Not tested with fee-on-transfer tokens
- Not tested with rebasing tokens (e.g., stETH, aTokens)
- Not compatible with non-standard ERC20s without `transfer` returns

**Timing:**
- Warrant expiration typically 5-10 minutes
- User must execute before validBefore timestamp
- Network congestion can cause warrant expiration

**MEV:**
- Vulnerable to sandwich attacks (like any DEX swap)
- Warrant system doesn't prevent MEV
- Slippage protection is user's responsibility

---

## Testing

### Test Coverage

The repository includes comprehensive test suites:

**Unit Tests:**
- `test/rainbow/admin.test.ts` - Admin function tests
- `test/rainbow/aggregators.test.ts` - DEX aggregator integration tests
- `test/rainbow/rainbow.test.ts` - Core functionality tests
- `test/rainbow/testSignature.ts` - Permit and warrant signature tests
- `test/rainbow/warrantsAccessControl.test.ts` - Access control tests
- `test/rainbow/testTransferProxy.ts` - Transfer proxy pattern demonstration

**Integration Tests:**
- `scripts/testRouters/testRouters.ts` - Universal router testing script (all chains)
- `scripts/testRouters/testAllChains.ts` - Sequential test runner for all deployed chains

### Multi-Chain Testing Infrastructure

The repository includes a comprehensive testing system for validating DEX aggregator integrations across all deployed chains.

#### Universal Router Testing Script

**`scripts/testRouters/testRouters.ts`** - Generic testing script that works across all networks:

```bash
# Test specific network
npx hardhat run scripts/testRouters/testRouters.ts --network op
npx hardhat run scripts/testRouters/testRouters.ts --network base
npx hardhat run scripts/testRouters/testRouters.ts --network bsc
```

**Features:**
- **Dynamic Configuration**: Pulls all network config from `networkConfig.ts`
- **4 Trade Phases**: Tests Native→USDC, Native→WETH, USDC→WETH, WETH→Native
- **Smart Skip Patterns**: Automatically skips expected limitations (rate limits, insufficient amounts, no routes)
- **Detailed Reporting**: Categorizes results by success, skipped, and failed with reasons
- **Timeout Protection**: 60-second timeout on all backend API calls to prevent hanging

**Skip Pattern Categories:**
- Global patterns (apply to all chains): rate limits, "no routes found"
- Network-specific patterns: known router limitations per chain

#### Automated Multi-Chain Testing

**`scripts/testRouters/testAllChains.ts`** - Orchestration script that tests all deployed chains sequentially:

```bash
# Test all chains with Rainbow Router deployments
npx hardhat run scripts/testRouters/testAllChains.ts
```

**Features:**
- **Auto-Discovery**: Automatically detects all chains with non-empty `rainbowRouterAddress` in `networkConfig.ts`
- **Sequential Execution**: Tests chains one at a time to avoid RPC rate limits
- **Timeout Protection**: 5-minute timeout per chain to prevent indefinite hanging
- **RPC Validation**: Skips chains with missing RPC URL configuration
- **Summary Reporting**: Displays pass/fail summary for all chains at completion

**Current Deployed Chains:**
- Optimism (10 routers)
- Base (3 routers)
- Worldchain (2 routers)
- BSC (8 routers)
- Polygon (TBD routers)
- Arbitrum (TBD routers)

**Timeout Safeguards:**
- Backend API calls: 60 second timeout (configured in `canoeHelper.ts`)
- Per-chain testing: 5 minute timeout (configured in `testAllChains.ts`)
- Prevents hanging on slow/unresponsive RPC endpoints or backend APIs

### Running Tests

```bash
# Unit tests
npm test

# Specific test file
npx hardhat test test/rainbow/testSignature.ts

# With gas reporting
REPORT_GAS=true npm test

# Integration tests - single chain
npx hardhat run scripts/testRouters/testRouters.ts --network op

# Integration tests - all deployed chains
npx hardhat run scripts/testRouters/testAllChains.ts
```

### Test Coverage Summary

- ✅ All 3 permit types (EIP-2612, DAI-style, Permit2)
- ✅ All 6 swap functions
- ✅ Warrant validation (expired, not yet valid, invalid signature)
- ✅ Warrant requirement for transfer proxy pattern
- ✅ Access control (targets, signers, ownership)
- ✅ Fee collection and withdrawal
- ✅ Reentrancy protection
- ✅ Balance and allowance verification
- ✅ Real aggregator integrations (1inch, Odos, Enso, etc.)
- ✅ Transfer proxy pattern (dual-contract architecture support)

**Total: 88+ passing tests** including 12 transfer proxy pattern tests

---

## Development

### Building

```bash
npm install
npx hardhat compile
```

### Deployment

```bash
npx hardhat run scripts/deploy.ts --network <network>
```

### Required Setup (Post-Deployment)

1. **Whitelist Aggregators:**
   ```typescript
   await rainbowRouter.updateSwapTargets(aggregatorAddress, true)
   ```

2. **Whitelist Backend Signer:**
   ```typescript
   await rainbowRouter.updateValidSigner("0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf", true)
   ```

3. **Optional: Enable Warrant Bypass:**
   ```typescript
   await rainbowRouter.updateValidSigner(ethers.ZeroAddress, true)
   ```

### Dependencies

- **Solidity:** 0.8.27
- **OpenZeppelin:** Contracts v5.x
- **Hardhat:** Development environment
- **Ethers.js:** v6

---

## Additional Resources

### Contract Interfaces

- `contracts/interfaces/IERC2612.sol` - EIP-2612 permit interface
- `contracts/interfaces/IDAI.sol` - DAI permit interface
- `contracts/interfaces/uniswapV3/IPermit2.sol` - Permit2 interface
- `contracts/interfaces/uniswapV3/ISwapRouter02.sol` - Uniswap V3 router

### Libraries

- `contracts/libraries/PermitHelper.sol` - Permit logic (all 3 types)
- `contracts/libraries/CanoeHelper.sol` - Warrant verification
- `contracts/libraries/SafeTransferLib.sol` - Safe ETH transfers

### Scripts

- `scripts/msc.ts` - Utility functions (permit signing, swap data generation)
- `scripts/canoeHelper.ts` - Warrant signing utilities
- `scripts/chainConfig.ts` - Chain-specific configurations

---

## FAQ

### Why use Rainbow Router instead of calling aggregators directly?

1. **Gasless approvals** - Permit signatures save one transaction
2. **Backend security** - Warrants prevent stale/malicious calldata
3. **Unified interface** - Same ABI across all aggregators
4. **Fee collection** - Built-in fee mechanism for integrators

### Which permit type should I use?

- **Permit2** - Best choice for most cases (works with any token, most gas-efficient)
- **EIP-2612** - If Permit2 not approved yet (still saves one transaction)
- **DAI-style** - Only for DAI token
- **Legacy approve** - Fallback if permit not supported

### Do I need to approve Permit2 for every swap?

**No.** Permit2 approval is **one-time per token**:
```solidity
token.approve(PERMIT2_ADDRESS, type(uint256).max)
```

After this, you can use Permit2 signatures unlimited times without further approvals.

### What happens if my warrant expires?

Transaction will revert with `CANOE: EXPIRED`. You must:
1. Request a new quote from backend
2. Receive a new warrant
3. Submit transaction again

Warrants typically valid for 5-10 minutes.

### Can I use Rainbow Router without the backend?

**Yes**, if you:
1. Have owner whitelist `address(0)` as valid signer
2. Pass a warrant with `verifyingSigner = address(0)`
3. Have the aggregator's swap calldata yourself

This bypasses warrant validation but you lose backend security benefits.

### Is Rainbow Router audited?

Audit status should be confirmed with the Rainbow team. The contracts use:
- OpenZeppelin's audited libraries (SafeERC20, ECDSA, EIP712, Ownable)
- Standard EIP-2612, DAI-style, and Permit2 implementations
- Industry-standard security patterns (reentrancy guards, access control)

---

## License

GPL-3.0

---

## Support

For questions or issues:
- GitHub: [rainbow/smart-contracts](https://github.com/rainbow-me/smart-contracts)
- Documentation: This file
- Tests: See `test/` directory for usage examples


## CRITICAL SECURITY RULES
- NEVER run grep, cat, or any command that could read .env files
- NEVER reference environment variable values in any context
- If you need env vars, ask user to provide them securely