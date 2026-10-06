/** Achica una foto en el navegador (máx. 1800 px, JPEG) para que suba rápido; los PDF pasan tal cual. */
export async function fileToDataUrl(file: File): Promise<string> {
  const read = (f: Blob) =>
    new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(new Error("No se pudo leer el archivo"));
      r.readAsDataURL(f);
    });
  if (file.type === "application/pdf") {
    if (file.size > 6 * 1024 * 1024) throw new Error("El PDF pesa más de 6 MB");
    return read(file);
  }
  if (!file.type.startsWith("image/")) throw new Error("Sube una foto o un PDF");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    throw new Error("No pudimos abrir esa foto. Si es HEIC, toma una captura de pantalla y súbela.");
  }
  const max = 1800;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export const VACCINE_LABEL: Record<string, { text: string; cls: string }> = {
  NONE: { text: "Sin cartilla", cls: "mano" },
  PENDING: { text: "Cartilla en revisión", cls: "mano" },
  APPROVED: { text: "Vacunas al día", cls: "cab" },
  REJECTED: { text: "Cartilla rechazada", cls: "mano" },
  EXPIRED: { text: "Vacunas vencidas", cls: "mano" },
};
