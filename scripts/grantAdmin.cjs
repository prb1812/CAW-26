const { ethers } = require("hardhat");
const fs = require("fs"), path = require("path");

async function main() {
  const cfg = fs.readFileSync(path.join(__dirname, "../src/config/contract.js"), "utf8");
  const address = cfg.match(/CONTRACT_ADDRESS = "([^"]+)"/)[1];
  const target = process.env.NEW_ADMIN;
  if (!ethers.isAddress(target || "")) throw new Error("Set NEW_ADMIN=0x...");

  const [me] = await ethers.getSigners();
  console.log("Using wallet from DEPLOYER_PRIVATE_KEY:", me.address);

  const c = await ethers.getContractAt("CampusAchievement", address);
  const ADMIN = await c.DEFAULT_ADMIN_ROLE();
  if (!(await c.hasRole(ADMIN, me.address)))
    throw new Error("This key is NOT an admin on the contract, so it cannot grant roles.");

  await (await c.grantRole(ADMIN, target)).wait();     // can revoke
  await (await c.addMinter(target)).wait();            // can sign vouchers / bulk mint
  console.log("Done. Roles granted to", target);
}
main().catch((e) => { console.error(e.message); process.exit(1); });