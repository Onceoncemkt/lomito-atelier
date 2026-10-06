import type { Size } from "../generated/prisma/enums.js";

/** Razas braquicéfalas: se secan a mano, nunca en cabina. */
const BRACHY = [
  "pug", "carlino", "bulldog", "shih tzu", "shihtzu", "boxer", "bóxer", "pequines", "pequinés",
  "pekines", "boston", "lhasa", "french", "frenchie", "cavalier", "chow", "shar pei", "sharpei",
  "dogo de burdeos", "mastin napolitano", "mastín napolitano", "affenpinscher", "griffon",
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function isBrachycephalic(breed?: string | null): boolean {
  if (!breed) return false;
  const b = norm(breed);
  return BRACHY.some((x) => b.includes(norm(x)));
}

/** ¿Puede usar la cabina de secado? override (ficha del lomito) manda sobre la regla. */
export function canUseCabin(breed: string | null | undefined, size: Size, override?: boolean | null): boolean {
  if (override === true || override === false) return override;
  if (size === "GRANDE" || size === "GIGANTE") return false;
  return !isBrachycephalic(breed);
}
