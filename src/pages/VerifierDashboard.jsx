import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { db } from "../config/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";

/** Employer / recruiter view: shortcuts + personal verification history. */
export default function VerifierDashboard() {
  const { user } = useAuth();
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!user?.walletAddress) return;
    const q = query(collection(db, "auditLogs"), where("actor", "==", user.walletAddress.toLowerCase()));
    const unsub = onSnapshot(
      q,
      (snap) =>
        setHistory(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((l) => l.action === "VERIFIED")
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        ),
      (err) => console.error("Verification history:", err)
    );
    return () => unsub();
  }, [user?.walletAddress]);

  const outcome = (l) => {
    const r = l.details?.result;
    if (r === "valid") return ["✅ Authentic", "text-emerald-400"];
    if (r === "revoked") return ["🚫 Revoked", "text-red-400"];
    if (r === "not_found") return ["❌ Not found", "text-red-400"];
    if (r === "offchain") return ["⚠️ Not on-chain", "text-amber-400"];
    return ["🔍 Looked up", "text-slate-300"];
  };

  return (
    <div className="min-h-screen bg-slate-950 bg-mesh pt-20 pb-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="font-display text-3xl font-bold text-white mb-1">
            Verifier <span className="gradient-text">Dashboard</span>
          </h1>
          <p className="text-slate-400 text-sm">
            {user?.name} · {user?.college}. Check candidate credentials and keep a record of what you verified.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          <Link to="/verify" className="glass-card p-5 hover:border-indigo-500/40 transition-all">
            <p className="text-2xl mb-2">📄</p>
            <p className="font-bold text-white text-sm">Verify a certificate</p>
            <p className="text-xs text-slate-400 mt-1">Upload the file, or enter a certificate ID, wallet or token.</p>
          </Link>
          <div className="glass-card p-5">
            <p className="text-2xl mb-2">🧾</p>
            <p className="font-bold text-white text-sm">{history.length} verifications</p>
            <p className="text-xs text-slate-400 mt-1">
              {history.filter((h) => h.details?.result === "valid").length} authentic ·{" "}
              {history.filter((h) => ["not_found", "revoked"].includes(h.details?.result)).length} rejected
            </p>
          </div>
        </div>

        <div className="glass-card p-6">
          <h2 className="font-bold text-white text-base mb-4">Verification history</h2>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">No verifications yet. Your checks will appear here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-400 uppercase tracking-wider border-b border-white/5">
                  <tr><th className="py-3 px-2">Time</th><th className="px-2">Method</th><th className="px-2">Document hash</th><th className="px-2">Result</th></tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-300">
                  {history.map((l) => {
                    const [label, color] = outcome(l);
                    return (
                      <tr key={l.id}>
                        <td className="py-3 px-2 whitespace-nowrap">{new Date(l.timestamp).toLocaleString()}</td>
                        <td className="px-2 capitalize">{l.details?.method || "lookup"}</td>
                        <td className="px-2 font-mono">{l.fileHash ? `${l.fileHash.slice(0, 10)}…${l.fileHash.slice(-4)}` : "—"}</td>
                        <td className={`px-2 font-semibold ${color}`}>{label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
