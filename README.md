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

Para crear usuarios por ahora: `POST /api/users` con sesión de dueña (la pantalla de usuarios viene después).
