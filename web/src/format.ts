export const TZ = "America/Mexico_City";

export const money = (centavos: number) =>
  "$" + (centavos / 100).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const toCentavos = (pesos: string | number) => Math.round(Number(pesos || 0) * 100);

export const SIZE_LABEL: Record<string, { name: string; desc: string }> = {
  CHICO: { name: "Chico", desc: "hasta 10 kg" },
  MEDIANO: { name: "Mediano", desc: "10–25 kg" },
  GRANDE: { name: "Grande", desc: "25–40 kg" },
  GIGANTE: { name: "Gigante", desc: "+40 kg" },
};
export const SIZES = ["CHICO", "MEDIANO", "GRANDE", "GIGANTE"] as const;

export const STATUS_LABEL: Record<string, string> = { BOOKED: "Agendada", DONE: "Terminada", CANCELLED: "Cancelada", NO_SHOW: "No llegó" };
export const SOURCE_LABEL: Record<string, string> = { WEB: "Página web", RECEPTION: "En recepción", PHONE: "Llamada", WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };
export const METHOD_LABEL: Record<string, string> = { CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia" };

const parts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );

/** AAAA-MM-DD en hora de Tulancingo */
export const ymd = (d: Date) => {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
};
export const hm = (d: Date | string) => {
  const p = parts(new Date(d));
  return `${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
};
/** minutos desde medianoche, hora local del negocio */
export const minutesOf = (d: Date | string) => {
  const [h, m] = hm(d).split(":").map(Number);
  return h * 60 + m;
};

export const todayYmd = () => ymd(new Date());

/** Suma días a una fecha AAAA-MM-DD (calendario, sin zona). */
export const addDays = (date: string, n: number) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const dayParts = (date: string) => {
  const d = new Date(date + "T12:00:00Z");
  return { dow: DOW[d.getUTCDay()], day: d.getUTCDate(), mon: MON[d.getUTCMonth()], weekday: d.getUTCDay() };
};
export const longDate = (date: string) =>
  new Date(date + "T12:00:00Z").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** ISO UTC para una fecha y hora locales de Tulancingo (UTC-6 todo el año desde 2022). */
export const localIso = (date: string, time: string) => new Date(`${date}T${time}:00-06:00`).toISOString();

export const waLink = (phone: string, text: string) => `https://wa.me/52${phone}?text=${encodeURIComponent(text)}`;
