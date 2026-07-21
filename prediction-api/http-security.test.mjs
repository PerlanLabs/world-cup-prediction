import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  assertSecureAdminConfiguration,
  buildSecurityHeaders,
  isAuthorizedAdminRequest,
  isLoopbackHost,
  normalizeCorsOrigin,
  parseMaxJsonBodyBytes,
  readJsonBody,
} from "./http-security.mjs";

test("loopback hosts can run locally without an admin token", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.doesNotThrow(() => assertSecureAdminConfiguration({ host: "127.0.0.1", adminToken: "" }));
});

test("non-loopback hosts require a strong admin token", () => {
  assert.throws(
    () => assertSecureAdminConfiguration({ host: "0.0.0.0", adminToken: "short" }),
    /at least 24 characters/,
  );
  assert.doesNotThrow(() => assertSecureAdminConfiguration({
    host: "0.0.0.0",
    adminToken: "a-long-random-admin-token-value",
  }));
});

test("admin authorization is explicit and accepts either supported header", () => {
  const adminToken = "a-long-random-admin-token-value";
  assert.equal(isAuthorizedAdminRequest({ headers: {} }, { adminToken: "", allowWithoutToken: false }), false);
  assert.equal(isAuthorizedAdminRequest({ headers: {} }, { adminToken: "", allowWithoutToken: true }), true);
  assert.equal(isAuthorizedAdminRequest({
    headers: { authorization: `Bearer ${adminToken}` },
  }, { adminToken }), true);
  assert.equal(isAuthorizedAdminRequest({
    headers: { "x-admin-token": adminToken },
  }, { adminToken }), true);
  assert.equal(isAuthorizedAdminRequest({
    headers: { authorization: "Bearer wrong" },
  }, { adminToken }), false);
});

test("CORS accepts one exact origin and rejects wildcard or path input", () => {
  assert.equal(normalizeCorsOrigin(""), null);
  assert.equal(normalizeCorsOrigin("https://example.com/"), "https://example.com");
  assert.throws(() => normalizeCorsOrigin("*"), /not '\*'/);
  assert.throws(() => normalizeCorsOrigin("https://example.com/app"), /exact http\(s\) origin/);
  const headers = buildSecurityHeaders({ corsOrigin: "https://example.com" });
  assert.equal(headers["Access-Control-Allow-Origin"], "https://example.com");
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
});

test("JSON body parsing enforces the configured byte limit", async () => {
  const request = Readable.from([Buffer.from('{"ok":true}')]);
  request.headers = {};
  assert.deepEqual(await readJsonBody(request, { maxBytes: 1024 }), { ok: true });

  const oversized = Readable.from([Buffer.alloc(1025, "a")]);
  oversized.headers = {};
  await assert.rejects(() => readJsonBody(oversized, { maxBytes: 1024 }), (error) => {
    assert.equal(error.status, 413);
    assert.equal(error.code, "payload_too_large");
    return true;
  });
  assert.equal(parseMaxJsonBodyBytes("2048"), 2048);
  assert.throws(() => parseMaxJsonBodyBytes("10"), /at least 1024/);
});
