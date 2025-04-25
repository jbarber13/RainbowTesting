//SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.27;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

//testing
import "hardhat/console.sol";

library CanoeHelper {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct Warrant {
        uint160 nonce;
        uint48 validBefore;
        uint48 validAfter;
        address verifyingSigner;
        bytes signature;
    }

    function _packValidationData(
        uint160 nonce,
        uint48 validBefore,
        uint48 validAfter
    ) internal pure returns (uint256) {
        return
            uint160(nonce) |
            (uint256(validBefore) << 160) |
            (uint256(validAfter) << (160 + 48));
    }

    function verifyWarrant(
        bytes32 dataHash,
        Warrant memory warrant
    ) internal view {
        // if the verifyingSigner is 0, it means that the warrant system is disabled, and we will function like the rainbow router
        if (warrant.verifyingSigner == address(0)) {
            return;
        }

        console.log("Verify Warrant: ");
        console.log("nonce: ", warrant.nonce);
        console.log("validBefore: ", warrant.validBefore);
        console.log("validAfter: ", warrant.validAfter);
        console.log("verifyingSigner: ", warrant.verifyingSigner);
        console.log("signature: ");
        console.logBytes(warrant.signature);

        require(warrant.validBefore >= block.timestamp, "CANOE: EXPIRED");
        require(warrant.validAfter <= block.timestamp, "CANOE: NOT_YET");
        require(
            warrant.validAfter <= warrant.validBefore,
            "CANOE: INVALID TIMESTAMPS"
        );

        bytes32 dataToVerify = keccak256(
            abi.encode(
                _packValidationData(
                    warrant.nonce,
                    warrant.validBefore,
                    warrant.validAfter
                ),
                dataHash
            )
        );
        console.log("On-Chain dataToVerify:");
        console.logBytes32(dataToVerify);
        uint256 onChainPackedValue = _packValidationData(
            warrant.nonce,
            warrant.validBefore,
            warrant.validAfter
        );

        console.log("On-Chain packedValue (uint256):", onChainPackedValue); // Add if not present

        address recoveredSigner = ECDSA.recover(
            dataToVerify.toEthSignedMessageHash(),
            warrant.signature
        );

        require(
            recoveredSigner == warrant.verifyingSigner,
            "CANOE: INVALID_SIGNATURE"
        );
    }
}
