import { ethers } from "ethers";

export const IPFS_GATEWAY = import.meta.env.VITE_IPFS_GATEWAY || "https://gateway.pinata.cloud/ipfs/";

const toBase64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsDataURL(file);
  });

// One signature per hour authenticates the admin to the pin API.
let cachedAuth = null;
async function getAuth(signer) {
  const bucket = Math.floor(Date.now() / 3600000);
  if (cachedAuth && cachedAuth.bucket === bucket) return cachedAuth;
  const address = await signer.getAddress();
  const message = `CAW pin auth ${bucket}`;
  const signature = await signer.signMessage(message);
  cachedAuth = { bucket, address, message, signature };
  return cachedAuth;
}

/**
 * Upload a file to IPFS through the /api/pin serverless function
 * (the Pinata key never reaches the browser).
 * Returns { cid, url } or throws.
 */
export async function pinToIPFS(file, signer) {
  const auth = await getAuth(signer);
  const resp = await fetch("/api/pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth: { address: auth.address, message: auth.message, signature: auth.signature },
      name: file.name,
      mime: file.type,
      data: await toBase64(file),
    }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.cid) throw new Error(json.error || `IPFS upload failed (${resp.status})`);
  return { cid: json.cid, url: `${IPFS_GATEWAY}${json.cid}` };
}

export { ethers };
