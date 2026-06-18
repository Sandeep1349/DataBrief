import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "../api/auth";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await forgotPassword(email);
      setMessage(res.message);
      setResetToken(res.reset_token);
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
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
          width: 600, height: 600, top: "-150px", left: "-150px",
          background: "radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 62%)",
        }}
      />

      <div className="relative z-10 w-full max-w-sm px-4 animate-slide-up">
        <div className="text-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-float"
            style={{
              background: "linear-gradient(135deg, #6366f1, #a855f7, #ec4899)",
              boxShadow: "0 0 38px rgba(168,85,247,0.48)",
            }}
          >
            <svg viewBox="0 0 20 20" fill="white" className="w-7 h-7">
              <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-gradient tracking-tight">DataBrief</h1>
          <p className="text-slate-500 text-sm mt-1">Reset your password</p>
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
          {!submitted ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <p className="text-sm text-slate-500 leading-relaxed">
                Enter your account email and we'll generate a reset token for you.
              </p>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-neon"
                  required
                  autoFocus
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
                {loading ? "Generating token…" : "Get reset token"}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-400 text-center">{message}</p>
              {resetToken && (
                <div
                  className="rounded-xl p-4"
                  style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}
                >
                  <p className="text-xs font-bold text-amber-400 mb-2 uppercase tracking-wide">Reset token (valid 1 hour):</p>
                  <code
                    className="block text-xs break-all font-mono rounded-lg p-3 select-all cursor-text text-amber-300"
                    style={{ background: "rgba(245,158,11,0.08)" }}
                  >
                    {resetToken}
                  </code>
                  <p className="text-xs text-amber-500/70 mt-2">Copy this token, then set your new password below.</p>
                </div>
              )}
              <Link
                to={`/reset-password${resetToken ? `?token=${encodeURIComponent(resetToken)}` : ""}`}
                className="block w-full text-center text-white font-bold py-3 rounded-xl transition-all btn-neon"
              >
                Set new password →
              </Link>
            </div>
          )}
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
