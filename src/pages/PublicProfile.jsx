import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { db } from "../config/firebase";
import { collection, query, where, getDocs, getDoc, doc } from "firebase/firestore";
import { EXPLORER_URL } from "../config/contract";
import { toast } from "react-hot-toast";

/**
 * Public, no-login "Verified Profile" page.
 * Anyone with the link (recruiter, employer, another student) can view
 * every ON-CHAIN VERIFIED (claimed) certificate a wallet holds — a
 * shareable, read-only portfolio. Reuses the exact same public Firestore
 * read pattern as Verify.jsx (open reads, no auth required).
 */
export default function PublicProfile() {
  const { walletAddress } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(null);
  const [certificates, setCertificates] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const normalized = walletAddress?.toLowerCase();
        if (!normalized || !/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
          setError("This isn't a valid wallet address.");
          setLoading(false);
          return;
        }

        // 1. Look up the user's profile (document ID = wallet address, same as the rest of the app)
        const userSnap = await getDoc(doc(db, "users", normalized));
        if (userSnap.exists()) {
          setProfile({ id: userSnap.id, ...userSnap.data() });
        }

        // 2. Look up every CLAIMED (on-chain verified) certificate for this wallet
        const certSnap = await getDocs(
          query(
            collection(db, "certificates"),
            where("studentWalletAddress", "==", normalized),
            where("claimed", "==", true)
          )
        );
        const certs = certSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCertificates(certs);

        if (!userSnap.exists() && certs.length === 0) {
          setError("No verified profile found for this wallet address.");
        }
      } catch (err) {
        console.error(err);
        setError("Failed to load this profile. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [walletAddress]);

  const shareUrl = `${window.location.origin}/u/${walletAddress}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    toast.success("Profile link copied!");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 bg-mesh pt-24 pb-12 flex flex-col items-center justify-center px-4">
        <div className="text-5xl mb-4">🔍</div>
        <h1 className="text-white text-xl font-bold font-display mb-2">Profile Not Found</h1>
        <p className="text-slate-400 text-sm text-center max-w-sm mb-6">{error}</p>
        <Link to="/verify" className="btn-secondary px-5 py-2.5 text-sm">
          Try the Verification Portal instead
        </Link>
      </div>
    );
  }

  const displayName = profile?.name || certificates[0]?.studentName || "Unnamed Student";
  const isAdmin = profile?.role === "admin";

  return (
    <div className="min-h-screen bg-slate-950 bg-mesh pt-20 pb-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">

        {/* Profile Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-6 sm:p-8 mb-8"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white shrink-0">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white font-display">{displayName}</h1>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  {isAdmin && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      Faculty
                    </span>
                  )}
                  {(profile?.department) && (
                    <span className="text-slate-400 text-xs">{profile.department}</span>
                  )}
                  {(profile?.college) && (
                    <span className="text-slate-500 text-xs">· {profile.college}</span>
                  )}
                </div>
                <p className="text-slate-500 font-mono text-[11px] mt-1.5">{walletAddress}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
              <button
                onClick={handleCopyLink}
                className="btn-secondary flex-1 sm:flex-none px-4 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                🔗 Copy Profile Link
              </button>
            </div>
          </div>
        </motion.div>

        {/* Stats + QR row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="glass-card p-5 sm:col-span-2 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-2xl">
              🛡️
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{certificates.length}</p>
              <p className="text-slate-400 text-xs">On-chain verified certificate{certificates.length === 1 ? "" : "s"}</p>
            </div>
          </div>
          <div className="glass-card p-4 flex flex-col items-center justify-center text-center">
            <div className="p-2 bg-white rounded-lg mb-2">
              <QRCodeSVG value={shareUrl} size={64} bgColor="#ffffff" fgColor="#000000" level="M" />
            </div>
            <p className="text-[10px] text-slate-500">Scan to view this profile</p>
          </div>
        </div>

        {/* Certificates Grid */}
        {certificates.length === 0 ? (
          <div className="glass-card p-10 text-center">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-slate-400 text-sm">
              This student hasn't claimed any on-chain verified certificates yet.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {certificates.map((cert, i) => (
              <motion.div
                key={cert.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card p-5 flex flex-col"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    ✅ Verified On-Chain
                  </span>
                  {cert.category && (
                    <span className="text-slate-500 text-[10px] capitalize">{cert.category}</span>
                  )}
                </div>
                <h3 className="text-white font-bold text-sm mb-1">{cert.title}</h3>
                <p className="text-slate-400 text-xs mb-3 line-clamp-2">
                  {cert.description || "No description provided."}
                </p>
                <div className="mt-auto pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-500">
                  <span>{cert.issuer || "SVKM IoT Dhule"}</span>
                  <span>{cert.issueDate}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <Link
                    to={`/verify/${cert.id}`}
                    className="flex-1 text-center btn-secondary py-2 text-[11px] font-semibold"
                  >
                    View Details
                  </Link>
                  {cert.transactionHash && (
                    <a
                      href={`${EXPLORER_URL}/tx/${cert.transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center btn-primary py-2 text-[11px] font-semibold"
                    >
                      🔗 BaseScan
                    </a>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Footer note */}
        <p className="text-center text-slate-600 text-[11px] mt-10">
          This is a public, read-only profile generated by Campus Achievement Wallet.
          Anyone with this link can view these verified credentials — no login required.
        </p>
      </div>
    </div>
  );
}