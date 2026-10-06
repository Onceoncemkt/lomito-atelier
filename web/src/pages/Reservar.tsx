import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, BUSINESS_SLUG } from "../api";
import { guessSize, SIZE_EXAMPLES, type Size } from "../breeds";
import BreedInput from "../BreedInput";
import { money, SIZES, SIZE_LABEL, todayYmd, addDays, dayParts, longDate, hm, ymd, cap } from "../format";

type Menu = {
  business: { name: string; phone: string | null; openingHours: Record<string, { open: string; close: string } | null> };
  services: { code: string; name: string; description: string | null; prices: Record<string, { price: number; durationMin: number }> }[];
  addOns: { code: string; name: string; price: number; durationMin: number }[];
};
type Avail = { price: number; durationMin: number; slots: { time: string; startsAt: string }[] };
type Done = { startsAt: string; service: string; addOns: string[]; petName: string; price: number; drying: string };

const fmtDur = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`);

const DAY_NAMES = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
/** "Martes a domingo", "Lunes a sábado", o la lista de días abiertos. */
function openDaysText(h: Record<string, unknown>) {
  const open = [1, 2, 3, 4, 5, 6, 7].filter((d) => h[String(d)]);
  if (!open.length) return "";
  const txt = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  // ¿forman un bloque continuo (circular)?
  for (let start = 0; start < 7; start++) {
    const seq = Array.from({ length: open.length }, (_, i) => ((open[0] - 1 + start + i) % 7) + 1);
    if (seq.every((d) => open.includes(d)) && open.length > 2) {
      const first = seq[0];
      const last = seq[seq.length - 1];
      if (open.includes(((first + 5) % 7) + 1) && open.length < 7) continue;
      return open.length === 7 ? "Todos los días" : `${txt(DAY_NAMES[first])} a ${DAY_NAMES[last]}`;
    }
  }
  return txt(open.map((d) => DAY_NAMES[d]).join(", "));
}

const WHATSAPP = import.meta.env.VITE_WHATSAPP as string | undefined;

export default function Reservar() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [service, setService] = useState("experiencia");
  const [size, setSize] = useState<string>("CHICO");
  /** de dónde salió el tamaño: null = aún no se sabe */
  const [sizeSource, setSizeSource] = useState<null | "breed" | "manual">(null);
  const [addOns, setAddOns] = useState<string[]>([]);
  const [date, setDate] = useState<string>("");
  const [avail, setAvail] = useState<Avail | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<string>("");
  const [form, setForm] = useState({ clientName: "", phone: "", petName: "", breed: "", notes: "" });
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);

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
    if (missing.length) setMissing(check());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, form, sizeSource]);

  useEffect(() => {
    if (!date && days.length) setDate(days[0]);
  }, [days, date]);

  useEffect(() => {
    if (!date || !service) return;
    let alive = true;
    setLoadingSlots(true);
    api<Avail>(`/public/${BUSINESS_SLUG}/availability`, { query: { date, service, size, addOns: addOns.join(",") } })
      .then((a) => {
        if (!alive) return;
        setAvail(a);
        // conserva la hora elegida si sigue disponible
        setSlot((cur) => (cur && a.slots.some((x) => x.startsAt === cur) ? cur : ""));
      })
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoadingSlots(false));
    return () => {
      alive = false;
    };
  }, [date, service, size, addOns]);

  useEffect(() => {
    if (!menu || !sizeSource) return;
    const cur = menu.services.find((x) => x.code === service);
    if (cur && !cur.prices[size]) {
      const alt = menu.services.find((x) => x.prices[size]);
      if (alt) setService(alt.code);
    }
  }, [size, sizeSource, menu, service]);

  if (loadErr) return <div className="public"><div className="err">{loadErr}</div></div>;
  if (!menu) return <div className="public"><p className="loading">Cargando…</p></div>;

  const guess = guessSize(form.breed);
  const sizeSet = sizeSource !== null;

  function onBreed(v: string) {
    setForm((f) => ({ ...f, breed: v }));
    const g = guessSize(v);
    if (g.kind === "match") {
      if (sizeSource !== "manual") {
        setSize(g.size);
        setSizeSource("breed");
      }
    } else if (sizeSource === "breed") {
      setSizeSource(null);
    }
  }

  const svc = menu.services.find((s) => s.code === service);
  const contactPhone = menu.business.phone || WHATSAPP;
  const showAddOns = service !== "unas";
  const chosen = menu.addOns.filter((a) => addOns.includes(a.code));
  const basePrice = svc?.prices[size]?.price ?? 0;
  const total = basePrice + chosen.reduce((t, a) => t + a.price, 0);
  const totalMin = (svc?.prices[size]?.durationMin ?? 0) + chosen.reduce((t, a) => t + a.durationMin, 0);
  const slotTime = avail?.slots.find((x) => x.startsAt === slot)?.time ?? "";
  const phoneDigits = form.phone.replace(/\D/g, "");

  function check() {
    const m: string[] = [];
    if (!form.petName.trim()) m.push("pet");
    if (sizeSource === null) m.push("size");
    if (!slot) m.push("hora");
    if (form.clientName.trim().length < 2) m.push("name");
    const digits = form.phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) m.push("phone");
    return m;
  }

  function review(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const m = check();
    setMissing(m);
    if (m.length) {
      const target =
        m[0] === "hora" ? document.querySelector(".slots, .days") : m[0] === "size" ? document.getElementById("sizes") : document.getElementById(m[0]);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (target instanceof HTMLInputElement) setTimeout(() => target.focus(), 300);
      return;
    }
    setReviewing(true);
  }

  async function submit() {
    setErr("");
    setSending(true);
    try {
      const r = await api<Done>(`/public/${BUSINESS_SLUG}/bookings`, {
        method: "POST",
        body: { service, size, addOns, startsAt: slot, ...form, breed: form.breed || null, notes: form.notes || null },
      });
      setReviewing(false);
      setDone(r);
    } catch (x: any) {
      setReviewing(false);
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
      <form className="phone" onSubmit={review} noValidate>
        <div className="phone-head">
          <img src="/lomito-creme.svg" alt="Lomito Atelier" />
          <h2>Agenda su cita</h2>
          <p style={{ opacity: 0.85, fontSize: ".9rem" }}>good hair days for good dogs</p>
        </div>
        <div className="phone-body">
          <section className="step">
            <h3>1 · Tu lomito</h3>
            <div className="field">
              <label htmlFor="pet">Nombre</label>
              <input id="pet" aria-invalid={missing.includes("pet")} value={form.petName} onChange={(e) => setForm({ ...form, petName: e.target.value })} maxLength={40} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="breed">Raza</label>
              <BreedInput value={form.breed} onChange={onBreed} />
            </div>
            {missing.includes("pet") && <div className="warnbox">Escribe el nombre de tu lomito</div>}
            {guess.kind === "match" && sizeSource === "breed" && (
              <p className="hint">Por su raza lo consideramos <b>{SIZE_LABEL[guess.size].name.toLowerCase()}</b> ({SIZE_LABEL[guess.size].desc}). Si tu lomito es más chico o más grande, cámbialo abajo.</p>
            )}
            {guess.kind === "match" && sizeSource === "manual" && guess.size !== size && (
              <p className="hint">
                Elegiste {SIZE_LABEL[size].name.toLowerCase()}; para un {guess.label.toLowerCase()} solemos considerar{" "}
                <b>{SIZE_LABEL[guess.size].name.toLowerCase()}</b>.{" "}
                <button type="button" className="linkbtn" onClick={() => { setSize(guess.size); setSizeSource("breed"); }}>
                  Usar {SIZE_LABEL[guess.size].name.toLowerCase()}
                </button>
              </p>
            )}
            {(guess.kind === "unknown" || guess.kind === "mixed") && !sizeSet && (
              <p className="hint">Como es cruza, elige abajo cuánto pesa más o menos.</p>
            )}
            {guess.kind === "nomatch" && !sizeSet && <p className="hint">Elige abajo cuánto pesa más o menos.</p>}
          </section>

          <section className="step sizes" id="sizes">
            <h3>2 · Tamaño <span className="muted" style={{ letterSpacing: 0, textTransform: "none", fontWeight: 500 }}>(peso aproximado)</span></h3>
            {missing.includes("size") && <div className="warnbox">Elige el tamaño de tu lomito</div>}
            <div className="opts sizes-grid">
              {SIZES.filter((z) => !svc || svc.prices[z]).map((z) => (
                <button
                  type="button"
                  key={z}
                  className="opt"
                  aria-pressed={sizeSet && z === size}
                  onClick={() => {
                    setSize(z);
                    setSizeSource(guess.kind === "match" && guess.size === z ? "breed" : "manual");
                  }}
                >
                  <b>{SIZE_LABEL[z].name} · {SIZE_LABEL[z].desc}</b>
                  <span>{SIZE_EXAMPLES[z as Size]}</span>
                </button>
              ))}
            </div>
            <p className="muted" style={{ fontSize: ".8rem" }}>Si al llegar tu lomito es de otro tamaño, ajustamos el precio en el atelier.</p>
          </section>

          <section className="step">
            <h3>3 · Servicio</h3>
            <div className="opts">
              {menu.services.map((s) => {
                const p = sizeSet ? s.prices[size] : undefined;
                const from = Math.min(...Object.values(s.prices).map((x) => x.price));
                return (
                  <button type="button" key={s.code} className="opt" aria-pressed={s.code === service} disabled={sizeSet && !p} onClick={() => {
                      setService(s.code);
                      if (s.code === "unas") setAddOns([]);
                    }}>
                    <b>{s.name}</b>
                    <span>{p ? `${money(p.price)} · ${fmtDur(p.durationMin)}` : sizeSet ? "No disponible en este tamaño" : `desde ${money(from)}`}</span>
                  </button>
                );
              })}
            </div>
            {svc?.description && <p className="muted" style={{ fontSize: ".85rem" }}>{svc.description}</p>}
          </section>

          {showAddOns && menu.addOns.length > 0 && (
            <section className="step">
              <h3>4 · Extras (opcional)</h3>
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
            <h3>{showAddOns ? 5 : 4} · Día y hora</h3>
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
              <>
              {missing.includes("hora") && <div className="warnbox">Elige una hora para tu cita</div>}
              <div className="slots" role="group" aria-label="Hora">
                {avail.slots.map((s) => (
                  <button type="button" key={s.startsAt} className="slot" aria-pressed={s.startsAt === slot} onClick={() => setSlot(s.startsAt)}>
                    {s.time}
                  </button>
                ))}
              </div>
              </>
            ) : (
              <p className="muted">No quedan horarios este día. Prueba otro.</p>
            )}
          </section>

          <section className="step">
            <h3>{showAddOns ? 6 : 5} · Tus datos</h3>
            <div className="row2">
              <div className="field">
                <label htmlFor="name">Tu nombre</label>
                <input id="name" aria-invalid={missing.includes("name")} autoComplete="name" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} required maxLength={80} />
              </div>
              <div className="field">
                <label htmlFor="phone">WhatsApp</label>
                <input id="phone" aria-invalid={missing.includes("phone")} inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10 dígitos" required />
              </div>
            </div>
            {missing.some((m) => m === "name" || m === "phone") && (
              <div className="warnbox">
                Falta: {missing.filter((m) => m === "name" || m === "phone").map((m) => ({ name: "tu nombre", phone: "WhatsApp a 10 dígitos" } as Record<string, string>)[m]).join(", ")}
              </div>
            )}
            <div className="field">
              <label htmlFor="notes">¿Algo que debamos saber?</label>
              <textarea id="notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} placeholder="Alergias, nervios, nudos…" />
            </div>
          </section>

          {svc && !sizeSet && (
            <div className="summary"><span className="muted">Elige el tamaño de tu lomito para ver el precio.</span></div>
          )}
          {svc && sizeSet && (
            <div className="summary">
              <div className="line">
                <span>{svc.name} · {SIZE_LABEL[size].name}</span>
                <span className="num">{money(basePrice)}</span>
              </div>
              {chosen.map((a) => (
                <div className="line" key={a.code}>
                  <span>{a.name}</span>
                  <span className="num">{money(a.price)}</span>
                </div>
              ))}
              <div className="line">
                <span className="muted">{slotTime ? `${cap(longDate(date))} · ${slotTime}` : "Elige día y hora"}</span>
                <span className="muted">{fmtDur(totalMin)}</span>
              </div>
              <div className="line total">
                <span>Total</span>
                <span className="num">{money(total)}</span>
              </div>
            </div>
          )}
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn" disabled={sending}>{sending ? "Agendando…" : "Revisar y confirmar"}</button>
          {reviewing && (
            <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && !sending && setReviewing(false)}>
              <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rv-title">
                <h2 id="rv-title">¿Todo bien?</h2>
                <p className="muted">Revisa los datos de tu cita antes de confirmar.</p>
                <div className="kv">
                  <span>Lomito</span><b>{form.petName.trim()}{form.breed.trim() ? ` · ${form.breed.trim()}` : ""}</b>
                  <span>Tamaño</span><b>{SIZE_LABEL[size].name} ({SIZE_LABEL[size].desc})</b>
                  <span>Servicio</span><b>{svc?.name}{chosen.length ? ` + ${chosen.map((a) => a.name).join(", ")}` : ""}</b>
                  <span>Cuándo</span><b>{cap(longDate(date))} · {slotTime}</b>
                  <span>Duración</span><b>aprox. {fmtDur(totalMin)}</b>
                  <span>A nombre de</span><b>{form.clientName.trim()}</b>
                  <span>WhatsApp</span><b className="num">{phoneDigits.slice(-10)}</b>
                  {form.notes.trim() && (<><span>Notas</span><b style={{ fontWeight: 500 }}>{form.notes.trim()}</b></>)}
                </div>
                <div className="summary">
                  <div className="line total"><span>Total a pagar en el atelier</span><span className="num">{money(total)}</span></div>
                </div>
                <div className="actions" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="btn ghost" disabled={sending} onClick={() => setReviewing(false)}>Corregir</button>
                  <button type="button" className="btn" disabled={sending} onClick={submit} autoFocus>{sending ? "Agendando…" : "Sí, confirmar cita"}</button>
                </div>
              </div>
            </div>
          )}
          <p className="footer-note">
            Pagas en el atelier · {openDaysText(menu.business.openingHours)}
            {contactPhone ? (
              <>
                {" · "}
                <a href={`https://wa.me/52${contactPhone}`} target="_blank" rel="noreferrer">¿Dudas? WhatsApp</a>
              </>
            ) : null}
          </p>
        </div>
      </form>
    </div>
  );
}
