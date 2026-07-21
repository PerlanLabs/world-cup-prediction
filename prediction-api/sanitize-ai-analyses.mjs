import { sanitizeDeepSeekAnalysisText } from "./deepseek-analysis.mjs";
import { mutateStore } from "./store.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const summary = sanitizeStoredAnalyses();
  const payload = { ok: true, sync: summary };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("Stored AI analysis text sanitization completed.");
    console.log(`Updated analyses: ${summary.updatedCount}`);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "ai_analysis_sanitize_failed",
      message: error.message,
    },
  }, null, 2));
  process.exitCode = 1;
}

function sanitizeStoredAnalyses() {
  const now = new Date().toISOString();
  let summary = {
    sourceId: "deepseek-ai-analysis",
    sanitizedAt: now,
    checkedCount: 0,
    updatedCount: 0,
    updatedMatchIds: [],
  };

  mutateStore((store) => {
    for (const match of store.matches) {
      const analyses = [
        match.marketOdds?.polymarket?.aiAnalysis,
        match.aiAnalysis?.modelOnly,
      ].filter((analysis) => analysis?.text);

      for (const analysis of analyses) {
        summary.checkedCount += 1;
        const sanitized = sanitizeDeepSeekAnalysisText(analysis.text);
        if (sanitized === analysis.text) continue;
        analysis.text = sanitized;
        analysis.sanitizedAt = now;
        summary.updatedCount += 1;
        summary.updatedMatchIds.push(match.id);
      }
    }
    return store;
  });

  return summary;
}

function parseArgs(args) {
  const options = {};
  for (const arg of args) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node prediction-api/sanitize-ai-analyses.mjs [--json]

Normalizes stored DeepSeek AI analysis copy to avoid trading-like wording.
This command does not call an LLM and does not fetch external data.
`);
}
