import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { db } from "../../config/firebase";
import { collection, query, onSnapshot } from "firebase/firestore";

const COLORS = {
  ASSIGNED: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  APPROVED: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  CLAIMED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  BULK_ISSUED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  REVOKED: "bg-red-500/10 text-red-400 border-red-500/20",
  VERIFIED: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

export default function AuditLogTab() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState("ALL");

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "auditLogs")),
      (snap) =>
        setLogs(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 300)
        ),
      (err) => console.error("Audit log listener:", err)
    );
    return () => unsub();
  }, []);

  const shown = filter === "ALL" ? logs : logs.filter((l) => l.action === filter);
  const short = (s) => (s && s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s || "—");

  return (
    <motion.div className="glass-card p-6 border border-white/5" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <h2 className="font-bold text-white text-lg">Audit Log</h2>
        <select
          value={filter} onChange={(e) => setFilter(e.target.value)}
          className="bg-slate-900/60 border border-white/5 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none"
        >
          {["ALL", "ASSIGNED", "APPROVED", "CLAIMED", "BULK_ISSUED", "REVOKED", "VERIFIED"].map((a) => (
            <option key={a} value={a}>{a === "ALL" ? "All actions" : a}</option>
          ))}
        </select>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-10">No audit events yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-400 uppercase tracking-wider border-b border-white/5">
              <tr><th className="py-3 px-2">Time</th><th className="px-2">Action</th><th className="px-2">Actor</th><th className="px-2">Certificate</th><th className="px-2">Token</th><th className="px-2">Doc hash</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-300">
              {shown.map((l) => (
                <tr key={l.id} className="hover:bg-white/5">
                  <td className="py-3 px-2 whitespace-nowrap">{new Date(l.timestamp).toLocaleString()}</td>
                  <td className="px-2">
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${COLORS[l.action] || "bg-white/5 text-slate-300 border-white/10"}`}>{l.action}</span>
                  </td>
                  <td className="px-2 font-mono">{short(l.actor)}</td>
                  <td className="px-2 font-mono">{short(l.certificateId)}</td>
                  <td className="px-2">{l.tokenId ? `#${l.tokenId}` : "—"}</td>
                  <td className="px-2 font-mono" title={l.fileHash || ""}>{short(l.fileHash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
