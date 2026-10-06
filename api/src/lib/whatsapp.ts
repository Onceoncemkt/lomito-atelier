/**
 * Envío de mensajes por WhatsApp Business (API oficial de Meta, "Cloud API").
 * Si no hay credenciales configuradas, no envía nada.
 *
 * Variables:
 *   WHATSAPP_TOKEN               token de acceso permanente (usuario de sistema)
 *   WHATSAPP_PHONE_NUMBER_ID     id del número del spa en Meta
 *   WHATSAPP_TEMPLATE_REMINDER   nombre de la plantilla de recordatorio (p. ej. recordatorio_cita)
 *   WHATSAPP_TEMPLATE_CONFIRM    (opcional) plantilla de confirmación al reservar
 *   WHATSAPP_TEMPLATE_CODE       (opcional) plantilla de autenticación para que el cliente entre con código
 *   WHATSAPP_LANG                idioma de las plantillas (por defecto es_MX)
 */
export type WaMessage = { to: string; template: string; params: string[]; components?: unknown[] };
export type Transport = (msg: WaMessage) => Promise<{ ok: boolean; id?: string; error?: string }>;

const env = () => ({
  token: process.env.WHATSAPP_TOKEN,
  phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  reminder: process.env.WHATSAPP_TEMPLATE_REMINDER,
  confirm: process.env.WHATSAPP_TEMPLATE_CONFIRM,
  code: process.env.WHATSAPP_TEMPLATE_CODE,
  lang: process.env.WHATSAPP_LANG || "es_MX",
});

export const whatsappStatus = () => {
  const e = env();
  const base = !!(e.token && e.phoneId);
  return { configured: base, reminders: base && !!e.reminder, confirmations: base && !!e.confirm, loginCodes: base && !!e.code };
};
export const templates = () => ({ reminder: env().reminder, confirm: env().confirm, code: env().code });

/** Plantilla de autenticación de Meta: el código va en el cuerpo y en el botón "Copiar código". */
export const codeComponents = (code: string) => [
  { type: "body", parameters: [{ type: "text", text: code }] },
  { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
];

const cloudApi: Transport = async ({ to, template, params, components }) => {
  const e = env();
  const res = await fetch(`https://graph.facebook.com/v21.0/${e.phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${e.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: `52${to}`,
      type: "template",
      template: {
        name: template,
        language: { code: e.lang },
        components: components ?? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!res.ok) return { ok: false, error: data.error?.message ?? `HTTP ${res.status}` };
  return { ok: true, id: data.messages?.[0]?.id };
};

let transport: Transport = cloudApi;
/** Para pruebas: reemplaza el envío real. */
export const setTransport = (t: Transport | null) => {
  transport = t ?? cloudApi;
};

export async function sendTemplate(msg: WaMessage) {
  if (!whatsappStatus().configured) return { ok: false, error: "WhatsApp no configurado" };
  try {
    return await transport(msg);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
