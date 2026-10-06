import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { money, SIZES, SIZE_LABEL } from "../format";

type Prices = Partial<Record<string, { price: number; durationMin: number }>>;
type Settings = {
  business: { name: string; slug: string; phone: string | null; openingHours: Record<string, { open: string; close: string } | null>; commissionPct: number; minNoticeHours: number; legalName: string | null; address: string | null; contactEmail: string | null };
  whatsapp: { configured: boolean; reminders: boolean; confirmations: boolean; loginCodes?: boolean };
  ai: { configured: boolean };
  vaccinePolicy: { key: string; label: string; months: number; required: boolean }[];
  services: { id: string; code: string; name: string; description: string | null; active: boolean; prices: Prices }[];
  addOns: { id: string; name: string; price: number; durationMin: number; active: boolean }[];
  products: { id: string; name: string; price: number; stock: number; active: boolean }[];
  groomers: { id: string; name: string; commissionPct: number | null; active: boolean }[];
  users: { id: string; name: string; email: string; role: "OWNER" | "RECEPTION" | "GROOMER"; groomerId: string | null; active: boolean; isMe: boolean }[];
};

const TABS = ["Negocio", "Servicios", "Extras", "Boutique", "Equipo"] as const;
type Tab = (typeof TABS)[number];
const DAYS: [string, string][] = [["2", "Martes"], ["3", "Miércoles"], ["4", "Jueves"], ["5", "Viernes"], ["6", "Sábado"], ["7", "Domingo"], ["1", "Lunes"]];
const ROLE_LABEL = { OWNER: "Dueña / dueño", RECEPTION: "Recepción", GROOMER: "Estilista" };
const toPesos = (c: number) => String(c / 100);
const toCent = (p: string) => Math.round(Number(p || 0) * 100);

/** Pequeño helper para guardar con mensaje. */
function useSaver(reload: () => void) {
  const [msg, setMsg] = useState<{ key: string; ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, okText = "Guardado") => {
      setBusy(key);
      setMsg(null);
      try {
        await fn();
        setMsg({ key, ok: true, text: okText });
        reload();
        setTimeout(() => setMsg((m) => (m?.key === key ? null : m)), 3000);
      } catch (x: any) {
        setMsg({ key, ok: false, text: x.message });
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );
  const Note = ({ k }: { k: string }) =>
    msg?.key === k ? <span className={msg.ok ? "okmsg" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</span> : null;
  return { run, busy, Note };
}

export default function Ajustes() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (sessionStorage.getItem("lomito.ajustes") as Tab) || "Servicios";
    } catch {
      return "Servicios";
    }
  });
  const [st, setSt] = useState<Settings | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    api<Settings>("/api/settings").then(setSt).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    try {
      sessionStorage.setItem("lomito.ajustes", tab);
    } catch {
      /* nada */
    }
  }, [tab]);

  return (
    <div>
      <div className="agenda-head">
        <h2>Ajustes</h2>
        <div className="seg" role="group" aria-label="Secciones de ajustes">
          {TABS.map((t) => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      {!st ? (
        <p className="loading">Cargando…</p>
      ) : tab === "Negocio" ? (
        <Negocio st={st} reload={load} />
      ) : tab === "Servicios" ? (
        <Servicios st={st} reload={load} />
      ) : tab === "Extras" ? (
        <Extras st={st} reload={load} />
      ) : tab === "Boutique" ? (
        <Boutique st={st} reload={load} />
      ) : (
        <Equipo st={st} reload={load} />
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card" style={{ marginBottom: 14 }}>
      <h3>{title}</h3>
      {hint && <p className="muted" style={{ fontSize: ".88rem" }}>{hint}</p>}
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

// ---------------- Negocio
function Negocio({ st, reload }: { st: Settings; reload: () => void }) {
  const { run, busy, Note } = useSaver(reload);
  const [name, setName] = useState(st.business.name);
  const [phone, setPhone] = useState(st.business.phone ?? "");
  const [pct, setPct] = useState(String(st.business.commissionPct));
  const [notice, setNotice] = useState(String(st.business.minNoticeHours));
  const [legal, setLegal] = useState({ legalName: st.business.legalName ?? "", address: st.business.address ?? "", contactEmail: st.business.contactEmail ?? "" });
  const [wipe, setWipe] = useState("");
  const [policy, setPolicy] = useState(st.vaccinePolicy);
  const [hours, setHours] = useState(st.business.openingHours);

  return (
    <>
      <Section title="Datos del negocio" hint="El WhatsApp aparece en la página de reservas para dudas.">
        <div className="row2">
          <div className="field"><label htmlFor="bn">Nombre</label><input id="bn" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label htmlFor="bp">WhatsApp del negocio</label><input id="bp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10 dígitos" /></div>
        </div>
        <div className="row2">
          <div className="field">
            <label htmlFor="bc">Comisión general de estilistas (%)</label>
            <input id="bc" type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="bm">Horas mínimas para que el cliente cambie o cancele en línea</label>
            <input id="bm" type="number" min={0} max={72} value={notice} onChange={(e) => setNotice(e.target.value)} />
          </div>
        </div>
        <div className="inline">
          <button className="btn" disabled={busy === "biz"} onClick={() => run("biz", () => api("/api/settings/business", { method: "PATCH", body: { name, phone: phone || null, commissionPct: Number(pct), minNoticeHours: Number(notice) } }))}>Guardar datos</button>
          <Note k="biz" />
        </div>
      </Section>
      <Section title="Aviso de privacidad" hint="Estos datos aparecen en lomitoatelier.mx/privacidad. La ley pide nombre y domicilio del responsable y un medio para ejercer derechos ARCO. Pide a tu contador o abogado que revise el texto final.">
        <div className="row2">
          <div className="field"><label htmlFor="ln">Responsable (tu nombre o razón social)</label><input id="ln" value={legal.legalName} onChange={(e) => setLegal({ ...legal, legalName: e.target.value })} /></div>
          <div className="field"><label htmlFor="le">Correo para privacidad</label><input id="le" type="email" value={legal.contactEmail} onChange={(e) => setLegal({ ...legal, contactEmail: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="la">Domicilio</label><input id="la" value={legal.address} onChange={(e) => setLegal({ ...legal, address: e.target.value })} placeholder="Calle, número, colonia, Tulancingo, Hgo., C.P." /></div>
        <div className="inline">
          <button className="btn" disabled={busy === "legal"} onClick={() => run("legal", () => api("/api/settings/business", { method: "PATCH", body: { legalName: legal.legalName || null, address: legal.address || null, contactEmail: legal.contactEmail || null } }))}>Guardar</button>
          <a href="/privacidad" target="_blank" rel="noreferrer">Ver aviso publicado</a>
          <Note k="legal" />
        </div>
        {(!st.business.legalName || !st.business.address || !st.business.contactEmail) && <div className="warnbox">Faltan datos: el aviso publicado los muestra incompletos.</div>}
      </Section>
      <Section title="Vacunas que pedimos" hint="Se usan para revisar las cartillas. Los meses son cuánto dura cada vacuna si la cartilla no dice la fecha de la siguiente dosis.">
        <div className="tablewrap">
          <table className="slim">
            <thead><tr><th>Vacuna</th><th>Obligatoria</th><th>Dura (meses)</th></tr></thead>
            <tbody>
              {policy.map((p, i) => (
                <tr key={p.key}>
                  <td><b>{p.label}</b></td>
                  <td><input type="checkbox" aria-label={`${p.label} obligatoria`} checked={p.required} onChange={(e) => setPolicy(policy.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} /></td>
                  <td><input className="num-in" type="number" min={1} max={36} value={p.months} aria-label={`Meses ${p.label}`} onChange={(e) => setPolicy(policy.map((x, j) => (j === i ? { ...x, months: Number(e.target.value) } : x)))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="kv-simple">
          <span>Lectura de cartillas con IA</span><b>{st.ai.configured ? "Activa" : "Sin conectar (ver README)"}</b>
          <span>Clientes entran con código por WhatsApp</span><b>{st.whatsapp.loginCodes ? "Activo" : "Apagado: entran con la liga de su cita"}</b>
        </div>
        <div className="inline">
          <button className="btn" disabled={busy === "pol"} onClick={() => run("pol", () => api("/api/settings/business", { method: "PATCH", body: { vaccinePolicy: policy.map(({ key, months, required }) => ({ key, months, required })) } }))}>Guardar vacunas</button>
          <Note k="pol" />
        </div>
      </Section>
      <Section title="WhatsApp automático" hint="Recordatorio un día antes de cada cita, con la liga para cambiar o cancelar.">
        <div className="kv-simple">
          <span>Conexión con WhatsApp Business</span><b>{st.whatsapp.configured ? "Conectado" : "Sin conectar"}</b>
          <span>Recordatorio 24 h antes</span><b>{st.whatsapp.reminders ? "Activo" : "Apagado"}</b>
          <span>Confirmación al reservar</span><b>{st.whatsapp.confirmations ? "Activa" : "Apagada"}</b>
        </div>
        {!st.whatsapp.reminders && (
          <p className="muted" style={{ fontSize: ".85rem" }}>
            Mientras no esté conectado, recepción puede mandar el recordatorio desde la agenda con el botón "Enviar recordatorio por WhatsApp".
            La guía para conectarlo está en el README del proyecto.
          </p>
        )}
      </Section>
      <Section title="Horario" hint="Las citas en línea sólo se ofrecen dentro de este horario. Las citas que ya están agendadas no se mueven.">
        <div className="tablewrap">
          <table className="slim">
            <thead><tr><th>Día</th><th>Abre</th><th>Apertura</th><th>Cierre</th></tr></thead>
            <tbody>
              {DAYS.map(([k, label]) => {
                const h = hours[k];
                return (
                  <tr key={k}>
                    <td><b>{label}</b></td>
                    <td><Toggle checked={!!h} onChange={(v) => setHours({ ...hours, [k]: v ? { open: "09:00", close: "19:00" } : null })} label={h ? "Abierto" : "Cerrado"} /></td>
                    <td>{h && <input type="time" step={1800} value={h.open} onChange={(e) => setHours({ ...hours, [k]: { ...h, open: e.target.value } })} />}</td>
                    <td>{h && <input type="time" step={1800} value={h.close} onChange={(e) => setHours({ ...hours, [k]: { ...h, close: e.target.value } })} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="inline">
          <button className="btn" disabled={busy === "hours"} onClick={() => run("hours", () => api("/api/settings/business", { method: "PATCH", body: { openingHours: hours } }))}>Guardar horario</button>
          <Note k="hours" />
        </div>
      </Section>
      <section className="card danger" style={{ marginBottom: 14 }}>
        <h3>Borrar datos de prueba</h3>
        <p className="muted" style={{ fontSize: ".88rem" }}>
          Borra <b>todas</b> las citas, clientes, lomitos, ventas, cortes de caja y la bitácora. Se conservan servicios, precios, extras, productos,
          estilistas, usuarios y horario. Úsalo una sola vez, justo antes de abrir. No se puede deshacer.
        </p>
        <p className="muted" style={{ fontSize: ".88rem" }}>Después revisa el stock de la boutique, porque las ventas de prueba lo descontaron.</p>
        <div className="inline">
          <label htmlFor="wipe">Escribe <b>BORRAR</b> para confirmar</label>
          <input id="wipe" value={wipe} onChange={(e) => setWipe(e.target.value)} style={{ width: 140 }} className="search" autoComplete="off" />
          <button className="btn danger-btn" disabled={busy === "wipe" || wipe.trim().toUpperCase() !== "BORRAR"} onClick={() => run("wipe", async () => {
            const r = await api<{ appointments: number; clients: number; sales: number }>("/api/settings/reset-data", { method: "POST", body: { confirm: wipe } });
            setWipe("");
            return r;
          }, "Listo: datos de prueba borrados")}>Borrar datos de prueba</button>
          <Note k="wipe" />
        </div>
      </section>
    </>
  );
}

// ---------------- Servicios
type PriceDraft = Record<string, { on: boolean; price: string; min: string }>;
const draftFrom = (p: Prices): PriceDraft =>
  Object.fromEntries(SIZES.map((z) => [z, { on: !!p[z], price: p[z] ? toPesos(p[z]!.price) : "", min: p[z] ? String(p[z]!.durationMin) : "60" }]));
const pricesFrom = (d: PriceDraft) =>
  Object.fromEntries(SIZES.map((z) => [z, d[z].on ? { price: toCent(d[z].price), durationMin: Number(d[z].min) || 60 } : null]));

function PriceGrid({ d, set }: { d: PriceDraft; set: (d: PriceDraft) => void }) {
  return (
    <div className="tablewrap">
      <table className="slim">
        <thead><tr><th>Tamaño</th><th>Se ofrece</th><th>Precio $</th><th>Minutos</th></tr></thead>
        <tbody>
          {SIZES.map((z) => (
            <tr key={z}>
              <td><b>{SIZE_LABEL[z].name}</b> <span className="muted">{SIZE_LABEL[z].desc}</span></td>
              <td><input type="checkbox" aria-label={`Ofrecer en ${SIZE_LABEL[z].name}`} checked={d[z].on} onChange={(e) => set({ ...d, [z]: { ...d[z], on: e.target.checked } })} /></td>
              <td><input className="num-in" inputMode="decimal" disabled={!d[z].on} value={d[z].price} onChange={(e) => set({ ...d, [z]: { ...d[z], price: e.target.value } })} aria-label={`Precio ${SIZE_LABEL[z].name}`} /></td>
              <td><input className="num-in" type="number" min={15} step={15} disabled={!d[z].on} value={d[z].min} onChange={(e) => set({ ...d, [z]: { ...d[z], min: e.target.value } })} aria-label={`Minutos ${SIZE_LABEL[z].name}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ServiceCard({ s, reload }: { s: Settings["services"][number]; reload: () => void }) {
  const { run, busy, Note } = useSaver(reload);
  const [name, setName] = useState(s.name);
  const [desc, setDesc] = useState(s.description ?? "");
  const [active, setActive] = useState(s.active);
  const [d, setD] = useState(() => draftFrom(s.prices));
  return (
    <Section title={s.name}>
      <div className="row2">
        <div className="field"><label htmlFor={`sn${s.id}`}>Nombre</label><input id={`sn${s.id}`} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>&nbsp;</label><Toggle checked={active} onChange={setActive} label={active ? "Visible en reservas" : "Oculto"} /></div>
      </div>
      <div className="field"><label htmlFor={`sd${s.id}`}>Descripción (se ve en la página de reservas)</label><input id={`sd${s.id}`} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      <PriceGrid d={d} set={setD} />
      <div className="inline">
        <button className="btn" disabled={busy === "s"} onClick={() => run("s", () => api(`/api/settings/services/${s.id}`, { method: "PATCH", body: { name, description: desc || null, active, prices: pricesFrom(d) } }))}>Guardar {s.name}</button>
        <Note k="s" />
      </div>
    </Section>
  );
}

function Servicios({ st, reload }: { st: Settings; reload: () => void }) {
  const { run, busy, Note } = useSaver(reload);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [d, setD] = useState<PriceDraft>(() => draftFrom({}));
  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>Los cambios de precio aplican a citas nuevas. Las ya agendadas conservan su precio.</p>
      {st.services.map((s) => <ServiceCard key={s.id + s.name} s={s} reload={reload} />)}
      {adding ? (
        <Section title="Nuevo servicio">
          <div className="row2">
            <div className="field"><label htmlFor="nsn">Nombre</label><input id="nsn" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="nsd">Descripción</label><input id="nsd" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          </div>
          <PriceGrid d={d} set={setD} />
          <div className="inline">
            <button className="btn" disabled={busy === "new" || name.trim().length < 2} onClick={() => run("new", async () => {
              await api("/api/settings/services", { method: "POST", body: { name, description: desc || null, prices: pricesFrom(d) } });
              setAdding(false); setName(""); setDesc(""); setD(draftFrom({}));
            }, "Servicio creado")}>Crear servicio</button>
            <button className="btn ghost" onClick={() => setAdding(false)}>Cancelar</button>
            <Note k="new" />
          </div>
        </Section>
      ) : (
        <button className="btn ghost" onClick={() => setAdding(true)}>+ Nuevo servicio</button>
      )}
    </>
  );
}

// ---------------- Extras
function Extras({ st, reload }: { st: Settings; reload: () => void }) {
  return (
    <Section title="Extras" hint="Se pueden agregar a cualquier servicio menos Uñas. Los minutos se suman a la duración de la cita.">
      <div className="tablewrap">
        <table className="slim">
          <thead><tr><th>Nombre</th><th>Precio $</th><th>Minutos extra</th><th>Visible</th><th></th></tr></thead>
          <tbody>
            {st.addOns.map((a) => <AddOnRow key={a.id + a.price + a.name + a.active} a={a} reload={reload} />)}
            <AddOnRow reload={reload} />
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function AddOnRow({ a, reload }: { a?: Settings["addOns"][number]; reload: () => void }) {
  const { run, busy, Note } = useSaver(reload);
  const [name, setName] = useState(a?.name ?? "");
  const [price, setPrice] = useState(a ? toPesos(a.price) : "");
  const [min, setMin] = useState(String(a?.durationMin ?? 0));
  const [active, setActive] = useState(a?.active ?? true);
  const body = { name, price: toCent(price), durationMin: Number(min) || 0, active };
  return (
    <tr>
      <td><input value={name} placeholder={a ? "" : "Nuevo extra"} onChange={(e) => setName(e.target.value)} aria-label="Nombre del extra" /></td>
      <td><input className="num-in" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Precio" /></td>
      <td><input className="num-in" type="number" min={0} step={5} value={min} onChange={(e) => setMin(e.target.value)} aria-label="Minutos" /></td>
      <td><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} aria-label="Visible" /></td>
      <td className="r">
        <button className={a ? "btn ghost" : "btn"} disabled={busy === "x" || name.trim().length < 2 || price === ""} onClick={() => run("x", async () => {
          if (a) await api(`/api/settings/addons/${a.id}`, { method: "PATCH", body });
          else { await api("/api/settings/addons", { method: "POST", body }); setName(""); setPrice(""); setMin("0"); }
        })}>{a ? "Guardar" : "Agregar"}</button>{" "}
        <Note k="x" />
      </td>
    </tr>
  );
}

// ---------------- Boutique
function Boutique({ st, reload }: { st: Settings; reload: () => void }) {
  const value = st.products.filter((p) => p.active).reduce((t, p) => t + p.price * p.stock, 0);
  return (
    <Section title="Boutique e inventario" hint={`Para recibir mercancía escribe la cantidad que llegó (o negativa si se dañó o perdió) y dale Ajustar. Valor del inventario a precio de venta: ${money(value)}.`}>
      <div className="tablewrap">
        <table className="slim">
          <thead><tr><th>Producto</th><th>Precio $</th><th className="r">En stock</th><th>Ajustar stock</th><th>A la venta</th><th></th></tr></thead>
          <tbody>
            {st.products.map((p) => <ProductRow key={p.id + p.stock + p.price + p.name + p.active} p={p} reload={reload} />)}
            <ProductRow reload={reload} />
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function ProductRow({ p, reload }: { p?: Settings["products"][number]; reload: () => void }) {
  const { run, busy, Note } = useSaver(reload);
  const [name, setName] = useState(p?.name ?? "");
  const [price, setPrice] = useState(p ? toPesos(p.price) : "");
  const [delta, setDelta] = useState("");
  const [active, setActive] = useState(p?.active ?? true);
  const low = p && p.active && p.stock <= 3;
  return (
    <tr>
      <td><input value={name} placeholder={p ? "" : "Nuevo producto"} onChange={(e) => setName(e.target.value)} aria-label="Producto" /></td>
      <td><input className="num-in" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Precio" /></td>
      <td className="r">{p ? <b style={{ color: low ? "var(--warn)" : undefined }}>{p.stock}{low ? " · poco" : ""}</b> : "—"}</td>
      <td>
        <div className="inline" style={{ flexWrap: "nowrap" }}>
          <input className="num-in" type="number" step={1} value={delta} placeholder={p ? "+0" : "Inicial"} onChange={(e) => setDelta(e.target.value)} aria-label="Cantidad a sumar o restar" />
          {p && (
            <button className="btn ghost" disabled={busy === "adj" || !delta || Number(delta) === 0} onClick={() => run("adj", async () => {
              await api(`/api/products/${p.id}`, { method: "PATCH", body: { addStock: Number(delta) } });
              setDelta("");
            }, "Stock ajustado")}>Ajustar</button>
          )}
        </div>
      </td>
      <td><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} aria-label="A la venta" /></td>
      <td className="r">
        <button className={p ? "btn ghost" : "btn"} disabled={busy === "p" || !name.trim() || price === ""} onClick={() => run("p", async () => {
          if (p) await api(`/api/products/${p.id}`, { method: "PATCH", body: { name, price: toCent(price), active } });
          else { await api("/api/products", { method: "POST", body: { name, price: toCent(price), stock: Math.max(0, Number(delta) || 0) } }); setName(""); setPrice(""); setDelta(""); }
        })}>{p ? "Guardar" : "Agregar"}</button>{" "}
        <Note k="p" /><Note k="adj" />
      </td>
    </tr>
  );
}

// ---------------- Equipo
function Equipo({ st, reload }: { st: Settings; reload: () => void }) {
  return (
    <>
      <Section title="Estilistas" hint={`Cada estilista es una columna en la agenda. Si dejas la comisión vacía se usa la general (${st.business.commissionPct}%). Desactivar a alguien la quita de la agenda y de las reservas nuevas; sus citas pasadas se conservan.`}>
        <div className="tablewrap">
          <table className="slim">
            <thead><tr><th>Nombre</th><th>Comisión %</th><th>Activa</th><th></th></tr></thead>
            <tbody>
              {st.groomers.map((g) => <GroomerRow key={g.id + g.name + g.active + g.commissionPct} g={g} reload={reload} />)}
              <GroomerRow reload={reload} />
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Usuarios del panel" hint="Recepción puede agendar, cobrar y hacer el corte. Estilista sólo ve sus citas y las marca como terminadas. Sólo dueña ve comisiones y ajustes.">
        <div className="tablewrap">
          <table className="slim">
            <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Es la estilista</th><th>Activo</th><th></th></tr></thead>
            <tbody>
              {st.users.map((u) => <UserRow key={u.id + u.role + u.active + u.groomerId + u.name} u={u} groomers={st.groomers} reload={reload} />)}
            </tbody>
          </table>
        </div>
        <NewUser groomers={st.groomers} reload={reload} />
      </Section>
    </>
  );
}

function GroomerRow({ g, reload }: { g?: Settings["groomers"][number]; reload: () => void }) {
  const { run, busy, Note } = useSaver(reload);
  const [name, setName] = useState(g?.name ?? "");
  const [pct, setPct] = useState(g?.commissionPct == null ? "" : String(g.commissionPct));
  const [active, setActive] = useState(g?.active ?? true);
  const body = { name, commissionPct: pct === "" ? null : Number(pct), active };
  return (
    <tr>
      <td><input value={name} placeholder={g ? "" : "Nueva estilista"} onChange={(e) => setName(e.target.value)} aria-label="Nombre" /></td>
      <td><input className="num-in" type="number" min={0} max={100} value={pct} placeholder="general" onChange={(e) => setPct(e.target.value)} aria-label="Comisión" /></td>
      <td><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} aria-label="Activa" /></td>
      <td className="r">
        <button className={g ? "btn ghost" : "btn"} disabled={busy === "g" || !name.trim()} onClick={() => run("g", async () => {
          if (g) await api(`/api/groomers/${g.id}`, { method: "PATCH", body });
          else { await api("/api/groomers", { method: "POST", body }); setName(""); setPct(""); }
        })}>{g ? "Guardar" : "Agregar"}</button>{" "}
        <Note k="g" />
      </td>
    </tr>
  );
}

function UserRow({ u, groomers, reload }: { u: Settings["users"][number]; groomers: Settings["groomers"]; reload: () => void }) {
  const { run, busy, Note } = useSaver(reload);
  const [role, setRole] = useState(u.role);
  const [groomerId, setGroomerId] = useState(u.groomerId ?? "");
  const [active, setActive] = useState(u.active);
  return (
    <tr>
      <td><b>{u.name}</b>{u.isMe ? <span className="muted"> (tú)</span> : null}</td>
      <td>{u.email}</td>
      <td>
        <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label="Rol">
          {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </td>
      <td>
        <select value={groomerId} onChange={(e) => setGroomerId(e.target.value)} aria-label="Estilista vinculada" disabled={role !== "GROOMER"}>
          <option value="">—</option>
          {groomers.filter((g) => g.active || g.id === groomerId).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </td>
      <td><input type="checkbox" checked={active} disabled={u.isMe} onChange={(e) => setActive(e.target.checked)} aria-label="Activo" /></td>
      <td className="r">
        <div className="inline" style={{ justifyContent: "flex-end" }}>
          <button className="btn ghost" disabled={busy === "u"} onClick={() => run("u", () => api(`/api/settings/users/${u.id}`, { method: "PATCH", body: { role, active, groomerId: role === "GROOMER" ? groomerId || null : null } }))}>Guardar</button>
          {!u.isMe && (
            <button className="btn ghost" disabled={busy === "pw"} onClick={() => {
              const pw = prompt(`Nueva contraseña para ${u.name} (mínimo 8 caracteres):`);
              if (pw) run("pw", () => api(`/api/settings/users/${u.id}`, { method: "PATCH", body: { password: pw } }), "Contraseña cambiada");
            }}>Nueva contraseña</button>
          )}
        </div>
        <Note k="u" /><Note k="pw" />
      </td>
    </tr>
  );
}

function NewUser({ groomers, reload }: { groomers: Settings["groomers"]; reload: () => void }) {
  const { run, busy, Note } = useSaver(reload);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "RECEPTION", groomerId: "" });
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>+ Nuevo usuario</button>;
  return (
    <div className="form" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <div className="row2">
        <div className="field"><label htmlFor="nun">Nombre</label><input id="nun" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="nue">Correo</label><input id="nue" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      </div>
      <div className="row2">
        <div className="field"><label htmlFor="nur">Rol</label>
          <select id="nur" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="nug">Es la estilista</label>
          <select id="nug" value={f.groomerId} disabled={f.role !== "GROOMER"} onChange={(e) => setF({ ...f, groomerId: e.target.value })}>
            <option value="">—</option>
            {groomers.filter((g) => g.active).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      </div>
      <div className="field" style={{ maxWidth: 320 }}><label htmlFor="nup">Contraseña inicial (mínimo 8)</label><input id="nup" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      <div className="inline">
        <button className="btn" disabled={busy === "nu" || !f.name || !f.email || f.password.length < 8} onClick={() => run("nu", async () => {
          await api("/api/users", { method: "POST", body: { ...f, groomerId: f.role === "GROOMER" ? f.groomerId || null : null } });
          setF({ name: "", email: "", password: "", role: "RECEPTION", groomerId: "" });
          setOpen(false);
        }, "Usuario creado")}>Crear usuario</button>
        <button className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
        <Note k="nu" />
      </div>
    </div>
  );
}
