import { getStore } from "./store.mjs";
import {
  buildPolymarketTeamMarketMappings,
  fetchPolymarketSearchPayload,
  fetchPolymarketWorldCupMarketsPayload,
} from "./polymarket-sync.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const probe = await runProbe(options);
  if (options.json) {
    console.log(JSON.stringify({ ok: true, probe }, null, 2));
  } else {
    console.log("Polymarket read-only probe completed.");
    console.log(`Mode: ${probe.mode}`);
    console.log(`Events: ${probe.eventCount}`);
    console.log(`Markets: ${probe.marketCount}`);
    console.log(`Mapped team signals: ${probe.mapping.mappedCount}`);
    console.log(`Skipped markets: ${probe.mapping.skippedCount}`);
    for (const item of probe.topMarkets.slice(0, 8)) {
      console.log(`- ${item.subject ?? item.question}: ${item.impliedProbabilityPercent ?? "n/a"}% (${item.slug})`);
    }
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "polymarket_probe_failed",
      message: error.message,
    },
  }, null, 2));
  process.exitCode = 1;
}

async function runProbe(options) {
  const store = getStore();
  const payload = options.search
    ? await fetchPolymarketSearchPayload({
      query: options.search,
      fetchedAt: options.fetchedAt,
    })
    : await fetchPolymarketWorldCupMarketsPayload({
      eventSlugs: options.eventSlugs,
      fetchedAt: options.fetchedAt,
    });

  const markets = payload.markets ?? [];
  const mapping = buildPolymarketTeamMarketMappings(store.teams, markets, {
    sourceId: payload.source?.id ?? "polymarket-search-probe",
    fetchedAt: payload.fetchedAt,
  });
  const sortedMarkets = [...markets]
    .filter((market) => market.marketType === "world_cup_winner" && market.yesPrice != null)
    .sort((a, b) => (b.yesPrice ?? 0) - (a.yesPrice ?? 0));

  return {
    mode: options.search ? "search" : "event",
    query: options.search ?? null,
    sourceUrl: payload.source?.url ?? payload.sourceUrl ?? null,
    fetchedAt: payload.fetchedAt,
    eventCount: payload.events?.length ?? payload.eventCount ?? 0,
    marketCount: markets.length,
    mapping: {
      mappedCount: mapping.mapped.length,
      mappedTeamIds: mapping.mapped.map((item) => item.teamId),
      skippedCount: mapping.skipped.length,
      skipped: mapping.skipped,
    },
    topMarkets: sortedMarkets.slice(0, Number(options.limit ?? 20)).map((market) => ({
      marketId: market.id,
      slug: market.slug,
      subject: market.subject,
      question: market.question,
      impliedProbabilityPercent: market.impliedProbabilityPercent,
      price: market.yesPrice,
      decimalOdds: market.decimalOdds,
      volume: market.volume,
      liquidity: market.liquidity,
      active: market.active,
      closed: market.closed,
    })),
  };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--event-slug") {
      options.eventSlugs = [...(options.eventSlugs ?? []), requiredValue(args, ++index, "--event-slug")];
    } else if (arg === "--search") {
      options.search = requiredValue(args, ++index, "--search");
    } else if (arg === "--limit") {
      options.limit = requiredValue(args, ++index, "--limit");
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function requiredValue(args, index, label) {
  const value = args[index];
  if (!value) throw new Error(`${label} requires a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage: node prediction-api/probe-polymarket.mjs [options]

Options:
  --event-slug <slug>      Polymarket event slug. Defaults to world-cup-winner.
  --search <query>         Probe public-search instead of event slug.
  --limit <number>         Number of top markets to include. Defaults to 20.
  --json                   Print machine-readable JSON.

This probe is read-only and does not use wallet, account, order, or trading APIs.
`);
}
