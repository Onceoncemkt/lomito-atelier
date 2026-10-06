import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, BUSINESS_SLUG, getClientToken, setClientToken } from "../api";
import { money, SIZE_LABEL, longDate, shortDate, cap, hm, ymd } from "../format";
import { useLightTheme } from "../useLightTheme";
import { fileToDataUrl, VACCINE_LABEL } from "../image";

type Pet = {
  id: string; name: string; breed: string | null; size: string;
  vaccine: string; vaccineExpiresAt: string | null;
  lastCard: { uploadedAt: string; review: string; note: string | null } | null;
};
type Appt = { startsAt: string; status: string; service: string; pet: string; price: number; manageToken: string | null };
type Account = { name: string; phone: string; requiredVaccines: string[]; pets: Pet[]; upcoming: Appt[]; past: Appt[] };

const BASE = `/public/${BUSINESS_SLUG}/account`;
const STATUS = { BOOKED: "Agendada", DONE: "Atendida", CANCELLED: "Cancelada", NO_SHOW: "No asistió" } as Record<string, string>;

export default function MiLomito() {
  useLightTheme();
  const [token, setToken] = useState(getClientToken());
  const [acc, setAcc] = useState<Account | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    if (!token) return;
    api<Account>(BASE, { token })
      .then(setAcc)
      .catch((e) => {
        if (e.status === 401) {
          setClientToken(null);
          setToken(null);
        } else setErr(e.message);
      });
  }, [token]);
  useEffect(load, [load]);

  return (
    <div className="public">
      <div className="phone">
        <div className="phone-head">
          <img src="/lomito-creme.svg" alt="Lomito Atelier" />
          <h2>Mi lomito</h2>
          {acc && <p style={{ opacity: 0.85, fontSize: ".9rem" }}>Hola, {acc.name.split(" ")[0]}</p>}
        </div>
        <div className="phone-body">
          {!token ? (
            <Login onIn={(t) => { setClientToken(t); setToken(t); }} />
          ) : !acc ? (
            err ? <div className="err">{err}</div> : <p className="loading">Cargando…</p>
          ) : (
            <Portal acc={acc} token={token} reload={load} onOut={() => { setClientToken(null); setToken(null); setAcc(null); }} />
          )}
        </div>
      </div>
    </div>
  );
}

function Login({ onIn }: { onIn: (t: string) => void }) {
  const [codeLogin, setCodeLogin] = useState<boolean | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ business: { codeLogin?: boolean } }>(`/public/${BUSINESS_SLUG}`).then((r) => setCodeLogin(!!r.business.codeLogin)).catch(() => setCodeLogin(false));
  }, []);

  async function send(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api(`${BASE}/code`, { method: "POST", body: { phone } });
      setStep("code");
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api<{ token: string }>(`${BASE}/verify`, { method: "POST", body: { phone, code } });
      onIn(r.token);
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  if (codeLogin === null) return <p className="loading">Cargando…</p>;
  if (!codeLogin)
    return (
      <div className="form">
        <p>Para entrar a tu cuenta abre la liga que te dimos al agendar tu cita (también llega en los mensajes de WhatsApp).</p>
        <p className="muted" style={{ fontSize: ".88rem" }}>¿No la tienes? Escríbenos y te la mandamos.</p>
        <a className="btn" href="/" style={{ textAlign: "center", textDecoration: "none" }}>Agendar una cita</a>
      </div>
    );
  return step === "phone" ? (
    <form className="form" onSubmit={send}>
      <p>Escribe el WhatsApp con el que agendas tus citas. Te mandaremos un código.</p>
      <div className="field">
        <label htmlFor="ph">WhatsApp</label>
        <input id="ph" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10 dígitos" />
      </div>
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy || phone.replace(/\D/g, "").length < 10}>{busy ? "Enviando…" : "Mandarme el código"}</button>
    </form>
  ) : (
    <form className="form" onSubmit={verify}>
      <p>Si ese número tiene citas con nosotros, te llegó un código por WhatsApp. Escríbelo aquí:</p>
      <div className="field">
        <label htmlFor="cd">Código de 6 números</label>
        <input id="cd" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ letterSpacing: ".4em", fontSize: "1.3rem", textAlign: "center" }} />
      </div>
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy || code.length !== 6}>{busy ? "Entrando…" : "Entrar"}</button>
      <button type="button" className="linkbtn" onClick={() => { setStep("phone"); setCode(""); setErr(""); }}>Usar otro número</button>
    </form>
  );
}

function Portal({ acc, token, reload, onOut }: { acc: Account; token: string; reload: () => void; onOut: () => void }) {
  return (
    <>
      <section className="step">
        <h3>Mis lomitos</h3>
        {acc.pets.map((p) => <PetCard key={p.id} p={p} token={token} reload={reload} required={acc.requiredVaccines} />)}
      </section>

      <section className="step">
        <h3>Próximas citas</h3>
        {acc.upcoming.length ? acc.upcoming.map((a, i) => <ApptRow key={i} a={a} />) : <p className="muted">No tienes citas próximas.</p>}
        <a className="btn" href="/" style={{ textAlign: "center", textDecoration: "none" }}>Agendar cita</a>
      </section>

      {acc.past.length > 0 && (
        <section className="step">
          <h3>Historial</h3>
          {acc.past.map((a, i) => <ApptRow key={i} a={a} />)}
        </section>
      )}
      <button className="linkbtn" onClick={onOut} style={{ justifySelf: "center" }}>Salir</button>
    </>
  );
}

function ApptRow({ a }: { a: Appt }) {
  const d = ymd(new Date(a.startsAt));
  const inner = (
    <>
      <span><b>{cap(longDate(d))} · {hm(a.startsAt)}</b><br /><span className="muted">{a.pet} · {a.service}</span></span>
      <span className="r"><span className="num">{money(a.price)}</span><br /><span className="muted" style={{ fontSize: ".8rem" }}>{STATUS[a.status]}</span></span>
    </>
  );
  return a.status === "BOOKED" && a.manageToken ? (
    <a className="client-row" href={`/cita/${a.manageToken}`} style={{ textDecoration: "none", color: "inherit" }}>{inner}</a>
  ) : (
    <div className="client-row" style={{ cursor: "default" }}>{inner}</div>
  );
}

function PetCard({ p, token, reload, required }: { p: Pet; token: string; reload: () => void; required: string[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const v = VACCINE_LABEL[p.vaccine] ?? VACCINE_LABEL.NONE;

  async function upload(file: File) {
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      await api(`${BASE}/pets/${p.id}/card`, { method: "POST", body: { dataUrl }, token });
      setMsg("¡Gracias! Recibimos la cartilla. La revisamos y te avisamos si falta algo.");
      reload();
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
        <div>
          <b style={{ fontSize: "1.05rem" }}>{p.name}</b>
          <div className="muted" style={{ fontSize: ".88rem" }}>{p.breed ?? "Sin raza"} · {SIZE_LABEL[p.size]?.name}</div>
        </div>
        <span className={`chip ${v.cls}`}>{v.text}</span>
      </div>
      {p.vaccine === "APPROVED" && p.vaccineExpiresAt && (
        <p className="muted" style={{ fontSize: ".85rem" }}>Vigentes hasta el {shortDate(ymd(new Date(p.vaccineExpiresAt)))}.</p>
      )}
      {p.vaccine === "PENDING" && <p className="muted" style={{ fontSize: ".85rem" }}>Estamos revisando su cartilla.</p>}
      {p.vaccine === "REJECTED" && p.lastCard?.note && <p className="hint">{p.lastCard.note}</p>}
      {(p.vaccine === "NONE" || p.vaccine === "REJECTED" || p.vaccine === "EXPIRED") && (
        <p className="muted" style={{ fontSize: ".85rem" }}>Para cuidar a todos los lomitos pedimos al día: {required.join(", ").toLowerCase()}.</p>
      )}
      <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <button className="btn ghost" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Subiendo…" : p.lastCard ? "Subir cartilla actualizada" : "Subir foto de la cartilla"}
      </button>
      {msg && <div className="okmsg">{msg}</div>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
