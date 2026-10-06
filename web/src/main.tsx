import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
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
import { SessionProvider } from "./session";

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
          <Route path="/" element={<Reservar />} />
          <Route path="/cita/:token" element={<Cita />} />
          <Route path="/privacidad" element={<Privacidad />} />
          <Route path="/mi-lomito" element={<MiLomito />} />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
