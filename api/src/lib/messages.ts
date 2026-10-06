import { DateTime } from "luxon";

export const webUrl = () => (process.env.PUBLIC_WEB_URL ?? "https://www.lomitoatelier.mx").replace(/\/$/, "");
export const manageUrl = (token: string) => `${webUrl()}/cita/${token}`;

/** "martes 6 de octubre" y "10:30" en la zona del negocio. */
export function whenText(d: Date, tz: string) {
  const dt = DateTime.fromJSDate(d, { zone: tz }).setLocale("es");
  return { day: dt.toFormat("cccc d 'de' LLLL"), time: dt.toFormat("HH:mm") };
}

/**
 * Parámetros de las plantillas (el orden importa, debe coincidir con la plantilla en Meta):
 * {{1}} nombre del cliente · {{2}} lomito · {{3}} día · {{4}} hora · {{5}} liga para cambiar o cancelar
 */
export function templateParams(a: { clientName: string; petName: string; startsAt: Date; manageToken: string | null }, tz: string) {
  const w = whenText(a.startsAt, tz);
  return [a.clientName.split(" ")[0], a.petName, w.day, w.time, a.manageToken ? manageUrl(a.manageToken) : webUrl()];
}
