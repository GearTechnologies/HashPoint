import { ethers } from "ethers";

export type ChainAddress = `0x${string}`;

export interface SupportedToken {
  label: string;
  address: ChainAddress;
  decimals: number;
  isNative?: boolean;
}

export const ZERO_ADDRESS = ethers.ZeroAddress as ChainAddress;

function stripWrappedQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

export function normalizeAddress(
  value: string | null | undefined,
  options: { allowZeroAddress?: boolean } = {}
): ChainAddress | null {
  const { allowZeroAddress = true } = options;
  const trimmed = stripWrappedQuotes((value ?? "").trim());
  if (!trimmed) {
    return null;
  }

  try {
    const normalized = ethers.getAddress(trimmed) as ChainAddress;
    if (!allowZeroAddress && normalized === ZERO_ADDRESS) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

export function requireAddress(
  value: string | null | undefined,
  name: string,
  options: { allowZeroAddress?: boolean } = {}
): ChainAddress {
  const normalized = normalizeAddress(value, options);
  if (!normalized) {
    throw new Error(`${name} is not configured with a valid address.`);
  }
  return normalized;
}

export function getSupportedTokens(): SupportedToken[] {
  const tokens: SupportedToken[] = [
    {
      label: "HSK",
      address: ZERO_ADDRESS,
      decimals: 18,
      isNative: true,
    },
  ];

  const usdcAddress = normalizeAddress(process.env.NEXT_PUBLIC_USDC_ADDRESS, {
    allowZeroAddress: false,
  });
  if (usdcAddress) {
    tokens.push({ label: "USDC", address: usdcAddress, decimals: 6 });
  }

  const usdtAddress = normalizeAddress(process.env.NEXT_PUBLIC_USDT_ADDRESS, {
    allowZeroAddress: false,
  });
  if (usdtAddress) {
    tokens.push({ label: "USDT", address: usdtAddress, decimals: 6 });
  }

  return tokens;
}

export function getTokenByAddress(address: string | null | undefined): SupportedToken {
  const normalized = normalizeAddress(address);
  if (!normalized || normalized === ZERO_ADDRESS) {
    return {
      label: "HSK",
      address: ZERO_ADDRESS,
      decimals: 18,
      isNative: true,
    };
  }

  const configuredToken = getSupportedTokens().find(
    (token) => token.address.toLowerCase() === normalized.toLowerCase()
  );
  if (configuredToken) {
    return configuredToken;
  }

  return {
    label: `${normalized.slice(0, 6)}...${normalized.slice(-4)}`,
    address: normalized,
    decimals: 18,
  };
}

function coerceAmount(value: bigint | string | number): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(Math.trunc(value));
  }
  return BigInt(value);
}

function trimFraction(formatted: string, maxFractionDigits: number): string {
  if (!formatted.includes(".")) {
    return formatted;
  }

  const [whole, fraction = ""] = formatted.split(".");
  const trimmedFraction = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

export function formatTokenAmount(
  value: bigint | string | number,
  tokenAddress: string | null | undefined
): string {
  const token = getTokenByAddress(tokenAddress);
  const amount = coerceAmount(value);
  const formatted = ethers.formatUnits(amount, token.decimals);
  return trimFraction(formatted, token.decimals === 18 ? 4 : 2);
}

export function parseTokenAmount(value: string, tokenAddress: string | null | undefined): bigint {
  const token = getTokenByAddress(tokenAddress);
  return ethers.parseUnits(value || "0", token.decimals);
}

export function getHistoryStartBlock(): bigint {
  const rawValue =
    process.env.NEXT_PUBLIC_INDEXER_FROM_BLOCK ??
    process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK ??
    "0";

  try {
    return BigInt(rawValue.trim() || "0");
  } catch {
    return 0n;
  }
}