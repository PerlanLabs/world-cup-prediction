import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { importInbox } from "./pnl-inbox.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("imports an HTML advice card from the P&L inbox and skips duplicate content", () => {
  const root = mkdtempSync(join(tmpdir(), "pnl-inbox-"));
  try {
    const inboxHtml = join(root, "_inbox", "html");
    const source = join(repoRoot, "2026-06-14_05-52-11_brazil-vs-morocco_betting-advice-card.html");
    const firstDrop = join(inboxHtml, "2026-06-14_05-52-11_brazil-vs-morocco_betting-advice-card.html");
    mkdirSync(inboxHtml, { recursive: true });
    copyFileSync(source, firstDrop);

    const firstRun = importInbox({ root, strategyPolicy: "hedged" });
    assert.equal(firstRun.importedCount, 1);
    assert.equal(firstRun.skippedDuplicateCount, 0);
    assert.equal(firstRun.failedCount, 0);
    assert.equal(existsSync(firstDrop), false);

    const acceptedPath = join(firstRun.results[0].matchDir, "accepted-bets.json");
    const accepted = JSON.parse(readFileSync(acceptedPath, "utf8"));
    assert.equal(accepted.match.id, "brazil-morocco");
    assert.equal(accepted.totalStake, 100);

    const secondDrop = join(inboxHtml, "brazil-vs-morocco-again.html");
    copyFileSync(source, secondDrop);
    const secondRun = importInbox({ root, strategyPolicy: "hedged" });
    assert.equal(secondRun.importedCount, 0);
    assert.equal(secondRun.skippedDuplicateCount, 1);
    assert.equal(existsSync(secondDrop), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("imports manual JSON advice with screenshot evidence from the P&L inbox", () => {
    const root = mkdtempSync(join(tmpdir(), "pnl-manual-inbox-"));
  try {
    const screenshotPath = join(root, "_inbox", "screenshots", "qatar.png");
    const manualPath = join(root, "_inbox", "manual", "qatar.json");
    mkdirSync(dirname(screenshotPath), { recursive: true });
    mkdirSync(dirname(manualPath), { recursive: true });
    writeFileSync(screenshotPath, "placeholder image bytes");
    writeFileSync(manualPath, JSON.stringify({
      adviceId: "manual-qatar-test",
      selectedStrategy: "main",
      match: {
        matchupSlug: "qatar-vs-switzerland",
        matchDate: "2026-06-14",
        homeName: "Qatar",
        awayName: "Switzerland",
      },
      evidenceFiles: ["qatar.png"],
      bets: [
        { market: "Qatar +2.5", price: "64.5c", stake: 35 },
        { market: "Draw", price: "12.5c", stake: 5 },
      ],
      scorePnlRows: [
        { score: "0-1", netPnl: 69.97 },
      ],
    }), "utf8");

    const result = importInbox({ root, strategyPolicy: "hedged" });
    assert.equal(result.importedCount, 1);
    assert.equal(result.failedCount, 0);

    const acceptedPath = join(result.results[0].matchDir, "accepted-bets.json");
    const accepted = JSON.parse(readFileSync(acceptedPath, "utf8"));
    assert.equal(accepted.match.id, "qatar-switzerland");
    assert.equal(accepted.selectedStrategy, "main");
    assert.equal(accepted.totalStake, 40);
    assert.equal(accepted.bets[0].price, 0.645);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
