import { useEffect, useState } from "react";
import { api } from "../api";
import { money, SIZES, SIZE_LABEL, STATUS_LABEL, ymd, hm, waLink } from "../format";

type Row = { id: string; name: string; phone: string; pets: { id: string; name: string; breed: string | null; size: string }[]; visits: number; spent: number; lastVisit: string | null };
type Full = {
  id: string; name: string; phone: string; email: string | null; notes: string | null;
  pets: { id: string; name: string; breed: string | null; size: string; notes: string | null; cabinOk: boolean | null; cabin: boolean }[];
  history: { id: string; startsAt: string; status: string; price: number; paid: boolean; service: string; groomer: string; pet: string }[];
};

export default function Clientes() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [n, setN] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => api<Row[]>("/api/clients", { query: { q } }).then(setRows).catch(() => setRows([])), 250);
    return () => clearTimeout(t);
  }, [q, n]);

  return (
    <div>
      <div className="agenda-head">
        <h2>Clientes</h2>
        <input className="search" placeholder="Buscar por nombre, WhatsApp o lomito" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="split">
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Cliente</th><th>Lomitos</th><th className="r">Visitas</th><th className="r">Gastado</th><th>Última visita</th></tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr><td colSpan={5} className="muted">Cargando…</td></tr>
              ) : rows.length ? (
                rows.map((c) => (
                  <tr key={c.id} onClick={() => setSelId(c.id)} style={{ cursor: "pointer", background: c.id === selId ? "var(--tint)" : undefined }}>
                    <td><b>{c.name}</b><br /><span className="muted">{c.phone}</span></td>
                    <td>{c.pets.map((p) => `${p.name}${p.breed ? ` (${p.breed})` : ""}`).join(", ")}</td>
                    <td className="r">{c.visits}</td>
                    <td className="r">{money(c.spent)}</td>
                    <td>{c.lastVisit ? ymd(new Date(c.lastVisit)) : "—"}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="muted">{q ? "Nadie coincide con esa búsqueda." : "Todavía no hay clientes."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <aside>{selId ? <ClientCard id={selId} onChanged={() => setN((x) => x + 1)} /> : <div className="detail"><p className="muted">Elige un cliente para ver su ficha.</p></div>}</aside>
      </div>
    </div>
  );
}

function ClientCard({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [c, setC] = useState<Full | null>(null);
  const [err, setErr] = useState("");
  const [newPet, setNewPet] = useState<{ name: string; breed: string; size: string } | null>(null);
  const load = () => api<Full>(`/api/clients/${id}`).then(setC).catch((e) => setErr(e.message));
  useEffect(() => { setC(null); setNewPet(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function savePet(petId: string, body: object) {
    try {
      await api(`/api/pets/${petId}`, { method: "PATCH", body });
      load();
    } catch (x: any) { setErr(x.message); }
  }
  async function addPet() {
    if (!newPet?.name.trim()) return;
    try {
      await api(`/api/clients/${id}/pets`, { method: "POST", body: { name: newPet.name, breed: newPet.breed || null, size: newPet.size } });
      setNewPet(null);
      load();
      onChanged();
    } catch (x: any) { setErr(x.message); }
  }

  if (!c) return <div className="detail"><p className="loading">{err || "Cargando…"}</p></div>;
  return (
    <div className="detail">
      <h2>{c.name}</h2>
      <p><a href={waLink(c.phone, "")} target="_blank" rel="noreferrer">{c.phone}</a>{c.email ? ` · ${c.email}` : ""}</p>
      {err && <div className="err">{err}</div>}
      <p className="lbl">Lomitos</p>
      {c.pets.map((p) => (
        <div key={p.id} className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <b>{p.name}</b>
            <span className={`chip ${p.cabin ? "cab" : "mano"}`}>{p.cabin ? "Cabina" : "A mano"}</span>
          </div>
          <span className="muted">{p.breed ?? "Sin raza"} · {SIZE_LABEL[p.size]?.name}</span>
          <div className="field">
            <label htmlFor={`n${p.id}`}>Notas del lomito</label>
            <textarea id={`n${p.id}`} rows={2} defaultValue={p.notes ?? ""} onBlur={(e) => e.target.value !== (p.notes ?? "") && savePet(p.id, { notes: e.target.value || null })} placeholder="Alergias, carácter, corte favorito…" />
          </div>
          <div className="field">
            <label htmlFor={`c${p.id}`}>Secado</label>
            <select id={`c${p.id}`} value={p.cabinOk === null ? "auto" : p.cabinOk ? "si" : "no"} onChange={(e) => savePet(p.id, { cabinOk: e.target.value === "auto" ? null : e.target.value === "si" })}>
              <option value="auto">Automático (por raza y tamaño)</option>
              <option value="si">Siempre cabina</option>
              <option value="no">Siempre a mano</option>
            </select>
          </div>
        </div>
      ))}
      {newPet ? (
        <div className="form">
          <div className="row2">
            <div className="field"><label htmlFor="npn">Nombre</label><input id="npn" value={newPet.name} onChange={(e) => setNewPet({ ...newPet, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="npb">Raza</label><input id="npb" value={newPet.breed} onChange={(e) => setNewPet({ ...newPet, breed: e.target.value })} /></div>
          </div>
          <div className="field">
            <label htmlFor="nps">Tamaño</label>
            <select id="nps" value={newPet.size} onChange={(e) => setNewPet({ ...newPet, size: e.target.value })}>
              {SIZES.map((z) => <option key={z} value={z}>{SIZE_LABEL[z].name}</option>)}
            </select>
          </div>
          <div className="actions"><button className="btn" onClick={addPet}>Guardar lomito</button><button className="btn ghost" onClick={() => setNewPet(null)}>Cancelar</button></div>
        </div>
      ) : (
        <button className="btn ghost" onClick={() => setNewPet({ name: "", breed: "", size: "CHICO" })}>+ Agregar lomito</button>
      )}
      <p className="lbl">Historial</p>
      <ul className="log">
        {c.history.length ? c.history.map((h) => (
          <li key={h.id} style={{ gridTemplateColumns: "88px 1fr" }}>
            <span className="num muted">{ymd(new Date(h.startsAt))} {hm(h.startsAt)}</span>
            <span>{h.pet} · {h.service} · {h.groomer} · {money(h.price)} · {STATUS_LABEL[h.status]}{h.paid ? " · pagado" : ""}</span>
          </li>
        )) : <li className="muted">Sin citas todavía.</li>}
      </ul>
    </div>
  );
}
