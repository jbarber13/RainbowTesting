import { RainbowRouter, RainbowRouter__factory } from "../../typechain-types"
import { ERC20, IERC20 } from "../../typechain-types/contracts/interfaces/openzeppelin"
import { network } from "hardhat"
import { Interface, Signer, ZeroAddress } from "ethers"
import { ERC20__factory, IERC20__factory } from "../../typechain-types/factories/contracts/interfaces/openzeppelin"
import {  generatePermitSignature, stealMoney } from "../../scripts/msc"
import { expect } from "chai"
import axios from "axios"
import { hardhat_mine_timed } from "../utils"
import { canoeParams, getCanoeQuote, MarketId } from "../../scripts/canoeHelper"
const { ethers } = require("hardhat")


describe("Test Canoe Quote", () => {
    let Rainbow: RainbowRouter
    const ownerAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"
    const wethAmount = ethers.parseEther("0.0001")
    const usdcAmount = ethers.parseUnits("0.01", 6)
    const usdcNativeWhale = "0xBA12222222228d8Ba445958a75a0704d566BF2C8" // Balancer Vault on Optimism

    const name = "Rainbow Router" // EIP-712 Domain Name
    const version = "1.0" // EIP-712 Domain Version

    let USDC: ERC20
    let WETH: IERC20
    let signer: Signer


    beforeEach(async () => {
        await hardhat_mine_timed(50, 5)
    })

    it("Setup", async function (this: any) {
        this.timeout(10000)

        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.OP_URL!,
                        blockNumber: 143608382, // Block where whale has 5795.57 USDC
                    },
                },
            ],
        })

        signer = (await ethers.getSigners())[0]

        const usdcAddress = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" // Optimism USDC
        USDC = ERC20__factory.connect(usdcAddress, signer)
        WETH = IERC20__factory.connect("0x4200000000000000000000000000000000000006", signer) // Optimism WETH
    })

    it("Deploy", async () => {
        Rainbow = await new RainbowRouter__factory(signer).deploy(name, version)


        let tx = await Rainbow.connect(signer).updateSwapTargets("0xE592427A0AEce92De3Edee1F18E0157C05861564", true) // Uniswap V3 Router
        await tx.wait()

        tx = await Rainbow.connect(signer).updateValidSigner(await signer.getAddress(), true)
        await tx.wait()
        tx = await Rainbow.connect(signer).updateValidSigner(ZeroAddress, true) // Allow warrants with ZeroAddress signer (no signature needed)
        await tx.wait()
    })

    it("Test warrant validation using EIP-712 with canoe quote via kyberswap", async function (this: any) {

        const feeAmount = 0n
        const sellTokenAddress = await USDC.getAddress()
        const buyTokenAddress = await WETH.getAddress()
        const rainbowAddress = await Rainbow.getAddress()
        const amountInFormat = ethers.formatUnits(usdcAmount, 6)
        const amountIn = usdcAmount

        //consruct warrant with canoe
        const params: canoeParams = {
            chain: "optimism",
            account: await Rainbow.getAddress(),
            isExactIn: true,
            inTokenAddress: sellTokenAddress,
            outTokenAddress: buyTokenAddress,
            inTokenAmount: amountInFormat,
            slippage: 1,
        }

        const response = await getCanoeQuote(MarketId.KYBERSWAP, params)

        const swapCallData = response?.txData
        const routerAddr = response?.recipient

        // Validate that we got a valid response from the API
        if (!routerAddr || routerAddr === ZeroAddress || !swapCallData || swapCallData === "0x") {
            console.log("Skipping test: Canoe API did not return valid swap data")
            this.skip()
        }

        //validate target
        await Rainbow.connect(signer).updateSwapTargets(routerAddr, true)

        // Use block timestamp instead of Date.now() since we're on a pinned fork
        const latestBlock = await ethers.provider.getBlock('latest')
        const time: number = latestBlock ? Number(latestBlock.timestamp) : Math.floor(Date.now() / 1000)
        const validBefore: number = time + 3600
        const validAfter: number = time - 300
        const nonce: bigint = 1n
        const verifyingSignerAddress: string = await signer.getAddress()

        const swapCallDataHash = ethers.keccak256(swapCallData)

        const dataHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'address', 'address', 'bytes32', 'uint256', 'uint256'],
                [sellTokenAddress, buyTokenAddress, routerAddr, swapCallDataHash, amountIn, feeAmount]
            )
        )
        const nonceBI = BigInt(nonce)
        const validBeforeBI = BigInt(validBefore)
        const validAfterBI = BigInt(validAfter)
        const packedValueBI = nonceBI | (validBeforeBI << 160n) | (validAfterBI << 208n)

        const domain = {
            name: name,
            version: version,
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: rainbowAddress
        }
        const types = {
            CanoeWarrant: [
                { name: 'packedValidationData', type: 'uint256' },
                { name: 'dataHash', type: 'bytes32' }
            ]
        }
        const value = {
            packedValidationData: packedValueBI,
            dataHash: dataHash
        }

        // Using signTypedData (adjust _signTypedData for ethers v5 if needed)
        const signature = await signer.signTypedData(domain, types, value)

        const warrant = {
            nonce: nonce,
            validBefore: validBefore,
            validAfter: validAfter,
            verifyingSigner: verifyingSignerAddress,
            signature: signature
        }

        const network = await ethers.provider.getNetwork()
        const permitData = await generatePermitSignature(
            signer, network.chainId, sellTokenAddress, amountIn, rainbowAddress
        )

        await stealMoney(usdcNativeWhale, await signer.getAddress(), sellTokenAddress, amountIn)

        const signerUsdcBalanceBefore = await USDC.balanceOf(await signer.getAddress())
        // Check recipient balance based on swapCallData recipient (rainbowAddress)
        const recipientWethBalanceBefore = await WETH.balanceOf(rainbowAddress)

        //perform the actual transaction
        await Rainbow.connect(signer).fillQuoteTokenToTokenWithPermit(
            sellTokenAddress,
            buyTokenAddress,
            routerAddr,
            swapCallData,
            amountIn,
            feeAmount,
            permitData,
            warrant
        )

        const signerUsdcBalanceAfter = await USDC.balanceOf(await signer.getAddress())
        const recipientWethBalanceAfter = await WETH.balanceOf(await signer.getAddress())

        expect(signerUsdcBalanceAfter).to.equal(signerUsdcBalanceBefore - amountIn, "Signer USDC balance did not decrease correctly")
        expect(recipientWethBalanceAfter).to.be.gt(recipientWethBalanceBefore, "Recipient WETH balance did not increase")



    })
    
})