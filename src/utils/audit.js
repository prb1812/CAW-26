import { db } from "../config/firebase";
import { collection, addDoc } from "firebase/firestore";

/**
 * Append-only audit trail. Actions:
 * ASSIGNED | APPROVED | CLAIMED | REVOKED | BULK_ISSUED | VERIFIED
 */
export async function logAudit({ action, actor, certificateId = null, tokenId = null, fileHash = null, details = {} }) {
  try {
    await addDoc(collection(db, "auditLogs"), {
      action,
      actor: (actor || "anonymous").toLowerCase(),
      certificateId,
      tokenId: tokenId != null ? String(tokenId) : null,
      fileHash,
      details,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    // Never block the main action because logging failed.
    console.warn("Audit log write failed:", e);
  }
}
