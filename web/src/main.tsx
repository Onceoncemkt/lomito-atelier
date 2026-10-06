import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import { SessionProvider } from "./session";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<Reservar />} />
          <Route path="/panel/login" element={<Login />} />
          <Route path="/panel" element={<Panel />}>
            <Route index element={<Agenda />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="caja" element={<Caja />} />
            <Route path="comisiones" element={<Comisiones />} />
            <Route path="cuenta" element={<Cuenta />} />
            <Route path="ajustes" element={<Ajustes />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
