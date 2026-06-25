function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMITS = {
  login: 8,
  reset: 4,
  otp: 5
};
const rateLimitBuckets = new Map();

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function rateLimitKey(req, scope, payload = {}) {
  const identity = String(payload.dni || payload.telefono || payload.email || "").trim().toLowerCase() || "anon";
  return `${scope}:${getClientIp(req)}:${identity}`;
}

function checkRateLimit(req, scope, payload) {
  const max = RATE_LIMITS[scope] || 6;
  const now = Date.now();
  const key = rateLimitKey(req, scope, payload);
  const current = rateLimitBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }
  current.count += 1;
  if (current.count > max) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return { retryAfter };
  }
  return null;
}

function createAuthObjectServer(deps) {
  const {
    sendText,
    sendJson,
    parseJsonBody,
    requestCustomerOtp,
    verifyCustomerOtp,
    registerCustomer,
    loginCustomer,
    resetCustomerPassword,
    logoutCustomer,
    findCustomerByToken,
    verifyCustomerAdultStatus,
    extractBearerToken
  } = deps;

  return async function handleAuthObjectRoute(req, res, pathname) {
    if (matchesPath(pathname, "/api/auth/adult-verification")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const token = extractBearerToken(req);
      const payload = await parseJsonBody(req);
      try {
        const result = await verifyCustomerAdultStatus(token, payload);
        sendJson(res, 200, result);
      } catch (error) {
        sendText(res, error?.status || 500, error?.message || "No se pudo confirmar la mayoría de edad.");
      }
      return true;
    }

    if (matchesPath(pathname, "/api/auth/otp/request")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const payload = await parseJsonBody(req);
      const limited = checkRateLimit(req, "otp", payload);
      if (limited) {
        sendText(res, 429, `Demasiados intentos. Intenta nuevamente en ${limited.retryAfter} segundos.`);
        return true;
      }
      try {
        const result = await requestCustomerOtp(payload);
        sendJson(res, 200, result);
      } catch (error) {
        sendText(res, error?.status || 500, error?.message || "Error al enviar código.");
      }
      return true;
    }

    if (matchesPath(pathname, "/api/auth/otp/verify")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const payload = await parseJsonBody(req);
      const limited = checkRateLimit(req, "otp", payload);
      if (limited) {
        sendText(res, 429, `Demasiados intentos. Intenta nuevamente en ${limited.retryAfter} segundos.`);
        return true;
      }
      try {
        const result = await verifyCustomerOtp(payload);
        sendJson(res, 200, result);
      } catch (error) {
        sendText(res, error?.status || 500, error?.message || "Código inválido.");
      }
      return true;
    }

    if (matchesPath(pathname, "/api/auth/register")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const payload = await parseJsonBody(req);
      const limited = checkRateLimit(req, "login", payload);
      if (limited) {
        sendText(res, 429, `Demasiados intentos. Intenta nuevamente en ${limited.retryAfter} segundos.`);
        return true;
      }
      try {
        const result = await registerCustomer(payload);
        sendJson(res, 201, result);
      } catch (error) {
        sendText(res, error?.status || 500, error?.message || "Error al registrar.");
      }
      return true;
    }

    if (matchesPath(pathname, "/api/auth/login")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const payload = await parseJsonBody(req);
      const limited = checkRateLimit(req, "login", payload);
      if (limited) {
        sendText(res, 429, `Demasiados intentos. Intenta nuevamente en ${limited.retryAfter} segundos.`);
        return true;
      }
      try {
        const result = await loginCustomer(payload);
        sendJson(res, 200, result);
      } catch (error) {
        sendText(res, error?.status || 500, error?.message || "Error de login.");
      }
      return true;
    }

    if (matchesPath(pathname, "/api/auth/password/reset")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const payload = await parseJsonBody(req);
      const limited = checkRateLimit(req, "reset", payload);
      if (limited) {
        sendText(res, 429, `Demasiados intentos. Intenta nuevamente en ${limited.retryAfter} segundos.`);
        return true;
      }
      try {
        const result = await resetCustomerPassword(payload);
        sendJson(res, 200, result);
      } catch (error) {
        sendText(res, error?.status || 500, error?.message || "Error al recuperar contraseña.");
      }
      return true;
    }

    if (matchesPath(pathname, "/api/auth/logout")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const token = extractBearerToken(req);
      try {
        await logoutCustomer(token);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendText(res, error?.status || 500, error?.message || "Error de logout.");
      }
      return true;
    }

    if (matchesPath(pathname, "/api/auth/me")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const token = extractBearerToken(req);
      const user = token ? await findCustomerByToken(token) : null;
      if (!user) {
        sendText(res, 401, "No autenticado.");
        return true;
      }
      sendJson(res, 200, { user });
      return true;
    }

    return false;
  };
}

module.exports = {
  createAuthObjectServer
};
