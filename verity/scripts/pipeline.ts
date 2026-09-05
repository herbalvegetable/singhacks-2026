import { createAdminDb } from "../lib/db/client";
import { loadEnvConfig } from "@next/env";
import { Repository } from "../lib/db/repository";
import { SnapshotDiffer } from "../lib/compute/snapshotDiff";
import { LookThroughAnalyzer } from "../lib/compute/lookThrough";
import type { Signal } from "../lib/contracts/signal";
import {
  buildNoMatchGrounding,
  filterEventCandidates,
  GroundingAgent,
  hashGroundingInput,
} from "../lib/agents/groundingAgent";

loadEnvConfig(process.cwd());

async function main() {
  console.log("=== Verity Pipeline ===\n");

  const db = createAdminDb();
  const repo = new Repository(db);

  try {
    console.log("Stage 2: Computing signals...");

    const snapshots = await repo.getSnapshotDates();
    const fromDate = snapshots[0];
    const toDate = snapshots[snapshots.length - 1];
    if (!fromDate || !toDate) {
      throw new Error("No holding snapshots found; run npm run ingest first");
    }

    console.log(`Using window: ${fromDate} → ${toDate}`);

    const clients = await repo.getAllClients();
    const generatedSignals: Signal[] = [];

    for (const client of clients) {
      console.log(`\nProcessing ${client.client_id} (${client.client_name})...`);

      const portfolios = await repo.getPortfoliosForClient(client.client_id);
      
      // Snapshot diff signals
      const differ = new SnapshotDiffer(repo);
      for (const portfolio of portfolios) {
        const changes = await differ.computePositionChanges(
          portfolio.portfolio_id,
          fromDate,
          toDate
        );

        if (changes.length > 0) {
          const durationSignal = differ.generateDurationSignal(
            client.client_id,
            portfolio.portfolio_id,
            changes
          );

          if (durationSignal) {
            generatedSignals.push(durationSignal);
            console.log(`  ✓ Duration signal: ${durationSignal.headline}`);
          }
        }
      }

      // Look-through analysis
      const analyzer = new LookThroughAnalyzer(repo);
      const exposures = await analyzer.computeHouseholdExposures(
        client.client_id,
        toDate
      );

      const concSignal = analyzer.generateConcentrationSignal(
        client.client_id,
        exposures,
        15.0
      );

      if (concSignal) {
        generatedSignals.push(concSignal);
        console.log(`  ✓ Concentration signal: ${concSignal.headline}`);
      }

      // Show top exposures
      const top3 = exposures.slice(0, 3);
      if (top3.length > 0) {
        console.log(`  Top exposures:`);
        for (const exp of top3) {
          console.log(
            `    ${exp.resolved_instrument_name}: ${exp.total_weight_pct.toFixed(1)}%`
          );
        }
      }
    }

    await repo.replaceSignals(generatedSignals);

    console.log("\nStage 3: Grounding signals in the event log...");
    const groundingAgent =
      process.env.OPENAI_API_KEY &&
      process.env.VERITY_AGENTS_ENABLED === "true"
      ? new GroundingAgent()
      : null;
    const events = await repo.getEvents();
    let cached = 0;
    let generated = 0;
    let skipped = 0;

    for (const signal of generatedSignals) {
      const instruments = await repo.getInstruments(
        [...new Set(signal.affected_holdings.map((holding) => holding.instrument_id))],
      );
      const candidates = filterEventCandidates(signal, events, instruments);
      const inputHash = hashGroundingInput(signal, candidates);
      if (await repo.getGrounding(signal.signal_id, inputHash)) {
        cached += 1;
        continue;
      }
      if (!groundingAgent && candidates.length > 0) {
        skipped += 1;
        continue;
      }
      const grounding = groundingAgent
        ? await groundingAgent.ground(signal, candidates)
        : buildNoMatchGrounding(signal, candidates);
      await repo.saveGrounding(grounding, inputHash);
      generated += 1;
    }
    console.log(`  ✓ Grounded ${generated} signals (${cached} cached)`);
    if (skipped > 0) {
      console.warn(
        `  Skipped ${skipped} candidate-bearing signals: OPENAI_API_KEY is not configured`,
      );
    }

    // Count results
    const signalCount = (
      await db.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM signals",
      )
    ).rows[0];

    console.log(`\n✓ Pipeline complete: ${signalCount.count} signals generated`);
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("Pipeline failed:", error);
  process.exitCode = 1;
});
