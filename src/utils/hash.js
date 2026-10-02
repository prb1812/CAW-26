// SHA-256 helpers. The hash is the certificate's tamper-proof fingerprint:
// it is stored on-chain, and a verifier re-computes it from the document.
const toHex = (buf) =>
  "0x" + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Bytes(bytes) {
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

export async function sha256File(file) {
  return sha256Bytes(await file.arrayBuffer());
}

/** Decode a data: URL back to the exact bytes it stores. */
export function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(",")[1] || "";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Fingerprint for certificates that have no file (e.g. CSV bulk issuance).
 * Canonical (fixed key order) JSON so the same data always gives the same hash.
 */
export async function sha256Record(rec) {
  const canonical = JSON.stringify({
    student: String(rec.studentWalletAddress || "").toLowerCase(),
    title: rec.title || "",
    category: rec.category || "certificate",
    issuer: rec.issuer || "",
    eventName: rec.eventName || rec.title || "",
    issueDate: rec.issueDate || "",
  });
  return sha256Bytes(new TextEncoder().encode(canonical));
}
