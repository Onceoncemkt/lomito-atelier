import { Link, NavLink, Navigate, Outlet } from "react-router-dom";
import { useSession } from "../session";

export default function Panel() {
  const { me, loading, logout } = useSession();
  if (loading) return <p className="loading wrap">Cargando…</p>;
  if (!me) return <Navigate to="/panel/login" replace />;
  const role = me.user.role;
  const tabs = [
    { to: "/panel", label: "Agenda", end: true, show: true },
    { to: "/panel/clientes", label: "Clientes", show: role !== "GROOMER" },
    { to: "/panel/caja", label: "Caja", show: role !== "GROOMER" },
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
