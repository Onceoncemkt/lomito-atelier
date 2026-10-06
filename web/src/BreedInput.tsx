import { useId, useMemo, useRef, useState } from "react";
import { BREEDS } from "./breeds";

const MIX = "Mestizo / cruza";
const POPULAR = [MIX, "Shih Tzu", "French Poodle", "Chihuahua", "Schnauzer mini", "Yorkshire", "Golden Retriever", "Labrador", "Husky siberiano", "Pug"];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Campo de raza con lista desplegable propia (la <datalist> nativa no se ve en iPhone). */
export default function BreedInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /** lo que se filtra: vacío al tocar el campo (muestra las más comunes), lo escrito al teclear */
  const [query, setQuery] = useState("");
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => {
    const q = norm(query);
    if (!q) return POPULAR;
    const all = [MIX, ...BREEDS.map(([n]) => n)];
    const starts = all.filter((n) => norm(n).startsWith(q));
    const contains = all.filter((n) => !norm(n).startsWith(q) && norm(n).includes(q));
    const words = all.filter((n) => !starts.includes(n) && !contains.includes(n) && norm(n).split(/[\s()/-]+/).some((w) => w.startsWith(q)));
    const res = [...starts, ...contains, ...words];
    if (/mest|cruz|mezc|mix|crioll|no s/.test(q) && !res.includes(MIX)) res.unshift(MIX);
    return res.slice(0, 8);
  }, [query]);

  const exact = !!query && options.length === 1 && norm(options[0]) === norm(query);
  const show = open && options.length > 0 && !exact;

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className="combo">
      <input
        ref={inputRef}
        id="breed"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show ? `${listId}-${active}` : undefined}
        value={value}
        placeholder="Escribe o elige: Golden, mestizo…"
        maxLength={60}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => { setQuery(""); setOpen(true); setActive(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => { onChange(e.target.value); setQuery(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(options[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {show && (
        <ul className="combo-list" role="listbox" id={listId}>
          {!query.trim() && <li className="combo-head" aria-hidden="true">Más comunes</li>}
          {options.map((o, i) => (
            <li
              key={o}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              onMouseEnter={() => setActive(i)}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
