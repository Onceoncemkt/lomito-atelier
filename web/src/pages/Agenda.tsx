import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import { VACCINE_LABEL } from "../image";
import { useCatalog, type Catalog } from "../useCatalog";
import {
  money, todayYmd, addDays, dayParts, hm, minutesOf, localIso, SIZES, SIZE_LABEL, STATUS_LABEL, SOURCE_LABEL, waLink, longDate, cap,
} from "../format";

export type Appt = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "BOOKED" | "DONE" | "CANCELLED" | "NO_SHOW";
  source: string;
  price: number;
  paid: boolean;
  useCabin: boolean;
  notes: string | null;
  size: string;
  groomer: { id: string; name: string };
  service: { id: string; name: string };
  addOns: { id: string; name: string; price: number }[];
  pet: { id: string; name: string; breed: string | null; notes: string | null; vaccine?: string; vaccineExpiresAt?: string | null };
  client: { id: string; name: string; phone: string };
  visits?: number;
  manageToken?: string | null;
};
type Day = { date: string; open: string | null; close: string | null; groomers: { id: string; name: string }[]; appointments: Appt[] };

const PX_PER_MIN = 0.8; // 48 px por hora
const COLORS = ["var(--g1)", "var(--g2)", "#E7E0F4", "#F4EBD0"];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default function Agenda() {
  const { me } = useSession();
  const { cat } = useCatalog();
  const nav = useNavigate();
  const [date, setDate] = useState(todayYmd());
  const [day, setDay] = useState<Day | null>(null);
  const [err, setErr] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ groomerId?: string; time?: string } | null>(null);
  const staff = me?.user.role !== "GROOMER";

  const load = useCallback(() => {
    api<Day>("/api/agenda", { query: { date } })
      .then((d) => {
        setDay(d);
        setErr("");
      })
      .catch((e) => setErr(e.message));
  }, [date]);
  useEffect(load, [load]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const sel = day?.appointments.find((a) => a.id === selId) ?? null;
  const active = day?.appointments.filter((a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW") ?? [];
  const kpis = {
    citas: active.length,
    terminadas: active.filter((a) => a.status === "DONE").length,
    porCobrar: active.filter((a) => !a.paid).reduce((t, a) => t + a.price, 0),
    total: active.reduce((t, a) => t + a.price, 0),
  };

  const strip = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(todayYmd(), i - 1)), []);

  return (
    <div>
      <div className="agenda-head">
        <div>
          <h2>{cap(longDate(date))}</h2>
          {day && !day.open && <p className="muted">Cerrado este día</p>}
        </div>
        <div className="inline">
          <button className="btn ghost" onClick={() => setDate(addDays(date, -1))} aria-label="Día anterior">‹</button>
          <input type="date" className="search" style={{ width: 160 }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button className="btn ghost" onClick={() => setDate(addDays(date, 1))} aria-label="Día siguiente">›</button>
          {staff && (
            <button className="btn" onClick={() => { setSelId(null); setDraft({}); }}>+ Nueva cita</button>
          )}
        </div>
      </div>
      <div className="days" style={{ marginBottom: 12 }}>
        {strip.map((d) => {
          const p = dayParts(d);
          return (
            <button key={d} className="day" aria-pressed={d === date} onClick={() => setDate(d)}>
              <small>{p.dow}</small>
              <b>{p.day}</b>
              <small>{p.mon}</small>
            </button>
          );
        })}
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="kpis">
        <div className="kpi"><span>Citas</span><b>{kpis.citas}</b></div>
        <div className="kpi"><span>Terminadas</span><b>{kpis.terminadas}</b></div>
        <div className="kpi"><span>Por cobrar</span><b>{money(kpis.porCobrar)}</b></div>
        <div className="kpi"><span>Total del día</span><b>{money(kpis.total)}</b></div>
      </div>
      {!day ? (
        <p className="loading">Cargando agenda…</p>
      ) : (
        <div className="cal-wrap">
          <Calendar
            day={day}
            selId={selId}
            onSelect={(id) => { setDraft(null); setSelId(id); }}
            onEmpty={staff ? (groomerId, time) => { setSelId(null); setDraft({ groomerId, time }); } : undefined}
          />
          <aside>
            {draft && cat && day ? (
              <NewAppt
                cat={cat}
                date={date}
                day={day}
                initial={draft}
                onCancel={() => setDraft(null)}
                onSaved={(a) => { setDraft(null); load(); setSelId(a.id); }}
                onGoToday={() => setDate(todayYmd())}
              />
            ) : sel ? (
              <Detail
                a={sel}
                day={day}
                staff={staff}
                onChanged={load}
                onCharge={() => nav(`/panel/caja?appt=${sel.id}&date=${date}`)}
              />
            ) : (
              <div className="detail">
                <h3>Toca una cita para ver el detalle</h3>
                <p className="muted">{staff ? "O toca un espacio vacío en la columna de un groomer para agendar ahí." : "Aquí verás tus citas del día."}</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Calendar({ day, selId, onSelect, onEmpty }: {
  day: Day;
  selId: string | null;
  onSelect: (id: string) => void;
  onEmpty?: (groomerId: string, time: string) => void;
}) {
  const visible = day.appointments.filter((a) => a.status !== "CANCELLED");
  const starts = visible.map((a) => minutesOf(a.startsAt));
  const ends = visible.map((a) => minutesOf(a.endsAt));
  const open = Math.min(day.open ? toMin(day.open) : 9 * 60, ...starts);
  const close = Math.max(day.close ? toMin(day.close) : 19 * 60, ...ends);
  const first = Math.floor(open / 60) * 60;
  const last = Math.ceil(close / 60) * 60;
  const height = (last - first) * PX_PER_MIN;
  const hours = Array.from({ length: (last - first) / 60 }, (_, i) => first + i * 60);
  const isToday = day.date === todayYmd();
  const now = minutesOf(new Date());
  const groomers = day.groomers.length ? day.groomers : [{ id: "-", name: "Sin groomers" }];

  return (
    <div className="cal">
      <div className="cal-grid" style={{ gridTemplateColumns: `56px repeat(${groomers.length}, minmax(180px,1fr))` }}>
        <div className="cal-col-h" />
        {groomers.map((g, i) => (
          <div key={g.id} className="cal-col-h">
            <span className="dot" style={{ background: COLORS[i % COLORS.length] }} />
            {g.name}
          </div>
        ))}
        <div className="hours" style={{ height }}>
          {hours.map((h) => <div key={h}>{fromMin(h)}</div>)}
        </div>
        {groomers.map((g, i) => (
          <div
            key={g.id}
            className="col"
            style={{ height }}
            onClick={(e) => {
              if (!onEmpty || e.target !== e.currentTarget) return;
              const y = e.nativeEvent.offsetY;
              const m = first + Math.floor(y / PX_PER_MIN / 30) * 30;
              onEmpty(g.id, fromMin(m));
            }}
          >
            {isToday && now >= first && now <= last && <div className="now-line" style={{ top: (now - first) * PX_PER_MIN }} />}
            {visible
              .filter((a) => a.groomer.id === g.id)
              .map((a) => {
                const s = minutesOf(a.startsAt);
                const e = minutesOf(a.endsAt);
                return (
                  <button
                    key={a.id}
                    className={`appt${a.id === selId ? " sel" : ""}${a.status !== "BOOKED" ? " done" : ""}`}
                    style={{ top: (s - first) * PX_PER_MIN + 2, height: Math.max(26, (e - s) * PX_PER_MIN - 4), background: COLORS[i % COLORS.length] }}
                    onClick={() => onSelect(a.id)}
                  >
                    <b>{hm(a.startsAt)} · {a.pet.name}</b>
                    <span>{a.service.name}{a.addOns.length ? ` + ${a.addOns.length}` : ""}</span>
                    <span>
                      <span className={`chip ${a.useCabin ? "cab" : "mano"}`}>{a.useCabin ? "Cabina" : "A mano"}</span>{" "}
                      {a.paid && <span className="chip paid">Pagado</span>}
                      {a.status === "NO_SHOW" && <span className="chip">No llegó</span>}
                      {a.pet.vaccine && a.pet.vaccine !== "APPROVED" && a.status === "BOOKED" && <span className="chip mano" title={VACCINE_LABEL[a.pet.vaccine]?.text}>Cartilla</span>}
                    </span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Detail({ a, day, staff, onChanged, onCharge }: { a: Appt; day: Day; staff: boolean; onChanged: () => void; onCharge: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [moving, setMoving] = useState(false);
  const [mv, setMv] = useState({ time: hm(a.startsAt), groomerId: a.groomer.id });
  useEffect(() => { setMoving(false); setErr(""); setMv({ time: hm(a.startsAt), groomerId: a.groomer.id }); }, [a.id, a.startsAt, a.groomer.id]);

  async function patch(body: object) {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/appointments/${a.id}`, { method: "PATCH", body });
      setMoving(false);
      onChanged();
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  const date = day.date;
  const reminder = `Hola ${a.client.name.split(" ")[0]} 🐾 Te recordamos la cita de ${a.pet.name} en Lomito Atelier el ${longDate(date)} a las ${hm(a.startsAt)}. ¡Lo esperamos!${a.manageToken ? `\n\nSi necesitas cambiar o cancelar: ${location.origin}/cita/${a.manageToken}` : ""}`;
  const times: string[] = [];
  for (let m = toMin(day.open ?? "09:00"); m < toMin(day.close ?? "19:00"); m += 30) times.push(fromMin(m));

  return (
    <div className="detail">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
        <div>
          <h2>{a.pet.name}</h2>
          <p className="muted">{a.pet.breed ?? "Sin raza"} · {SIZE_LABEL[a.size]?.name}{a.visits ? ` · visita #${a.visits}` : ""}</p>
        </div>
        <span className={`chip ${a.useCabin ? "cab" : "mano"}`}>{a.useCabin ? "Cabina" : "A mano"}</span>
      </div>
      <div className="kv">
        <span>Hora</span><b className="num">{hm(a.startsAt)} – {hm(a.endsAt)}</b>
        <span>Groomer</span><b>{a.groomer.name}</b>
        <span>Tamaño</span>
        {staff && !a.paid && (a.status === "BOOKED" || a.status === "DONE") ? (
          <select className="status-sel" aria-label="Tamaño real" value={a.size} disabled={busy} onChange={(e) => {
            const z = e.target.value;
            if (confirm(`¿Cambiar a ${SIZE_LABEL[z].name.toLowerCase()}? El precio y la duración se recalculan.`)) patch({ size: z });
          }}>
            {SIZES.map((z) => <option key={z} value={z}>{SIZE_LABEL[z].name} ({SIZE_LABEL[z].desc})</option>)}
          </select>
        ) : <b>{SIZE_LABEL[a.size]?.name}</b>}
        <span>Servicio</span><b>{a.service.name}{a.addOns.length ? ` + ${a.addOns.map((x) => x.name).join(", ")}` : ""}</b>
        <span>Total</span><b className="num">{money(a.price)} {a.paid ? <span className="chip paid">Pagado</span> : null}</b>
        <span>Estado</span><b>{STATUS_LABEL[a.status]}</b>
        <span>Dueño</span><b>{a.client.name}</b>
        <span>WhatsApp</span><b><a href={waLink(a.client.phone, "")} target="_blank" rel="noreferrer">{a.client.phone}</a></b>
        <span>Agendó por</span><b>{SOURCE_LABEL[a.source]}</b>
        {a.pet.vaccine && (<><span>Cartilla</span><b>
          <span className={`chip ${VACCINE_LABEL[a.pet.vaccine]?.cls}`}>{VACCINE_LABEL[a.pet.vaccine]?.text}</span>
          {a.pet.vaccine === "PENDING" && staff && <> <a href="/panel/cartillas">Revisar</a></>}
        </b></>)}
        {(a.notes || a.pet.notes) && (<><span>Notas</span><b style={{ fontWeight: 500 }}>{[a.pet.notes, a.notes].filter(Boolean).join(" · ")}</b></>)}
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="actions">
        {a.status === "BOOKED" && <button className="btn" disabled={busy} onClick={() => patch({ status: "DONE" })}>Terminada</button>}
        {staff && !a.paid && a.status !== "CANCELLED" && a.status !== "NO_SHOW" && <button className="btn" disabled={busy} onClick={onCharge}>Cobrar</button>}
        {a.status !== "BOOKED" && !a.paid && <button className="btn ghost" disabled={busy} onClick={() => patch({ status: "BOOKED" })}>Regresar a agendada</button>}
      </div>
      {staff && a.status === "BOOKED" && (
        <div className="actions">
          <button className="btn ghost" disabled={busy} onClick={() => setMoving((m) => !m)}>Mover</button>
          <button className="btn ghost" disabled={busy} onClick={() => patch({ status: "NO_SHOW" })}>No llegó</button>
          <button className="btn ghost" disabled={busy} onClick={() => confirm(`¿Cancelar la cita de ${a.pet.name}?`) && patch({ status: "CANCELLED" })}>Cancelar</button>
        </div>
      )}
      {moving && (
        <div className="form">
          <div className="row2">
            <div className="field">
              <label htmlFor="mvG">Groomer</label>
              <select id="mvG" value={mv.groomerId} onChange={(e) => setMv({ ...mv, groomerId: e.target.value })}>
                {day.groomers.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="mvT">Hora</label>
              <select id="mvT" value={mv.time} onChange={(e) => setMv({ ...mv, time: e.target.value })}>
                {!times.includes(mv.time) && <option value={mv.time}>{mv.time}</option>}
                {times.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <button className="btn" disabled={busy} onClick={() => patch({ startsAt: localIso(date, mv.time), groomerId: mv.groomerId })}>Guardar cambio</button>
        </div>
      )}
      {staff && a.status === "BOOKED" && (
        <a className="btn ghost" style={{ textAlign: "center", textDecoration: "none" }} href={waLink(a.client.phone, reminder)} target="_blank" rel="noreferrer">
          Enviar recordatorio por WhatsApp
        </a>
      )}
    </div>
  );
}

type ClientHit = { id: string; name: string; phone: string; pets: { id: string; name: string; breed: string | null; size: string }[] };

function NewAppt({ cat, date, day, initial, onCancel, onSaved, onGoToday }: {
  cat: Catalog;
  date: string;
  day: Day;
  initial: { groomerId?: string; time?: string };
  onCancel: () => void;
  onSaved: (a: Appt) => void;
  onGoToday: () => void;
}) {
  const times: string[] = [];
  for (let m = toMin(day.open ?? "09:00"); m < toMin(day.close ?? "19:00"); m += 30) times.push(fromMin(m));
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [petId, setPetId] = useState<string>("");
  const [picked, setPicked] = useState<ClientHit | null>(null);
  const [nc, setNc] = useState({ name: "", phone: "", petName: "", breed: "", size: "CHICO" });
  const [serviceId, setServiceId] = useState(cat.services[0]?.id ?? "");
  const [size, setSize] = useState("CHICO");
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [groomerId, setGroomerId] = useState(initial.groomerId ?? "");
  const [time, setTime] = useState(initial.time ?? times[0] ?? "09:00");
  const [dur, setDur] = useState<string>("");
  const [source, setSource] = useState("RECEPTION");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => api<ClientHit[]>("/api/clients", { query: { q } }).then(setHits).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);

  const svc = cat.services.find((s) => s.id === serviceId);
  const adds = cat.addOns.filter((a) => addOnIds.includes(a.id));
  const autoDur = (svc?.prices[size]?.durationMin ?? 0) + adds.reduce((t, a) => t + a.durationMin, 0);
  const price = (svc?.prices[size]?.price ?? 0) + adds.reduce((t, a) => t + a.price, 0);
  const duration = Number(dur) || autoDur;
  const endMin = toMin(time) + duration;
  const late = day.close ? endMin > toMin(day.close) : false;
  const isNew = !petId;
  const valid = serviceId && (petId || (nc.name.trim().length >= 2 && nc.phone.replace(/\D/g, "").length >= 10 && nc.petName.trim()));

  function nowSlot() {
    if (date !== todayYmd()) onGoToday();
    const m = minutesOf(new Date());
    setTime(fromMin(Math.ceil(m / 30) * 30));
    setGroomerId("");
    setSource("RECEPTION");
  }

  async function save() {
    setErr("");
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        serviceId,
        size,
        addOnIds,
        startsAt: localIso(date, time),
        durationMin: dur ? Number(dur) : undefined,
        groomerId: groomerId || undefined,
        source,
        notes: notes || null,
      };
      if (petId) body.petId = petId;
      else {
        body.client = { name: nc.name, phone: nc.phone };
        body.pet = { name: nc.petName, breed: nc.breed || null, size };
      }
      onSaved(await api<Appt>("/api/appointments", { method: "POST", body }));
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h2>Nueva cita</h2>
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
      </div>
      <div className="form">
        <div className="field">
          <label htmlFor="cq">Buscar cliente (nombre, WhatsApp o lomito)</label>
          <input id="cq" value={q} onChange={(e) => { setQ(e.target.value); setPicked(null); setPetId(""); }} placeholder="Deja vacío si es cliente nuevo" />
        </div>
        {hits.length > 0 && !picked && (
          <div className="list">
            {hits.slice(0, 6).map((c) => (
              <button key={c.id} type="button" className="client-row" onClick={() => {
                setPicked(c);
                const p = c.pets[0];
                if (p) { setPetId(p.id); setSize(p.size); }
              }}>
                <span><b>{c.name}</b> <span className="muted">· {c.phone}</span><br /><span className="muted">{c.pets.map((p) => p.name).join(", ") || "Sin lomitos"}</span></span>
              </button>
            ))}
          </div>
        )}
        {picked && (
          <div className="field">
            <label htmlFor="pp">Lomito de {picked.name}</label>
            <select id="pp" value={petId} onChange={(e) => {
              setPetId(e.target.value);
              const p = picked.pets.find((x) => x.id === e.target.value);
              if (p) setSize(p.size);
            }}>
              {picked.pets.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.breed ?? "sin raza"}</option>)}
              <option value="">+ Otro lomito nuevo</option>
            </select>
          </div>
        )}
        {isNew && (
          <>
            <div className="row2">
              <div className="field"><label htmlFor="nP">Lomito</label><input id="nP" value={nc.petName} onChange={(e) => setNc({ ...nc, petName: e.target.value })} /></div>
              <div className="field"><label htmlFor="nB">Raza</label><input id="nB" value={nc.breed} onChange={(e) => setNc({ ...nc, breed: e.target.value })} /></div>
            </div>
            <div className="row2">
              <div className="field"><label htmlFor="nN">Dueño</label><input id="nN" value={picked ? picked.name : nc.name} disabled={!!picked} onChange={(e) => setNc({ ...nc, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="nW">WhatsApp</label><input id="nW" inputMode="tel" value={picked ? picked.phone : nc.phone} disabled={!!picked} onChange={(e) => setNc({ ...nc, phone: e.target.value })} /></div>
            </div>
          </>
        )}
        <div className="row2">
          <div className="field">
            <label htmlFor="sv">Servicio</label>
            <select id="sv" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              {cat.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sz">Tamaño</label>
            <select id="sz" value={size} onChange={(e) => setSize(e.target.value)}>
              {SIZES.map((z) => <option key={z} value={z}>{SIZE_LABEL[z].name} ({SIZE_LABEL[z].desc})</option>)}
            </select>
          </div>
        </div>
        <div className="checks">
          {cat.addOns.filter((a) => a.active).map((a) => (
            <label key={a.id}>
              <input type="checkbox" checked={addOnIds.includes(a.id)} onChange={(e) => setAddOnIds((c) => (e.target.checked ? [...c, a.id] : c.filter((x) => x !== a.id)))} />
              {a.name}
            </label>
          ))}
        </div>
        <div className="row2">
          <div className="field">
            <label htmlFor="gr">Groomer</label>
            <select id="gr" value={groomerId} onChange={(e) => setGroomerId(e.target.value)}>
              <option value="">El que esté libre</option>
              {day.groomers.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tm">Hora</label>
            <select id="tm" value={time} onChange={(e) => setTime(e.target.value)}>
              {!times.includes(time) && <option>{time}</option>}
              {times.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label htmlFor="du">Duración (min)</label>
            <input id="du" type="number" min={15} step={15} placeholder={String(autoDur)} value={dur} onChange={(e) => setDur(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="so">Cómo agendó</label>
            <select id="so" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="RECEPTION">En recepción</option>
              <option value="PHONE">Llamada</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="INSTAGRAM">Instagram</option>
            </select>
          </div>
        </div>
        <button type="button" className="btn ghost" onClick={nowSlot}>Llegó sin cita: atender ahora</button>
        <div className="field"><label htmlFor="no">Notas</label><textarea id="no" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="summary">
          <div className="line"><span>{time} – {fromMin(endMin)}</span><span>{longDate(date)}</span></div>
          <div className="line total"><span>Total</span><span className="num">{money(price)}</span></div>
        </div>
        {late && <div className="warnbox">Terminaría después del cierre ({day.close}).</div>}
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn" disabled={!valid || busy} onClick={save}>{busy ? "Guardando…" : "Guardar cita"}</button>
      </div>
    </div>
  );
}
