/** Razas comunes en México y su tamaño típico para estética (por peso adulto). */
export type Size = "CHICO" | "MEDIANO" | "GRANDE" | "GIGANTE";

export const BREEDS: [string, Size][] = [
  // Chico (hasta 10 kg)
  ["Chihuahua", "CHICO"], ["Yorkshire", "CHICO"], ["Shih Tzu", "CHICO"], ["Maltés", "CHICO"], ["Pomerania", "CHICO"],
  ["French Poodle", "CHICO"], ["Poodle toy", "CHICO"], ["Poodle mini", "CHICO"], ["Schnauzer mini", "CHICO"], ["Pug", "CHICO"],
  ["Bichón frisé", "CHICO"], ["Bichón maltés", "CHICO"], ["Lhasa Apso", "CHICO"], ["Pequinés", "CHICO"], ["Salchicha (Dachshund)", "CHICO"],
  ["Pinscher miniatura", "CHICO"], ["Jack Russell", "CHICO"], ["Cavalier King Charles", "CHICO"], ["Papillón", "CHICO"],
  ["Westie (West Highland)", "CHICO"], ["Scottish Terrier", "CHICO"], ["Boston Terrier", "CHICO"], ["Havanés", "CHICO"],
  ["Coton de Tulear", "CHICO"], ["Spitz japonés", "CHICO"], ["Xoloitzcuintle mini", "CHICO"], ["Chin japonés", "CHICO"],
  ["Cairn Terrier", "CHICO"], ["Fox Terrier", "CHICO"], ["Pomsky", "CHICO"], ["Maltipoo", "CHICO"], ["Yorkipoo", "CHICO"],
  // Mediano (10–25 kg)
  ["Beagle", "MEDIANO"], ["Cocker Spaniel", "MEDIANO"], ["Schnauzer estándar", "MEDIANO"], ["Bulldog francés", "MEDIANO"],
  ["Bulldog inglés", "MEDIANO"], ["Border Collie", "MEDIANO"], ["Corgi", "MEDIANO"], ["Shiba Inu", "MEDIANO"],
  ["Basset Hound", "MEDIANO"], ["Springer Spaniel", "MEDIANO"], ["Shar Pei", "MEDIANO"], ["Pitbull", "MEDIANO"],
  ["Staffordshire", "MEDIANO"], ["Xoloitzcuintle", "MEDIANO"], ["Schnauzer", "MEDIANO"], ["Cockapoo", "MEDIANO"],
  ["Whippet", "MEDIANO"], ["Bull Terrier", "MEDIANO"], ["Shetland (Sheltie)", "MEDIANO"], ["Kerry Blue Terrier", "MEDIANO"],
  ["Wheaten Terrier", "MEDIANO"], ["Spaniel bretón", "MEDIANO"], ["Keeshond", "MEDIANO"],
  // Grande (25–40 kg)
  ["Labrador", "GRANDE"], ["Golden Retriever", "GRANDE"], ["Pastor alemán", "GRANDE"], ["Bóxer", "GRANDE"],
  ["Dóberman", "GRANDE"], ["Husky siberiano", "GRANDE"], ["Samoyedo", "GRANDE"], ["Poodle estándar", "GRANDE"],
  ["Pastor australiano", "GRANDE"], ["Dálmata", "GRANDE"], ["Weimaraner", "GRANDE"], ["Chow Chow", "GRANDE"],
  ["Pastor belga", "GRANDE"], ["Dogo argentino", "GRANDE"], ["Collie", "GRANDE"], ["Goldendoodle", "GRANDE"],
  ["Labradoodle", "GRANDE"], ["Setter irlandés", "GRANDE"], ["Pointer", "GRANDE"], ["Viejo pastor inglés", "GRANDE"],
  ["Schnauzer gigante", "GRANDE"], ["Rhodesian Ridgeback", "GRANDE"], ["Pastor suizo (blanco)", "GRANDE"],
  // Gigante (más de 40 kg)
  ["Gran danés", "GIGANTE"], ["San Bernardo", "GIGANTE"], ["Rottweiler", "GIGANTE"], ["Bernés de la montaña", "GIGANTE"],
  ["Mastín", "GIGANTE"], ["Terranova", "GIGANTE"], ["Akita", "GIGANTE"], ["Malamute de Alaska", "GIGANTE"],
  ["Cane Corso", "GIGANTE"], ["Gran Pirineo", "GIGANTE"], ["Dogo de Burdeos", "GIGANTE"], ["Leonberger", "GIGANTE"],
];

export const UNKNOWN_HINTS = ["mestiz", "cruza", "criollo", "callejer", "no se", "nose", "mezcla", "mix", "adoptad", "rescat", "sin raza", "corriente"];

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Palabras clave por raza, de más específica a menos (p. ej. "schnauzer mini" antes que "schnauzer"). */
const KEYS: [string, Size][] = BREEDS.flatMap(([name, size]) => {
  const n = norm(name.replace(/\(.*?\)/g, ""));
  const extra = (name.match(/\((.*?)\)/)?.[1] ?? "").split(/,\s*/).map(norm).filter(Boolean);
  return [n, ...extra].map((k) => [k, size] as [string, Size]);
})
  .concat([
    ["golden", "GRANDE"], ["husky", "GRANDE"], ["pastor aleman", "GRANDE"], ["doberman", "GRANDE"], ["poodle", "CHICO"],
    ["frenchie", "MEDIANO"], ["salchicha", "CHICO"], ["dachshund", "CHICO"], ["yorkie", "CHICO"], ["xolo", "MEDIANO"],
    ["maltes", "CHICO"], ["bichon", "CHICO"], ["boxer", "GRANDE"], ["rottweiler", "GIGANTE"], ["pitbull", "MEDIANO"], ["pit bull", "MEDIANO"],
    ["labrador", "GRANDE"], ["border", "MEDIANO"], ["cocker", "MEDIANO"], ["bulldog", "MEDIANO"], ["pomerania", "CHICO"],
    ["schnauzer", "MEDIANO"], ["pastor", "GRANDE"], ["mastin", "GIGANTE"], ["san bernardo", "GIGANTE"],
  ] as [string, Size][])
  .sort((a, b) => b[0].length - a[0].length);

export type BreedGuess = { kind: "empty" } | { kind: "unknown" } | { kind: "match"; size: Size; label: string } | { kind: "mixed" } | { kind: "nomatch" };

/** Adivina el tamaño a partir de lo que escribió la persona. */
export function guessSize(text: string): BreedGuess {
  const t = norm(text);
  if (!t) return { kind: "empty" };
  if (UNKNOWN_HINTS.some((h) => t.includes(h))) {
    // "cruza de golden": si sólo menciona una raza seguimos sin saber; pedimos peso
    return { kind: "unknown" };
  }
  const found: [string, Size][] = [];
  let rest = ` ${t} `;
  for (const [k, size] of KEYS) {
    if (rest.includes(` ${k} `) || (k.length >= 5 && rest.includes(k))) {
      found.push([k, size]);
      rest = rest.replace(k, " ");
    }
  }
  if (!found.length) return { kind: "nomatch" };
  const sizes = new Set(found.map((f) => f[1]));
  if (sizes.size > 1) return { kind: "mixed" };
  const exact = BREEDS.find(([n]) => norm(n.replace(/\(.*?\)/g, "")) === t || norm(n) === t);
  return { kind: "match", size: found[0][1], label: exact?.[0] ?? text.trim() };
}

export const SIZE_EXAMPLES: Record<Size, string> = {
  CHICO: "como un chihuahua, shih tzu o poodle toy",
  MEDIANO: "como un beagle, schnauzer o cocker",
  GRANDE: "como un labrador, golden o husky",
  GIGANTE: "como un gran danés, san bernardo o rottweiler",
};
