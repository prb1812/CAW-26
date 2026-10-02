// Health check: run `npm run doctor` before starting the app or when a claim fails.
// It never prints secrets. Checks .env.local, the deployed contract and admin roles.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config({ path: path.join(__dirname, "../.env.local") });

const ok = (m) => console.log("  ✅", m);
const bad = (m, fix) => { problems++; console.log("  ❌", m); if (fix) console.log("     →", fix); };
const warn = (m) => console.log("  ⚠️ ", m);
let problems = 0;

(async () => {
  console.log("\n1) Firebase settings (.env.local)");
  for (const k of ["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "STORAGE_BUCKET", "MESSAGING_SENDER_ID", "APP_ID"]) {
    const v = process.env["VITE_FIREBASE_" + k];
    if (!v || /your_|_here/i.test(v)) bad(`VITE_FIREBASE_${k} is missing`, "copy it from Firebase Console → Project settings → Your apps");
    else ok(`VITE_FIREBASE_${k} set`);
  }

  console.log("\n2) Contract address (src/config/contract.js)");
  const cfg = fs.readFileSync(path.join(__dirname, "../src/config/contract.js"), "utf8");
  const address = (cfg.match(/CONTRACT_ADDRESS\s*=\s*"(0x[0-9a-fA-F]{40})"/) || [])[1];
  if (!address || /^0x0+$/.test(address)) {
    bad("Contract is not deployed yet (address is all zeros)", "run: npm run compile && npm run deploy:baseSepolia");
    return;
  }
  ok("address " + address);

  console.log("\n3) Blockchain connection");
  const rpc = process.env.DOCTOR_RPC || process.env.VITE_RPC_URL || process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: false });
  let net;
  try { net = await Promise.race([provider.getNetwork(), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 8000))]); }
  catch (e) { bad("Cannot reach the RPC " + rpc + " (" + e.message + ")", "check your internet / try another Base Sepolia RPC in .env.local"); return; }
  const expected = BigInt(process.env.DOCTOR_CHAIN_ID || 84532);
  if (net.chainId !== expected) bad(`RPC is chain ${net.chainId}, expected ${expected} (Base Sepolia)`);
  else ok("connected to Base Sepolia");

  const code = await provider.getCode(address);
  if (code === "0x") { bad("No contract exists at that address on this network", "redeploy: npm run deploy:baseSepolia"); return; }
  ok("contract code found on-chain");

  console.log("\n4) Roles (who may sign certificates)");
  const abi = ["function hasRole(bytes32,address) view returns (bool)", "function totalMinted() view returns (uint256)", "function DEFAULT_ADMIN_ROLE() view returns (bytes32)"];
  const c = new ethers.Contract(address, abi, provider);
  const MINTER = ethers.id("MINTER_ROLE");
  const auth = fs.readFileSync(path.join(__dirname, "../src/context/AuthContext.jsx"), "utf8");
  const seen = new Set();
  const siteAdmins = (auth.match(/"0x[0-9a-fA-F]{40}"/g) || []).map((s) => s.replace(/"/g, ""))
    .filter((a) => !/^0x0+$/.test(a) && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
  for (const a of siteAdmins) {
    (await c.hasRole(MINTER, a)) ? ok(`${a.slice(0, 8)}… can sign certificates (MINTER_ROLE)`)
      : warn(`${a.slice(0, 8)}… is an admin on the website but has NO MINTER_ROLE on the contract (its vouchers will fail)`);
  }
  if (!(await c.hasRole(MINTER, siteAdmins[0]))) bad("The main admin wallet is not a minter", "redeploy, or run: npm run add-minters");
  try { ok("certificates minted so far: " + (await c.totalMinted())); } catch {}

  console.log("\n5) Deployer wallet");
  if (!process.env.DEPLOYER_PRIVATE_KEY || /your_/.test(process.env.DEPLOYER_PRIVATE_KEY)) warn("DEPLOYER_PRIVATE_KEY not set (only needed to deploy, not to run the site)");
  else {
    try {
      const w = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY);
      const bal = await provider.getBalance(w.address);
      ok(`deployer ${w.address.slice(0, 8)}… holds ${ethers.formatEther(bal)} ETH`);
    } catch { bad("DEPLOYER_PRIVATE_KEY is not a valid private key"); }
  }
})().catch((e) => { bad("Unexpected error: " + e.message); }).finally(() => {
  console.log(problems ? `\n${problems} problem(s) found — fix the ❌ lines above.\n` : "\nAll checks passed. Run: npm run dev\n");
  process.exit(problems ? 1 : 0);
});
