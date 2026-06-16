import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import { isAuthenticated, clearToken } from "./api/client";
import Login from "./pages/Login";
import DatasetList from "./pages/DatasetList";
import Dashboard from "./pages/Dashboard";
import Chat from "./pages/Chat";

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function NavBar() {
  const nav = useNavigate();

  function handleLogout() {
    clearToken();
    nav("/login");
  }

  return (
    <nav className="h-16 border-b border-gray-200 bg-white flex items-center px-6 gap-6 sticky top-0 z-10">
      <Link to="/" className="font-bold text-brand-700 text-lg">
        DataBrief
      </Link>
      <Link
        to="/"
        className="text-sm text-gray-600 hover:text-brand-600 font-medium"
      >
        Datasets
      </Link>
      <Link
        to="/chat"
        className="text-sm text-gray-600 hover:text-brand-600 font-medium"
      >
        Chat
      </Link>
      <div className="ml-auto">
        <button
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-red-500"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <main className="flex-1">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell>
                <DatasetList />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/datasets/:id"
          element={
            <RequireAuth>
              <AppShell>
                <Dashboard />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/chat"
          element={
            <RequireAuth>
              <AppShell>
                <Chat />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
