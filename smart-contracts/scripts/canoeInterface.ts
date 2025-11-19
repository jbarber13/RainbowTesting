// interfaces.ts

export interface ExecutionRequest {
  coupon: Coupon;
  signingRequest?: SigningRequest;
  blockaidSim?: boolean;
  useOkuRouter?: boolean;
}

export interface Coupon {
  chainId: number;
  account: string; // 0x... address (Rainbow Router for routing)
  raw?: any;
}

export interface Token {
  address: string;
  decimals: number;
  symbol: string;
  chainId: number;
}

export interface SigningRequest {
  typedData?: TypedDataSignature[];
  permit2Address?: string;
}

export interface TypedDataSignature {
  payload: TypedData;
  signature?: string;
}

export interface TypedData {
  types: Record<string, any>;
  domain: Record<string, any>;
  message: Record<string, any>;
  primaryType: string;
}

// You'll also need an interface for the response data
export interface RainbowExecutionInfo {
  // Define the structure of the expected response from your API
  // Based on the schema, it's a union of ExecutionInformation and ExecutionInformationWithWarrant
  approvals?: any[]; // Define more specific types if needed
  transactions?: any[];
  trade?: any;
  analysis?: any;
  warrant?: any;
  warrantTypedData?: any;
  [key: string]: any;
}