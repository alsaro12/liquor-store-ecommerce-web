const mysql = require("mysql2/promise");

async function openMysqlConnection(config) {
  return mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: config.charset,
    connectTimeout: 5000,
    dateStrings: true
  });
}

module.exports = {
  openMysqlConnection
};
