import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { db } from "../../config/firebase";
import { collection, doc, setDoc } from "firebase/firestore";
import { parseCSV, CSV_TEMPLATE } from "../../utils/csv";
import { sha256File } from "../../utils/hash";
import { pinToIPFS } from "../../utils/ipfs";
import { getWriteContract, verifyHashOnChain } from "../../utils/certContract";
import { logAudit } from "../../utils/audit";

const CATEGORIES = ["certificate", "badge", "reward"];
const CHUNK = 25; // keeps each transaction comfortably under the block gas limit
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024; // /api/pin accepts 4 MB of base64 (~3 MB file)

const compactURI = (r, hash) =>
  "data:application/json;base64," +
  btoa(
    unescape(
      encodeURIComponent(
        JSON.stringify({
          name: r.title,
          issuer: r.issuer,
          event: r.eventName,
          image: r.fileUrl,
          attendance: r.attendanceStatus,
          sha256: hash,
          soulbound: true,
        })
      )
    )
  );

// Final description shown on the certificate / verify page
const buildDescription = (r) => {
  if (r.attendanceStatus !== "absent") return r.description;
  const base = `ABSENT at the event. Reason: ${r.absenceReason}.`;
  return r.description ? `${base} ${r.description}` : base;
};

// "01.png" and "01.jpg" both have the base name "01"
const baseName = (n) => n.toLowerCase().replace(/\.[^.]+$/, "");

export default function BulkIssueTab({ signer, adminAddress }) {
  const [csvRows, setCsvRows] = useState([]);
  const [images, setImages] = useState({}); // lowercase filename -> File
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);

  const today = new Date().toISOString().split("T")[0];

  // Exact file name first; otherwise match by name ignoring the extension
  const findImage = (name) => {
    const key = name.toLowerCase();
    if (images[key]) return { file: images[key] };
    const matches = Object.entries(images).filter(([n]) => baseName(n) === baseName(key)).map(([, f]) => f);
    if (matches.length === 1) return { file: matches[0] };
    if (matches.length > 1) return { ambiguous: true };
    return {};
  };

  // Re-validate whenever the CSV or the selected images change (selection order doesn't matter)
  const rows = useMemo(
    () =>
      csvRows.map((r) => {
        const row = { ...r };
        const found = row.certificateFile ? findImage(row.certificateFile) : {};
        row.file = found.file || null;
        if (!ethers.isAddress(row.wallet)) row.error = "Invalid wallet address";
        else if (!row.title) row.error = "Title is required";
        else if (!CATEGORIES.includes(row.category)) row.error = "Category must be certificate, badge or reward";
        else if (!row.certificateFile) row.error = "certificateFile column is empty";
        else if (found.ambiguous) row.error = `More than one image matches "${row.certificateFile}" - use the full file name`;
        else if (!row.file) row.error = `Image not selected: ${row.certificateFile}`;
        else if (row.file.size > MAX_IMAGE_BYTES) row.error = "Image is larger than 2.5 MB";
        else if (!["present", "absent"].includes(row.attendanceStatus)) row.error = "attendanceStatus must be present or absent";
        else if (row.attendanceStatus === "absent" && !row.absenceReason) row.error = "absenceReason is required when absent";
        return row;
      }),
    [csvRows, images]
  );

  const handleCsv = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setReport(null);
    const parsed = parseCSV(await f.text()).slice(0, 100).map((r, i) => ({
      n: i + 1,
      wallet: r.wallet || r.walletaddress || "",
      studentName: r.studentname || r.name || "",
      rollNumber: r.rollnumber || "",
      title: r.title || "",
      category: (r.category || "certificate").toLowerCase(),
      issuer: r.issuer || "SVKM IoT Dhule",
      eventName: r.eventname || r.title || "",
      issueDate: r.issuedate || today,
      description: r.description || "",
      certificateFile: r.certificatefile || "",
      attendanceStatus: (r.attendancestatus || "present").toLowerCase(),
      absenceReason: r.absencereason || "",
    }));
    if (!parsed.length) toast.error("No rows found. Check the CSV header and format.");
    setCsvRows(parsed);
  };

  const handleImages = async (e) => {
    setReport(null);
    const map = {};
    try {
      // Copy each file into memory now, so moving/renaming/editing it on disk later
      // cannot break the upload ("requested file could not be found").
      for (const f of Array.from(e.target.files || [])) {
        const buf = await f.arrayBuffer();
        map[f.name.toLowerCase()] = new File([buf], f.name, { type: f.type, lastModified: f.lastModified });
      }
    } catch {
      toast.error("Could not read an image file. Make sure the files are saved on this computer (not online-only in OneDrive) and select them again.");
      e.target.value = "";
      setImages({});
      return;
    }
    setImages(map);
  };

  const downloadTemplate = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: "text/csv" }));
    a.download = "bulk_certificates_template.csv";
    a.click();
  };

  const handleIssue = async () => {
    if (!signer) return toast.error("Connect your admin wallet first.");
    const valid = rows.filter((r) => !r.error);
    if (!valid.length) return toast.error("No valid rows to issue.");
    if (!window.confirm(`Issue ${valid.length} soulbound certificates on-chain? You pay the gas.`)) return;

    setBusy(true);
    const results = [];
    try {
      const contract = getWriteContract(signer);

      // 1. Hash each certificate IMAGE; skip duplicates and anything already on-chain
      const seen = new Set();
      const candidates = [];
      for (const r of valid) {
        const fileHash = await sha256File(r.file);
        if (seen.has(fileHash)) { results.push({ ...r, ok: false, msg: "Same image used twice in CSV" }); continue; }
        seen.add(fileHash);
        const chain = await verifyHashOnChain(fileHash);
        if (chain.status !== "not_found") {
          results.push({ ...r, ok: false, msg: chain.status === "revoked" ? "Previously revoked" : "Already issued" });
          continue;
        }
        candidates.push({ ...r, fileHash });
      }

      // 2. Upload each image to IPFS (only for rows that passed the checks)
      const toIssue = [];
      for (let i = 0; i < candidates.length; i++) {
        const r = candidates[i];
        toast.loading(`Uploading image ${i + 1} of ${candidates.length} to IPFS...`, { id: "bulk" });
        try {
          const pinned = await pinToIPFS(r.file, signer);
          toIssue.push({ ...r, fileUrl: pinned.url, ipfsCid: pinned.cid });
        } catch (err) {
          results.push({ ...r, ok: false, msg: `IPFS upload failed: ${err?.message || "unknown error"}` });
        }
      }

      // 3. One transaction per chunk of CHUNK certificates
      for (let i = 0; i < toIssue.length; i += CHUNK) {
        const chunk = toIssue.slice(i, i + CHUNK);
        toast.loading(`Issuing ${i + 1}-${i + chunk.length} of ${toIssue.length}...`, { id: "bulk" });
        try {
          const tx = await contract.batchMint(
            chunk.map((r) => ({
              to: r.wallet,
              tokenURI: compactURI(r, r.fileHash),
              title: r.title,
              achievementType: r.category,
              issuerName: r.issuer,
              eventName: r.title,
              fileHash: r.fileHash,
            }))
          );
          const receipt = await tx.wait();

          // map fileHash -> tokenId from events
          const ids = {};
          for (const log of receipt.logs) {
            try {
              const p = contract.interface.parseLog(log);
              if (p?.name === "CertificateHashRecorded") ids[p.args.fileHash] = p.args.tokenId.toString();
            } catch { /* other logs */ }
          }

          for (const r of chunk) {
            const ref = doc(collection(db, "certificates"));
            const tokenId = ids[r.fileHash] || null;
            await setDoc(ref, {
              certificateId: ref.id,
              title: r.title,
              description: buildDescription(r),
              attendanceStatus: r.attendanceStatus,
              absenceReason: r.attendanceStatus === "absent" ? r.absenceReason : "",
              category: r.category, type: r.category,
              issuer: r.issuer, issuerName: r.issuer,
              issueDate: r.issueDate,
              studentWalletAddress: r.wallet.toLowerCase(),
              studentName: r.studentName || "Student",
              rollNumber: r.rollNumber || "N/A",
              department: "", college: "SVKM IoT Dhule",
              certificateFileUrl: r.fileUrl,
              metadataUrl: r.fileUrl,
              fileMime: r.file.type,
              ipfsCid: r.ipfsCid,
              fileHash: r.fileHash, hashSource: "file",
              status: "claimed", claimed: true, bulkIssued: true,
              tokenId, transactionHash: tx.hash, claimedAt: new Date().toISOString(),
              verificationUrl: `${window.location.origin}/verify/${ref.id}`,
              assignedByAdminWallet: adminAddress.toLowerCase(),
              createdAt: new Date().toISOString(),
            });
            results.push({ ...r, ok: true, msg: `Token #${tokenId}` });
          }
          logAudit({
            action: "BULK_ISSUED", actor: adminAddress,
            details: { count: chunk.length, txHash: tx.hash },
          });
        } catch (err) {
          const msg = err?.shortMessage || err?.message || "Transaction failed";
          chunk.forEach((r) => results.push({ ...r, ok: false, msg }));
        }
      }
      toast.dismiss("bulk");
      const okCount = results.filter((r) => r.ok).length;
      okCount ? toast.success(`Issued ${okCount} certificates.`) : toast.error("No certificates were issued.");
    } catch (err) {
      toast.dismiss("bulk");
      toast.error(err?.message || "Bulk issuance failed");
    } finally {
      setReport(results);
      setBusy(false);
    }
  };

  const validCount = rows.filter((r) => !r.error).length;
  const fileInputCls =
    "block w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-600 file:text-white file:font-semibold";

  return (
    <motion.div className="glass-card p-6 border border-white/5" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <h2 className="font-bold text-white text-lg">Bulk Issuance (CSV + certificate images)</h2>
        <button onClick={downloadTemplate} className="btn-secondary px-4 py-2 text-xs font-semibold">
          ⬇ Download CSV template
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-5 leading-relaxed">
        Upload a CSV with columns{" "}
        <span className="font-mono">
          wallet, studentName, rollNumber, title, category, issuer, eventName, issueDate, description, certificateFile, attendanceStatus, absenceReason
        </span>
        . <span className="font-mono">certificateFile</span> is the image file name for that student (e.g. 01.png); select all
        images in step 2. <span className="font-mono">attendanceStatus</span> is present or absent; absent needs a reason.
        Images are stored on IPFS and each image's SHA-256 is recorded on-chain (soulbound, one transaction per {CHUNK}).
      </p>

      <div className="mb-4">
        <label className="block text-xs text-slate-400 mb-1">1. CSV file</label>
        <input type="file" accept=".csv,text/csv" onChange={handleCsv} disabled={busy} className={fileInputCls} />
      </div>
      <div className="mb-5">
        <label className="block text-xs text-slate-400 mb-1">
          2. Certificate images (select all together){Object.keys(images).length ? ` – ${Object.keys(images).length} selected` : ""}
        </label>
        <input type="file" accept="image/*,application/pdf" multiple onChange={handleImages} disabled={busy} className={fileInputCls} />
      </div>

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-white/5 mb-4 max-h-80">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-slate-400 sticky top-0">
                <tr>
                  <th className="p-2">#</th><th className="p-2">Wallet</th><th className="p-2">Student</th>
                  <th className="p-2">Title</th><th className="p-2">Image</th><th className="p-2">Attendance</th><th className="p-2">Check</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {rows.map((r) => (
                  <tr key={r.n}>
                    <td className="p-2">{r.n}</td>
                    <td className="p-2 font-mono">{r.wallet.slice(0, 8)}…{r.wallet.slice(-4)}</td>
                    <td className="p-2">{r.studentName}</td>
                    <td className="p-2 max-w-[200px] truncate">{r.title}</td>
                    <td className="p-2 max-w-[120px] truncate">{r.file ? `✓ ${r.file.name}` : `✕ ${r.certificateFile || "—"}`}</td>
                    <td className="p-2 capitalize">
                      {r.attendanceStatus === "absent"
                        ? <span className="text-amber-400" title={r.absenceReason}>Absent</span>
                        : "Present"}
                    </td>
                    <td className="p-2">{r.error ? <span className="text-red-400">✕ {r.error}</span> : <span className="text-emerald-400">✓ OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={handleIssue} disabled={busy || !validCount} className="btn-primary px-6 py-2.5 text-sm font-semibold">
            {busy ? "Issuing…" : `Issue ${validCount} certificate${validCount === 1 ? "" : "s"} on-chain`}
          </button>
        </>
      )}

      {report && (
        <div className="mt-6">
          <h3 className="font-semibold text-white text-sm mb-2">
            Result: {report.filter((r) => r.ok).length} issued · {report.filter((r) => !r.ok).length} skipped/failed
          </h3>
          <div className="overflow-x-auto rounded-xl border border-white/5 max-h-64">
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-white/5 text-slate-300">
                {report.map((r, i) => (
                  <tr key={i}>
                    <td className="p-2">{r.ok ? "🟢" : "🔴"}</td>
                    <td className="p-2 font-mono">{r.wallet.slice(0, 8)}…</td>
                    <td className="p-2">{r.title}</td>
                    <td className="p-2 text-slate-400">{r.msg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}