import { RainbowRouter, RainbowRouter__factory } from "../../typechain-types"
import { network } from "hardhat"
import { Signer } from "ethers"
import { expect } from "chai"
const { ethers } = require("hardhat")

describe("Hardhat Fork Artifacts EIP-712 Test", () => {
    let Rainbow: RainbowRouter
    let signer: Signer

    const realContractAddress = "0x80dCD2C737cAFE9f86559bBCed9938eFfB7f7D1A"
    
    // Values from Viem backend
    const expectedSigner = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"
    const viemDomainSeparator = "0x4c6325c0acab1f77f02b85964c3320b22ada02895be4b55fa9f5157fa607e45c"
    const viemStructHash = "0x08da93d35ca427b903a269c9af3c561dec1ce52c76c9e4931ce39c3d94ae9e58"
    
    const message = {
        packedValidationData: "721980455690642277667728101835171479699320999466756708622599137117081049",
        dataHash: "0x2defd3ad8c3be3592c38237bd0a161a9c9de1481a3aeacbda3a868c2772b8aaa"
    }
    
    // Signature components from Viem
    const r = "0xe681176486bee1f3257c189735df61e2e50fb54385edf6981ab3ca055e2cddf8"
    const s = "0x25642eaf084041a3aa02f767f41649174b10e066e46745a55c812062e62c2c0a"
    const v = 28

    before(async () => {
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
        Rainbow = RainbowRouter__factory.connect(realContractAddress, signer)
    })

    it("Test abi.encodePacked vs ethers.solidityPacked encoding differences", async () => {
        console.log("\n🔍 TESTING HARDHAT FORK EIP-712 ARTIFACTS")
        console.log("=" .repeat(70))
        
        const chainId = (await ethers.provider.getNetwork()).chainId
        console.log("📋 Environment:")
        console.log("  - Chain ID:", chainId)
        console.log("  - Network:", network.name)
        console.log("  - Block number:", await ethers.provider.getBlockNumber())
        
        // Test the exact digest calculation methods
        console.log("\n🔍 TESTING DIGEST CALCULATION METHODS")
        console.log("-" .repeat(50))
        
        // Method 1: ethers.solidityPacked (what our test uses)
        const digest1 = ethers.keccak256(
            ethers.solidityPacked(
                ["string", "bytes32", "bytes32"],
                ["\x19\x01", viemDomainSeparator, viemStructHash]
            )
        )
        
        // Method 2: Manual hex concatenation (closer to abi.encodePacked)
        const digest2 = ethers.keccak256(
            "0x1901" + viemDomainSeparator.slice(2) + viemStructHash.slice(2)
        )
        
        // Method 3: ethers.concat with bytes
        const digest3 = ethers.keccak256(
            ethers.concat([
                "0x1901",
                viemDomainSeparator,
                viemStructHash
            ])
        )
        
        // Method 4: Exact bytes matching Solidity abi.encodePacked
        const prefix = "0x1901"  // "\x19\x01" as hex
        const digest4 = ethers.keccak256(
            ethers.concat([
                ethers.getBytes(prefix),
                ethers.getBytes(viemDomainSeparator),
                ethers.getBytes(viemStructHash)
            ])
        )
        
        console.log("📋 Digest calculation methods:")
        console.log("  1. ethers.solidityPacked:", digest1)
        console.log("  2. Manual hex concat:   ", digest2)
        console.log("  3. ethers.concat:       ", digest3)  
        console.log("  4. Exact bytes concat:  ", digest4)
        
        // Test signature recovery with each method
        const signatureBytes = r + s.slice(2) + v.toString(16).padStart(2, '0')
        
        console.log("\n📋 Testing signature recovery:")
        const methods = ["solidityPacked", "manual hex", "ethers.concat", "exact bytes"]
        const digests = [digest1, digest2, digest3, digest4]
        
        for (let i = 0; i < digests.length; i++) {
            try {
                const recoveredSigner = ethers.recoverAddress(digests[i], signatureBytes)
                const isMatch = recoveredSigner.toLowerCase() === expectedSigner.toLowerCase()
                console.log(`  ${i+1}. ${methods[i]}: ${recoveredSigner} ${isMatch ? '✅' : '❌'}`)
                
                if (isMatch) {
                    console.log(`     🎯 SUCCESS: Method ${i+1} (${methods[i]}) recovered correct signer!`)
                }
            } catch (error) {
                console.log(`  ${i+1}. ${methods[i]}: ❌ Error: ${error}`)
            }
        }
        
        // Test if fork environment affects signature validation
        console.log("\n🔍 TESTING FORK ENVIRONMENT EFFECTS")
        console.log("-" .repeat(50))
        
        // Check if we can access the actual contract storage
        try {
            const contractCode = await ethers.provider.getCode(realContractAddress)
            console.log("📋 Contract code length:", contractCode.length)
            console.log("📋 Is contract deployed:", contractCode !== "0x")
            
            // Try to call a view function to verify fork state
            const contractDomain = await Rainbow.DOMAIN_SEPARATOR()
            console.log("📋 Contract domain separator:", contractDomain)
            console.log("📋 Matches expected:", contractDomain.toLowerCase() === viemDomainSeparator.toLowerCase())
            
        } catch (error) {
            console.log("❌ Error accessing contract:", error)
        }
        
        console.log("\n📊 FORK ARTIFACT ANALYSIS:")
        console.log("=".repeat(50))
        console.log("🔍 All digest methods produce same result:", 
            digests.every(d => d === digests[0]))
        console.log("🔍 Fork block number > 100k:", 
            await ethers.provider.getBlockNumber() > 100000)
        console.log("🔍 ChainId correctly set to 10:", chainId == 10)
    })

    it("Test direct contract warrant validation call", async () => {
        console.log("\n🔍 TESTING DIRECT CONTRACT WARRANT VALIDATION")
        console.log("=" .repeat(70))
        
        // Create warrant structure that matches the exact signature
        const warrant = {
            nonce: BigInt("721980455690642277667728101835171479699320999466756708622599137117081049") & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"), // Extract nonce (160 bits)
            validBefore: Number((BigInt("721980455690642277667728101835171479699320999466756708622599137117081049") >> BigInt(160)) & BigInt("0xFFFFFFFFFFFF")), // Extract validBefore (48 bits)
            validAfter: Number((BigInt("721980455690642277667728101835171479699320999466756708622599137117081049") >> BigInt(208)) & BigInt("0xFFFFFFFFFFFF")), // Extract validAfter (48 bits)
            verifyingSigner: expectedSigner,
            signature: r + s.slice(2) + v.toString(16).padStart(2, '0')
        }
        
        console.log("📋 Unpacked warrant:")
        console.log("  - Nonce:", warrant.nonce.toString())
        console.log("  - Valid before:", warrant.validBefore)
        console.log("  - Valid after:", warrant.validAfter)
        console.log("  - Verifying signer:", warrant.verifyingSigner)
        console.log("  - Signature length:", warrant.signature.length)
        
        try {
            // This should call the exact same validation logic as the Solidity contract
            // But this will likely fail if there are fork artifacts
            console.log("📋 Attempting direct warrant validation...")
            
            // Note: We can't directly call verifyWarrant as it's internal
            // But we can test the components it would use
            const contractDomainSeparator = await Rainbow.DOMAIN_SEPARATOR()
            console.log("📋 Contract domain separator:", contractDomainSeparator)
            console.log("📋 Expected domain separator:", viemDomainSeparator)
            console.log("📋 Domain separator match:", 
                contractDomainSeparator.toLowerCase() === viemDomainSeparator.toLowerCase())
            
        } catch (error) {
            console.log("❌ Direct validation failed:", error)
            console.log("🔍 This suggests fork artifacts may be affecting validation")
        }
    })
})