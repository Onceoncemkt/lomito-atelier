import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useSession } from "../session";

export default function Cuenta() {
  const { me } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setOk(false);
    if (next.length < 8) return setErr("La nueva contraseña debe tener al menos 8 caracteres");
    if (next !== repeat) return setErr("Las contraseñas nuevas no coinciden");
    setBusy(true);
    try {
      await api("/auth/password", { method: "POST", body: { current, next } });
      setOk(true);
      setCurrent("");
      setNext("");
      setRepeat("");
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <h2>Mi cuenta</h2>
      <p className="muted" style={{ margin: "6px 0 16px" }}>{me?.user.name} · {me?.user.email}</p>
      <form className="card form" onSubmit={submit}>
        <h3>Cambiar contraseña</h3>
        <div className="field">
          <label htmlFor="cur">Contraseña actual</label>
          <input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="nw">Nueva contraseña</label>
          <input id="nw" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        </div>
        <div className="field">
          <label htmlFor="rp">Repite la nueva contraseña</label>
          <input id="rp" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required minLength={8} />
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        {ok && <div className="okmsg">Listo, tu contraseña se cambió.</div>}
        <button className="btn" disabled={busy}>{busy ? "Guardando…" : "Guardar contraseña"}</button>
      </form>
    </div>
  );
}
