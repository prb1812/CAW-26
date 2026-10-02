// Grant MINTER_ROLE to extra admin wallets so they can sign claim vouchers.
// Usage: MINTERS=0xabc...,0xdef... npm run add-minters
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const cfg = fs.readFileSync(path.join(__dirname, "../src/config/contract.js"), "utf8");
  const address = cfg.match(/CONTRACT_ADDRESS = "([^"]+)"/)[1];
  const minters = (process.env.MINTERS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!minters.length) throw new Error("Set MINTERS=0x...,0x...");
  const c = await ethers.getContractAt("CampusAchievement", address);
  for (const m of minters) {
    const tx = await c.addMinter(m);
    await tx.wait();
    console.log("MINTER_ROLE granted to", m);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
