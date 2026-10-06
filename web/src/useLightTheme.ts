import { useEffect } from "react";

/** Las páginas públicas siempre se ven con los colores de la marca, aunque el celular esté en modo oscuro. */
export function useLightTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "light");
    root.style.colorScheme = "light";
    return () => {
      if (prev) root.setAttribute("data-theme", prev);
      else root.removeAttribute("data-theme");
      root.style.colorScheme = "";
    };
  }, []);
}
