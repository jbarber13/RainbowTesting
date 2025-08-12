import { RainbowRouter, RainbowRouter__factory } from "../../typechain-types"
import { Signer } from "ethers"
const { ethers } = require("hardhat")

describe("Live Network EIP-712 Test", () => {
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
        // Use live Optimism network account
        const accounts = await ethers.getSigners()
        signer = accounts[0]
        
        console.log("📋 Using account:", await signer.getAddress())
        console.log("📋 Network:", (await ethers.provider.getNetwork()).name)
        console.log("📋 Chain ID:", (await ethers.provider.getNetwork()).chainId)
        
        Rainbow = RainbowRouter__factory.connect(realContractAddress, signer)
    })

    it("Test signature validation on live Optimism network", async () => {
        console.log("\n🔍 TESTING ON LIVE OPTIMISM NETWORK")
        console.log("=" .repeat(70))
        
        const network = await ethers.provider.getNetwork()
        console.log("📋 Network info:")
        console.log("  - Name:", network.name)
        console.log("  - Chain ID:", network.chainId)
        console.log("  - Block number:", await ethers.provider.getBlockNumber())
        
        // Get actual domain separator from live contract
        try {
            // Try different ways to get domain separator
            let contractDomainSeparator
            
            try {
                contractDomainSeparator = await Rainbow.DOMAIN_SEPARATOR()
                console.log("📋 Contract domain separator (method 1):", contractDomainSeparator)
            } catch (error) {
                console.log("⚠️  DOMAIN_SEPARATOR method not found, trying alternatives...")
                
                // Try to call the domain separator calculation manually
                const name = "Rainbow Router"
                const version = "1.0"
                const chainId = network.chainId
                
                const DOMAIN_TYPEHASH = ethers.keccak256(
                    ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
                )
                
                contractDomainSeparator = ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ["bytes32", "bytes32", "bytes32", "uint256", "address"],
                        [
                            DOMAIN_TYPEHASH,
                            ethers.keccak256(ethers.toUtf8Bytes(name)),
                            ethers.keccak256(ethers.toUtf8Bytes(version)),
                            chainId,
                            realContractAddress
                        ]
                    )
                )
                console.log("📋 Contract domain separator (calculated):", contractDomainSeparator)
            }
            
            console.log("📋 Expected domain separator:", viemDomainSeparator)
            console.log("📋 Domain separator match:", 
                contractDomainSeparator.toLowerCase() === viemDomainSeparator.toLowerCase())
            
            // Test signature recovery on live network
            console.log("\n🔍 TESTING SIGNATURE RECOVERY ON LIVE NETWORK")
            console.log("-" .repeat(50))
            
            const digest = ethers.keccak256(
                ethers.solidityPacked(
                    ["string", "bytes32", "bytes32"],
                    ["\x19\x01", contractDomainSeparator, viemStructHash]
                )
            )
            
            const signatureBytes = r + s.slice(2) + v.toString(16).padStart(2, '0')
            const recoveredSigner = ethers.recoverAddress(digest, signatureBytes)
            
            console.log("📋 Live network signature recovery:")
            console.log("  - Digest:", digest)
            console.log("  - Recovered signer:", recoveredSigner)
            console.log("  - Expected signer:", expectedSigner)
            console.log("  - Match:", recoveredSigner.toLowerCase() === expectedSigner.toLowerCase())
            
            if (recoveredSigner.toLowerCase() === expectedSigner.toLowerCase()) {
                console.log("🎯 SUCCESS: Live network signature validation works!")
            } else {
                console.log("❌ FAILURE: Even live network signature validation fails")
                console.log("🔍 This suggests the signature data itself may be incorrect")
            }
            
        } catch (error) {
            console.log("❌ Error testing on live network:", error)
        }
    })
})