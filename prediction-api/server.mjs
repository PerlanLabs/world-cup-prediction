import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  backfillUpstreamTrackRecord,
  ensureInitialPredictions,
  freezePreMatchPredictions,
  getBackendDataQuality,
  getBackendMatch,
  getModelTrackRecord,
  getPolymarketAccountSnapshot,
  getLatestPrediction,
  listBackendMatches,
  listBackendSources,
  listBackendTeams,
  listModelRuns,
  listOfficialLineupSyncCandidates,
  listPredictionHistory,
  refreshModelRatings,
  runPredictions,
  syncApiFootballFixtureIds,
  syncApiFootballMatchStats,
  syncApiFootballSupplementalData,
  syncDeepSeekAnalyses,
  syncExpectedLineups,
  syncFifaTeamRankings,
  syncOfficialFixtures,
  syncOfficialLineups,
  syncOfficialMatchFacts,
  importPolymarketMatchMarkets,
  syncPolymarketMatchMarkets,
  syncPolymarketWorldCupMarkets,
  syncModelOnlyDeepSeekAnalyses,
  syncLineups,
} from "./backend-service.mjs";
import { getModelMetadata, listTeams, predictMatch } from "./model-adapter.mjs";
import {
  getPolymarketMovementAssistantView,
  getPolymarketMarketStructure,
  getPolymarketMovementSnapshot,
  listPolymarketMovementSnapshots,
  refreshPolymarketMovementSnapshot,
} from "./polymarket-movement-service.mjs";
import { getPolymarketBacktestSummary } from "./polymarket-backtest-service.mjs";
import {
  assertSecureAdminConfiguration,
  buildSecurityHeaders,
  isAuthorizedAdminRequest,
  isLoopbackHost,
  normalizeCorsOrigin,
  parseMaxJsonBodyBytes,
  readJsonBody as parseJsonBody,
} from "./http-security.mjs";

const DEFAULT_PORT = 8787;
const port = Number(process.env.PORT ?? DEFAULT_PORT);
const host = process.env.HOST ?? "127.0.0.1";
const adminToken = process.env.ADMIN_TOKEN?.trim() ?? "";
const corsOrigin = normalizeCorsOrigin(process.env.CORS_ORIGIN);
const maxJsonBodyBytes = parseMaxJsonBodyBytes(process.env.MAX_JSON_BODY_BYTES);
const securityHeaders = buildSecurityHeaders({ corsOrigin });
const DEFAULT_STATIC_DIR = fileURLToPath(new URL("../world-cup-command-center/dist", import.meta.url));
const staticDir = resolve(process.env.STATIC_DIR ?? DEFAULT_STATIC_DIR);
const serveStatic = process.env.SERVE_STATIC !== "false" && existsSync(staticDir);

assertSecureAdminConfiguration({ host, adminToken });
ensureInitialPredictions();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (request.method === "OPTIONS") {
    sendJson(response, 204, null);
    return;
  }

  try {
    if (url.pathname.startsWith("/api/admin") && !isAuthorizedAdminRequest(request, {
      adminToken,
      allowWithoutToken: isLoopbackHost(host),
    })) {
      sendJson(response, 401, {
        error: {
          code: "unauthorized",
          message: "Admin token required.",
        },
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "world-cup-backend",
        model: getModelMetadata(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/teams") {
      sendJson(response, 200, {
        teams: listBackendTeams(),
        modelTeams: listTeams(),
        model: getModelMetadata(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sources") {
      sendJson(response, 200, {
        sources: listBackendSources(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/model-track-record") {
      sendJson(response, 200, {
        trackRecord: getModelTrackRecord({
          limit: url.searchParams.get("limit"),
        }),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/polymarket/account") {
      const account = await getPolymarketAccountSnapshot({
        address: url.searchParams.get("address"),
        limit: url.searchParams.get("limit"),
        scenarioMaxGoals: url.searchParams.get("scenarioMaxGoals"),
      });
      sendJson(response, 200, { account });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/polymarket/movement/events") {
      sendJson(response, 200, {
        events: listPolymarketMovementSnapshots(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/polymarket/backtest") {
      const backtest = getPolymarketBacktestSummary();
      if (!backtest) {
        sendJson(response, 404, {
          error: { code: "not_found", message: "Polymarket signal backtest report not found." },
        });
        return;
      }
      sendJson(response, 200, { backtest });
      return;
    }

    const movementStructureRoute = url.pathname.match(/^\/api\/polymarket\/movement\/events\/([^/]+)\/structure$/);
    if (request.method === "GET" && movementStructureRoute) {
      const structure = getPolymarketMarketStructure(decodeURIComponent(movementStructureRoute[1]));
      if (!structure) {
        sendJson(response, 404, {
          error: { code: "not_found", message: "Polymarket market-structure snapshot not found." },
        });
        return;
      }
      sendJson(response, 200, structure);
      return;
    }

    const movementRoute = url.pathname.match(/^\/api\/polymarket\/movement\/events\/([^/]+)$/);
    if (request.method === "GET" && movementRoute) {
      const eventSlug = decodeURIComponent(movementRoute[1]);
      const movement = url.searchParams.get("view") === "assistant"
        ? getPolymarketMovementAssistantView(eventSlug)
        : getPolymarketMovementSnapshot(eventSlug);
      if (!movement) {
        sendJson(response, 404, {
          error: { code: "not_found", message: "Polymarket movement snapshot not found." },
        });
        return;
      }
      sendJson(response, 200, { movement });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/matches") {
      sendJson(response, 200, {
        matches: listBackendMatches({
          date: url.searchParams.get("date"),
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          status: url.searchParams.get("status"),
          include: url.searchParams.get("include") ?? "prediction",
        }),
      });
      return;
    }

    const matchRoute = url.pathname.match(/^\/api\/matches\/([^/]+)$/);
    if (request.method === "GET" && matchRoute) {
      const match = getBackendMatch(decodeURIComponent(matchRoute[1]), { includePrediction: true });
      if (!match) {
        sendJson(response, 404, {
          error: { code: "not_found", message: "Match not found." },
        });
        return;
      }
      sendJson(response, 200, { match });
      return;
    }

    const latestPredictionRoute = url.pathname.match(/^\/api\/matches\/([^/]+)\/prediction\/latest$/);
    if (request.method === "GET" && latestPredictionRoute) {
      const prediction = getLatestPrediction(decodeURIComponent(latestPredictionRoute[1]));
      if (!prediction) {
        sendJson(response, 404, {
          error: { code: "not_found", message: "Prediction not found." },
        });
        return;
      }
      sendJson(response, 200, { prediction });
      return;
    }

    const predictionHistoryRoute = url.pathname.match(/^\/api\/matches\/([^/]+)\/predictions\/history$/);
    if (request.method === "GET" && predictionHistoryRoute) {
      sendJson(response, 200, {
        predictions: listPredictionHistory(decodeURIComponent(predictionHistoryRoute[1])),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/model-runs") {
      sendJson(response, 200, {
        runs: listModelRuns(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/data-quality") {
      sendJson(response, 200, {
        report: getBackendDataQuality(),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/freeze-predictions") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        freeze: freezePreMatchPredictions({
          matchIds: Array.isArray(body?.matchIds) ? body.matchIds : undefined,
          lockBeforeMinutes: body?.lockBeforeMinutes,
          force: body?.force,
          now: body?.now,
          generatedAt: body?.generatedAt,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/backfill-upstream-track-record") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        backfill: await backfillUpstreamTrackRecord({
          resultsUrl: body?.resultsUrl,
          ratingsUrl: body?.ratingsUrl,
          localRepoPath: body?.localRepoPath,
          disableLocalFallback: body?.disableLocalFallback,
          fetchedAt: body?.fetchedAt,
          generatedAt: body?.generatedAt,
          force: body?.force,
        }),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/official-lineup-candidates") {
      sendJson(response, 200, {
        candidates: listOfficialLineupSyncCandidates({
          matchIds: readRepeatedQuery(url, "matchId"),
          mode: url.searchParams.get("mode") ?? undefined,
          lookaheadHours: url.searchParams.get("lookaheadHours") ?? undefined,
          lookbackHours: url.searchParams.get("lookbackHours") ?? undefined,
          onlyPending: parseOptionalBoolean(url.searchParams.get("onlyPending")),
          now: url.searchParams.get("now") ?? undefined,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/run-predictions") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        run: runPredictions({
          matchIds: Array.isArray(body?.matchIds) ? body.matchIds : undefined,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/refresh-model-ratings") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        refresh: refreshModelRatings({
          matchIds: Array.isArray(body?.matchIds) ? body.matchIds : undefined,
          officialResultsPath: body?.officialResultsPath,
          currentRatingsPath: body?.currentRatingsPath,
          predictionMode: body?.predictionMode,
          refresh: body?.refresh,
          refreshPredictions: body?.refreshPredictions,
          all: body?.all,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/sync-fixtures") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        sync: await syncOfficialFixtures({
          mode: body?.mode ?? "supported",
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/sync-lineups") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        sync: syncLineups({
          payload: body?.lineups || body?.matches || body?.source ? body : undefined,
          path: body?.path,
          retrievedAt: body?.retrievedAt,
          reviewedAt: body?.reviewedAt,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/sync-expected-lineups") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        sync: await syncExpectedLineups({
          url: body?.url,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/sync-official-lineups") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        sync: await syncOfficialLineups({
          matchIds: Array.isArray(body?.matchIds) ? body.matchIds : undefined,
          language: body?.language,
          mode: body?.mode,
          lookaheadHours: body?.lookaheadHours,
          lookbackHours: body?.lookbackHours,
          onlyPending: body?.onlyPending,
          now: body?.now,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/sync-match-facts") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        sync: await syncOfficialMatchFacts({
          matchIds: Array.isArray(body?.matchIds) ? body.matchIds : undefined,
          language: body?.language,
          mode: body?.mode,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/sync-team-rankings") {
      sendJson(response, 200, {
        sync: await syncFifaTeamRankings(),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/sync-api-football-fixtures") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        sync: await syncApiFootballFixtureIds({
          key: body?.key,
          league: body?.league,
          season: body?.season,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/sync-api-football-match-stats") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        sync: await syncApiFootballMatchStats({
          key: body?.key,
          matchIds: Array.isArray(body?.matchIds) ? body.matchIds : undefined,
          mode: body?.mode,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/sync-api-football") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        sync: await syncApiFootballSupplementalData({
          key: body?.key,
          league: body?.league,
          season: body?.season,
          matchIds: Array.isArray(body?.matchIds) ? body.matchIds : undefined,
          mode: body?.mode,
          skipFixtureSync: body?.skipFixtureSync,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/sync-polymarket-markets") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        sync: await syncPolymarketWorldCupMarkets({
          eventSlugs: Array.isArray(body?.eventSlugs) ? body.eventSlugs : undefined,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/sync-polymarket-match-markets") {
      const body = await readJsonBody(request);
      const payload = body?.payload && typeof body.payload === "object" ? body.payload : null;
      sendJson(response, 200, {
        sync: payload
          ? await importPolymarketMatchMarkets({ payload })
          : await syncPolymarketMatchMarkets({
            matchIds: Array.isArray(body?.matchIds) ? body.matchIds : undefined,
            mode: body?.mode,
            limit: body?.limit,
            eventSlugByMatchId: body?.eventSlugByMatchId,
            withAi: body?.withAi,
            aiLimit: body?.aiLimit,
          }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/polymarket/movement/refresh") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        movement: await refreshPolymarketMovementSnapshot({
          eventSlug: body?.eventSlug,
          home: body?.home,
          away: body?.away,
          date: body?.date,
          historyMode: body?.historyMode,
          lookbackDays: body?.lookbackDays,
          fidelity: body?.fidelity,
          categories: body?.categories,
          allCategories: body?.allCategories,
          limit: body?.limit,
          concurrency: body?.concurrency,
          timeoutMs: body?.timeoutMs,
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/sync-ai-analyses") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        sync: body?.modelOnly
          ? await syncModelOnlyDeepSeekAnalyses({
            matchIds: Array.isArray(body?.matchIds) ? body.matchIds : undefined,
            limit: body?.limit,
            refresh: body?.refresh,
            missingMarketOnly: body?.missingMarketOnly,
          })
          : await syncDeepSeekAnalyses({
            matchIds: Array.isArray(body?.matchIds) ? body.matchIds : undefined,
            limit: body?.limit,
            refresh: body?.refresh,
          }),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/predict") {
      const prediction = predictMatch({
        home: url.searchParams.get("home"),
        away: url.searchParams.get("away"),
        venue: url.searchParams.get("venue") ?? "neutral",
      });
      sendJson(response, 200, prediction);
      return;
    }

    if ((request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/")) {
      const served = serveStaticAsset(request, response, url);
      if (served) return;
    }

    sendJson(response, 404, {
      error: {
        code: "not_found",
        message: "Use GET /api/matches?include=prediction or GET /api/predict?home=usa&away=paraguay&venue=home.",
      },
    });
  } catch (error) {
    const statusCode = Number.isInteger(error.status) ? error.status : 500;
    if (statusCode >= 500) console.error(error);
    sendJson(response, statusCode, {
      error: {
        code: statusCode >= 500 ? "internal_error" : (error.code ?? "bad_request"),
        message: statusCode >= 500 ? "Internal server error." : error.message,
      },
    });
  }
});

server.listen(port, host, () => {
  console.log(`Prediction API listening on http://${host}:${port}`);
  if (serveStatic) {
    console.log(`Serving static app from ${staticDir}`);
  }
});

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...securityHeaders,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });

  if (statusCode === 204) {
    response.end();
    return;
  }

  response.end(JSON.stringify(payload, null, 2));
}

function serveStaticAsset(request, response, url) {
  if (!serveStatic) return false;

  const decodedPathname = safeDecodePathname(url.pathname);
  if (!decodedPathname) {
    sendText(response, 400, "Bad request.");
    return true;
  }

  const normalizedPath = normalize(decodedPathname === "/" ? "/index.html" : decodedPathname);
  const relativePath = normalizedPath.replace(/^[/\\]+/, "");
  let assetPath = resolve(staticDir, relativePath);

  if (!isInsideDirectory(assetPath, staticDir)) {
    sendText(response, 403, "Forbidden.");
    return true;
  }

  let stat = statFile(assetPath);
  if (stat?.isDirectory()) {
    assetPath = join(assetPath, "index.html");
    stat = statFile(assetPath);
  }

  if (!stat?.isFile()) {
    if (!acceptsHtml(request)) return false;
    assetPath = join(staticDir, "index.html");
    stat = statFile(assetPath);
    if (!stat?.isFile()) return false;
  }

  response.writeHead(200, {
    ...securityHeaders,
    "Content-Length": stat.size,
    "Content-Type": contentTypeFor(assetPath),
    "Cache-Control": assetPath.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  });

  if (request.method === "HEAD") {
    response.end();
    return true;
  }

  createReadStream(assetPath).pipe(response);
  return true;
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    ...securityHeaders,
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function safeDecodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function statFile(path) {
  try {
    return statSync(path);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

function isInsideDirectory(childPath, parentPath) {
  const child = resolve(childPath);
  const parent = resolve(parentPath);
  return child === parent || child.startsWith(`${parent}${sep}`);
}

function acceptsHtml(request) {
  const accept = request.headers.accept ?? "";
  return accept.includes("text/html") || accept.includes("*/*") || accept === "";
}

function contentTypeFor(path) {
  const extension = extname(path).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  }[extension] ?? "application/octet-stream";
}

async function readJsonBody(request) {
  return parseJsonBody(request, { maxBytes: maxJsonBodyBytes });
}

function readRepeatedQuery(url, key) {
  const values = url.searchParams.getAll(key).flatMap((value) => value.split(","));
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

function parseOptionalBoolean(value) {
  if (value == null || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  const error = new Error(`Invalid boolean query value: ${value}.`);
  error.status = 400;
  error.code = "bad_request";
  throw error;
}
