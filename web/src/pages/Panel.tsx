import { Link, NavLink, Navigate, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";

export default function Panel() {
  const { me, loading, logout } = useSession();
  const [pending, setPending] = useState(0);
  const canReview = !!me && me.user.role !== "GROOMER";
  useEffect(() => {
    if (!canReview) return;
    const get = () => api<{ pending: number }>("/api/vaccine-cards", { query: { status: "PENDING" } }).then((r) => setPending(r.pending)).catch(() => {});
    get();
    const t = setInterval(get, 120_000);
    return () => clearInterval(t);
  }, [canReview]);
  if (loading) return <p className="loading wrap">Cargando…</p>;
  if (!me) return <Navigate to="/panel/login" replace />;
  const role = me.user.role;
  const tabs = [
    { to: "/panel", label: "Agenda", end: true, show: true },
    { to: "/panel/clientes", label: "Clientes", show: role !== "GROOMER" },
    { to: "/panel/caja", label: "Caja", show: role !== "GROOMER" },
    { to: "/panel/cartillas", label: "Cartillas", show: role !== "GROOMER", badge: pending },
    { to: "/panel/reportes", label: "Reportes", show: role === "OWNER" },
    { to: "/panel/comisiones", label: "Comisiones", show: role === "OWNER" },
    { to: "/panel/ajustes", label: "Ajustes", show: role === "OWNER" },
  ].filter((t) => t.show);
  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <picture>
            <source srcSet="/lomito-creme.svg" media="(prefers-color-scheme: dark)" />
            <img src="/lomito-verde.svg" alt="" />
          </picture>
          <div>
            <b>LOMITO ATELIER</b>
            <small>Citas y gestión</small>
          </div>
        </div>
        <nav className="tabs" aria-label="Secciones">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className="tab">
              {t.label}
              {"badge" in t && t.badge ? <span className="badge" aria-label={`${t.badge} por revisar`}>{t.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="user">
          <Link to="/panel/cuenta" className="linkbtn" title="Mi cuenta y contraseña">{me.user.name}</Link>
          <button className="linkbtn" onClick={logout}>Salir</button>
        </div>
      </header>
      <main className="view">
        <Outlet />
      </main>
    </div>
  );
}
