import { sha256 } from "./jose.js";

const alphabet = "abcdefghijklmnopqrstuvwxyz234567";

function decodeBase32(value: string): Uint8Array {
  let bits = 0, buffer = 0;
  const bytes: number[] = [];
  for (const character of value.toLowerCase()) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("invalid base32 CID");
    buffer = (buffer << 5) | digit; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 0xff); }
  }
  return Uint8Array.from(bytes);
}

export async function verifySha256Cid(cid: string, bytes: Uint8Array): Promise<boolean> {
  if (!cid.startsWith("b")) return false;
  const decoded = decodeBase32(cid.slice(1));
  // CIDv1 + raw/dag-cbor codec varints, then sha2-256 multihash (0x12, 0x20).
  const marker = decoded.findIndex((value, index) => value === 0x12 && decoded[index + 1] === 0x20);
  if (marker < 1 || decoded.length !== marker + 34) return false;
  const expected = decoded.slice(marker + 2);
  const actual = await sha256(bytes);
  return expected.every((value, index) => value === actual[index]);
}
