function createLogger(appendLog) {
  return {
    info(message, meta = null) {
      return appendLog("INFO", message, meta);
    },
    warn(message, meta = null) {
      return appendLog("WARN", message, meta);
    },
    error(message, meta = null) {
      return appendLog("ERROR", message, meta);
    }
  };
}

module.exports = {
  createLogger
};
