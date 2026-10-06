import { useCallback, useEffect, useState } from "react";
import { api, API_URL, getToken } from "../api";
import { SIZE_LABEL, shortDate, hm, ymd, todayYmd, addDays, waLink } from "../format";

type Item = { key: string; label: string; required: boolean; applied: string | null; expires: string | null; valid: boolean };
type Card = {
  id: string; mimeType: string; uploadedBy: string; aiStatus: string; aiSuggestion: string | null; aiSummary: string | null;
  aiResult: { reading?: { notas?: string; legible?: boolean; vacunas?: { nombre: string; tipo: string; fecha_aplicacion: string | null }[] }; evaluation?: { items: Item[] } } | null;
  review: "PENDING" | "APPROVED" | "REJECTED"; reviewNote: string | null; reviewedAt: string | null; expiresAt: string | null; createdAt: string;
  pet: { id: string; name: string; breed: string | null; size: string; client: { id: string; name: string; phone: string } };
};
type List = { pending: number; ai: boolean; cards: Card[] };

const SUGG: Record<string, { text: string; cls: string }> = {
  APPROVE: { text: "IA: todo vigente", cls: "cab" },
  REVIEW: { text: "IA: revisar", cls: "mano" },
  REJECT: { text: "IA: no parece cartilla", cls: "mano" },
};
const fmt = (d: string | null) => (d ? shortDate(d) : "—");

/** Cola de cartillas por revisar: foto, lectura de la IA y decisión del equipo. */
export default function Cartillas() {
  const [tab, setTab] = useState<"PENDING" | "ALL">("PENDING");
  const [list, setList] = useState<List | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    api<List>("/api/vaccine-cards", { query: { status: tab } }).then(setList).catch((e) => setErr(e.message));
  }, [tab]);
  useEffect(load, [load]);
  // si la IA sigue leyendo alguna, refresca en unos segundos
  useEffect(() => {
    if (!list?.cards.some((c) => c.aiStatus === "PENDING")) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [list, load]);

  return (
    <div>
      <div className="agenda-head">
        <h2>Cartillas</h2>
        <div className="seg" role="group" aria-label="Filtro">
          <button aria-pressed={tab === "PENDING"} onClick={() => setTab("PENDING")}>Por revisar{list ? ` (${list.pending})` : ""}</button>
          <button aria-pressed={tab === "ALL"} onClick={() => setTab("ALL")}>Todas</button>
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      {list && !list.ai && (
        <p className="hint" style={{ marginBottom: 12 }}>La lectura con IA no está conectada. Puedes revisar las cartillas a mano; la guía para activarla está en el README.</p>
      )}
      {!list ? (
        <p className="loading">Cargando…</p>
      ) : list.cards.length ? (
        <div className="list">{list.cards.map((c) => <CardReview key={c.id + c.review + c.aiStatus} c={c} ai={list.ai} reload={load} />)}</div>
      ) : (
        <div className="detail"><p className="muted">{tab === "PENDING" ? "No hay cartillas por revisar." : "Todavía no hay cartillas."}</p></div>
      )}
    </div>
  );
}

function CardReview({ c, ai, reload }: { c: Card; ai: boolean; reload: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [until, setUntil] = useState(c.expiresAt ? ymd(new Date(c.expiresAt)) : "");
  const [note, setNote] = useState(c.reviewNote ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let obj: string | null = null;
    fetch(`${API_URL}/api/vaccine-cards/${c.id}/file`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => r.blob())
      .then((b) => { obj = URL.createObjectURL(b); setUrl(obj); })
      .catch(() => {});
    return () => { if (obj) URL.revokeObjectURL(obj); };
  }, [c.id]);

  async function decide(decision: "APPROVED" | "REJECTED") {
    setErr("");
    if (decision === "APPROVED" && !until) return setErr("Pon hasta cuándo son válidas las vacunas");
    if (decision === "REJECTED" && !note.trim()) return setErr("Escribe qué falta; el cliente lo verá en su cuenta");
    setBusy(true);
    try {
      await api(`/api/vaccine-cards/${c.id}`, { method: "PATCH", body: { decision, note: note || null, expiresOn: until || null } });
      reload();
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }
  async function reread() {
    setBusy(true);
    try {
      await api(`/api/vaccine-cards/${c.id}/analyze`, { method: "POST" });
      reload();
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  const items = c.aiResult?.evaluation?.items ?? [];
  const sugg = c.aiSuggestion ? SUGG[c.aiSuggestion] : null;
  const isPdf = c.mimeType === "application/pdf";
  const msg = `Hola ${c.pet.client.name.split(" ")[0]} 🐾 Revisamos la cartilla de ${c.pet.name}: ${note || "nos falta información"}. ¿Nos ayudas a subirla actualizada en ${location.origin}/mi-lomito? ¡Gracias!`;

  return (
    <section className="card vcard">
      <div className="vimg">
        {!url ? <div className="loading">Cargando archivo…</div> : isPdf ? (
          <a className="btn ghost" href={url} target="_blank" rel="noreferrer">Abrir PDF</a>
        ) : (
          <a href={url} target="_blank" rel="noreferrer" title="Ver en grande"><img src={url} alt={`Cartilla de ${c.pet.name}`} /></a>
        )}
      </div>
      <div className="vinfo">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ fontSize: "1.15rem" }}>{c.pet.name} <span className="muted" style={{ fontWeight: 500, fontSize: ".9rem" }}>{c.pet.breed ?? "Sin raza"} · {SIZE_LABEL[c.pet.size]?.name}</span></h3>
            <p className="muted" style={{ fontSize: ".85rem" }}>
              {c.pet.client.name} · {c.pet.client.phone} · subida {c.uploadedBy === "CLIENT" ? "por el cliente" : "en recepción"} el {fmt(ymd(new Date(c.createdAt)))} {hm(c.createdAt)}
            </p>
          </div>
          {c.review !== "PENDING" ? (
            <span className={`chip ${c.review === "APPROVED" ? "cab" : "mano"}`}>{c.review === "APPROVED" ? "Aprobada" : "Rechazada"}</span>
          ) : c.aiStatus === "PENDING" ? (
            <span className="chip">IA leyendo…</span>
          ) : sugg ? <span className={`chip ${sugg.cls}`}>{sugg.text}</span> : null}
        </div>

        {items.length > 0 && (
          <table className="slim vtable">
            <thead><tr><th>Vacuna</th><th>Aplicada</th><th>Vence</th><th></th></tr></thead>
            <tbody>
              {items.filter((i) => i.required).map((i) => (
                <tr key={i.key}>
                  <td>{i.label}</td>
                  <td>{fmt(i.applied)}</td>
                  <td>{fmt(i.expires)}</td>
                  <td className={i.valid ? "ok-txt" : "bad-txt"}>{i.valid ? "✓ vigente" : i.expires ? "✗ vencida" : "✗ no aparece"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {c.aiResult?.reading?.notas && <p className="muted" style={{ fontSize: ".85rem" }}>Nota de la IA: {c.aiResult.reading.notas}</p>}
        {(c.aiStatus === "ERROR" || c.aiStatus === "SKIPPED") && (
          <p className="hint">{c.aiStatus === "SKIPPED" ? "Sin lectura de IA: revísala a mano." : c.aiSummary}{ai && <> <button className="linkbtn" disabled={busy} onClick={reread}>Volver a leer con IA</button></>}</p>
        )}
        <p className="muted" style={{ fontSize: ".8rem" }}>La IA puede equivocarse: confirma las fechas en la foto antes de aprobar.</p>

        {c.review === "PENDING" ? (
          <div className="form">
            <div className="row2">
              <div className="field">
                <label htmlFor={`u${c.id}`}>Vacunas válidas hasta</label>
                <input id={`u${c.id}`} type="date" value={until} min={todayYmd()} onChange={(e) => setUntil(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor={`n${c.id}`}>Nota (el cliente la ve si se rechaza)</label>
                <input id={`n${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. Falta Bordetella" />
              </div>
            </div>
            {!until && <div className="inline" style={{ fontSize: ".85rem" }}>
              <span className="muted">Rápido:</span>
              {[3, 6, 12].map((m) => <button key={m} className="linkbtn" onClick={() => setUntil(addDays(todayYmd(), Math.round(m * 30.4)))}>{m} meses</button>)}
            </div>}
            {err && <div className="err">{err}</div>}
            <div className="actions">
              <button className="btn" disabled={busy} onClick={() => decide("APPROVED")}>Aprobar</button>
              <button className="btn ghost" disabled={busy} onClick={() => decide("REJECTED")}>Rechazar</button>
              <a className="btn ghost" style={{ textDecoration: "none" }} href={waLink(c.pet.client.phone, msg)} target="_blank" rel="noreferrer">Escribir al cliente</a>
            </div>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: ".85rem" }}>
            {c.review === "APPROVED" ? `Válida hasta ${fmt(c.expiresAt ? ymd(new Date(c.expiresAt)) : null)}` : "Rechazada"}
            {c.reviewNote ? ` · ${c.reviewNote}` : ""}
          </p>
        )}
      </div>
    </section>
  );
}
