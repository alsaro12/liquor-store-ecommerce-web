const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const CUSTOMERS_DB_PATH = path.join(ROOT, "local-db", "customers.json");
const VALID_ROLES = new Set(["cliente", "staff", "admin"]);

function readEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return {};
  return fs.readFileSync(envPath, "utf8").split(/\r?\n/).reduce((acc, line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) return acc;
    const index = clean.indexOf("=");
    if (index < 0) return acc;
    const key = clean.slice(0, index).trim();
    const raw = clean.slice(index + 1).trim();
    acc[key] = raw.replace(/^["']|["']$/g, "");
    return acc;
  }, {});
}

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").slice(-9);
}

function normalizeDni(value) {
  return String(value || "").replace(/\D+/g, "").slice(0, 12);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function usage() {
  console.error("Uso: node scripts/set-user-role.js --role=admin --telefono=999999999");
  console.error("Tambien puedes usar --dni=12345678 o --email=admin@correo.com. Roles: admin, staff, cliente.");
}

async function updateLocalStore({ role, telefono, dni, email }) {
  if (!fs.existsSync(CUSTOMERS_DB_PATH)) return false;
  const store = JSON.parse(fs.readFileSync(CUSTOMERS_DB_PATH, "utf8") || "{}");
  const customers = Array.isArray(store.customers) ? store.customers : [];
  const customer = customers.find((entry) => (
    (telefono && normalizePhone(entry.telefono) === telefono) ||
    (dni && normalizeDni(entry.dni) === dni) ||
    (email && normalizeEmail(entry.email) === email)
  ));
  if (!customer) return false;
  customer.rol = role;
  fs.writeFileSync(CUSTOMERS_DB_PATH, `${JSON.stringify(store, null, 2)}\n`);
  console.log(`Rol actualizado en local-db para usuario #${customer.id}: ${role}`);
  return true;
}

async function updateMysql({ role, telefono, dni, email }) {
  const env = { ...readEnvFile(), ...process.env };
  if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER) return false;
  const connection = await mysql.createConnection({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD || "",
    charset: env.DB_CHARSET || "utf8mb4"
  });
  try {
    const clauses = [];
    const values = [];
    if (telefono) {
      clauses.push("telefono = ?");
      values.push(telefono);
    }
    if (dni) {
      clauses.push("dni = ?");
      values.push(dni);
    }
    if (email) {
      clauses.push("LOWER(email) = ?");
      values.push(email);
    }
    const [rows] = await connection.query(
      `SELECT id FROM usuarios_cliente WHERE ${clauses.join(" OR ")} LIMIT 1`,
      values
    );
    if (!Array.isArray(rows) || !rows.length) return false;
    await connection.query("UPDATE usuarios_cliente SET rol = ? WHERE id = ?", [role, rows[0].id]);
    console.log(`Rol actualizado en MySQL para usuario #${rows[0].id}: ${role}`);
    return true;
  } finally {
    await connection.end();
  }
}

async function main() {
  const role = String(getArg("role") || "").toLowerCase();
  const telefono = normalizePhone(getArg("telefono") || getArg("phone"));
  const dni = normalizeDni(getArg("dni"));
  const email = normalizeEmail(getArg("email"));

  if (!VALID_ROLES.has(role) || (!telefono && !dni && !email)) {
    usage();
    process.exitCode = 1;
    return;
  }

  let changed = false;
  try {
    changed = await updateMysql({ role, telefono, dni, email }) || changed;
  } catch (error) {
    console.warn(`No se pudo actualizar MySQL: ${error.message}`);
  }
  changed = await updateLocalStore({ role, telefono, dni, email }) || changed;

  if (!changed) {
    console.error("No encontre un usuario con esos datos.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
