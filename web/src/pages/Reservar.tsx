import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, BUSINESS_SLUG } from "../api";
import { money, SIZES, SIZE_LABEL, todayYmd, addDays, dayParts, longDate, hm, ymd } from "../format";

type Menu = {
  business: { name: string; phone: string | null; openingHours: Record<string, { open: string; close: string } | null> };
  services: { code: string; name: string; description: string | null; prices: Record<string, { price: number; durationMin: number }> }[];
  addOns: { code: string; name: string; price: number; durationMin: number }[];
};
type Avail = { price: number; durationMin: number; slots: { time: string; startsAt: string }[] };
type Done = { startsAt: string; service: string; addOns: string[]; petName: string; price: number; drying: string };

const WHATSAPP = import.meta.env.VITE_WHATSAPP as string | undefined;

export default function Reservar() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [service, setService] = useState("experiencia");
  const [size, setSize] = useState<string>("CHICO");
  const [addOns, setAddOns] = useState<string[]>([]);
  const [date, setDate] = useState<string>("");
  const [avail, setAvail] = useState<Avail | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<string>("");
  const [form, setForm] = useState({ clientName: "", phone: "", petName: "", breed: "", notes: "" });
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    api<Menu>(`/public/${BUSINESS_SLUG}`)
      .then((m) => {
        setMenu(m);
        if (!m.services.some((s) => s.code === "experiencia")) setService(m.services[0]?.code ?? "");
      })
      .catch((e) => setLoadErr(e.message));
  }, []);

  const days = useMemo(() => {
    if (!menu) return [];
    const out: string[] = [];
    for (let i = 0; out.length < 14 && i < 45; i++) {
      const d = addDays(todayYmd(), i);
      const wd = dayParts(d).weekday || 7;
      if (menu.business.openingHours[String(wd)]) out.push(d);
    }
    return out;
  }, [menu]);

  useEffect(() => {
    if (!date && days.length) setDate(days[0]);
  }, [days, date]);

  useEffect(() => {
    if (!date || !service) return;
    let alive = true;
    setLoadingSlots(true);
    setSlot("");
    api<Avail>(`/public/${BUSINESS_SLUG}/availability`, { query: { date, service, size, addOns: addOns.join(",") } })
      .then((a) => alive && setAvail(a))
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoadingSlots(false));
    return () => {
      alive = false;
    };
  }, [date, service, size, addOns]);

  if (loadErr) return <div className="public"><div className="err">{loadErr}</div></div>;
  if (!menu) return <div className="public"><p className="loading">Cargando…</p></div>;

  const svc = menu.services.find((s) => s.code === service);
  const showAddOns = service !== "unas";
  const chosen = menu.addOns.filter((a) => addOns.includes(a.code));
  const valid = slot && form.clientName.trim().length >= 2 && form.phone.replace(/\D/g, "").length >= 10 && form.petName.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setErr("");
    setSending(true);
    try {
      const r = await api<Done>(`/public/${BUSINESS_SLUG}/bookings`, {
        method: "POST",
        body: { service, size, addOns, startsAt: slot, ...form, breed: form.breed || null, notes: form.notes || null },
      });
      setDone(r);
    } catch (x: any) {
      setErr(x.message);
      if (x.status === 409) {
        // se ocupó el horario: refrescar
        setAddOns((a) => [...a]);
      }
    } finally {
      setSending(false);
    }
  }

  if (done) {
    const d = ymd(new Date(done.startsAt));
    return (
      <div className="public">
        <div className="phone">
          <div className="phone-head">
            <img src="/lomito-creme.svg" alt="" />
            <h2>¡Listo!</h2>
          </div>
          <div className="phone-body">
            <div className="ok">
              <h3>Te esperamos con {done.petName}</h3>
              <p>
                {longDate(d)} a las <b>{hm(done.startsAt)}</b>
              </p>
              <p>
                {done.service}
                {done.addOns.length ? ` + ${done.addOns.join(", ")}` : ""} · <b>{money(done.price)}</b>
              </p>
              <p className="muted">Secado {done.drying === "cabina" ? "en cabina, suave y silencioso" : "a mano, con calma"}.</p>
            </div>
            <p className="muted" style={{ textAlign: "center", fontSize: ".88rem" }}>
              Te escribiremos por WhatsApp para confirmar. Si necesitas cambiar tu cita, contéstanos ahí.
            </p>
            <button className="btn ghost" onClick={() => location.reload()}>Agendar otro lomito</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="public">
      <form className="phone" onSubmit={submit}>
        <div className="phone-head">
          <img src="/lomito-creme.svg" alt="Lomito Atelier" />
          <h2>Agenda su cita</h2>
          <p style={{ opacity: 0.85, fontSize: ".9rem" }}>good hair days for good dogs</p>
        </div>
        <div className="phone-body">
          <section className="step">
            <h3>1 · Servicio</h3>
            <div className="opts">
              {menu.services.map((s) => (
                <button type="button" key={s.code} className="opt" aria-pressed={s.code === service} onClick={() => {
                    setService(s.code);
                    if (s.code === "unas") setAddOns([]);
                  }}>
                  <b>{s.name}</b>
                  <span>desde {money(Math.min(...Object.values(s.prices).map((p) => p.price)))}</span>
                </button>
              ))}
            </div>
            {svc?.description && <p className="muted" style={{ fontSize: ".85rem" }}>{svc.description}</p>}
          </section>

          <section className="step sizes">
            <h3>2 · Tamaño</h3>
            <div className="opts">
              {SIZES.filter((z) => svc?.prices[z]).map((z) => (
                <button type="button" key={z} className="opt" aria-pressed={z === size} onClick={() => setSize(z)}>
                  <b>{SIZE_LABEL[z].name}</b>
                  <span>{SIZE_LABEL[z].desc}</span>
                </button>
              ))}
            </div>
          </section>

          {showAddOns && menu.addOns.length > 0 && (
            <section className="step">
              <h3>3 · Extras (opcional)</h3>
              <div className="checks">
                {menu.addOns.map((a) => (
                  <label key={a.code}>
                    <input
                      type="checkbox"
                      checked={addOns.includes(a.code)}
                      onChange={(e) => setAddOns((cur) => (e.target.checked ? [...cur, a.code] : cur.filter((c) => c !== a.code)))}
                    />
                    {a.name} +{money(a.price)}
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="step">
            <h3>{showAddOns ? 4 : 3} · Día y hora</h3>
            <div className="days" role="group" aria-label="Día">
              {days.map((d) => {
                const p = dayParts(d);
                return (
                  <button type="button" key={d} className="day" aria-pressed={d === date} onClick={() => setDate(d)}>
                    <small>{p.dow}</small>
                    <b>{p.day}</b>
                    <small>{p.mon}</small>
                  </button>
                );
              })}
            </div>
            {loadingSlots ? (
              <p className="loading">Buscando horarios…</p>
            ) : avail && avail.slots.length ? (
              <div className="slots" role="group" aria-label="Hora">
                {avail.slots.map((s) => (
                  <button type="button" key={s.startsAt} className="slot" aria-pressed={s.startsAt === slot} onClick={() => setSlot(s.startsAt)}>
                    {s.time}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No quedan horarios este día. Prueba otro.</p>
            )}
          </section>

          <section className="step">
            <h3>{showAddOns ? 5 : 4} · Tus datos</h3>
            <div className="row2">
              <div className="field">
                <label htmlFor="pet">Nombre del lomito</label>
                <input id="pet" value={form.petName} onChange={(e) => setForm({ ...form, petName: e.target.value })} required maxLength={40} />
              </div>
              <div className="field">
                <label htmlFor="breed">Raza</label>
                <input id="breed" value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })} placeholder="Ej. Poodle, mestizo" maxLength={60} />
              </div>
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="name">Tu nombre</label>
                <input id="name" autoComplete="name" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} required maxLength={80} />
              </div>
              <div className="field">
                <label htmlFor="phone">WhatsApp</label>
                <input id="phone" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10 dígitos" required />
              </div>
            </div>
            <div className="field">
              <label htmlFor="notes">¿Algo que debamos saber?</label>
              <textarea id="notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} placeholder="Alergias, nervios, nudos…" />
            </div>
          </section>

          {avail && (
            <div className="summary">
              <div className="line">
                <span>{svc?.name} · {SIZE_LABEL[size].name}</span>
                <span className="num">{money(svc?.prices[size]?.price ?? 0)}</span>
              </div>
              {chosen.map((a) => (
                <div className="line" key={a.code}>
                  <span>{a.name}</span>
                  <span className="num">{money(a.price)}</span>
                </div>
              ))}
              <div className="line total">
                <span>Total · aprox. {Math.round((avail.durationMin / 60) * 10) / 10} h</span>
                <span className="num">{money(avail.price)}</span>
              </div>
            </div>
          )}
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn" disabled={!valid || sending}>{sending ? "Agendando…" : "Confirmar cita"}</button>
          <p className="footer-note">
            Pagas en el atelier · Martes a domingo
            {WHATSAPP ? (
              <>
                {" · "}
                <a href={`https://wa.me/52${WHATSAPP}`} target="_blank" rel="noreferrer">¿Dudas? WhatsApp</a>
              </>
            ) : null}
          </p>
        </div>
      </form>
    </div>
  );
}
