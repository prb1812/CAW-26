import { ethers } from "ethers";
import { CONTRACT_ADDRESS, CONTRACT_ABI, CHAIN_ID } from "../config/contract";

export const RPC_URL = import.meta.env.VITE_RPC_URL || "https://sepolia.base.org";

export function assertDeployed() {
  if (!CONTRACT_ADDRESS || /^0x0+$/.test(CONTRACT_ADDRESS)) {
    throw new Error("Contract not deployed yet. Run: npm run deploy:baseSepolia");
  }
}

let _readProvider;
export function getReadContract() {
  assertDeployed();
  _readProvider ||= new ethers.JsonRpcProvider(RPC_URL);
  return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, _readProvider);
}

export function getWriteContract(signer) {
  assertDeployed();
  return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
}

/** Must match CampusAchievement.voucherDigest() exactly. */
export function voucherDigest(
  { to, fileHash, title, type, issuer, eventName },
  chainId = CHAIN_ID,
  contractAddress = CONTRACT_ADDRESS
) {
  const k = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "address", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
      [chainId, contractAddress, to, fileHash, k(title), k(type), k(issuer), k(eventName)]
    )
  );
}

export const MINTER_ROLE = ethers.id("MINTER_ROLE");

/**
 * Admin signs (no gas) to authorise one certificate to be claimed.
 * Refuses to sign if this wallet is NOT a minter on the deployed contract,
 * because such a voucher would always fail later with "Invalid issuer signature".
 */
export async function signVoucher(signer, fields) {
  assertDeployed();
  const who = await signer.getAddress();
  let isMinter = true;
  try {
    isMinter = await getReadContract().hasRole(MINTER_ROLE, who);
  } catch (e) {
    console.warn("Could not check MINTER_ROLE (RPC busy?) - continuing:", e);
  }
  if (!isMinter) {
    throw new Error(
      `Wallet ${who.slice(0, 6)}…${who.slice(-4)} does not hold MINTER_ROLE on the deployed contract. ` +
      "Redeploy with this wallet as deployer, or run `npm run add-minters`."
    );
  }
  return signer.signMessage(ethers.getBytes(voucherDigest(fields)));
}

/** Read-only on-chain check. Returns { status, tokenId, student }. */
export async function verifyHashOnChain(fileHash) {
  const c = getReadContract();
  const [valid, isRevoked, tokenId, student] = await c.verifyHash(fileHash);
  const status = valid ? "valid" : isRevoked ? "revoked" : "not_found";
  return { status, tokenId: tokenId.toString(), student };
}

export const isHexHash = (s) => /^0x[a-fA-F0-9]{64}$/.test((s || "").trim());
