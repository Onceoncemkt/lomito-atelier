# Lomito Atelier

Sistema de citas y gestión para Lomito Atelier (spa canino, Tulancingo). Ya está preparado para manejar varios negocios.

- **Página pública de reservas**: el cliente elige servicio, tamaño, extras, día y hora, y deja sus datos.
- **Panel del equipo** (`/panel`): agenda por groomer, citas manuales y walk-ins, clientes y lomitos, caja (servicios y boutique), corte de caja con bitácora del día, y comisiones.

| Parte | Tecnología | Dónde vive |
|---|---|---|
| `api/` | Node 22 · Express 5 · Prisma 7 · PostgreSQL | Render |
| `web/` | React 19 · Vite · TypeScript | Vercel |

## Correr en tu compu

Necesitas Node 22 y un PostgreSQL local (Postgres.app o `brew install postgresql@16`).

```bash
npm install
cp api/.env.example api/.env          # pon tu DATABASE_URL local
cp web/.env.example web/.env.local    # VITE_API_URL=http://localhost:4000
npm run migrate -w api                # crea las tablas
SEED_OWNER_PASSWORD=algo-seguro npm run seed -w api
npm run dev:api                       # http://localhost:4000
npm run dev:web                       # http://localhost:5173  (panel en /panel)
```

Pruebas de la API (usan una base `lomito_test` que se vacía en cada corrida):

```bash
TEST_DATABASE_URL=postgresql://localhost:5432/lomito_test npm test
```

## Publicar

### 1. API y base de datos en Render

1. En Render: **New → Blueprint** y elige este repo. `render.yaml` crea la base de datos y la API.
2. Cuando termine el primer deploy, abre la **Shell** del servicio y corre:
   ```bash
   SEED_OWNER_EMAIL=maria@onceonce.community SEED_OWNER_PASSWORD='una-contraseña-segura' npm run seed -w api
   ```
3. Revisa que `https://<tu-api>.onrender.com/health` responda `{"ok":true}`.

### 2. Web en Vercel

1. En Vercel: **Add New → Project** y elige este repo.
2. **Root Directory**: `web` (Vercel detecta Vite solo).
3. Variables de entorno:
   - `VITE_API_URL` = la URL de la API en Render
   - `VITE_BUSINESS_SLUG` = `lomito-atelier`
   - `VITE_WHATSAPP` = el WhatsApp del negocio (10 dígitos)
   - `VITE_META_PIXEL_ID` (opcional) = el ID del Pixel de Meta para medir campañas
   - `VITE_GA_ID` (opcional) = el ID de Google Analytics 4 (`G-XXXXXXX`)
4. Deploy.

### 3. Dominio

- En Vercel → Settings → Domains agrega `lomitoatelier.mx` y `www.lomitoatelier.mx`, y configura el DNS como te indique.
- La página de reservas queda en `lomitoatelier.mx` y el panel del equipo en `lomitoatelier.mx/panel`.
- Si cambias de dominio, actualiza `CORS_ORIGIN` en Render.

## Reglas del negocio en el código

- **Horario**: martes a domingo de 9:00 a 19:00, con citas cada 30 min (`Business.openingHours`, `slotMinutes`). Lunes cerrado.
- **Asignación de groomer**: el que esté libre y, si hay varios, el menos ocupado del día.
- **Sin dobles reservas**: cada reserva toma un candado por negocio y día (`pg_advisory_xact_lock`). Además, un mismo lomito no puede tener dos citas encimadas.
- **Cabina de secado**: braquicéfalos (pug, bulldog, shih tzu, bóxer…) y perros grandes o gigantes se secan a mano. Se puede forzar por lomito desde su ficha.
- **Dinero** en centavos (`Int`) en la base de datos y en la API.
- **Comisiones**: % (30 por defecto, configurable por groomer) sobre servicios terminados, incluyendo extras. La boutique no paga comisión.
- **Corte de caja**: uno por día. Después del corte ya no se puede cobrar ese día.

## Roles

| Rol | Puede |
|---|---|
| OWNER | Todo, incluidas comisiones, productos, groomers y usuarios |
| RECEPTION | Agenda, citas, clientes, caja y corte |
| GROOMER | Ver sus citas y marcarlas como terminadas |

Usuarios, estilistas, precios, extras, boutique, horario y WhatsApp se editan en **Panel → Ajustes** (sólo dueña).

Si alguien olvida su contraseña: la dueña la cambia en Ajustes → Equipo, o desde la Shell de Render:

```bash
npm run set-password -w api -- correo@ejemplo.com 'NuevaContraseña123'
```

## Liga de la cita (cambiar o cancelar)

Cada cita tiene una liga privada `lomitoatelier.mx/cita/<código>`. El cliente la ve al terminar de reservar y llega en los mensajes de WhatsApp. Desde ahí puede cambiar el día u hora o cancelar, hasta **N horas antes** (Ajustes → Negocio, 4 h por defecto). Todo queda en la bitácora del día.

## WhatsApp automático

Sin configurar, recepción manda recordatorios desde la agenda con el botón **Enviar recordatorio por WhatsApp**, que ya incluye la liga.

Para que salgan solos (recordatorio 24 h antes y, si quieres, confirmación al reservar):

1. **Número:** un número para el spa que **no** esté en la app normal de WhatsApp ni en WhatsApp Business del celular (o hay que darlo de baja ahí primero).
2. **Meta:** en [business.facebook.com](https://business.facebook.com) crea o usa tu portafolio, luego en [developers.facebook.com](https://developers.facebook.com) → *Create app* → tipo *Business* → agrega el producto **WhatsApp** y registra el número.
3. **Token permanente:** Configuración del negocio → Usuarios del sistema → crea uno con rol Admin, asígnale la app y genera un token con permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
4. **Plantillas** (WhatsApp Manager → Plantillas de mensajes), categoría **Utilidad**, idioma **Español (MEX)**. Los números `{{1}}…{{5}}` deben ir en este orden: nombre, lomito, día, hora, liga.

   **recordatorio_cita**
   > Hola {{1}}, te recordamos la cita de {{2}} en Lomito Atelier el {{3}} a las {{4}}. Si necesitas cambiarla o cancelarla, entra aquí: {{5}} ¡Te esperamos!

   **confirmacion_cita** (opcional)
   > Hola {{1}}, ¡tu cita quedó agendada! {{2}} te espera el {{3}} a las {{4}} en Lomito Atelier. Para ver, cambiar o cancelar tu cita: {{5}}

5. **Render → lomito-atelier-api → Environment:**
   - `WHATSAPP_TOKEN` = el token permanente
   - `WHATSAPP_PHONE_NUMBER_ID` = el *Phone number ID* (no es el número, es un id largo)
   - `WHATSAPP_TEMPLATE_REMINDER` = `recordatorio_cita`
   - `WHATSAPP_TEMPLATE_CONFIRM` = `confirmacion_cita` (déjala vacía si no quieres confirmación)

   Guarda y redeploy. En **Ajustes → Negocio → WhatsApp automático** debe decir *Conectado / Activo*.

El recordatorio se revisa cada 10 minutos: sale para citas de las próximas 24 h (y con más de 2 h de anticipación), una sola vez. Si se reprograma, se vuelve a mandar para la nueva hora. Los errores de envío aparecen en la bitácora de Caja.

## Antes de abrir

1. **Ajustes → Negocio → Aviso de privacidad:** llena responsable, domicilio y correo. El aviso queda en `/privacidad` y se enlaza al confirmar cada cita. Que lo revise tu contador o abogado.
2. **Ajustes → Negocio → Borrar datos de prueba:** escribe BORRAR. Deja servicios, precios, productos, equipo y horario; borra citas, clientes, ventas, cortes y bitácora. Después revisa el stock de la boutique.
3. **Medición (opcional):** con `VITE_META_PIXEL_ID` y/o `VITE_GA_ID` en Vercel, cada reserva confirmada manda el evento `Schedule` (Meta) y `generate_lead` (Google) con el valor en MXN. El panel no se mide.

## Reportes

Panel → **Reportes** (sólo dueña): ventas por día, servicios y productos más vendidos, ticket promedio, clientes nuevos y que regresan, porcentaje que no llegó, días y horas más llenos, cómo agendan, formas de pago y clientes por recuperar (más de 60 días sin venir) con botón para invitarlos por WhatsApp.

## Cuenta del cliente y cartillas

**Mi lomito** (`lomitoatelier.mx/mi-lomito`): el cliente ve sus perros, sus citas próximas y su historial, y sube la foto o PDF de la cartilla de cada lomito.

- **Cómo entra:** con la liga de cualquiera de sus citas (botón *Mi cuenta* en la página de la cita, o *Subir cartilla ahora* al terminar de reservar). Cuando WhatsApp esté conectado y exista la plantilla de código, también puede entrar escribiendo su número y un código de 6 números que le llega por WhatsApp. El cliente usa su WhatsApp normal; el que necesita WhatsApp Business es el spa.
- **Plantilla de código** (WhatsApp Manager → Plantillas → categoría **Autenticación**, idioma Español (MEX), con botón *Copiar código*). Ponle de nombre `codigo_acceso` y en Render: `WHATSAPP_TEMPLATE_CODE=codigo_acceso`.

**Revisión de cartillas** (Panel → **Cartillas**, dueña y recepción):

1. Al subirse, la IA (Claude) lee cada vacuna y su fecha. El sistema calcula cuáles están vigentes según **Ajustes → Negocio → Vacunas que pedimos** (cuáles son obligatorias y cuántos meses dura cada una).
2. La IA sólo **sugiere**: "todo vigente", "revisar" o "no parece cartilla". Una persona aprueba (con fecha de vigencia) o rechaza (con nota que el cliente ve en su cuenta).
3. En la agenda, las citas de lomitos sin cartilla aprobada muestran la etiqueta **Cartilla**. Pueden reservar igual; recepción revisa antes o al llegar.

**Activar la IA:**

1. Crea una cuenta en [console.anthropic.com](https://console.anthropic.com), agrega un método de pago y crea una **API key**.
2. Render → lomito-atelier-api → Environment: `ANTHROPIC_API_KEY=<tu clave>`. Opcional: `ANTHROPIC_MODEL` (por defecto `claude-sonnet-5-5`).
3. Redeploy. En Ajustes debe decir *Lectura de cartillas con IA: Activa*.

Cada cartilla cuesta centavos de dólar. Sin la clave, todo funciona igual pero la revisión es 100% manual.
