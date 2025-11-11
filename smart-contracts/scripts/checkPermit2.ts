import { ethers, network } from "hardhat";

async function main() {
    // Fork Optimism at the specified block
    await network.provider.request({
        method: "hardhat_reset",
        params: [{
            forking: {
                jsonRpcUrl: process.env.OP_URL,
                blockNumber: 143608382
            }
        }]
    });

    const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

    // Check if contract exists
    const code = await ethers.provider.getCode(PERMIT2_ADDRESS);
    console.log("Permit2 bytecode length:", code.length);
    console.log("Contract exists:", code !== "0x");

    if (code === "0x") {
        console.log("ERROR: Permit2 contract not deployed at this block!");
        return;
    }

    // Try to call the function
    const permit2Abi = [
        'function DOMAIN_SEPARATOR() view returns (bytes32)',
        'function nonce(address owner) view returns (uint256)',
        'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)'
    ];

    try {
        const permit2 = new ethers.Contract(PERMIT2_ADDRESS, permit2Abi, ethers.provider);

        // Try DOMAIN_SEPARATOR first
        const domainSep = await permit2.DOMAIN_SEPARATOR();
        console.log("DOMAIN_SEPARATOR:", domainSep);

        // Try the nonce function (for AllowanceTransfer)
        const testOwner = "0x0000000000000000000000000000000000000001";
        const nonce = await permit2.nonce(testOwner);
        console.log("Nonce for test address:", nonce.toString());

        console.log("\nSUCCESS: Permit2 contract is deployed and functional");
    } catch (error: any) {
        console.log("Error calling Permit2:", error.message);
    }
}

main().catch(console.error);
