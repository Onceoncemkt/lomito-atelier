import { badRequest } from "./errors.js";

const MAX = 6 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** Recibe "data:<tipo>;base64,..." y valida tipo real y tamaño. */
export function decodeDataUrl(dataUrl: string) {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!m) throw badRequest("Archivo inválido");
  const mimeType = m[1].toLowerCase();
  if (!ALLOWED.includes(mimeType)) throw badRequest("Sube una foto (JPG, PNG) o un PDF");
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length) throw badRequest("El archivo está vacío");
  if (buf.length > MAX) throw badRequest("El archivo pesa más de 6 MB");
  const sig = buf.subarray(0, 12);
  const ok =
    (mimeType === "image/jpeg" && sig[0] === 0xff && sig[1] === 0xd8) ||
    (mimeType === "image/png" && sig.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ||
    (mimeType === "image/webp" && sig.subarray(0, 4).toString() === "RIFF" && sig.subarray(8, 12).toString() === "WEBP") ||
    (mimeType === "application/pdf" && sig.subarray(0, 4).toString() === "%PDF");
  if (!ok) throw badRequest("El archivo no coincide con su tipo");
  return { mimeType, data: buf };
}
