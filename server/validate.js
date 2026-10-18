// Small input validator. Collects all field errors and throws one 400 with details.
import { badRequest } from './http.js';

export function validator(body = {}) {
  const errors = {};
  const out = {};
  const fail = (k, m) => { errors[k] = m; };
  const has = (k) => body[k] !== undefined && body[k] !== null && body[k] !== '';
  const api = {
    str(k, { required = false, max = 500, min = 0 } = {}) {
      if (!has(k)) { if (required) fail(k, 'is required'); return api; }
      if (typeof body[k] !== 'string') { fail(k, 'must be text'); return api; }
      const v = body[k].trim();
      if (required && !v) fail(k, 'is required');
      else if (v.length > max) fail(k, `must be at most ${max} characters`);
      else if (v.length < min) fail(k, `must be at least ${min} characters`);
      else out[k] = v;
      return api;
    },
    int(k, { required = false, min = -Infinity, max = Infinity } = {}) {
      if (!has(k)) { if (required) fail(k, 'is required'); return api; }
      const n = Number(body[k]);
      if (!Number.isInteger(n)) fail(k, 'must be a whole number');
      else if (n < min || n > max) fail(k, `must be between ${min} and ${max}`);
      else out[k] = n;
      return api;
    },
    oneOf(k, values, { required = false } = {}) {
      if (!has(k)) { if (required) fail(k, 'is required'); return api; }
      if (!values.includes(body[k])) fail(k, `must be one of: ${values.join(', ')}`);
      else out[k] = body[k];
      return api;
    },
    date(k, { required = false } = {}) {
      if (!has(k)) { if (required) fail(k, 'is required'); return api; }
      const d = new Date(body[k]);
      if (Number.isNaN(d.getTime())) fail(k, 'must be a valid date/time');
      else out[k] = d.toISOString();
      return api;
    },
    list(k, { values = null, max = 20 } = {}) {
      if (!has(k)) return api;
      if (!Array.isArray(body[k])) { fail(k, 'must be a list'); return api; }
      const arr = body[k].filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
      if (arr.length > max) fail(k, `must have at most ${max} items`);
      else if (values && arr.some((x) => !values.includes(x))) fail(k, `items must be one of: ${values.join(', ')}`);
      else out[k] = arr;
      return api;
    },
    bool(k) { if (has(k)) out[k] = Boolean(body[k]); return api; },
    check(cond, k, msg) { if (!cond) fail(k, msg); return api; },
    done() {
      if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
      return out;
    },
  };
  return api;
}
