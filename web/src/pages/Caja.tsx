import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useCatalog } from "../useCatalog";
import { money, todayYmd, addDays, longDate, cap, METHOD_LABEL, toCentavos } from "../format";

type Summary = {
  date: string;
  total: number;
  tickets: number;
  services: number;
  products: number;
  byMethod: Record<"CASH" | "CARD" | "TRANSFER", number>;
  openingFloat: number;
  expectedCash: number;
  closing: null | { openingFloat: number; expectedCash: number; countedCash: number; difference: number; notes: string | null; createdAt: string };
  sales: { id: string; time: string; method: string; total: number; items: { kind: string; name: string; qty: number; unitPrice: number }[] }[];
  pending: { id: string; time: string; pet: string; client: string; service: string; price: number; status: string }[];
  activity: { time: string; type: string; message: string }[];
};
type Line = { kind: "appt"; id: string; name: string; price: number } | { kind: "prod"; id: string; name: string; price: number; qty: number; stock: number };

export default function Caja() {
  const [params, setParams] = useSearchParams();
  const today = todayYmd();
  const date = params.get("date") ?? today;
  const preAppt = params.get("appt");
  const { cat, reload: reloadCat } = useCatalog();
  const [sum, setSum] = useState<Summary | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [method, setMethod] = useState<"CASH" | "CARD" | "TRANSFER">("CARD");
  const [received, setReceived] = useState("");
  const [float, setFloat] = useState("500");
  const [counted, setCounted] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const isToday = date === today;

  const load = useCallback(() => {
    api<Summary>(`/api/cash/${date}`, { query: { openingFloat: toCentavos(float) } }).then(setSum).catch((e) => setErr(e.message));
  }, [date, float]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!preAppt || !sum) return;
    const a = sum.pending.find((p) => p.id === preAppt);
    if (a && !cart.some((l) => l.kind === "appt" && l.id === a.id)) {
      setCart((c) => [...c, { kind: "appt", id: a.id, name: `${a.pet} · ${a.service}`, price: a.price }]);
    }
    const next = new URLSearchParams(params);
    next.delete("appt");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preAppt, sum]);

  const setDate = (d: string) => {
    const next = new URLSearchParams(params);
    next.set("date", d);
    setParams(next);
    setCart((c) => c.filter((l) => l.kind === "prod"));
  };

  const total = cart.reduce((t, l) => t + l.price * (l.kind === "prod" ? l.qty : 1), 0);
  const rec = toCentavos(received);
  const cashShort = method === "CASH" && received !== "" && rec < total;

  function addProduct(p: { id: string; name: string; price: number; stock: number }) {
    setCart((c) => {
      const ex = c.find((l) => l.kind === "prod" && l.id === p.id) as Extract<Line, { kind: "prod" }> | undefined;
      if (ex) return ex.qty >= p.stock ? c : c.map((l) => (l === ex ? { ...ex, qty: ex.qty + 1 } : l));
      return [...c, { kind: "prod", id: p.id, name: p.name, price: p.price, qty: 1, stock: p.stock }];
    });
  }

  async function charge() {
    setErr("");
    setBusy(true);
    try {
      const r = await api<{ total: number; change: number | null }>("/api/sales", {
        method: "POST",
        body: {
          items: cart.map((l) => (l.kind === "appt" ? { appointmentId: l.id } : { productId: l.id, qty: l.qty })),
          method,
          received: method === "CASH" && received !== "" ? rec : undefined,
        },
      });
      setMsg(`Cobrado: ${money(r.total)} en ${METHOD_LABEL[method].toLowerCase()}${r.change ? ` · cambio ${money(r.change)}` : ""}`);
      setTimeout(() => setMsg(""), 5000);
      setCart([]);
      setReceived("");
      load();
      reloadCat();
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  async function closeDay() {
    if (!confirm("¿Hacer el corte de caja? Ya no se podrá cobrar más este día.")) return;
    setErr("");
    setBusy(true);
    try {
      await api(`/api/cash/${date}/close`, { method: "POST", body: { openingFloat: toCentavos(float), countedCash: toCentavos(counted), notes: closeNotes || null } });
      load();
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  const expected = sum ? (sum.closing ? sum.closing.expectedCash : toCentavos(float) + sum.byMethod.CASH) : 0;
  const diff = counted === "" ? null : toCentavos(counted) - expected;

  return (
    <div>
      <div className="agenda-head">
        <h2>Caja · {cap(longDate(date))}</h2>
        <div className="inline">
          <button className="btn ghost" onClick={() => setDate(addDays(date, -1))} aria-label="Día anterior">‹</button>
          <input type="date" className="search" style={{ width: 160 }} value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button className="btn ghost" disabled={date >= today} onClick={() => setDate(addDays(date, 1))} aria-label="Día siguiente">›</button>
        </div>
      </div>
      {err && <div className="err" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
      {!sum || !cat ? (
        <p className="loading">Cargando…</p>
      ) : (
        <div className="caja">
          <section className="card">
            <h3>Cobrar</h3>
            {!isToday || sum.closing ? (
              <p className="muted">{sum.closing ? "La caja de este día ya está cerrada." : "Sólo se puede cobrar en el día de hoy."}</p>
            ) : (
              <>
                <p className="lbl">Citas por cobrar</p>
                {sum.pending.length ? (
                  <div className="opts">
                    {sum.pending.map((a) => {
                      const inCart = cart.some((l) => l.kind === "appt" && l.id === a.id);
                      return (
                        <button key={a.id} className="opt" disabled={inCart} onClick={() => setCart((c) => [...c, { kind: "appt", id: a.id, name: `${a.pet} · ${a.service}`, price: a.price }])}>
                          <b>{a.time} · {a.pet}</b>
                          <span>{a.service} · {money(a.price)}{a.status === "DONE" ? " · terminada" : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="muted">No hay citas pendientes de cobro.</p>
                )}
                <p className="lbl">Boutique</p>
                <div className="opts">
                  {cat.products.filter((p) => p.active).map((p) => (
                    <button key={p.id} className="opt" disabled={p.stock < 1} onClick={() => addProduct(p)}>
                      <b>{p.name}</b>
                      <span>{money(p.price)} · {p.stock < 1 ? "agotado" : `${p.stock} en stock`}</span>
                    </button>
                  ))}
                </div>
                <p className="lbl">Cuenta</p>
                <div className="cart">
                  {cart.length ? cart.map((l, i) => (
                    <div className="cart-row" key={l.kind + l.id}>
                      <span>{l.name}</span>
                      <span className="qty">
                        {l.kind === "prod" && (
                          <>
                            <button aria-label="Quitar uno" onClick={() => setCart((c) => c.flatMap((x, j) => (j !== i || x.kind !== "prod" ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : [])))}>−</button>
                            <b className="num">{l.qty}</b>
                            <button aria-label="Agregar uno" onClick={() => setCart((c) => c.map((x, j) => (j === i && x.kind === "prod" && x.qty < x.stock ? { ...x, qty: x.qty + 1 } : x)))}>+</button>
                          </>
                        )}
                      </span>
                      <span className="num">{money(l.price * (l.kind === "prod" ? l.qty : 1))}</span>
                      <button className="x" aria-label="Quitar" onClick={() => setCart((c) => c.filter((_, j) => j !== i))}>×</button>
                    </div>
                  )) : <p className="muted">Agrega una cita o productos.</p>}
                </div>
                <div className="cart-total"><span>Total</span><b className="num">{money(total)}</b></div>
                <div className="seg" role="group" aria-label="Forma de pago">
                  {(["CASH", "CARD", "TRANSFER"] as const).map((m) => (
                    <button key={m} aria-pressed={method === m} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</button>
                  ))}
                </div>
                {method === "CASH" && (
                  <div className="inline">
                    <label htmlFor="rec">Recibido $</label>
                    <input id="rec" inputMode="decimal" style={{ width: 110 }} value={received} onChange={(e) => setReceived(e.target.value)} />
                    {received !== "" && rec >= total && total > 0 && <b>Cambio: {money(rec - total)}</b>}
                  </div>
                )}
                {msg && <div className="okmsg">{msg}</div>}
                <button className="btn" disabled={!cart.length || busy || cashShort} onClick={charge}>{busy ? "Cobrando…" : `Cobrar ${money(total)}`}</button>
              </>
            )}
          </section>

          <section className="card">
            <h3>Corte del día</h3>
            <div className="kpis" style={{ marginBottom: 0 }}>
              <div className="kpi"><span>Vendido</span><b>{money(sum.total)}</b></div>
              <div className="kpi"><span>Servicios</span><b>{money(sum.services)}</b></div>
              <div className="kpi"><span>Boutique</span><b>{money(sum.products)}</b></div>
              <div className="kpi"><span>Tickets</span><b>{sum.tickets}</b></div>
            </div>
            <div className="tablewrap">
              <table className="slim">
                <tbody>
                  {(["CASH", "CARD", "TRANSFER"] as const).map((m) => (
                    <tr key={m}><td>{METHOD_LABEL[m]}</td><td className="r">{money(sum.byMethod[m])}</td></tr>
                  ))}
                  <tr className="total"><td>Efectivo esperado (fondo + efectivo)</td><td className="r">{money(expected)}</td></tr>
                  {sum.closing ? (
                    <>
                      <tr><td>Contado</td><td className="r">{money(sum.closing.countedCash)}</td></tr>
                      <tr><td>Diferencia</td><td className="r" style={{ color: sum.closing.difference === 0 ? "var(--accent)" : "var(--warn)" }}>{sum.closing.difference > 0 ? "+" : sum.closing.difference < 0 ? "−" : ""}{money(Math.abs(sum.closing.difference))}</td></tr>
                    </>
                  ) : diff !== null ? (
                    <tr><td>Diferencia contra lo contado</td><td className="r" style={{ color: diff === 0 ? "var(--accent)" : "var(--warn)" }}>{diff > 0 ? "+" : diff < 0 ? "−" : ""}{money(Math.abs(diff))}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {sum.closing ? (
              <div className="okmsg">Corte hecho a las {new Date(sum.closing.createdAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}{sum.closing.notes ? ` · ${sum.closing.notes}` : ""}</div>
            ) : (
              <div className="form">
                <div className="row2">
                  <div className="field"><label htmlFor="fl">Fondo inicial $</label><input id="fl" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} /></div>
                  <div className="field"><label htmlFor="ct">Efectivo contado $</label><input id="ct" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></div>
                </div>
                <div className="field"><label htmlFor="cn">Notas del corte</label><input id="cn" value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} /></div>
                <button className="btn" disabled={counted === "" || busy || date > today} onClick={closeDay}>Hacer corte de caja</button>
              </div>
            )}
            <p className="lbl">Ventas</p>
            <div className="tablewrap">
              <table className="slim">
                <thead><tr><th>Hora</th><th>Concepto</th><th>Pago</th><th className="r">Total</th></tr></thead>
                <tbody>
                  {sum.sales.length ? sum.sales.map((s) => (
                    <tr key={s.id}>
                      <td className="num">{s.time}</td>
                      <td>{s.items.map((i, k) => <div key={k}>{i.qty > 1 ? `${i.qty}× ` : ""}{i.name}</div>)}</td>
                      <td>{METHOD_LABEL[s.method]}</td>
                      <td className="r">{money(s.total)}</td>
                    </tr>
                  )) : <tr><td colSpan={4} className="muted">Sin ventas este día.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="lbl">Actividad del día</p>
            <ul className="log">
              {sum.activity.length ? sum.activity.map((l, i) => (
                <li key={i}><span className="num muted">{l.time}</span> {l.message}</li>
              )) : <li className="muted">Sin actividad registrada.</li>}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
