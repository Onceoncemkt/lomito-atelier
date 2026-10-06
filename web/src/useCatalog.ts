import { useEffect, useState } from "react";
import { api } from "./api";

export type Catalog = {
  services: { id: string; code: string; name: string; prices: Record<string, { price: number; durationMin: number }> }[];
  addOns: { id: string; code: string; name: string; price: number; durationMin: number; active: boolean }[];
  products: { id: string; name: string; price: number; stock: number; active: boolean }[];
  groomers: { id: string; name: string; active: boolean; commissionPct: number | null }[];
};

export function useCatalog() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    api<Catalog>("/api/catalog").then(setCat).catch(() => {});
  }, [n]);
  return { cat, reload: () => setN((x) => x + 1) };
}
