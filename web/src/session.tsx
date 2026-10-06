import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";

export type Me = {
  user: { id: string; name: string; email: string; role: "OWNER" | "RECEPTION" | "GROOMER"; groomerId: string | null };
  business: { slug: string; name: string; timezone: string; slotMinutes: number; openingHours: Record<string, { open: string; close: string } | null>; commissionPct: number };
};

type Ctx = { me: Me | null; loading: boolean; login: (business: string, email: string, password: string) => Promise<void>; logout: () => void };
const SessionCtx = createContext<Ctx>(null!);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api<Me>("/auth/me")
      .then(setMe)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (business: string, email: string, password: string) => {
    const r = await api<{ token: string }>("/auth/login", { method: "POST", body: { business, email, password } });
    setToken(r.token);
    setMe(await api<Me>("/auth/me"));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setMe(null);
  }, []);

  return <SessionCtx.Provider value={{ me, loading, login, logout }}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);
