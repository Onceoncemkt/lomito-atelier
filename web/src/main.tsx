import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { trackPage } from "./tracking";
import "./styles.css";
import Reservar from "./pages/Reservar";
import Login from "./pages/Login";
import Panel from "./pages/Panel";
import Agenda from "./pages/Agenda";
import Clientes from "./pages/Clientes";
import Caja from "./pages/Caja";
import Comisiones from "./pages/Comisiones";
import Cuenta from "./pages/Cuenta";
import Ajustes from "./pages/Ajustes";
import Cita from "./pages/Cita";
import Privacidad from "./pages/Privacidad";
import Reportes from "./pages/Reportes";
import MiLomito from "./pages/MiLomito";
import Cartillas from "./pages/Cartillas";
import Huellitas from "./pages/Huellitas";
import { SessionProvider } from "./session";

/**
 * Mientras no abrimos, todo lo público muestra "¡No comas ansias!". El panel sigue funcionando.
 * Para abrir: en Vercel pon VITE_LAUNCHED=1 y vuelve a desplegar.
 * Para ver la página real antes de abrir: entra una vez a lomitoatelier.mx/?preview=lomito
 */
const LAUNCHED = import.meta.env.VITE_LAUNCHED === "1";
function isPreview() {
  try {
    if (new URLSearchParams(location.search).get("preview") === "lomito") localStorage.setItem("lomito-preview", "1");
    return localStorage.getItem("lomito-preview") === "1";
  } catch {
    return false;
  }
}
const OPEN = LAUNCHED || isPreview();
function Publica({ children }: { children: React.ReactNode }) {
  return OPEN ? <>{children}</> : <Huellitas mode="soon" />;
}

function PageTracker() {
  const { pathname } = useLocation();
  useEffect(() => trackPage(pathname), [pathname]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <PageTracker />
      <SessionProvider>
        <Routes>
          <Route path="/" element={<Publica><Reservar /></Publica>} />
          <Route path="/cita/:token" element={<Publica><Cita /></Publica>} />
          <Route path="/privacidad" element={<Publica><Privacidad /></Publica>} />
          <Route path="/mi-lomito" element={<Publica><MiLomito /></Publica>} />
          <Route path="/panel/login" element={<Login />} />
          <Route path="/panel" element={<Panel />}>
            <Route index element={<Agenda />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="caja" element={<Caja />} />
            <Route path="comisiones" element={<Comisiones />} />
            <Route path="cuenta" element={<Cuenta />} />
            <Route path="ajustes" element={<Ajustes />} />
            <Route path="reportes" element={<Reportes />} />
            <Route path="cartillas" element={<Cartillas />} />
          </Route>
          <Route path="*" element={<Huellitas mode={OPEN ? "404" : "soon"} />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
