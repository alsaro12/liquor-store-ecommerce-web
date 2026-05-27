const path = require("path");

const PROJECT_DIR = path.resolve(__dirname, "../..");
const ROOT_DIR = path.resolve(__dirname, "../../..");

module.exports = {
  HOST: process.env.HOST || "127.0.0.1",
  PORT: Number.parseInt(process.env.PORT || "8787", 10),
  PROJECT_DIR,
  ROOT_DIR,
  STATIC_ROOT: PROJECT_DIR,
  ENV_FILE_PATH: path.join(PROJECT_DIR, ".env")
};
