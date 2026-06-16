import { api, setToken, clearToken } from "./client";

export async function login(username: string, password: string): Promise<void> {
  const res = await api.post<{ access_token: string }>("/auth/login", {
    username,
    password,
  });
  setToken(res.access_token);
}

export async function logout(): Promise<void> {
  try {
    await api.post("/auth/logout", {});
  } finally {
    clearToken();
  }
}
