// api/lib/response.js - 统一响应格式

const CODE = {
  OK: 0,
  BAD_REQUEST: 4000,
  VALIDATION: 4001,
  TURNSTILE_FAIL: 4003,
  ALREADY_EXISTS: 4009,
  UNAUTHORIZED: 4011,
  SESSION_EXPIRED: 4012,
  FORBIDDEN: 4031,
  NOT_FOUND: 4040,
  RATE_LIMIT: 4290,
  SERVER_ERROR: 5000,
};

function ok(c, data, status) {
  return c.json({ code: CODE.OK, data, msg: 'ok' }, status || 200);
}

function err(c, code, msg, status) {
  return c.json({ code, data: null, msg }, status || 400);
}

export { CODE, ok, err };
