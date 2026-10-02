import { Routes, Route, Navigate } from "react-router-dom";
import Navbar from "./components/Navbar";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Achievements from "./pages/Achievements";
import Verify from "./pages/Verify";
import PublicProfile from "./pages/PublicProfile";
import AdminPanel from "./pages/AdminPanel";
import CompleteProfile from "./pages/CompleteProfile";
import VerifierDashboard from "./pages/VerifierDashboard";
import ProtectedRoute from "./components/ProtectedRoute";

export default function App() {
  return (
    <>
      <Navbar />

      <Routes>
        {/* Public Route */}
        <Route path="/" element={<Landing />} />

        {/* Complete Profile Page */}
        <Route path="/complete-profile" element={<CompleteProfile />} />

        {/* Protected Routes */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allowedRoles={["student", "admin"]}>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/achievements"
          element={
            <ProtectedRoute allowedRoles={["student", "admin"]}>
              <Achievements />
            </ProtectedRoute>
          }
        />

        <Route
          path="/verifier"
          element={
            <ProtectedRoute allowedRoles={["verifier"]}>
              <VerifierDashboard />
            </ProtectedRoute>
          }
        />

        <Route path="/verify" element={<Verify />} />
        <Route path="/verify/:certificateId" element={<Verify />} />

        {/* NEW: Public, shareable Verified Profile page — no login required */}
        <Route path="/u/:walletAddress" element={<PublicProfile />} />

        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminPanel />
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Landing />} />
      </Routes>
    </>
  );
}