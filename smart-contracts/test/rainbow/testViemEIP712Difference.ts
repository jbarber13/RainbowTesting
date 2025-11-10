import { RainbowRouter, RainbowRouter__factory } from "../../typechain-types"
import { network } from "hardhat"
import { Signer } from "ethers"
import { expect } from "chai"
const { ethers } = require("hardhat")

describe("Viem vs Hardhat EIP-712 Implementation Test", () => {
    let Rainbow: RainbowRouter
    let signer: Signer

    const name = "Rainbow Router"
    const version = "1.0"
    const realContractAddress = "0x80dCD2C737cAFE9f86559bBCed9938eFfB7f7D1A"
    
    // Latest values from Viem backend
    const expectedSigner = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"
    const viemDomainSeparator = "0x4c6325c0acab1f77f02b85964c3320b22ada02895be4b55fa9f5157fa607e45c"
    const viemTypeHash = "0xb520d9d521900af4955dc1d08f1951f7691106d2bdaa7e63bfad403300364d0d"
    const viemStructHash = "0x08da93d35ca427b903a269c9af3c561dec1ce52c76c9e4931ce39c3d94ae9e58"
    
    // Domain and message from Viem
    const domain = {
        name: "Rainbow Router",
        version: "1.0", 
        chainId: 10,
        verifyingContract: "0x80dCD2C737cAFE9f86559bBCed9938eFfB7f7D1A"
    }
    
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
        
        // Connect to the real deployed contract
        Rainbow = RainbowRouter__factory.connect(realContractAddress, signer)
    })

    it("Test EIP-712 implementation differences step by step", async () => {
        console.log("\n🔍 TESTING EIP-712 IMPLEMENTATION DIFFERENCES")
        console.log("=" .repeat(70))
        
        const chainId = (await ethers.provider.getNetwork()).chainId
        const contractAddress = await Rainbow.getAddress()
        
        console.log("📋 Environment:")
        console.log("  - Chain ID:", chainId)
        console.log("  - Chain ID type:", typeof chainId)
        console.log("  - Contract address:", contractAddress)
        console.log("  - Expected signer:", expectedSigner)
        console.log("  - Network name:", network.name)
        
        // Check if we're actually on a fork
        const blockNumber = await ethers.provider.getBlockNumber()
        console.log("  - Current block:", blockNumber)
        console.log("  - Is this likely a fork?", blockNumber > 100000) // Real Optimism has high block numbers
        
        // Step 1: Compare Domain Separator
        console.log("\n🔍 STEP 1: DOMAIN SEPARATOR COMPARISON")
        console.log("-" .repeat(50))
        
        const DOMAIN_TYPEHASH = ethers.keccak256(
            ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
        )
        
        const hardhatDomainSeparator = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "bytes32", "bytes32", "uint256", "address"],
                [
                    DOMAIN_TYPEHASH,
                    ethers.keccak256(ethers.toUtf8Bytes(name)),
                    ethers.keccak256(ethers.toUtf8Bytes(version)),
                    Number(chainId), // Ensure it's a regular number, not BigInt
                    contractAddress
                ]
            )
        )
        
        console.log("📋 Domain Separator:")
        console.log("  - Viem (expected):", viemDomainSeparator)
        console.log("  - Hardhat (calculated):", hardhatDomainSeparator)
        console.log("  - Match:", hardhatDomainSeparator.toLowerCase() === viemDomainSeparator.toLowerCase())
        console.log("  - DOMAIN_TYPEHASH:", DOMAIN_TYPEHASH)
        console.log("  - Name hash:", ethers.keccak256(ethers.toUtf8Bytes(name)))
        console.log("  - Version hash:", ethers.keccak256(ethers.toUtf8Bytes(version)))
        
        // Step 2: Compare Type Hash
        console.log("\n🔍 STEP 2: TYPE HASH COMPARISON") 
        console.log("-" .repeat(50))
        
        const TYPEHASH_CANOE_WARRANT = ethers.keccak256(
            ethers.toUtf8Bytes("CanoeWarrant(uint256 packedValidationData,bytes32 dataHash)")
        )
        
        console.log("📋 Type Hash:")
        console.log("  - Viem (expected):", viemTypeHash)
        console.log("  - Hardhat (calculated):", TYPEHASH_CANOE_WARRANT)
        console.log("  - Match:", TYPEHASH_CANOE_WARRANT.toLowerCase() === viemTypeHash.toLowerCase())
        console.log("  - Type string used: 'CanoeWarrant(uint256 packedValidationData,bytes32 dataHash)'")
        
        // Step 3: Compare Struct Hash
        console.log("\n🔍 STEP 3: STRUCT HASH COMPARISON")
        console.log("-" .repeat(50))
        
        const hardhatStructHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "uint256", "bytes32"],
                [TYPEHASH_CANOE_WARRANT, message.packedValidationData, message.dataHash]
            )
        )
        
        console.log("📋 Struct Hash:")
        console.log("  - Viem (expected):", viemStructHash)
        console.log("  - Hardhat (calculated):", hardhatStructHash)
        console.log("  - Match:", hardhatStructHash.toLowerCase() === viemStructHash.toLowerCase())
        console.log("  - Packed validation data:", message.packedValidationData)
        console.log("  - Data hash:", message.dataHash)
        
        // Step 4: Compare Final Digest
        console.log("\n🔍 STEP 4: FINAL DIGEST COMPARISON")
        console.log("-" .repeat(50))
        
        // Try both methods of digest calculation
        const hardhatDigest1 = ethers.keccak256(
            ethers.solidityPacked(
                ["string", "bytes32", "bytes32"],
                ["\x19\x01", hardhatDomainSeparator, hardhatStructHash]
            )
        )
        
        // Alternative method using concat
        const hardhatDigest2 = ethers.keccak256(
            ethers.concat([
                ethers.toUtf8Bytes("\x19\x01"),
                hardhatDomainSeparator,
                hardhatStructHash
            ])
        )
        
        // Alternative method using manual hex concat
        const hardhatDigest3 = ethers.keccak256(
            "0x1901" + hardhatDomainSeparator.slice(2) + hardhatStructHash.slice(2)
        )
        
        console.log("📋 Final Digest:")
        console.log("  - Method 1 (solidityPacked):", hardhatDigest1)
        console.log("  - Method 2 (concat):", hardhatDigest2)
        console.log("  - Method 3 (manual hex):", hardhatDigest3)
        console.log("  - EIP-712 prefix: \\x19\\x01")
        
        // Test signature recovery with each digest
        console.log("\n📋 Testing signature recovery with each digest:")
        
        // Step 5: Test Signature Recovery
        console.log("\n🔍 STEP 5: SIGNATURE RECOVERY TEST")
        console.log("-" .repeat(50))
        
        // Create signature bytes in the format ethers expects
        const signatureBytes = r + s.slice(2) + v.toString(16).padStart(2, '0')
        
        console.log("📋 Signature components:")
        console.log("  - v:", v)
        console.log("  - r:", r)
        console.log("  - s:", s)
        console.log("  - Signature bytes:", signatureBytes)
        
        const digests = [hardhatDigest1, hardhatDigest2, hardhatDigest3]
        const methods = ["solidityPacked", "concat", "manual hex"]
        
        for (let i = 0; i < digests.length; i++) {
            try {
                const recoveredSigner = ethers.recoverAddress(digests[i], signatureBytes)
                console.log(`  - Method ${i+1} (${methods[i]}):`)
                console.log(`    Digest: ${digests[i]}`)
                console.log(`    Recovered: ${recoveredSigner}`)
                console.log(`    Match: ${recoveredSigner.toLowerCase() === expectedSigner.toLowerCase()}`)
                
                if (recoveredSigner.toLowerCase() === expectedSigner.toLowerCase()) {
                    console.log(`    ✅ FOUND CORRECT METHOD: ${methods[i]}`)
                }
            } catch (error) {
                console.log(`  - Method ${i+1} (${methods[i]}): ❌ Failed - ${error}`)
            }
        }
        
        // Summary of all checks
        console.log("\n📊 SUMMARY OF DIFFERENCES:")
        console.log("=" .repeat(70))
        console.log("🔍 Domain separator match:", hardhatDomainSeparator.toLowerCase() === viemDomainSeparator.toLowerCase())
        console.log("🔍 Type hash match:", TYPEHASH_CANOE_WARRANT.toLowerCase() === viemTypeHash.toLowerCase())
        console.log("🔍 Struct hash match:", hardhatStructHash.toLowerCase() === viemStructHash.toLowerCase())
        
        // Detailed component analysis if there are mismatches
        if (hardhatDomainSeparator.toLowerCase() !== viemDomainSeparator.toLowerCase()) {
            console.log("\n❌ DOMAIN SEPARATOR MISMATCH:")
            console.log("This could be due to:")
            console.log("- Different chainId encoding")
            console.log("- Different address casing") 
            console.log("- Different string encoding")
        }
        
        if (TYPEHASH_CANOE_WARRANT.toLowerCase() !== viemTypeHash.toLowerCase()) {
            console.log("\n❌ TYPE HASH MISMATCH:")
            console.log("This could be due to:")
            console.log("- Different type string formatting")
            console.log("- Different parameter ordering") 
            console.log("- Different type names")
        }
        
        if (hardhatStructHash.toLowerCase() !== viemStructHash.toLowerCase()) {
            console.log("\n❌ STRUCT HASH MISMATCH:")
            console.log("This could be due to:")
            console.log("- Different parameter encoding")
            console.log("- Different uint256 handling")
            console.log("- Different bytes32 handling")
        }
    })
})