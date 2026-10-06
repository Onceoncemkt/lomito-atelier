import { prisma } from "./db.js";
import { sendTemplate, templates, whatsappStatus } from "./whatsapp.js";
import { templateParams } from "./messages.js";
import { logActivity } from "./activity.js";

const HOUR = 3600_000;

/**
 * Manda el recordatorio a las citas agendadas que empiezan en las próximas 24 h
 * (y faltan más de 2 h), una sola vez por cita. No molesta a quien reservó hace menos de 1 h.
 */
export async function runReminders(now = new Date()) {
  if (!whatsappStatus().reminders) return { sent: 0, failed: 0 };
  const template = templates().reminder!;
  const due = await prisma.appointment.findMany({
    where: {
      status: "BOOKED",
      reminderSentAt: null,
      startsAt: { gt: new Date(+now + 2 * HOUR), lte: new Date(+now + 24 * HOUR) },
      createdAt: { lt: new Date(+now - HOUR) },
    },
    include: { client: true, pet: true, business: true },
    take: 200,
  });
  let sent = 0;
  let failed = 0;
  for (const a of due) {
    // reclama la cita para que dos procesos no manden doble
    const claim = await prisma.appointment.updateMany({ where: { id: a.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (claim.count !== 1) continue;
    const r = await sendTemplate({
      to: a.client.phone,
      template,
      params: templateParams({ clientName: a.client.name, petName: a.pet.name, startsAt: a.startsAt, manageToken: a.manageToken }, a.business.timezone),
    });
    if (r.ok) sent++;
    else failed++;
    await logActivity(
      prisma,
      a.businessId,
      r.ok ? "whatsapp.reminder" : "whatsapp.error",
      r.ok ? `Recordatorio enviado por WhatsApp a ${a.client.name} (${a.pet.name})` : `No se pudo enviar el recordatorio a ${a.client.name}: ${r.error}`,
      { meta: { appointmentId: a.id } },
    );
  }
  return { sent, failed };
}

/** Confirmación al momento de reservar (si hay plantilla configurada). No bloquea la reserva. */
export async function sendConfirmation(appointmentId: string) {
  if (!whatsappStatus().confirmations) return;
  const a = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { client: true, pet: true, business: true } });
  if (!a) return;
  const r = await sendTemplate({
    to: a.client.phone,
    template: templates().confirm!,
    params: templateParams({ clientName: a.client.name, petName: a.pet.name, startsAt: a.startsAt, manageToken: a.manageToken }, a.business.timezone),
  });
  if (!r.ok) {
    await logActivity(prisma, a.businessId, "whatsapp.error", `No se pudo enviar la confirmación a ${a.client.name}: ${r.error}`, { meta: { appointmentId: a.id } });
  }
}

export function startReminderLoop() {
  if (!whatsappStatus().reminders) {
    console.log("Recordatorios por WhatsApp: no configurados");
    return;
  }
  const tick = () => runReminders().then((r) => r.sent + r.failed && console.log("Recordatorios", r)).catch((e) => console.error("Recordatorios", e));
  setTimeout(tick, 30_000);
  setInterval(tick, 10 * 60_000);
  console.log("Recordatorios por WhatsApp: activos");
}
