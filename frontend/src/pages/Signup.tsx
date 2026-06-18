import { useState, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register } from "../api/auth";

function AuthOrbs() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      <div
        className="absolute rounded-full animate-orb"
        style={{
          width: 700, height: 700,
          top: "-250px", right: "-200px",
          background: "radial-gradient(circle, rgba(168,85,247,0.20) 0%, transparent 62%)",
        }}
      />
      <div
        className="absolute rounded-full animate-orb"
        style={{
          width: 600, height: 600,
          bottom: "-200px", left: "-150px",
          background: "radial-gradient(circle, rgba(251,146,60,0.14) 0%, transparent 62%)",
          animationDelay: "-6s",
        }}
      />
      <div className="absolute inset-0 bg-grid opacity-50" />
    </div>
  );
}

export default function Signup() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await register(username, email, password);
      nav("/login", { state: { message: "Account created! Please sign in." } });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative py-8 page-bg-auth"
    >
      <AuthOrbs />

      <div className="relative z-10 w-full max-w-sm px-4 animate-slide-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 animate-float"
            style={{
              background: "linear-gradient(135deg, #6366f1, #a855f7, #ec4899)",
              boxShadow: "0 0 42px rgba(168,85,247,0.5), 0 0 85px rgba(99,102,241,0.22)",
            }}
          >
            <svg viewBox="0 0 20 20" fill="white" className="w-7 h-7 neon-flicker">
              <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-gradient tracking-tight">DataBrief</h1>
          <p className="text-slate-500 text-sm mt-1">Create your account</p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            background: "var(--c-surface)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 25px 50px rgba(0,0,0,0.5), 0 0 60px rgba(139,92,246,0.09)",
          }}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-neon"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-neon"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-neon"
                required
                minLength={8}
              />
              <p className="text-xs text-slate-600 mt-1.5">Minimum 8 characters</p>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                Confirm Password
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
                style={{
                  background: "rgba(244,63,94,0.08)",
                  border: "1px solid rgba(244,63,94,0.2)",
                }}
              >
                <p className="text-rose-400 text-sm text-center font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full text-white font-bold py-3 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2 btn-neon"
            >
              {loading && (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {loading ? "Creating account…" : "Create Account"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-slate-600 mt-6">
          Already have an account?{" "}
          <Link to="/login" className="text-cyan-500 hover:text-cyan-300 font-semibold transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
