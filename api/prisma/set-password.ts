/**
 * Cambia la contraseña de un usuario (por si alguien la olvidó).
 *
 *   npm run set-password -w api -- correo@ejemplo.com 'NuevaContraseña123'
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db.js";

async function main() {
  const [email, password] = process.argv.slice(2);
  const slug = process.env.SEED_BUSINESS_SLUG ?? "lomito-atelier";
  if (!email || !password) throw new Error("Uso: npm run set-password -w api -- correo 'contraseña'");
  if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres");
  const r = await prisma.user.updateMany({
    where: { email: email.toLowerCase(), business: { slug } },
    data: { passwordHash: await bcrypt.hash(password, 10) },
  });
  if (!r.count) throw new Error(`No existe el usuario ${email} en ${slug}`);
  console.log(`Contraseña actualizada para ${email}`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
