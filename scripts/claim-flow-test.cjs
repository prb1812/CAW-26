// Simulates the website's claim flow against a local in-memory chain.
// Run: npm run test:claim
const { ethers } = require("hardhat");
(async () => {
  const [admin, student, stranger] = await ethers.getSigners();
  const F = await ethers.getContractFactory("CampusAchievement", admin);
  const c = await F.deploy(admin.address); await c.waitForDeployment();
  const addr = await c.getAddress();
  const { chainId } = await ethers.provider.getNetwork();
  const k = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
  // identical to src/utils/certContract.js voucherDigest()
  const digest = (f) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256","address","address","bytes32","bytes32","bytes32","bytes32","bytes32"],
    [chainId, addr, f.to, f.fileHash, k(f.title), k(f.type), k(f.issuer), k(f.eventName)]));
  const fileHash = ethers.sha256(ethers.toUtf8Bytes("my certificate bytes"));
  const cert = { title: "Hackathon Winner ✨", category: "certificate", issuer: "SVKM IoT Dhule" };
  const sig = await admin.signMessage(ethers.getBytes(digest({
    to: student.address.toLowerCase(), fileHash, title: cert.title, type: cert.category, issuer: cert.issuer, eventName: cert.title })));
  // same shape as useMintNFT.buildChainURI()
  const uri = "data:application/json;base64," + Buffer.from(JSON.stringify({
    name: cert.title, issuer: cert.issuer, event: cert.title, sha256: fileHash, external_url: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", soulbound: true })).toString("base64");
  const args = [student.address, uri, cert.title, cert.category, cert.issuer, cert.title, fileHash, sig];

  let fails = 0;
  const check = (ok, msg) => { console.log(ok ? "PASS" : "FAIL", msg); if (!ok) fails++; };
  const expectRevert = async (p, frag, msg) => {
    try { await p; check(false, msg + " (did not revert)"); }
    catch (e) { const t = [e.revert?.args?.[0], e.reason, e.shortMessage, e.message].join(" "); check(t.includes(frag), msg); }
  };

  // The website's free pre-flight uses a READ provider + { from: student }
  const reader = c.connect(ethers.provider);
  await reader.getFunction("mintAchievement").staticCall(...args, { from: student.address });
  check(true, "pre-flight simulation passes for the right student");

  const redirected = [...args]; redirected[0] = stranger.address;
  await expectRevert(reader.getFunction("mintAchievement").staticCall(...redirected, { from: stranger.address }),
    "Invalid issuer signature", "a voucher cannot be redirected to another wallet");
  const badArgs = [...args]; badArgs[2] = "Tampered title";
  await expectRevert(reader.getFunction("mintAchievement").staticCall(...badArgs, { from: student.address }),
    "Invalid issuer signature", "pre-flight catches a voucher/field mismatch");

  const gas = await c.connect(student).mintAchievement.estimateGas(...args);
  check(gas < 900000n, `claim gas with compact URI = ${gas} (was ~4.6M with the SVG on-chain)`);
  const rc = await (await c.connect(student).mintAchievement(...args)).wait();
  const minted = rc.logs.map((l) => { try { return c.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "AchievementMinted");
  check(minted && minted.args.tokenId === 1n, "AchievementMinted event found with tokenId 1");
  const v = await c.verifyHash(fileHash);
  check(v[0] && !v[1] && v[2] === 1n && v[3] === student.address, "verifyHash valid after claim");
  await expectRevert(reader.getFunction("mintAchievement").staticCall(...args, { from: student.address }),
    "Already issued", "second claim is blocked");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
