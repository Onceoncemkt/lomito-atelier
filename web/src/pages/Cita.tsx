import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, BUSINESS_SLUG } from "../api";
import { money, SIZE_LABEL, todayYmd, addDays, dayParts, longDate, cap, hm, ymd } from "../format";
import { useLightTheme } from "../useLightTheme";

type Data = {
  business: { name: string; phone: string | null; minNoticeHours: number; openingHours: Record<string, unknown> };
  appointment: {
    status: "BOOKED" | "DONE" | "CANCELLED" | "NO_SHOW";
    startsAt: string;
    endsAt: string;
    petName: string;
    clientName: string;
    service: string;
    size: string;
    addOns: string[];
    price: number;
    drying: string;
  };
  canChange: boolean;
  reason: string | null;
};
type Slots = { slots: { time: string; startsAt: string; current?: boolean }[] };

const WHATSAPP = import.meta.env.VITE_WHATSAPP as string | undefined;

/** Página de la liga privada: el cliente ve, cambia o cancela su cita. */
export default function Cita() {
  useLightTheme();
  const { token = "" } = useParams();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"view" | "move" | "cancel">("view");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slots["slots"] | null>(null);
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const base = `/public/${BUSINESS_SLUG}/manage/${token}`;
  const load = useCallback(() => {
    api<Data>(base).then(setData).catch((e) => setErr(e.status === 404 ? "No encontramos esta cita. Revisa que la liga esté completa." : e.message));
  }, [base]);
  useEffect(load, [load]);

  const days = useMemo(() => {
    if (!data) return [];
    const out: string[] = [];
    for (let i = 0; out.length < 14 && i < 45; i++) {
      const d = addDays(todayYmd(), i);
      if (data.business.openingHours[String(dayParts(d).weekday || 7)]) out.push(d);
    }
    return out;
  }, [data]);

  useEffect(() => {
    if (mode !== "move" || !date) return;
    setSlots(null);
    setSlot("");
    api<Slots>(`${base}/availability`, { query: { date } }).then((r) => setSlots(r.slots)).catch((e) => setErr(e.message));
  }, [mode, date, base]);

  async function act(path: string, body?: object, ok?: string) {
    setBusy(true);
    setErr("");
    try {
      setData(await api<Data>(`${base}/${path}`, { method: "POST", body }));
      setMode("view");
      setMsg(ok ?? "");
    } catch (x: any) {
      setErr(x.message);
      if (x.status === 409 && date) api<Slots>(`${base}/availability`, { query: { date } }).then((r) => setSlots(r.slots));
    } finally {
      setBusy(false);
    }
  }

  const contact = data?.business.phone || WHATSAPP;
  const a = data?.appointment;
  const d = a ? ymd(new Date(a.startsAt)) : "";

  return (
    <div className="public">
      <div className="phone">
        <div className="phone-head">
          <img src="/lomito-creme.svg" alt="Lomito Atelier" />
          <h2>Tu cita</h2>
        </div>
        <div className="phone-body">
          {!data ? (
            err ? <div className="err">{err}</div> : <p className="loading">Cargando…</p>
          ) : (
            <>
              {msg && <div className="okmsg" role="status">{msg}</div>}
              <div className={a!.status === "CANCELLED" ? "summary" : "ok"} style={{ textAlign: "left" }}>
                <h3 style={{ textAlign: "center" }}>
                  {a!.status === "CANCELLED" ? `Cita de ${a!.petName} cancelada` : `${a!.petName} te espera`}
                </h3>
                <div className="kv">
                  <span>Cuándo</span><b>{cap(longDate(d))} · {hm(a!.startsAt)}</b>
                  <span>Servicio</span><b>{a!.service}{a!.addOns.length ? ` + ${a!.addOns.join(", ")}` : ""}</b>
                  <span>Tamaño</span><b>{SIZE_LABEL[a!.size]?.name}</b>
                  <span>Total</span><b className="num">{money(a!.price)}</b>
                </div>
              </div>

              {err && <div className="err" role="alert">{err}</div>}

              {data.canChange && mode === "view" && (
                <div className="form">
                  <button className="btn" onClick={() => { setMode("move"); setDate(d); setMsg(""); }}>Cambiar día u hora</button>
                  <button className="btn ghost" onClick={() => { setMode("cancel"); setMsg(""); }}>Cancelar cita</button>
                  <p className="muted" style={{ fontSize: ".82rem", textAlign: "center" }}>
                    Puedes cambiar o cancelar hasta {data.business.minNoticeHours} horas antes.
                  </p>
                </div>
              )}

              {mode === "move" && (
                <section className="step">
                  <h3>Elige el nuevo día y hora</h3>
                  <div className="days" role="group" aria-label="Día">
                    {days.map((x) => {
                      const p = dayParts(x);
                      return (
                        <button type="button" key={x} className="day" aria-pressed={x === date} onClick={() => setDate(x)}>
                          <small>{p.dow}</small><b>{p.day}</b><small>{p.mon}</small>
                        </button>
                      );
                    })}
                  </div>
                  {!slots ? (
                    <p className="loading">Buscando horarios…</p>
                  ) : slots.length ? (
                    <div className="slots" role="group" aria-label="Hora">
                      {slots.map((s) => (
                        <button type="button" key={s.startsAt} className="slot" disabled={s.current} title={s.current ? "Tu hora actual" : undefined} aria-pressed={s.startsAt === slot} onClick={() => setSlot(s.startsAt)}>
                          {s.time}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No hay horarios este día. Prueba otro.</p>
                  )}
                  <div className="actions">
                    <button className="btn ghost" disabled={busy} onClick={() => { setMode("view"); setErr(""); }}>Volver</button>
                    <button className="btn" disabled={!slot || busy} onClick={() => act("reschedule", { startsAt: slot }, "Listo, cambiamos tu cita.")}>
                      {busy ? "Guardando…" : slot ? `Cambiar a las ${hm(slot)}` : "Elige una hora"}
                    </button>
                  </div>
                </section>
              )}

              {mode === "cancel" && (
                <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && !busy && setMode("view")}>
                  <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cx">
                    <h2 id="cx">¿Cancelar la cita de {a!.petName}?</h2>
                    <p className="muted">{cap(longDate(d))} a las {hm(a!.startsAt)}. Liberaremos el horario para otro lomito.</p>
                    <div className="actions" style={{ justifyContent: "flex-end" }}>
                      <button className="btn ghost" disabled={busy} onClick={() => setMode("view")}>No, mantenerla</button>
                      <button className="btn" disabled={busy} onClick={() => act("cancel", undefined, "Tu cita quedó cancelada.")}>{busy ? "Cancelando…" : "Sí, cancelar"}</button>
                    </div>
                  </div>
                </div>
              )}

              {!data.canChange && data.reason && a!.status !== "CANCELLED" && <p className="hint">{data.reason}</p>}
              {a!.status === "CANCELLED" && <a className="btn" style={{ textAlign: "center", textDecoration: "none" }} href="/">Agendar otra cita</a>}
              {contact && (
                <a className="btn ghost" style={{ textAlign: "center", textDecoration: "none" }} href={`https://wa.me/52${contact}`} target="_blank" rel="noreferrer">
                  Escríbenos por WhatsApp
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
