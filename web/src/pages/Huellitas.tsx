import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useLightTheme } from "../useLightTheme";

const WHATSAPP = import.meta.env.VITE_WHATSAPP as string | undefined;
const INSTAGRAM = "https://www.instagram.com/lomitoatelier/";

/** Huellita: cojinete + 4 deditos. */
function Paw({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="42" rx="14" ry="12" />
      <ellipse cx="14" cy="26" rx="6" ry="8" transform="rotate(-20 14 26)" />
      <ellipse cx="25" cy="15" rx="6" ry="8" transform="rotate(-6 25 15)" />
      <ellipse cx="39" cy="15" rx="6" ry="8" transform="rotate(6 39 15)" />
      <ellipse cx="50" cy="26" rx="6" ry="8" transform="rotate(20 50 26)" />
    </svg>
  );
}

/** Un caminito de huellas que cruza la pantalla, alternando pata izquierda y derecha. */
function Trail({ top, delay, flip }: { top: string; delay: number; flip?: boolean }) {
  const steps = 9;
  return (
    <div className={`trail${flip ? " flip" : ""}`} style={{ top }} aria-hidden="true">
      {Array.from({ length: steps }, (_, i) => (
        <Paw
          key={i}
          className="paw"
          style={{
            left: `${4 + i * 11}%`,
            transform: `translateY(${i % 2 ? 22 : 0}px) rotate(${flip ? -90 : 90}deg)`,
            animationDelay: `${delay + i * 0.35}s`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Página de huellitas: "próximamente" mientras no abrimos, y página 404 después.
 * mode="soon"  → ¡No comas ansias!
 * mode="404"   → Aquí no hay ningún hueso
 */
export default function Huellitas({ mode }: { mode: "soon" | "404" }) {
  useLightTheme();
  const soon = mode === "soon";

  useEffect(() => {
    document.title = soon ? "Lomito Atelier · Muy pronto" : "Página no encontrada · Lomito Atelier";
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const created = !robots;
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.appendChild(robots);
    }
    robots.content = "noindex";
    return () => {
      document.title = "Lomito Atelier · Agenda tu cita";
      if (created) robots?.remove();
    };
  }, [soon]);

  return (
    <main className="huellitas">
      <Trail top="3%" delay={0} />
      <Trail top="calc(100% - 70px)" delay={2.2} flip />

      <section className="huellitas-card">
        <img className="huellitas-dog" src="/lomito-verde.svg" alt="" />
        <p className="huellitas-eyebrow">Lomito Atelier · Tulancingo</p>
        {soon ? (
          <>
            <h1>¡No comas ansias!</h1>
            <p>Estamos preparando algo muy bonito para consentir a tu lomito.</p>
            <p className="huellitas-date">Muy pronto</p>
            <div className="huellitas-actions">
              <a className="btn" href={INSTAGRAM} target="_blank" rel="noreferrer">
                Síguenos en Instagram
              </a>
              {WHATSAPP ? (
                <a className="btn ghost" href={`https://wa.me/52${WHATSAPP}`} target="_blank" rel="noreferrer">
                  Escríbenos por WhatsApp
                </a>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <p className="huellitas-404">404</p>
            <h1>Aquí no hay ningún hueso</h1>
            <p>Olfateamos por todos lados y esta página no existe. Seguro alguien la enterró en el jardín.</p>
            <div className="huellitas-actions">
              <Link className="btn" to="/">
                Volver al inicio
              </Link>
            </div>
          </>
        )}
        <p className="huellitas-sign">good hair days for good dogs</p>
      </section>
    </main>
  );
}
