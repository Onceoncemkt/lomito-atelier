import { useEffect, useState } from "react";
import { api } from "../api";
import { money, todayYmd, addDays, dayParts } from "../format";

type Res = { from: string; to: string; total: number; rows: { groomerId: string; name: string; services: number; unpaidServices: number; base: number; pct: number; commission: number }[] };

/** Semana de martes a domingo que contiene `d` (lunes cuenta con la semana anterior). */
function weekOf(d: string) {
  const wd = dayParts(d).weekday; // 0 dom … 6 sáb
  const sinceTue = (wd + 5) % 7;
  const from = addDays(d, -sinceTue);
  return { from, to: addDays(from, 6) };
}

export default function Comisiones() {
  const [range, setRange] = useState(() => weekOf(todayYmd()));
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<Res>("/api/commissions", { query: range }).then(setRes).catch((e) => setErr(e.message));
  }, [range]);

  return (
    <div>
      <div className="agenda-head">
        <h2>Comisiones</h2>
        <div className="inline">
          <button className="btn ghost" onClick={() => setRange(weekOf(addDays(range.from, -7)))}>‹ Semana anterior</button>
          <label htmlFor="f">Del</label>
          <input id="f" type="date" className="search" style={{ width: 160 }} value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
          <label htmlFor="t">al</label>
          <input id="t" type="date" className="search" style={{ width: 160 }} value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
          <button className="btn ghost" onClick={() => setRange(weekOf(addDays(range.from, 7)))}>Semana siguiente ›</button>
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      <p className="muted" style={{ marginBottom: 12 }}>Porcentaje sobre servicios terminados (servicio + extras). La boutique no paga comisión. El sueldo base va aparte.</p>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Groomer</th><th className="r">Servicios</th><th className="r">Vendido en servicios</th><th className="r">%</th><th className="r">Comisión</th></tr></thead>
          <tbody>
            {!res ? (
              <tr><td colSpan={5} className="muted">Cargando…</td></tr>
            ) : (
              <>
                {res.rows.map((r) => (
                  <tr key={r.groomerId}>
                    <td>{r.name}{r.unpaidServices ? <span className="muted"> · {r.unpaidServices} sin cobrar</span> : null}</td>
                    <td className="r">{r.services}</td>
                    <td className="r">{money(r.base)}</td>
                    <td className="r">{r.pct}%</td>
                    <td className="r">{money(r.commission)}</td>
                  </tr>
                ))}
                <tr className="total"><td colSpan={4}>Total a pagar en comisiones</td><td className="r">{money(res.total)}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
