/**
 * Compute the SHA-256 hex digest of an ArrayBuffer using WebCrypto.
 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);
  const hex: string[] = [];
  for (const b of bytes) {
    hex.push(b.toString(16).padStart(2, "0"));
  }
  return hex.join("");
}
