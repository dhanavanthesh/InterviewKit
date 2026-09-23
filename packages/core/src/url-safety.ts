import dns from "node:dns/promises";
import type { LookupFunction } from "node:net";

import ipaddr from "ipaddr.js";
import { Agent } from "undici";

import { PipelineError } from "./errors";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface HostResolver {
  resolve(hostname: string): Promise<ResolvedAddress[]>;
}

export interface UrlSafetyOptions {
  allowPrivateHosts: boolean;
  resolver?: HostResolver;
}

export interface ValidatedUrl {
  url: URL;
  addresses: ResolvedAddress[];
}

const systemResolver: HostResolver = {
  resolve: async (hostname) => {
    if (ipaddr.isValid(hostname)) {
      const parsed = ipaddr.parse(hostname);
      return [{ address: hostname, family: parsed.kind() === "ipv4" ? 4 : 6 }];
    }
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    return addresses.map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));
  },
};

function isBlockedAddress(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return true;
  }
  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    parsed = parsed.toIPv4Address();
  }
  const range = parsed.range();
  return new Set([
    "unspecified",
    "broadcast",
    "multicast",
    "linkLocal",
    "loopback",
    "private",
    "carrierGradeNat",
    "uniqueLocal",
    "reserved",
  ]).has(range);
}

// Returns the bare hostname of an HTTP(S) URL, or undefined when the value cannot be parsed.
export function safeHostname(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

export function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PipelineError("URL_INVALID", "The company URL is malformed.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PipelineError("URL_SCHEME_UNSUPPORTED", "Only HTTP and HTTPS URLs are supported.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new PipelineError(
      "URL_CREDENTIALS_FORBIDDEN",
      "URLs containing credentials are not allowed.",
    );
  }
  url.hash = "";
  return url;
}

export async function validateUrl(
  value: string | URL,
  options: UrlSafetyOptions,
): Promise<ValidatedUrl> {
  const url = parseHttpUrl(value.toString());
  let addresses: ResolvedAddress[];
  try {
    addresses = await (options.resolver ?? systemResolver).resolve(url.hostname);
  } catch {
    throw new PipelineError("DNS_FAILED", "The host could not be resolved.", { retryable: true });
  }
  if (addresses.length === 0) {
    throw new PipelineError("DNS_FAILED", "The host did not resolve to an address.", {
      retryable: true,
    });
  }
  if (!options.allowPrivateHosts && addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new PipelineError("URL_BLOCKED", "The URL resolves to a non-public network address.");
  }
  return { url, addresses };
}

export function createPinnedDispatcher(validated: ValidatedUrl): Agent {
  let cursor = 0;
  const lookup: LookupFunction = (_hostname, options, callback) => {
    const address = validated.addresses[cursor % validated.addresses.length]!;
    cursor += 1;
    if (typeof options === "object" && options.all === true) {
      callback(null, validated.addresses);
      return;
    }
    callback(null, address.address, address.family);
  };
  return new Agent({ connect: { lookup } });
}

export function isUrlInCompanyScope(candidate: URL, root: URL): boolean {
  if (candidate.protocol !== "http:" && candidate.protocol !== "https:") return false;
  if (candidate.hostname === root.hostname) {
    if (root.hostname === "localhost" || ipaddr.isValid(root.hostname)) {
      const prefix = root.pathname.endsWith("/") ? root.pathname : `${root.pathname}/`;
      return (
        candidate.port === root.port &&
        (root.pathname === "/" ||
          candidate.pathname === root.pathname ||
          candidate.pathname.startsWith(prefix))
      );
    }
    return true;
  }
  if (root.hostname === "localhost" || ipaddr.isValid(root.hostname)) return false;
  const rootParts = root.hostname.split(".");
  const candidateParts = candidate.hostname.split(".");
  return candidateParts.slice(-2).join(".") === rootParts.slice(-2).join(".");
}

export { isBlockedAddress };
