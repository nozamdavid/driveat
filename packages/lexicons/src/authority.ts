import { createExperimentalNsids, type ExperimentalNsids } from "./nsids.js";

export type LexiconAuthorityPlan = Readonly<{
  baseAuthority: string;
  controlledDomain: string;
  dnsRecordName: string;
  dnsTxtValue: string;
  namespaceAuthority: string;
  namespaceDomain: string;
  publisherDid: string;
  recordKeys: readonly string[];
  nsids: ExperimentalNsids;
}>;

const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const didPattern = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/;

function reverseName(value: string): string {
  return value.split(".").reverse().join(".");
}

/** Converts a controlled DNS domain such as example.com to the NSID base com.example. */
export function nsidBaseForDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!domainPattern.test(normalized)) {
    throw new TypeError("Authority domain must be a normalized multi-label DNS name.");
  }
  return reverseName(normalized);
}

/**
 * Builds the DNS and repository publication plan for ATGallery's alpha Lexicons.
 * This does not claim ownership of the domain or mutate DNS/the publisher's repo.
 */
export function createLexiconAuthorityPlan(
  controlledDomain: string,
  publisherDid: string,
): LexiconAuthorityPlan {
  const normalizedDid = publisherDid.trim();
  if (!didPattern.test(normalizedDid)) {
    throw new TypeError("Lexicon publisher must be a valid DID.");
  }

  const baseAuthority = nsidBaseForDomain(controlledDomain);
  const namespaceAuthority = `${baseAuthority}.alpha`;
  const nsids = createExperimentalNsids(namespaceAuthority);
  const firstNsid = Object.values(nsids)[0];
  if (!firstNsid) throw new Error("ATGallery must declare at least one Lexicon.");

  const namespaceDomain = reverseName(namespaceAuthority);

  return {
    baseAuthority,
    controlledDomain: reverseName(baseAuthority),
    dnsRecordName: `_lexicon.${namespaceDomain}`,
    dnsTxtValue: `did=${normalizedDid}`,
    namespaceAuthority,
    namespaceDomain,
    publisherDid: normalizedDid,
    recordKeys: Object.values(nsids),
    nsids,
  };
}
