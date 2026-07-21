import { createHash, timingSafeEqual } from "node:crypto";

export const DEFAULT_MAX_JSON_BODY_BYTES = 10 * 1024 * 1024;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self' https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
].join("; ");

export function isLoopbackHost(host) {
  const normalized = String(host ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost"
    || normalized === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export function assertSecureAdminConfiguration({ host, adminToken }) {
  if (isLoopbackHost(host)) return;
  if (!adminToken || adminToken.length < 24) {
    throw new Error("ADMIN_TOKEN must contain at least 24 characters when HOST is not loopback.");
  }
}

export function normalizeCorsOrigin(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw === "*") throw new Error("CORS_ORIGIN must be an exact http(s) origin, not '*'.");

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("CORS_ORIGIN must be a valid http(s) origin.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash) {
    throw new Error("CORS_ORIGIN must be an exact http(s) origin without credentials, a path, query, or fragment.");
  }
  return parsed.origin;
}

export function parseMaxJsonBodyBytes(value) {
  if (value == null || value === "") return DEFAULT_MAX_JSON_BODY_BYTES;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1024) {
    throw new Error("MAX_JSON_BODY_BYTES must be an integer of at least 1024.");
  }
  return parsed;
}

export function buildSecurityHeaders({ corsOrigin } = {}) {
  return {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": corsOrigin ? "cross-origin" : "same-origin",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...(corsOrigin ? {
      "Access-Control-Allow-Origin": corsOrigin,
      "Vary": "Origin",
    } : {}),
  };
}

export function isAuthorizedAdminRequest(request, { adminToken, allowWithoutToken = false } = {}) {
  if (!adminToken) return allowWithoutToken;

  const authorization = String(request.headers.authorization ?? "");
  const bearerToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const rawHeaderToken = request.headers["x-admin-token"];
  const headerToken = Array.isArray(rawHeaderToken) ? rawHeaderToken[0] : String(rawHeaderToken ?? "");
  return secureTokenEqual(bearerToken, adminToken) || secureTokenEqual(headerToken, adminToken);
}

export async function readJsonBody(request, { maxBytes = DEFAULT_MAX_JSON_BODY_BYTES } = {}) {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw payloadTooLarge(maxBytes);

  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    byteLength += chunk.length;
    if (byteLength > maxBytes) throw payloadTooLarge(maxBytes);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Invalid JSON body."), {
      status: 400,
      code: "bad_request",
    });
  }
}

function secureTokenEqual(candidate, expected) {
  if (!candidate || !expected) return false;
  const candidateHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

function payloadTooLarge(maxBytes) {
  return Object.assign(new Error(`JSON body exceeds the ${maxBytes}-byte limit.`), {
    status: 413,
    code: "payload_too_large",
  });
}
