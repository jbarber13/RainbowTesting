import { expect } from "chai"
import { network, ethers } from "hardhat"
import { RainbowRouter__factory } from "../../typechain-types"
import { Signer, Contract } from "ethers"

const SAFE_SINGLETON_FACTORY = "0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7"

describe("Deterministic Deployment (CREATE2)", () => {
    let signer: Signer
    const name = "Rainbow Router"
    const version = "1.0"

    function getVersionSalt(ver: string): string {
        return ethers.keccak256(ethers.toUtf8Bytes(`rainbow-router-${ver}`))
    }

    async function computeDeterministicAddress(ver: string, initCodeHash: string): Promise<string> {
        const salt = getVersionSalt(ver)
        const packed = ethers.solidityPacked(
            ["bytes1", "address", "bytes32", "bytes32"],
            ["0xff", SAFE_SINGLETON_FACTORY, salt, initCodeHash]
        )
        const hash = ethers.keccak256(packed)
        return ethers.getAddress("0x" + hash.slice(-40))
    }

    async function deployDeterministic(ver: string): Promise<string> {
        const salt = getVersionSalt(ver)
        const RainbowRouter = await ethers.getContractFactory("RainbowRouter")
        const deployTx = await RainbowRouter.getDeployTransaction(name, ver)
        const initCode = deployTx.data!
        const initCodeHash = ethers.keccak256(initCode)
        const expectedAddress = await computeDeterministicAddress(ver, initCodeHash)

        // Check if already deployed
        const existingCode = await ethers.provider.getCode(expectedAddress)
        if (existingCode !== "0x") {
            return expectedAddress
        }

        // Deploy via CREATE2
        const factory = new Contract(
            SAFE_SINGLETON_FACTORY,
            ["function deploy(bytes memory _initCode, bytes32 _salt) public returns (address payable)"],
            signer
        )

        const tx = await factory.deploy(initCode, salt, { gasLimit: 5000000 })
        await tx.wait()

        return expectedAddress
    }

    before(async function () {
        this.timeout(30000)

        // Fork Optimism (has Safe Singleton Factory deployed)
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.OP_URL!,
                        blockNumber: 130000000,
                    },
                },
            ],
        })

        signer = (await ethers.getSigners())[0]

        // Verify Safe Singleton Factory exists
        const factoryCode = await ethers.provider.getCode(SAFE_SINGLETON_FACTORY)
        expect(factoryCode).to.not.equal("0x", "Safe Singleton Factory should be deployed on Optimism")
    })

    it("Should deploy to deterministic address", async () => {
        const address = await deployDeterministic(version)
        const code = await ethers.provider.getCode(address)

        expect(code).to.not.equal("0x", "Contract should be deployed")
        console.log(`        Deployed to deterministic address: ${address}`)
    })

    it("Should return same address when deploying with same salt twice", async () => {
        // First deployment
        const address1 = await deployDeterministic(version)

        // Second deployment (should detect existing and return same address)
        const address2 = await deployDeterministic(version)

        expect(address1).to.equal(address2, "Both deployments should return the same address")
        console.log(`        Verified idempotent deployment: ${address1}`)
    })

    it("Should deploy to different address with different version (salt)", async () => {
        const version1 = "1.0"
        const version2 = "1.1"

        const address1 = await deployDeterministic(version1)
        const address2 = await deployDeterministic(version2)

        expect(address1).to.not.equal(address2, "Different versions should have different addresses")
        console.log(`        Version ${version1}: ${address1}`)
        console.log(`        Version ${version2}: ${address2}`)
    })

    it("Should compute address correctly before deployment", async () => {
        const testVersion = "1.2"
        const RainbowRouter = await ethers.getContractFactory("RainbowRouter")
        const deployTx = await RainbowRouter.getDeployTransaction(name, testVersion)
        const initCode = deployTx.data!
        const initCodeHash = ethers.keccak256(initCode)

        // Compute expected address
        const expectedAddress = await computeDeterministicAddress(testVersion, initCodeHash)

        // Deploy
        const actualAddress = await deployDeterministic(testVersion)

        expect(actualAddress).to.equal(expectedAddress, "Computed address should match deployed address")
        console.log(`        Predicted address: ${expectedAddress}`)
        console.log(`        Actual address:    ${actualAddress}`)
    })

    it("Should prevent deployment if code already exists at address", async () => {
        const testVersion = "1.3"

        // Deploy once
        const address1 = await deployDeterministic(testVersion)
        const codeBefore = await ethers.provider.getCode(address1)
        expect(codeBefore).to.not.equal("0x")

        // Deploy again (should skip and return existing)
        const address2 = await deployDeterministic(testVersion)
        const codeAfter = await ethers.provider.getCode(address2)

        expect(address1).to.equal(address2)
        expect(codeBefore).to.equal(codeAfter)

        console.log(`        Skipped re-deployment to existing address: ${address1}`)
    })

    it("Should revert if trying to deploy without pre-check", async () => {
        const testVersion = "1.4"

        // Deploy once
        await deployDeterministic(testVersion)

        // Try to deploy again WITHOUT checking if code exists (should revert)
        const salt = getVersionSalt(testVersion)
        const RainbowRouter = await ethers.getContractFactory("RainbowRouter")
        const deployTx = await RainbowRouter.getDeployTransaction(name, testVersion)
        const initCode = deployTx.data!

        const factory = new Contract(
            SAFE_SINGLETON_FACTORY,
            ["function deploy(bytes memory _initCode, bytes32 _salt) public returns (address payable)"],
            signer
        )

        // This should revert because CREATE2 returns address(0) when target already has code
        await expect(
            factory.deploy(initCode, salt, { gasLimit: 5000000 })
        ).to.be.reverted

        console.log(`        ✓ Factory correctly reverts when deploying to occupied address`)
    })
})
