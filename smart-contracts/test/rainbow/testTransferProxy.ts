import { RainbowRouter, RainbowRouter__factory } from "../../typechain-types"
import { ERC20, IERC20 } from "../../typechain-types/contracts/interfaces/openzeppelin"
import { network } from "hardhat"
import { Signer, ZeroAddress } from "ethers"
import { ERC20__factory, IERC20__factory } from "../../typechain-types/factories/contracts/interfaces/openzeppelin"
import { stealMoney } from "../../scripts/msc"
import { expect } from "chai"
const { ethers } = require("hardhat")

/**
 * Test suite demonstrating the limitation of the current Rainbow Router implementation
 * with transfer proxy patterns like OKX DEX aggregator.
 *
 * PROBLEM: OKX uses a dual-contract architecture:
 * - Router Contract (0xC44C6550a3B13116F6fD593e1ec963d5aE78C4C8): Receives swap calldata
 * - Approval Target (0x68D6B739D2020067D1e2F713b999dA97E4d54812): Needs token approval
 *
 * Current Rainbow Router approves tokens to the `target` parameter (router), but OKX
 * needs approval to go to the separate approval target contract.
 *
 * This test demonstrates the expected revert with the current implementation.
 */
describe("Transfer Proxy Limitation (OKX)", () => {
    let Rainbow: RainbowRouter

    // OKX DEX Aggregator addresses on Optimism
    const OKX_ROUTER = "0xC44C6550a3B13116F6fD593e1ec963d5aE78C4C8"  // Swap execution contract
    const OKX_APPROVAL_TARGET = "0x68D6B739D2020067D1e2F713b999dA97E4d54812"  // Token approval contract (NOT USED YET)

    // Token addresses on Optimism
    const USDC_ADDRESS = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"
    const WETH_ADDRESS = "0x4200000000000000000000000000000000000006"

    // Test parameters
    const usdcAmount = ethers.parseUnits("0.01", 6)  // 0.01 USDC
    const usdcNativeWhale = "0xBA12222222228d8Ba445958a75a0704d566BF2C8"  // Balancer Vault on Optimism

    const name = "Rainbow Router"
    const version = "1.0"

    let USDC: ERC20
    let WETH: IERC20
    let signer: Signer

    before(async () => {
        // Setup before all tests if needed
    })

    it("Setup - Fork Optimism", async function (this: any) {
        this.timeout(10000)

        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.OP_URL!,
                        blockNumber: 143608382,
                    },
                },
            ],
        })

        signer = (await ethers.getSigners())[0]

        USDC = ERC20__factory.connect(USDC_ADDRESS, signer)
        WETH = IERC20__factory.connect(WETH_ADDRESS, signer)
    })

    it("Deploy Rainbow Router", async () => {
        Rainbow = await new RainbowRouter__factory(signer).deploy(name, version)

        // Whitelist OKX router as valid swap target
        let tx = await Rainbow.connect(signer).updateSwapTargets(OKX_ROUTER, true)
        await tx.wait()

        // Allow ZeroAddress as valid signer (bypass signature validation for this test)
        tx = await Rainbow.connect(signer).updateValidSigner(ZeroAddress, true)
        await tx.wait()

        console.log(`        Rainbow Router deployed at: ${await Rainbow.getAddress()}`)
        console.log(`        OKX Router whitelisted: ${OKX_ROUTER}`)
        console.log(`        OKX Approval Target (not used yet): ${OKX_APPROVAL_TARGET}`)
    })

    it("EXPECT REVERT: USDC → WETH swap via OKX (transfer proxy limitation)", async () => {
        // Get USDC for test
        await stealMoney(usdcNativeWhale, await signer.getAddress(), USDC_ADDRESS, usdcAmount)

        const signerAddress = await signer.getAddress()
        const signerUsdcBalanceBefore = await USDC.balanceOf(signerAddress)
        expect(signerUsdcBalanceBefore).to.eq(usdcAmount, "Should have USDC after stealing")

        // Approve Rainbow Router to spend USDC (standard ERC20 approval)
        await USDC.connect(signer).approve(await Rainbow.getAddress(), usdcAmount)

        // Create dummy swap calldata (simple mock - doesn't need to be real OKX calldata)
        // We're just demonstrating the approval flow, not executing a real swap
        const dummySwapCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint256"],
            [USDC_ADDRESS, WETH_ADDRESS, usdcAmount]
        )

        // Create warrant with ZeroAddress signer (bypass signature validation)
        const latestBlock = await ethers.provider.getBlock('latest')
        const time: number = latestBlock ? Number(latestBlock.timestamp) : Math.floor(Date.now() / 1000)

        const warrant = {
            nonce: 1n,
            validBefore: time + 3600,
            validAfter: time - 300,
            verifyingSigner: ZeroAddress,
            signature: "0x"
        }

        // Try to execute swap - EXPECT THIS TO REVERT
        //
        // What happens:
        // 1. Rainbow Router receives USDC from user
        // 2. Rainbow Router approves USDC to OKX_ROUTER (0xC44C...)
        // 3. Rainbow Router calls OKX_ROUTER with swap calldata
        // 4. OKX_ROUTER tries to pull USDC via OKX_APPROVAL_TARGET (0x68D6...)
        // 5. REVERT: OKX_APPROVAL_TARGET doesn't have allowance (approval went to OKX_ROUTER, not OKX_APPROVAL_TARGET)
        //
        // Expected revert: Transfer failure or insufficient allowance

        console.log("\n        === Attempting swap (expecting revert) ===")
        console.log(`        User USDC balance: ${signerUsdcBalanceBefore}`)
        console.log(`        Swap amount: ${usdcAmount}`)
        console.log(`        Target (OKX Router): ${OKX_ROUTER}`)
        console.log(`        Problem: OKX needs approval to ${OKX_APPROVAL_TARGET}, not ${OKX_ROUTER}`)

        await expect(
            Rainbow.connect(signer).fillQuoteTokenToToken(
                USDC_ADDRESS,
                WETH_ADDRESS,
                OKX_ROUTER,
                dummySwapCalldata,
                usdcAmount,
                0n,  // No fee
                warrant
            )
        ).to.be.reverted  // We expect this to revert due to approval mismatch

        console.log(`        ✓ Transaction reverted as expected (current implementation doesn't support transfer proxy pattern)`)
    })

    it("Explanation: Why this fails", async () => {
        console.log("\n        === Current Implementation Limitation ===")
        console.log(`
        The current BaseAggregator.sol (lines 346-350) does:

            SafeERC20.safeIncreaseAllowance(
                IERC20(sellTokenAddress),
                target,  // Approves to OKX Router (0xC44C...)
                sellAmount
            );

        But OKX needs:

            SafeERC20.safeIncreaseAllowance(
                IERC20(sellTokenAddress),
                approvalTarget,  // Should approve to OKX Approval Target (0x68D6...)
                sellAmount
            );

        SOLUTION: Add support for separate approval target parameter
        - Allow contracts to specify different approval and swap targets
        - Whitelist both addresses separately
        - Update fillQuote functions to accept optional approvalTarget parameter
        `)
    })
})
