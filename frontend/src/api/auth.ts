import { api, setToken, clearToken } from "./client";

function extractDetail(err: unknown): Error {
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message);
      return new Error(parsed.detail || err.message);
    } catch {
      return err;
    }
  }
  return new Error("An error occurred");
}

export async function login(username: string, password: string): Promise<void> {
  const res = await api.post<{ access_token: string }>("/auth/login", { username, password });
  setToken(res.access_token);
}

export async function register(username: string, email: string, password: string): Promise<void> {
  try {
    await api.post("/auth/register", { username, email, password });
  } catch (err) {
    throw extractDetail(err);
  }
}

export async function forgotPassword(email: string): Promise<{ message: string; reset_token: string | null }> {
  try {
    return await api.post<{ message: string; reset_token: string | null }>("/auth/forgot-password", { email });
  } catch (err) {
    throw extractDetail(err);
  }
}

export async function resetPassword(token: string, new_password: string): Promise<void> {
  try {
    await api.post("/auth/reset-password", { token, new_password });
  } catch (err) {
    throw extractDetail(err);
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post("/auth/logout", {});
  } finally {
    clearToken();
  }
}
