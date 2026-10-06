import { useEffect, useState } from "react";
import { api, BUSINESS_SLUG } from "../api";
import { useLightTheme } from "../useLightTheme";

type Biz = { name: string; phone: string | null; legalName: string | null; address: string | null; contactEmail: string | null };

const UPDATED = "6 de octubre de 2026";

/** Aviso de privacidad integral (Ley Federal de Protección de Datos Personales en Posesión de los Particulares). */
export default function Privacidad() {
  useLightTheme();
  const [b, setB] = useState<Biz | null>(null);
  useEffect(() => {
    api<{ business: Biz }>(`/public/${BUSINESS_SLUG}`).then((r) => setB(r.business)).catch(() => {});
    document.title = "Aviso de privacidad · Lomito Atelier";
    return () => {
      document.title = "Lomito Atelier · Agenda tu cita";
    };
  }, []);

  const name = b?.name ?? "Lomito Atelier";
  const responsable = b?.legalName || name;
  const email = b?.contactEmail;
  const contact = email ? <a href={`mailto:${email}`}>{email}</a> : b?.phone ? <>WhatsApp {b.phone}</> : <>los medios de contacto del atelier</>;

  return (
    <div className="public legal">
      <div className="phone">
        <div className="phone-head">
          <img src="/lomito-creme.svg" alt="" />
          <h2>Aviso de privacidad</h2>
        </div>
        <div className="phone-body">
          <p className="muted">Última actualización: {UPDATED}</p>

          <h3>Quién es responsable de tus datos</h3>
          <p>
            <b>{responsable}</b>{b?.legalName && b.legalName !== name ? `, que opera ${name}` : ""}
            {b?.address ? <>, con domicilio en {b.address}</> : null}, es responsable del uso y protección de tus datos personales.
            Para cualquier tema de privacidad puedes escribirnos a {contact}.
          </p>

          <h3>Qué datos recabamos</h3>
          <ul>
            <li>Tu nombre, número de WhatsApp y, si nos lo das, tu correo.</li>
            <li>Datos de tu mascota: nombre, raza, tamaño y notas de cuidado o comportamiento.</li>
            <li>Historial de citas, servicios y compras en el atelier.</li>
          </ul>
          <p>No recabamos datos personales sensibles.</p>

          <h3>Para qué los usamos</h3>
          <p><b>Finalidades necesarias para darte el servicio:</b></p>
          <ul>
            <li>Agendar, confirmar, cambiar o cancelar tus citas.</li>
            <li>Contactarte por WhatsApp para recordatorios o avisos sobre tu cita.</li>
            <li>Llevar la ficha e historial de tu mascota para atenderla mejor.</li>
            <li>Cobrar y, si lo pides, emitir tu factura.</li>
          </ul>
          <p><b>Finalidades adicionales:</b> enviarte promociones, novedades y encuestas de satisfacción.</p>
          <p>
            Si no quieres que usemos tus datos para estas finalidades adicionales, escríbenos a {contact}. Negarte no afecta tus citas ni el
            servicio.
          </p>

          <h3>Con quién los compartimos</h3>
          <p>
            No vendemos ni rentamos tus datos. Los tratan, sólo por encargo nuestro y para darte el servicio, los proveedores que nos ayudan a operar:
            hospedaje de la página y de la base de datos, y la plataforma de WhatsApp para enviarte mensajes. Sólo compartiríamos tus datos sin tu
            consentimiento en los casos que permite la ley, por ejemplo, a petición de una autoridad.
          </p>

          <h3>Tus derechos (ARCO)</h3>
          <p>
            Puedes <b>acceder</b> a tus datos, <b>rectificarlos</b>, pedir que los <b>cancelemos</b> u <b>oponerte</b> a su uso, así como revocar tu
            consentimiento o limitar su uso. Envía tu solicitud a {contact} con tu nombre, tu número de WhatsApp, el derecho que quieres ejercer y
            una descripción de lo que pides. Te responderemos en un máximo de 20 días hábiles.
          </p>

          <h3>Cookies y medición</h3>
          <p>
            Esta página puede usar herramientas de medición, como Meta Pixel o Google Analytics, para saber cómo llegaste y mejorar nuestros anuncios.
            Puedes bloquearlas desde la configuración de tu navegador.
          </p>

          <h3>Cambios a este aviso</h3>
          <p>Cualquier cambio lo publicaremos en esta misma página.</p>

          <a className="btn ghost" href="/" style={{ textAlign: "center", textDecoration: "none" }}>Volver a agendar</a>
        </div>
      </div>
    </div>
  );
}
