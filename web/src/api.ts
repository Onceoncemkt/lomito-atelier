export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:4000";
export const BUSINESS_SLUG = (import.meta.env.VITE_BUSINESS_SLUG as string | undefined) ?? "lomito-atelier";

const TOKEN_KEY = "lomito.token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sin almacenamiento: la sesión dura lo que la pestaña */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) {
    super(message);
  }
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | number | undefined>; token?: string | null } = {},
): Promise<T> {
  const url = new URL(API_URL + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  else if (token && !path.startsWith("/public")) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, "No hay conexión con el servidor. Revisa tu internet.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/login")) {
      setToken(null);
      if (location.pathname.startsWith("/panel") && location.pathname !== "/panel/login") location.href = "/panel/login";
    }
    const detail = data?.issues?.[0]?.message ? ` (${data.issues[0].message})` : "";
    throw new ApiError(res.status, (data?.error ?? "Algo salió mal") + detail, data);
  }
  return data as T;
}

// ---- sesión del cliente ("Mi lomito"), separada de la del equipo
const CLIENT_KEY = "lomito.client";
export function getClientToken() {
  try {
    return localStorage.getItem(CLIENT_KEY);
  } catch {
    return null;
  }
}
export function setClientToken(t: string | null) {
  try {
    if (t) localStorage.setItem(CLIENT_KEY, t);
    else localStorage.removeItem(CLIENT_KEY);
  } catch {
    /* sin almacenamiento */
  }
}
/** Abre la cuenta del cliente a partir de la liga de una cita. */
export async function enterWithLink(manageToken: string) {
  const r = await api<{ token: string }>(`/public/${BUSINESS_SLUG}/account/from-link`, { method: "POST", body: { token: manageToken } });
  setClientToken(r.token);
}
