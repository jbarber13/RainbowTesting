// SIMPLIFIED WARRANT PACKING - Replace the 350+ line function with this:

export const packRainbowWarrant = async (
  account: PrivateKeyAccount,
  chainId: number,
  inputAmount: bigint,
  digest: ExtendedPriceQuote,
  functionName: string
) => {
  const swapCallDataFromApi = digest.candidateTrade!.data;
  const routerAddrFromApi = digest.candidateTrade!.to;

  // Calculate dataHash based on function type (this logic is correct)
  let dataHash: Hex;
  if (functionName === "fillQuoteTokenToToken" || functionName === "fillQuoteTokenToTokenWithPermit") {
    dataHash = keccak256(
      encodeAbiParameters(
        [
          { name: 'sellTokenAddress', type: 'address' },
          { name: 'buyTokenAddress', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'swapCallData', type: 'bytes' },
          { name: 'sellAmount', type: 'uint256' },
          { name: 'feeAmount', type: 'uint256' }
        ],
        [
          digest.inToken.address as Hex,
          digest.outToken.address as Hex,
          routerAddrFromApi as Hex,
          swapCallDataFromApi as Hex,
          inputAmount,
          BigInt(0)
        ]
      )
    );
  } else if (functionName === "fillQuoteTokenToEth" || functionName === "fillQuoteTokenToEthWithPermit") {
    dataHash = keccak256(
      encodeAbiParameters(
        [
          { name: 'sellTokenAddress', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'swapCallData', type: 'bytes' },
          { name: 'sellAmount', type: 'uint256' },
          { name: 'feePercentageBasisPoints', type: 'uint256' }
        ],
        [
          digest.inToken.address as Hex,
          routerAddrFromApi as Hex,
          swapCallDataFromApi as Hex,
          inputAmount,
          BigInt(0)
        ]
      )
    );
  } else if (functionName === "fillQuoteEthToToken") {
    dataHash = keccak256(
      encodeAbiParameters(
        [
          { name: 'buyTokenAddress', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'swapCallData', type: 'bytes' },
          { name: 'feeAmount', type: 'uint256' }
        ],
        [
          digest.outToken.address as Hex,
          routerAddrFromApi as Hex,
          swapCallDataFromApi as Hex,
          BigInt(0)
        ]
      )
    );
  } else {
    throw new Error(`Unsupported function name for warrant: ${functionName}`);
  }

  // Time validation
  const clientCurrentTimeSec = Math.floor(Date.now() / 1000);
  const warrantValidAfter = BigInt(clientCurrentTimeSec - 300); // 5 minutes ago
  const warrantValidBefore = BigInt(clientCurrentTimeSec + 3600); // 1 hour from now
  const warrantNonce: bigint = BigInt(Date.now());

  // Pack validation data (matches contract exactly)
  const packedValidationData = warrantNonce | (warrantValidBefore << BigInt(160)) | (warrantValidAfter << BigInt(208));

  // EIP-712 domain and types
  const domain = {
    name: rainbowName,
    version: rainbowVersion, 
    chainId: chainId,
    verifyingContract: RainbowAddress as Hex
  };

  const types = {
    CanoeWarrant: [
      { name: 'packedValidationData', type: 'uint256' },
      { name: 'dataHash', type: 'bytes32' },
    ],
  } as const;

  const message = {
    packedValidationData: packedValidationData,
    dataHash: dataHash,
  };

  // CRITICAL FIX: Use Viem's signTypedData directly - it handles EIP-712 correctly
  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: 'CanoeWarrant',
    message
  });

  console.log('✅ SIMPLIFIED WARRANT DEBUG:', {
    signerAddress: account.address,
    functionName,
    packedValidationData: packedValidationData.toString(),
    dataHash,
    signature,
    signatureLength: signature.length
  });

  // Test signature recovery to verify it works
  try {
    const recoveredSigner = await recoverTypedDataAddress({
      domain,
      types,
      primaryType: 'CanoeWarrant', 
      message,
      signature
    });
    
    console.log('🔍 SIGNATURE VERIFICATION:', {
      expectedSigner: account.address,
      recoveredSigner,
      match: recoveredSigner.toLowerCase() === account.address.toLowerCase()
    });
    
    if (recoveredSigner.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error('Signature verification failed - recovered wrong signer');
    }
  } catch (error) {
    console.error('🚨 SIGNATURE RECOVERY FAILED:', error);
    throw error;
  }

  const warrant: Warrant = {
    nonce: warrantNonce,
    validBefore: warrantValidBefore,
    validAfter: warrantValidAfter,
    verifyingSigner: account.address,
    signature,
  };

  return { warrant, warrantTypedData: { domain, types, primaryType: 'CanoeWarrant' as const, message } };
};