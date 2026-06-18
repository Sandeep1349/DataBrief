import { useState, FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api/auth";

export default function ResetPassword() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState(searchParams.get("token") || "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token, newPassword);
      nav("/login", { state: { message: "Password reset! Please sign in with your new password." } });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reset failed. Token may be invalid or expired.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative page-bg-auth"
    >
      <div className="fixed inset-0 bg-grid opacity-40 pointer-events-none" />
      <div
        className="fixed rounded-full pointer-events-none animate-orb"
        style={{
          width: 600, height: 600, bottom: "-150px", right: "-150px",
          background: "radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 60%)",
        }}
      />

      <div className="relative z-10 w-full max-w-sm px-4 animate-slide-up">
        <div className="text-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-float"
            style={{
              background: "linear-gradient(135deg, #6366f1, #a855f7, #ec4899)",
              boxShadow: "0 0 40px rgba(168,85,247,0.48)",
            }}
          >
            <svg viewBox="0 0 20 20" fill="white" className="w-7 h-7">
              <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-gradient tracking-tight">DataBrief</h1>
          <p className="text-slate-500 text-sm mt-1">Set new password</p>
        </div>

        <div
          className="rounded-2xl p-8"
          style={{
            background: "var(--c-surface)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 25px 50px rgba(0,0,0,0.6)",
          }}
        >
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                Reset token
              </label>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="input-neon font-mono"
                required
                placeholder="Paste your reset token here"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                New password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input-neon"
                required
                minLength={8}
              />
              <p className="text-xs text-slate-600 mt-1.5">Minimum 8 characters</p>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                Confirm new password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-neon"
                required
              />
            </div>

            {error && (
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.2)" }}
              >
                <p className="text-rose-400 text-sm text-center">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full text-white font-bold py-3 rounded-xl transition-all disabled:opacity-40 flex items-center justify-center gap-2 btn-neon"
            >
              {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {loading ? "Resetting…" : "Reset password"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-slate-600 mt-6">
          <Link to="/login" className="text-cyan-500 hover:text-cyan-300 transition-colors">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
