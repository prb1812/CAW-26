// Vercel serverless function: POST /api/pin
// Pins a file to IPFS via Pinata. Only allow-listed admin wallets may call it.
//
// Env (set in Vercel project settings, NOT prefixed with VITE_):
//   PINATA_JWT       - Pinata API JWT
//   ADMIN_WALLETS    - comma separated admin addresses
import { ethers } from "ethers";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(503).json({ error: "IPFS not configured (PINATA_JWT missing)" });

  try {
    const { auth, name, mime, data } = req.body || {};
    if (!auth || !data) return res.status(400).json({ error: "Missing fields" });

    // 1. Authenticate: signed message must be for the current hour (+/- 1)
    const bucket = Math.floor(Date.now() / 3600000);
    const okMsg = [bucket, bucket - 1].some((b) => auth.message === `CAW pin auth ${b}`);
    if (!okMsg) return res.status(401).json({ error: "Auth expired" });
    const signer = ethers.verifyMessage(auth.message, auth.signature).toLowerCase();
    const admins = (process.env.ADMIN_WALLETS || "").toLowerCase().split(",").map((s) => s.trim());
    if (signer !== String(auth.address).toLowerCase() || !admins.includes(signer)) {
      return res.status(403).json({ error: "Not an admin wallet" });
    }

    // 2. Pin
    const bytes = Buffer.from(data, "base64");
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime || "application/octet-stream" }), name || "certificate");
    form.append("network", "public");
    const pin = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });
    const out = await pin.json();
    const cid = out?.data?.cid;
    if (!pin.ok || !cid) return res.status(502).json({ error: "Pinata rejected upload" });
    return res.status(200).json({ cid });
  } catch (e) {
    return res.status(500).json({ error: "Pin failed" });
  }
}
