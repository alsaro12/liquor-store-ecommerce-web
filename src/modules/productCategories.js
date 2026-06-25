export const PRODUCT_CATEGORY_OPTIONS = [
  "Whisky",
  "Ron",
  "Vodka",
  "Pisco",
  "Tequila",
  "Gin",
  "Vino",
  "Espumante",
  "Cerveza",
  "Cigarros",
  "Anís",
  "Fernet",
  "Licores y Cremas",
  "Aperitivos y Digestivos",
  "Ready To Drink",
  "Energizantes",
  "Gaseosas",
  "Jugos y Néctares",
  "Agua",
  "Hielo",
  "Snacks y Golosinas",
  "Accesorios y Regalos"
];

const PRODUCT_CATEGORY_ALIASES = new Map([
  ["WHISKY", "Whisky"],
  ["WHISKEY", "Whisky"],
  ["RON", "Ron"],
  ["RONES", "Ron"],
  ["VODKA", "Vodka"],
  ["VODKAS", "Vodka"],
  ["PISCO", "Pisco"],
  ["TEQUILA", "Tequila"],
  ["GIN", "Gin"],
  ["VINO", "Vino"],
  ["VINOS", "Vino"],
  ["ESPUMANTE", "Espumante"],
  ["ESPUMANTES", "Espumante"],
  ["CHAMPAGNE", "Espumante"],
  ["ESPUMANTES Y CHAMPAGNE", "Espumante"],
  ["CERVEZA", "Cerveza"],
  ["CERVEZAS", "Cerveza"],
  ["CIGARRO", "Cigarros"],
  ["CIGARROS", "Cigarros"],
  ["TABACO", "Cigarros"],
  ["TABACOS", "Cigarros"],
  ["ANIS", "Anís"],
  ["ANÍS", "Anís"],
  ["FERNET", "Fernet"],
  ["LICOR", "Licores y Cremas"],
  ["LICORES", "Licores y Cremas"],
  ["CREMAS", "Licores y Cremas"],
  ["LICORES Y CREMAS", "Licores y Cremas"],
  ["CREMAS Y APERITIVOS", "Licores y Cremas"],
  ["APERITIVO", "Aperitivos y Digestivos"],
  ["APERITIVOS", "Aperitivos y Digestivos"],
  ["APERITIVOS Y DIGESTIVOS", "Aperitivos y Digestivos"],
  ["DIGESTIVOS", "Aperitivos y Digestivos"],
  ["READY TO DRINK", "Ready To Drink"],
  ["READY 2 DRINK", "Ready To Drink"],
  ["RTD", "Ready To Drink"],
  ["BEBIDAS PREPARADAS", "Ready To Drink"],
  ["BEBIDAS PREPARADAS RTD", "Ready To Drink"],
  ["ENERGIZANTE", "Energizantes"],
  ["ENERGIZANTES", "Energizantes"],
  ["GASEOSA", "Gaseosas"],
  ["GASEOSAS", "Gaseosas"],
  ["MIXER", "Gaseosas"],
  ["MIXERS", "Gaseosas"],
  ["GASEOSAS Y MIXERS", "Gaseosas"],
  ["JUGO", "Jugos y Néctares"],
  ["JUGOS", "Jugos y Néctares"],
  ["NECTAR", "Jugos y Néctares"],
  ["NECTARES", "Jugos y Néctares"],
  ["NÉCTARES", "Jugos y Néctares"],
  ["JUGOS Y NECTARES", "Jugos y Néctares"],
  ["JUGOS Y NÉCTARES", "Jugos y Néctares"],
  ["AGUA", "Agua"],
  ["AGUAS", "Agua"],
  ["AGUAS Y COMPLEMENTOS", "Agua"],
  ["HIELO", "Hielo"],
  ["HIELOS", "Hielo"],
  ["SNACK", "Snacks y Golosinas"],
  ["SNACKS", "Snacks y Golosinas"],
  ["GOLOSINA", "Snacks y Golosinas"],
  ["GOLOSINAS", "Snacks y Golosinas"],
  ["SNACKS Y GOLOSINAS", "Snacks y Golosinas"],
  ["SNACKS Y PICOTEO", "Snacks y Golosinas"],
  ["ACCESORIO", "Accesorios y Regalos"],
  ["ACCESORIOS", "Accesorios y Regalos"],
  ["REGALO", "Accesorios y Regalos"],
  ["REGALOS", "Accesorios y Regalos"],
  ["ACCESORIOS Y REGALOS", "Accesorios y Regalos"],
  ["OTRO", "Aperitivos y Digestivos"],
  ["OTROS", "Aperitivos y Digestivos"]
]);

function normalizeCategoryKey(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function normalizeProductCategory(value, fallback = "Aperitivos y Digestivos") {
  const raw = String(value || "").trim();
  const exact = PRODUCT_CATEGORY_OPTIONS.find((category) => category.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  return PRODUCT_CATEGORY_ALIASES.get(normalizeCategoryKey(raw)) || fallback;
}
