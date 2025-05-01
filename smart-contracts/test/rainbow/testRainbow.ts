import { RainbowRouter, RainbowRouter__factory } from "../../typechain-types"
import { ERC20, IERC20 } from "../../typechain-types/contracts/interfaces/openzeppelin"
import { network } from "hardhat"
import { AbiCoder, Interface, Signer, ZeroAddress } from "ethers"
import { ERC20__factory, IERC20__factory } from "../../typechain-types/factories/contracts/interfaces/openzeppelin"
import { generatePermitSignature, generateUniTxData, stealMoney } from "../../scripts/msc"
import { expect } from "chai"
import { Sign } from "crypto"
const { ethers } = require("hardhat")

describe("Test Rainbow Specific Functions", () => {

    const name = "Rainbow Router" // EIP-712 Domain Name
    const version = "1.0" // EIP-712 Domain Version
    const usdcNativeWhale = "0x133FA49A01801264fC05A12EF5ef9Db6a302e93D"
    let USDC: ERC20
    let WETH: IERC20

    let nonOwner: Signer
    let newTarget: string
    let owner: Signer
    let recipient: Signer
    let recipientAddress: string
    let Rainbow: RainbowRouter

    before(async () => {

        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.OP_URL!,
                    },
                },
            ],
        })



        const signers = await ethers.getSigners()
        owner = signers[0]
        nonOwner = signers[1]
        newTarget = await signers[2].getAddress()
        recipient = signers[3]
        recipientAddress = await recipient.getAddress()

        Rainbow = await new RainbowRouter__factory(owner).deploy(name, version)

        const usdcAddress = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" // Optimism USDC
        USDC = ERC20__factory.connect(usdcAddress, owner)
        WETH = IERC20__factory.connect("0x4200000000000000000000000000000000000006", owner) // Optimism WETH

    })

    it("Should allow owner to receive ETH", async () => {
        const rainbowAddress = await Rainbow.getAddress()
        const amountToSend = ethers.parseEther("0.1")
        const initialBalance = await ethers.provider.getBalance(rainbowAddress)

        const tx = await owner.sendTransaction({
            to: rainbowAddress,
            value: amountToSend
        })
        await tx.wait()

        const finalBalance = await ethers.provider.getBalance(rainbowAddress)
        expect(finalBalance).to.equal(initialBalance + amountToSend)
    })

    it("Should NOT allow non-owner to receive ETH directly", async () => {
        const rainbowAddress = await Rainbow.getAddress()
        const amountToSend = ethers.parseEther("0.1")

        await expect(nonOwner.sendTransaction({
            to: rainbowAddress,
            value: amountToSend
        })).to.be.revertedWith("NO_RECEIVE")
    })

    describe("updateSwapTargets", () => {

        it("Should allow owner to add a swap target", async () => {
            await expect(Rainbow.connect(owner).updateSwapTargets(newTarget, true))
                .to.emit(Rainbow, "SwapTargetAdded")
                .withArgs(newTarget)
            expect(await Rainbow.swapTargets(newTarget)).to.be.true
        })

        it("Should allow owner to remove a swap target", async () => {
            // Ensure target is added first for removal test
            await Rainbow.connect(owner).updateSwapTargets(newTarget, true)
            expect(await Rainbow.swapTargets(newTarget)).to.be.true // Verify it was added

            await expect(Rainbow.connect(owner).updateSwapTargets(newTarget, false))
                .to.emit(Rainbow, "SwapTargetRemoved")
                .withArgs(newTarget)
            expect(await Rainbow.swapTargets(newTarget)).to.be.false
        })

        it("Should prevent non-owner from updating swap targets", async () => {
            await expect(Rainbow.connect(nonOwner).updateSwapTargets(newTarget, true))
                .to.be.revertedWith("ONLY_OWNER")
        })
    })

    describe("updateValidSigner", () => {
        const newSigner = ethers.Wallet.createRandom().address

        it("Should allow owner to add a valid signer", async () => {
            await expect(Rainbow.connect(owner).updateValidSigner(newSigner, true))
                .to.emit(Rainbow, "ValidSignerAdded")
                .withArgs(newSigner)
            expect(await Rainbow.validSigners(newSigner)).to.be.true
        })

        it("Should allow owner to remove a valid signer", async () => {
            // Ensure signer is added first for removal test
            await Rainbow.connect(owner).updateValidSigner(newSigner, true)
            expect(await Rainbow.validSigners(newSigner)).to.be.true // Verify it was added

            await expect(Rainbow.connect(owner).updateValidSigner(newSigner, false))
                .to.emit(Rainbow, "ValidSignerRemoved")
                .withArgs(newSigner)
            expect(await Rainbow.validSigners(newSigner)).to.be.false
        })

        it("Should prevent non-owner from updating valid signers", async () => {
            await expect(Rainbow.connect(nonOwner).updateValidSigner(newSigner, true))
                .to.be.revertedWith("ONLY_OWNER")
        })
    })

    describe("withdrawToken", () => {
        const withdrawAmount = ethers.parseUnits("5", 6) // 5 USDC
        let rainbowAddress: string
        let usdcAddress: string

        beforeEach(async () => {
            usdcAddress = await USDC.getAddress()
            rainbowAddress = await Rainbow.getAddress()
            await stealMoney(usdcNativeWhale, rainbowAddress, usdcAddress, withdrawAmount * 2n)
        })

        it("Should allow owner to withdraw ERC20 tokens", async () => {
            const initialContractBalance = await USDC.balanceOf(rainbowAddress)
            const initialRecipientBalance = await USDC.balanceOf(recipientAddress)

            await expect(Rainbow.connect(owner).withdrawToken(usdcAddress, recipientAddress, withdrawAmount))
                .to.emit(Rainbow, "TokenWithdrawn")
                .withArgs(usdcAddress, recipientAddress, withdrawAmount)

            const finalContractBalance = await USDC.balanceOf(rainbowAddress)
            const finalRecipientBalance = await USDC.balanceOf(recipientAddress)

            expect(finalContractBalance).to.equal(initialContractBalance - withdrawAmount)
            expect(finalRecipientBalance).to.equal(initialRecipientBalance + withdrawAmount)
        })

        it("Should prevent withdrawing tokens to the zero address", async () => {
            await expect(Rainbow.connect(owner).withdrawToken(usdcAddress, ZeroAddress, withdrawAmount))
                .to.be.revertedWith("ZERO_ADDRESS")
        })

        it("Should prevent non-owner from withdrawing tokens", async () => {
            await expect(Rainbow.connect(nonOwner).withdrawToken(usdcAddress, recipientAddress, withdrawAmount))
                .to.be.revertedWith("ONLY_OWNER")
        })

        it("Should revert if withdrawing more tokens than balance (via SafeERC20)", async () => {
            const currentBalance = await USDC.balanceOf(rainbowAddress);
            const excessAmount = currentBalance + 1n // Calculate amount just over balance
            await expect(Rainbow.connect(owner).withdrawToken(usdcAddress, recipientAddress, excessAmount))
                .to.be.reverted // SafeERC20 reverts without specific message usually, or with "ERC20: transfer amount exceeds balance"
        })
    })

    describe("withdrawEth", () => {
        const withdrawAmount = ethers.parseEther("0.05")
        let rainbowAddress: string

        beforeEach(async () => {
            rainbowAddress = await Rainbow.getAddress()
            const fundTx = await owner.sendTransaction({ to: rainbowAddress, value: withdrawAmount * 2n })
            await fundTx.wait()
        })

        it("Should allow owner to withdraw ETH", async () => {
            const initialContractBalance = await ethers.provider.getBalance(rainbowAddress)
            const initialRecipientBalance = await ethers.provider.getBalance(recipientAddress)

            const tx = await Rainbow.connect(owner).withdrawEth(recipientAddress, withdrawAmount)
            const receipt = await tx.wait()
            const gasUsed = receipt!.gasUsed * receipt!.gasPrice // Calculate gas cost for accurate balance check if owner is recipient

            await expect(tx)
                .to.emit(Rainbow, "EthWithdrawn")
                .withArgs(recipientAddress, withdrawAmount)

            const finalContractBalance = await ethers.provider.getBalance(rainbowAddress)
            const finalRecipientBalance = await ethers.provider.getBalance(recipientAddress)

            expect(finalContractBalance).to.equal(initialContractBalance - withdrawAmount)
            // Recipient balance check needs to account for potential gas costs if recipient is the tx sender (owner)
            if (recipientAddress === await owner.getAddress()) {
                // This case is less common for withdrawal tests but handled for completeness
                expect(finalRecipientBalance).to.equal(initialRecipientBalance + withdrawAmount - gasUsed)
            } else {
                expect(finalRecipientBalance).to.equal(initialRecipientBalance + withdrawAmount)
            }
        })

        it("Should prevent withdrawing ETH to the zero address", async () => {
            await expect(Rainbow.connect(owner).withdrawEth(ZeroAddress, withdrawAmount))
                .to.be.revertedWith("ZERO_ADDRESS")
        })

        it("Should prevent non-owner from withdrawing ETH", async () => {
            await expect(Rainbow.connect(nonOwner).withdrawEth(recipientAddress, withdrawAmount))
                .to.be.revertedWith("ONLY_OWNER")
        })

        it("Should revert if withdrawing more ETH than balance", async () => {
            const currentBalance = await ethers.provider.getBalance(rainbowAddress);
            const excessAmount = currentBalance + ethers.parseEther("1") // Calculate amount clearly over balance
            await expect(Rainbow.connect(owner).withdrawEth(recipientAddress, excessAmount))
                .to.be.reverted // Reverts due to insufficient balance (no specific message needed usually)
        })
    })

    describe("transferOwnership", () => {
        let currentOwnerAddress: string
        let newOwnerAddress: string

        before(async () => {
            // Set the target new owner address once
            newOwnerAddress = await nonOwner.getAddress()
        })

        beforeEach(async () => {
            currentOwnerAddress = await owner.getAddress()
            // Ensure ownership is reset to the original 'owner' before each test in this block
            const currentContractOwner = await Rainbow.owner()
            if (currentContractOwner !== currentOwnerAddress) {
                // If the owner isn't the original one (e.g., from a prior test run), transfer it back.
                const tempOwnerSigner = await ethers.getSigner(currentContractOwner) // Get signer for the current contract owner
                await Rainbow.connect(tempOwnerSigner).transferOwnership(currentOwnerAddress)
            }
            expect(await Rainbow.owner()).to.equal(currentOwnerAddress) // Verify owner is reset correctly
        })

        it("Should allow current owner to transfer ownership", async () => {
            await expect(Rainbow.connect(owner).transferOwnership(newOwnerAddress))
                .to.emit(Rainbow, "OwnerChanged")
                .withArgs(newOwnerAddress, currentOwnerAddress)
            expect(await Rainbow.owner()).to.equal(newOwnerAddress)
        })

        it("Should prevent transferring ownership to the zero address", async () => {
            await expect(Rainbow.connect(owner).transferOwnership(ZeroAddress))
                .to.be.revertedWith("ZERO_ADDRESS")
        })

        it("Should prevent transferring ownership to the current owner", async () => {
            await expect(Rainbow.connect(owner).transferOwnership(currentOwnerAddress))
                .to.be.revertedWith("SAME_OWNER")
        })

        it("Should prevent non-owner from transferring ownership", async () => {
            await expect(Rainbow.connect(nonOwner).transferOwnership(recipientAddress)) // Attempt to transfer to recipient
                .to.be.revertedWith("ONLY_OWNER")
        })

        it("New owner should be able to call owner-only functions", async () => {
            await Rainbow.connect(owner).transferOwnership(newOwnerAddress) // Perform the ownership transfer
            expect(await Rainbow.owner()).to.equal(newOwnerAddress) // Confirm transfer

            // Test an owner-only function (updateValidSigner) using the new owner (nonOwner signer)
            const testSigner = ethers.Wallet.createRandom().address
            await expect(Rainbow.connect(nonOwner).updateValidSigner(testSigner, true))
                .to.not.be.reverted
            expect(await Rainbow.validSigners(testSigner)).to.be.true // Verify state change
        })

        it("Old owner should NOT be able to call owner-only functions", async () => {
            await Rainbow.connect(owner).transferOwnership(newOwnerAddress) // Perform the ownership transfer
            expect(await Rainbow.owner()).to.equal(newOwnerAddress) // Confirm transfer

            // Test an owner-only function using the old owner (owner signer)
            const testSigner = ethers.Wallet.createRandom().address
            await expect(Rainbow.connect(owner).updateValidSigner(testSigner, true))
                .to.be.revertedWith("ONLY_OWNER")
        })
    })
})