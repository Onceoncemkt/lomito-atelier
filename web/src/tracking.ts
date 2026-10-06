/**
 * Medición para campañas: Meta Pixel y Google Analytics 4.
 * Se activan sólo si existen las variables VITE_META_PIXEL_ID / VITE_GA_ID en Vercel.
 * No se cargan en el panel del equipo.
 */
declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const PIXEL = import.meta.env.VITE_META_PIXEL_ID as string | undefined;
const GA = import.meta.env.VITE_GA_ID as string | undefined;
let started = false;

function loadScript(src: string) {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function start() {
  if (started) return;
  started = true;
  if (PIXEL) {
    // stub estándar de Meta: la librería procesa la cola al cargar
    const f = function (...args: unknown[]) {
      const self = f as unknown as { callMethod?: (...a: unknown[]) => void; queue: unknown[] };
      if (self.callMethod) self.callMethod(...args);
      else self.queue.push(args);
    } as unknown as Window["fbq"] & { queue: unknown[]; push: unknown; loaded: boolean; version: string };
    f.queue = [];
    f.push = f;
    f.loaded = true;
    f.version = "2.0";
    window.fbq = f;
    window._fbq = f;
    loadScript("https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", PIXEL);
  }
  if (GA) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${GA}`);
    window.gtag("js", new Date());
    window.gtag("config", GA, { send_page_view: false });
  }
}

export function trackPage(path: string) {
  if (path.startsWith("/panel")) return;
  if (!PIXEL && !GA) return;
  start();
  window.fbq?.("track", "PageView");
  window.gtag?.("event", "page_view", { page_path: path.replace(/\/cita\/.+/, "/cita"), page_location: location.origin + path.replace(/\/cita\/.+/, "/cita") });
}

/** Reserva confirmada: evento "Schedule" en Meta y "generate_lead" en Google, con el valor en pesos. */
export function trackBooking(pesos: number, service: string) {
  if (!PIXEL && !GA) return;
  start();
  window.fbq?.("track", "Schedule", { value: pesos, currency: "MXN", content_name: service });
  window.gtag?.("event", "generate_lead", { value: pesos, currency: "MXN", service });
}
