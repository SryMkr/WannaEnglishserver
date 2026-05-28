const mysql = require("mysql2");
const { CHINA_TIME_ZONE_OFFSET } = require("../services/timeService");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  timezone: CHINA_TIME_ZONE_OFFSET,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10000,
  maxIdle: Number(process.env.DB_MAX_IDLE) || 10,
  idleTimeout: Number(process.env.DB_IDLE_TIMEOUT_MS) || 60000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

pool.on("connection", (connection) => {
  connection.query(`SET time_zone = '${CHINA_TIME_ZONE_OFFSET}'`, (error) => {
    if (error) {
      console.error("Failed to set MySQL session time_zone:", error);
    }
  });
});

module.exports = pool.promise();
