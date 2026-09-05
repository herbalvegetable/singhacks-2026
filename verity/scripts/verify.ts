import { createAdminDb } from "../lib/db/client";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type CountRow = { count: string };

async function verify() {
  console.log("=== Verity Verification ===\n");

  const db = createAdminDb();

  try {
    // Check database exists and has data
    const counts = {
      clients: Number((await db.query<CountRow>("SELECT COUNT(*) AS count FROM clients")).rows[0].count),
      holdings: Number((await db.query<CountRow>("SELECT COUNT(*) AS count FROM holdings")).rows[0].count),
      signals: Number((await db.query<CountRow>("SELECT COUNT(*) AS count FROM signals")).rows[0].count),
      events: Number((await db.query<CountRow>("SELECT COUNT(*) AS count FROM events")).rows[0].count),
      flags: Number((await db.query<CountRow>("SELECT COUNT(*) AS count FROM data_quality_flags")).rows[0].count),
    };

    console.log("📊 Database Check:");
    console.log(`  ✓ Clients: ${counts.clients} ${counts.clients === 20 ? '✓' : '❌ Expected 20'}`);
    console.log(`  ✓ Holdings: ${counts.holdings} ${counts.holdings >= 1000 ? '✓' : '❌ Expected ~1015'}`);
    console.log(`  ✓ Events: ${counts.events} ${counts.events === 16 ? '✓' : '❌ Expected 16'}`);
    console.log(`  ✓ Signals: ${counts.signals} ${counts.signals > 0 ? '✓' : '❌ Run pipeline first!'}`);
    console.log(`  ✓ Flags: ${counts.flags} ${counts.flags > 0 ? '✓' : '❌'}`);

    // Check demo clients exist
    console.log("\n🎯 Demo Clients:");
    const demoClients = ['CL-0001', 'CL-0003', 'CL-0012'];
    for (const clientId of demoClients) {
      const client = (
        await db.query<{ client_name: string }>(
          "SELECT client_name FROM clients WHERE client_id = $1",
          [clientId],
        )
      ).rows[0];
      const signals = Number((
        await db.query<CountRow>(
          "SELECT COUNT(*) AS count FROM signals WHERE client_id = $1",
          [clientId],
        )
      ).rows[0].count);
      
      if (client) {
        console.log(`  ✓ ${clientId} (${client.client_name}): ${signals} signals`);
      } else {
        console.log(`  ❌ ${clientId}: Not found`);
      }
    }

    // Check signals have proper structure
    console.log("\n🔍 Signal Validation:");
    const sampleSignal = (
      await db.query<{ payload: string }>("SELECT payload FROM signals LIMIT 1")
    ).rows[0];
    
    if (sampleSignal) {
      const signal = JSON.parse(sampleSignal.payload);
      console.log(`  ✓ Signal structure: ${signal.signal_id}`);
      console.log(`  ✓ Type: ${signal.type}`);
      console.log(`  ✓ Evidence rows: ${signal.evidence.length}`);
      console.log(`  ✓ Urgency score: ${signal.urgency_score}`);
    } else {
      console.log("  ❌ No signals found - run 'npm run pipeline'");
    }

    // Overall status
    const allGood = 
      counts.clients === 20 &&
      counts.holdings >= 1000 &&
      counts.events === 16 &&
      counts.signals > 0 &&
      counts.flags > 0;

    console.log("\n" + "=".repeat(40));
    if (allGood) {
      console.log("✅ VERIFICATION PASSED");
      console.log("\nVerity is ready to run!");
      console.log("Start the dev server: npm run dev");
      console.log("Then open: http://localhost:3000");
    } else {
      console.log("⚠️  VERIFICATION INCOMPLETE");
      process.exitCode = 1;
      if (counts.signals === 0) {
        console.log("\nNext step: npm run pipeline");
      }
    }
    console.log("=".repeat(40));

  } catch (error) {
    console.error("❌ Verification failed:", error);
    process.exitCode = 1;
    console.log("\nTry running:");
    console.log("  1. npm run ingest");
    console.log("  2. npm run pipeline");
  } finally {
    await db.end();
  }
}

verify().catch((error) => {
  console.error("Verification failed:", error);
  process.exitCode = 1;
});
