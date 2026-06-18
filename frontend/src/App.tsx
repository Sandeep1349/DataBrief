import { useState, useEffect, createContext, useContext } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { isAuthenticated, clearToken } from "./api/client";
import { listDatasets } from "./api/datasets";
import { ThemeProvider, useTheme } from "./ThemeContext";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import DatasetList from "./pages/DatasetList";
import Dashboard from "./pages/Dashboard";
import Chat from "./pages/Chat";
import Upload from "./pages/Upload";
import HomeDashboard from "./pages/HomeDashboard";
import ConnectDatasource from "./pages/ConnectDatasource";
import DataCleaner from "./pages/DataCleaner";
import type { Dataset } from "./types";

function getUsernameFromToken(): string {
  const token = localStorage.getItem("token");
  if (!token) return "";
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub || "";
  } catch {
    return "";
  }
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function IconDashboard() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
      <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
    </svg>
  );
}
function IconConnect() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
    </svg>
  );
}
function IconDatasets() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" />
      <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" />
      <path d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z" />
    </svg>
  );
}
function IconChat() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
    </svg>
  );
}
function IconUpload() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
    </svg>
  );
}
function IconChevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`w-3 h-3 transition-transform duration-300 ${open ? "rotate-90" : ""}`}>
      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
    </svg>
  );
}
function IconSignOut() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

// ─── Theme toggle icons ───────────────────────────────────────────────────────
function IconMoon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}
function IconSun() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ─── Sidebar context ──────────────────────────────────────────────────────────
const SidebarCtx = createContext(false);

// ─── NavSection ───────────────────────────────────────────────────────────────
function NavSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const expanded = useContext(SidebarCtx);
  const [open, setOpen] = useState(defaultOpen);

  if (!expanded) return <div className="space-y-0.5 py-1">{children}</div>;

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left rounded-lg transition-all group"
        style={{ color: "var(--sb-section)" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--sb-hover-bg)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <span className="flex-1 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors">
          {title}
        </span>
        <IconChevron open={open} />
      </button>
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ maxHeight: open ? "600px" : "0px", opacity: open ? 1 : 0 }}
      >
        <div className="pt-0.5 pb-2 space-y-0.5">{children}</div>
      </div>
    </div>
  );
}

// ─── NavItem ──────────────────────────────────────────────────────────────────
function NavItem({
  to, icon, label, badge, end = false,
}: {
  to: string; icon: React.ReactNode; label: string; badge?: string; end?: boolean;
}) {
  const expanded = useContext(SidebarCtx);
  const location = useLocation();
  const active = end
    ? location.pathname === to
    : location.pathname === to || (to !== "/" && location.pathname.startsWith(to));

  return (
    <Link
      to={to}
      title={!expanded ? label : undefined}
      className={`relative flex items-center rounded-xl mx-1 text-sm transition-all duration-200 group overflow-hidden ${
        expanded ? "gap-2.5 px-3 py-2.5" : "justify-center py-3"
      }`}
      style={
        active
          ? {
              background: "var(--sb-active-bg)",
              border: "1px solid var(--sb-active-bdr)",
              color: "var(--sb-active-text)",
              boxShadow: "0 0 20px var(--sb-active-shad), inset 0 0 20px var(--sb-active-shad)",
            }
          : {
              background: "transparent",
              border: "1px solid transparent",
              color: "var(--sb-idle-text)",
            }
      }
      onMouseEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = "var(--sb-hover-bg)";
          (e.currentTarget as HTMLElement).style.color = "var(--sb-hover-text)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          (e.currentTarget as HTMLElement).style.color = "var(--sb-idle-text)";
        }
      }}
    >
      <span
        className="shrink-0 transition-all duration-200"
        style={active ? { color: "var(--sb-active-text)", filter: "drop-shadow(0 0 6px var(--sb-active-glow))" } : {}}
      >
        {icon}
      </span>
      {expanded && (
        <>
          <span className="flex-1 truncate font-medium tracking-wide">{label}</span>
          {badge && (
            <span
              className="text-[10px] rounded-full px-1.5 py-0.5 font-bold shrink-0"
              style={{
                background: "var(--sb-active-bg)",
                border: "1px solid var(--sb-active-bdr)",
                color: "var(--sb-active-text)",
              }}
            >
              {badge}
            </span>
          )}
          {active && (
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{
                background: "var(--sb-active-dot)",
                boxShadow: "0 0 6px var(--sb-active-glow)",
              }}
            />
          )}
        </>
      )}
    </Link>
  );
}

// ─── Theme Toggle Button ─────────────────────────────────────────────────────
function ThemeToggle() {
  const expanded = useContext(SidebarCtx);
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const [spinning, setSpinning] = useState(false);

  function handleToggle() {
    setSpinning(true);
    toggle();
    setTimeout(() => setSpinning(false), 600);
  }

  return (
    <div className="px-2 py-2" style={{ borderBottom: "1px solid var(--sb-divider)" }}>
      <button
        onClick={handleToggle}
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className={`w-full flex items-center rounded-xl mx-0 transition-all duration-300 group ${
          expanded ? "gap-2.5 px-3 py-2.5" : "justify-center py-3"
        }`}
        style={{
          background: isDark ? "rgba(139,92,246,0.07)" : "rgba(245,158,11,0.08)",
          border: `1px solid ${isDark ? "rgba(139,92,246,0.14)" : "rgba(245,158,11,0.18)"}`,
          boxShadow: isDark
            ? "inset 0 0 20px rgba(139,92,246,0.03)"
            : "inset 0 0 20px rgba(245,158,11,0.04)",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = isDark ? "rgba(139,92,246,0.13)" : "rgba(245,158,11,0.14)";
          el.style.boxShadow = isDark
            ? "0 0 20px rgba(139,92,246,0.12), inset 0 0 20px rgba(139,92,246,0.05)"
            : "0 0 20px rgba(245,158,11,0.12), inset 0 0 20px rgba(245,158,11,0.05)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = isDark ? "rgba(139,92,246,0.07)" : "rgba(245,158,11,0.08)";
          el.style.boxShadow = isDark
            ? "inset 0 0 20px rgba(139,92,246,0.03)"
            : "inset 0 0 20px rgba(245,158,11,0.04)";
        }}
      >
        {/* Icon */}
        <span
          className={`shrink-0 transition-all duration-300 ${spinning ? "animate-theme-spin" : ""}`}
          style={{
            color: isDark ? "#c4b5fd" : "#fbbf24",
            filter: isDark
              ? "drop-shadow(0 0 8px rgba(196,181,253,0.7))"
              : "drop-shadow(0 0 8px rgba(251,191,36,0.7))",
          }}
        >
          {isDark ? <IconMoon /> : <IconSun />}
        </span>

        {/* Label + toggle pill */}
        {expanded && (
          <>
            <span
              className="flex-1 text-sm font-semibold tracking-wide transition-colors"
              style={{ color: isDark ? "#c4b5fd" : "#f59e0b" }}
            >
              {isDark ? "Dark mode" : "Light mode"}
            </span>

            {/* Mini pill toggle */}
            <div
              className="relative shrink-0 rounded-full transition-all duration-300"
              style={{
                width: 36, height: 20,
                background: isDark ? "rgba(139,92,246,0.2)" : "rgba(245,158,11,0.2)",
                border: `1px solid ${isDark ? "rgba(139,92,246,0.35)" : "rgba(245,158,11,0.35)"}`,
              }}
            >
              <div
                className="absolute top-[3px] w-[14px] h-[14px] rounded-full transition-all duration-300"
                style={{
                  left: isDark ? "3px" : "19px",
                  background: isDark ? "#a78bfa" : "#fbbf24",
                  boxShadow: isDark
                    ? "0 0 8px rgba(167,139,250,0.8)"
                    : "0 0 8px rgba(251,191,36,0.8)",
                }}
              />
            </div>
          </>
        )}
      </button>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar() {
  const nav = useNavigate();
  const location = useLocation();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [expanded, setExpanded] = useState(false);
  const username = getUsernameFromToken();

  useEffect(() => {
    listDatasets()
      .then((list) =>
        setDatasets(
          list
            .filter((d) => d.status === "ready")
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 3)
        )
      )
      .catch(() => {});
  }, [location.pathname]);

  function handleLogout() {
    clearToken();
    nav("/login");
  }

  const initials = username.slice(0, 2).toUpperCase() || "?";

  return (
    <SidebarCtx.Provider value={expanded}>
      <aside
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className="shrink-0 h-screen flex flex-col overflow-hidden transition-[width,background] duration-300 ease-in-out relative"
        style={{
          width: expanded ? "240px" : "64px",
          background: "var(--sb-bg)",
          borderRight: "1px solid var(--sb-border)",
        }}
      >
        {/* Side accent line */}
        <div
          className="absolute right-0 top-0 bottom-0 w-px pointer-events-none"
          style={{ background: "var(--sb-glow)" }}
        />

        {/* Logo */}
        <div
          className="px-3 pt-5 pb-4 flex items-center"
          style={{ borderBottom: "1px solid var(--sb-divider)" }}
        >
          <Link to="/" className="flex items-center gap-3 group min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-105"
              style={{
                background: "linear-gradient(135deg, #6366f1, #a855f7)",
                boxShadow: "0 0 22px rgba(168,85,247,0.45), 0 4px 15px rgba(0,0,0,0.2)",
              }}
            >
              <svg viewBox="0 0 20 20" fill="white" className="w-5 h-5 neon-flicker">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
              </svg>
            </div>
            <div className={`overflow-hidden transition-all duration-300 ${expanded ? "opacity-100 w-auto" : "opacity-0 w-0"}`}>
              <p className="font-bold text-base tracking-tight leading-none whitespace-nowrap text-gradient">
                DataBrief
              </p>
              <p className="text-[11px] mt-0.5 whitespace-nowrap" style={{ color: "var(--sb-sub)" }}>
                AI Analytics
              </p>
            </div>
          </Link>
        </div>

        {/* ── Theme toggle — right below the logo ── */}
        <ThemeToggle />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5 sidebar-scroll">
          <NavSection title="Workspace">
            <NavItem to="/" icon={<IconDashboard />} label="Dashboard" end />
            <NavItem to="/upload" icon={<IconUpload />} label="Upload Data" />
            <NavItem to="/connect" icon={<IconConnect />} label="Connect Source" />
            <NavItem to="/databases" icon={<IconDatasets />} label="Databases" />
          </NavSection>

          {datasets.length > 0 && (
            <NavSection title="Recent Analytics">
              {datasets.map((d) => (
                <NavItem
                  key={d.dataset_id}
                  to={`/datasets/${d.dataset_id}`}
                  icon={<IconChart />}
                  label={d.name}
                  badge={
                    d.row_count
                      ? d.row_count >= 1000000
                        ? `${(d.row_count / 1000000).toFixed(1)}M`
                        : `${(d.row_count / 1000).toFixed(0)}k`
                      : undefined
                  }
                />
              ))}
            </NavSection>
          )}
        </nav>

        {/* AI Chat */}
        <div className="px-2 py-2" style={{ borderTop: "1px solid var(--sb-divider)" }}>
          <NavItem to="/chat" icon={<IconChat />} label="AI Chat" />
        </div>

        {/* User footer */}
        <div className="p-3" style={{ borderTop: "1px solid var(--sb-divider)" }}>
          {expanded ? (
            <div className="space-y-1">
              <div
                className="flex items-center gap-3 px-2 py-2 rounded-xl transition-all cursor-default"
                style={{ color: "var(--sb-t1)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--sb-hover-bg)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0"
                  style={{ background: "linear-gradient(135deg, #6366f1, #a855f7)", boxShadow: "0 0 14px rgba(168,85,247,0.45)" }}
                >
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate leading-none" style={{ color: "var(--sb-t1)" }}>
                    {username}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--sb-sub)" }}>Free plan</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-sm group"
                style={{ color: "var(--sb-t2)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--sb-logout-hover)";
                  (e.currentTarget as HTMLElement).style.color = "#f43f5e";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--sb-t2)";
                }}
              >
                <IconSignOut />
                <span>Sign out</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold"
                style={{ background: "linear-gradient(135deg, #6366f1, #a855f7)", boxShadow: "0 0 14px rgba(168,85,247,0.45)" }}
              >
                {initials}
              </div>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="transition-all p-1 rounded-lg"
                style={{ color: "var(--sb-t2)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "#f43f5e";
                  (e.currentTarget as HTMLElement).style.background = "var(--sb-logout-hover)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "var(--sb-t2)";
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <IconSignOut />
              </button>
            </div>
          )}
        </div>
      </aside>
    </SidebarCtx.Provider>
  );
}

// ─── App Shell ────────────────────────────────────────────────────────────────
function AppShell({ children, stretch = false }: { children: React.ReactNode; stretch?: boolean }) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--c-bg)" }}>
      <Sidebar />
      <main className={`flex-1 min-w-0 theme-main ${stretch ? "overflow-hidden" : "overflow-y-auto"}`}>
        {children}
      </main>
    </div>
  );
}

// ─── Routes ──────────────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<RequireAuth><AppShell><HomeDashboard /></AppShell></RequireAuth>} />
      <Route path="/databases" element={<RequireAuth><AppShell><DatasetList /></AppShell></RequireAuth>} />
      <Route path="/datasets/:id" element={<RequireAuth><AppShell><Dashboard /></AppShell></RequireAuth>} />
      <Route path="/upload" element={<RequireAuth><AppShell><Upload /></AppShell></RequireAuth>} />
      <Route path="/connect" element={<RequireAuth><AppShell><ConnectDatasource /></AppShell></RequireAuth>} />
      <Route path="/datasets/:id/clean" element={<RequireAuth><AppShell stretch><DataCleaner /></AppShell></RequireAuth>} />
      <Route path="/chat" element={<RequireAuth><AppShell stretch><Chat /></AppShell></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ThemeProvider>
  );
}
