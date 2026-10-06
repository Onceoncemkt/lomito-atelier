import { execSync } from "node:child_process";
import pg from "pg";

/** Deja la base de pruebas vacía y con el seed de Lomito Atelier. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5433/lomito_test";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
  );
  if (rows.length) await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(",")} CASCADE`);
  await client.end();
  execSync("npx tsx prisma/seed.ts", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: url, SEED_OWNER_PASSWORD: "lomito-test-123" },
  });
}
