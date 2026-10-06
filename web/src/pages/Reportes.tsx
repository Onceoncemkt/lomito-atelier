import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { money, todayYmd, addDays, SOURCE_LABEL, METHOD_LABEL, waLink, dayParts } from "../format";

type Report = {
  from: string;
  to: string;
  sales: {
    total: number; services: number; products: number; tickets: number; avgTicket: number; prevTotal: number;
    byMethod: Record<string, number>;
    byDay: { date: string; services: number; products: number }[];
  };
  appointments: { BOOKED: number; DONE: number; CANCELLED: number; NO_SHOW: number; noShowRate: number; cancelRate: number; bySource: Record<string, number>; heat: number[][] };
  clients: { attended: number; returning: number; new: number; dogs: number };
  topServices: { name: string; count: number; revenue: number }[];
  topProducts: { name: string; qty: number; revenue: number }[];
  winback: { clientId: string; name: string; phone: string; pets: string[]; lastVisit: string; daysAgo: number; visits: number }[];
  winbackDays: number;
};

const monthStart = (d: string) => d.slice(0, 8) + "01";
const monthEnd = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const PRESETS: { key: string; label: string; range: () => { from: string; to: string } }[] = [
  { key: "mes", label: "Este mes", range: () => ({ from: monthStart(todayYmd()), to: todayYmd() }) },
  { key: "pasado", label: "Mes pasado", range: () => { const p = addDays(monthStart(todayYmd()), -1); return { from: monthStart(p), to: monthEnd(p) }; } },
  { key: "7", label: "7 días", range: () => ({ from: addDays(todayYmd(), -6), to: todayYmd() }) },
  { key: "30", label: "30 días", range: () => ({ from: addDays(todayYmd(), -29), to: todayYmd() }) },
  { key: "90", label: "90 días", range: () => ({ from: addDays(todayYmd(), -89), to: todayYmd() }) },
];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const WEEK = [["Lun", 0], ["Mar", 1], ["Mié", 2], ["Jue", 3], ["Vie", 4], ["Sáb", 5], ["Dom", 6]] as const;

export default function Reportes() {
  const [preset, setPreset] = useState("mes");
  const [range, setRange] = useState(PRESETS[0].range());
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setR(null);
    api<Report>("/api/reports", { query: range }).then(setR).catch((e) => setErr(e.message));
  }, [range]);

  const delta = r && r.sales.prevTotal ? (r.sales.total - r.sales.prevTotal) / r.sales.prevTotal : null;

  return (
    <div>
      <div className="agenda-head">
        <h2>Reportes</h2>
        <div className="inline">
          <div className="seg" role="group" aria-label="Periodo">
            {PRESETS.map((p) => (
              <button key={p.key} aria-pressed={preset === p.key} onClick={() => { setPreset(p.key); setRange(p.range()); }}>{p.label}</button>
            ))}
          </div>
          <input type="date" className="search" style={{ width: 150 }} value={range.from} max={range.to} aria-label="Desde" onChange={(e) => { if (e.target.value) { setPreset(""); setRange({ ...range, from: e.target.value }); } }} />
          <input type="date" className="search" style={{ width: 150 }} value={range.to} min={range.from} aria-label="Hasta" onChange={(e) => { if (e.target.value) { setPreset(""); setRange({ ...range, to: e.target.value }); } }} />
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      {!r ? (
        <p className="loading">Calculando…</p>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <span>Ventas</span><b>{money(r.sales.total)}</b>
              <small className="muted">{delta === null ? "sin periodo anterior" : `${delta >= 0 ? "▲" : "▼"} ${pct(Math.abs(delta))} vs. periodo anterior`}</small>
            </div>
            <div className="kpi"><span>Servicios</span><b>{money(r.sales.services)}</b><small className="muted">{plural(r.appointments.DONE, "servicio realizado", "servicios realizados")}</small></div>
            <div className="kpi"><span>Boutique</span><b>{money(r.sales.products)}</b><small className="muted">{r.sales.total ? pct(r.sales.products / r.sales.total) : "0%"} de las ventas</small></div>
            <div className="kpi"><span>Ticket promedio</span><b>{money(r.sales.avgTicket)}</b><small className="muted">{plural(r.sales.tickets, "cobro", "cobros")}</small></div>
            <div className="kpi"><span>Clientes atendidos</span><b>{r.clients.attended}</b><small className="muted">{plural(r.clients.new, "nuevo", "nuevos")} · {r.clients.returning} {r.clients.returning === 1 ? "regresó" : "regresaron"}</small></div>
            <div className="kpi"><span>No llegaron</span><b>{pct(r.appointments.noShowRate)}</b><small className="muted">{plural(r.appointments.NO_SHOW, "cita", "citas")} · {plural(r.appointments.CANCELLED, "cancelada", "canceladas")}</small></div>
          </div>

          <section className="card" style={{ marginBottom: 14 }}>
            <h3>Ventas por día</h3>
            <SalesChart days={r.sales.byDay} />
          </section>

          <div className="caja" style={{ marginBottom: 14 }}>
            <section className="card">
              <h3>Servicios realizados</h3>
              <BarTable rows={r.topServices.map((s) => ({ label: s.name, value: s.revenue, note: `${s.count}` }))} noteHead="Veces" empty="Sin servicios terminados en este periodo." />
            </section>
            <section className="card">
              <h3>Lo más vendido de la boutique</h3>
              <BarTable rows={r.topProducts.map((p) => ({ label: p.name, value: p.revenue, note: `${p.qty}` }))} noteHead="Piezas" empty="Sin ventas de boutique en este periodo." />
            </section>
          </div>

          <div className="caja" style={{ marginBottom: 14 }}>
            <section className="card">
              <h3>Días y horas más llenos</h3>
              <p className="muted" style={{ fontSize: ".85rem" }}>Citas por hora de inicio (sin canceladas). Útil para decidir turnos y promociones en horas flojas.</p>
              <Heat heat={r.appointments.heat} />
            </section>
            <section className="card">
              <h3>Cómo agendan</h3>
              <BarTable
                rows={Object.entries(r.appointments.bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: SOURCE_LABEL[k] ?? k, value: v, note: "" }))}
                format={(v) => plural(v, "cita", "citas")}
                empty="Sin citas en este periodo."
              />
              <h3 style={{ marginTop: 10 }}>Formas de pago</h3>
              <BarTable rows={Object.entries(r.sales.byMethod).map(([k, v]) => ({ label: METHOD_LABEL[k], value: v, note: "" }))} empty="Sin cobros." />
            </section>
          </div>

          <section className="card">
            <h3>Clientes por recuperar</h3>
            <p className="muted" style={{ fontSize: ".85rem" }}>Su última visita fue hace más de {r.winbackDays} días y no tienen cita próxima. Mándales un mensaje para invitarlos de vuelta.</p>
            {r.winback.length ? (
              <div className="tablewrap">
                <table className="slim">
                  <thead><tr><th>Cliente</th><th>Lomitos</th><th className="r">Visitas</th><th>Última visita</th><th></th></tr></thead>
                  <tbody>
                    {r.winback.map((w) => (
                      <tr key={w.clientId}>
                        <td><b>{w.name}</b><br /><span className="muted">{w.phone}</span></td>
                        <td>{w.pets.join(", ")}</td>
                        <td className="r">{w.visits}</td>
                        <td>hace {w.daysAgo} días</td>
                        <td className="r">
                          <a className="btn ghost" style={{ textDecoration: "none" }} target="_blank" rel="noreferrer"
                            href={waLink(w.phone, `Hola ${w.name.split(" ")[0]} 🐾 ¡Extrañamos a ${w.pets[0] ?? "tu lomito"} en Lomito Atelier! ¿Le agendamos su próximo spa? Reserva aquí: ${location.origin}`)}>
                            Invitar por WhatsApp
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Nadie por ahora.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Barras verticales de ventas por día con tooltip. Una sola serie (total); el desglose va en el tooltip. */
function SalesChart({ days }: { days: Report["sales"]["byDay"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = days.map((d) => d.services + d.products);
  const max = Math.max(1, ...totals);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const W = 900, H = 220, L = 64, B = 26, T = 10;
  const bw = (W - L) / days.length;
  const barW = Math.max(2, Math.min(28, bw - 2));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.ceil(days.length / 10);
  const h = hover !== null ? days[hover] : null;
  const allZero = totals.every((t) => t === 0);

  return (
    <div className="chart">
      {allZero ? (
        <p className="muted">Sin ventas en este periodo.</p>
      ) : (
        <div style={{ position: "relative" }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Ventas por día" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W} y1={y(t)} y2={y(t)} className="grid" />
                <text x={L - 8} y={y(t) + 4} textAnchor="end" className="axis">{money(t)}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const v = totals[i];
              const x = L + i * bw + (bw - barW) / 2;
              const yy = y(v);
              const hgt = Math.max(0, H - B - yy);
              const r = Math.min(4, barW / 2, hgt);
              return (
                <g key={d.date}>
                  {v > 0 && (
                    <path className={`bar${hover === i ? " on" : ""}`}
                      d={`M${x},${H - B} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${H - B} Z`} />
                  )}
                  {i % labelEvery === 0 && (
                    <text x={L + i * bw + bw / 2} y={H - 8} textAnchor="middle" className="axis">{dayParts(d.date).day}</text>
                  )}
                  <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent"
                    onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
                    aria-label={`${d.date}: ${money(v)}`} />
                </g>
              );
            })}
            <line x1={L} x2={W} y1={H - B} y2={H - B} className="baseline" />
          </svg>
          {h && hover !== null && (
            <div className="tip" style={{ left: `${((L + hover * bw + bw / 2) / W) * 100}%` }}>
              <b>{dayParts(h.date).dow} {dayParts(h.date).day} {dayParts(h.date).mon}</b>
              <span>Total <b className="num">{money(h.services + h.products)}</b></span>
              <span className="muted">Servicios {money(h.services)}</span>
              <span className="muted">Boutique {money(h.products)}</span>
            </div>
          )}
        </div>
      )}
      <details>
        <summary className="muted" style={{ fontSize: ".85rem", cursor: "pointer" }}>Ver como tabla</summary>
        <div className="tablewrap" style={{ marginTop: 8 }}>
          <table className="slim">
            <thead><tr><th>Día</th><th className="r">Servicios</th><th className="r">Boutique</th><th className="r">Total</th></tr></thead>
            <tbody>
              {days.filter((d) => d.services + d.products > 0).map((d) => (
                <tr key={d.date}><td>{d.date}</td><td className="r">{money(d.services)}</td><td className="r">{money(d.products)}</td><td className="r">{money(d.services + d.products)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Tabla con barra proporcional (una sola serie). */
function BarTable({ rows, empty, noteHead, format = money }: { rows: { label: string; value: number; note: string }[]; empty: string; noteHead?: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length || rows.every((r) => r.value === 0)) return <p className="muted">{empty}</p>;
  return (
    <table className="bartable">
      {noteHead && <thead><tr><th></th><th className="r">{noteHead}</th><th className="r">Total</th></tr></thead>}
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>
              <div>{r.label}</div>
              <div className="track"><div className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
            </td>
            {noteHead && <td className="r num">{r.note}</td>}
            <td className="r num">{format(r.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Mapa de calor día × hora (secuencial, un solo tono). */
function Heat({ heat }: { heat: number[][] }) {
  const hours = useMemo(() => {
    let lo = 24, hi = -1;
    heat.forEach((row) => row.forEach((v, h) => { if (v) { lo = Math.min(lo, h); hi = Math.max(hi, h); } }));
    if (hi < 0) return [];
    lo = Math.min(lo, 9); hi = Math.max(hi, 18);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [heat]);
  const max = Math.max(1, ...heat.flat());
  if (!hours.length) return <p className="muted">Sin citas en este periodo.</p>;
  return (
    <div className="tablewrap" style={{ border: 0 }}>
      <table className="heat">
        <thead><tr><th></th>{hours.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {WEEK.map(([name, idx]) => (
            <tr key={name}>
              <th>{name}</th>
              {hours.map((h) => {
                const v = heat[idx][h];
                const level = v ? Math.ceil((v / max) * 4) : 0;
                return <td key={h} className={`lv${level}`} title={`${name} ${h}:00 · ${v} cita${v === 1 ? "" : "s"}`}>{v || ""}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="heat-legend muted"><span>menos</span>{[1, 2, 3, 4].map((l) => <i key={l} className={`lv${l}`} />)}<span>más</span></div>
    </div>
  );
}
