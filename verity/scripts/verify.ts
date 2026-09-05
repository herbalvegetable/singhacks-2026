import { getDb, closeDb } from "../lib/db/client";

function verify() {
  console.log("=== Verity Verification ===\n");

  const db = getDb();

  try {
    // Check database exists and has data
    const counts = {
      clients: db.prepare("SELECT COUNT(*) as count FROM clients").get() as { count: number },
      holdings: db.prepare("SELECT COUNT(*) as count FROM holdings").get() as { count: number },
      signals: db.prepare("SELECT COUNT(*) as count FROM signals").get() as { count: number },
      events: db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number },
      flags: db.prepare("SELECT COUNT(*) as count FROM data_quality_flags").get() as { count: number },
    };

    console.log("📊 Database Check:");
    console.log(`  ✓ Clients: ${counts.clients.count} ${counts.clients.count === 20 ? '✓' : '❌ Expected 20'}`);
    console.log(`  ✓ Holdings: ${counts.holdings.count} ${counts.holdings.count >= 1000 ? '✓' : '❌ Expected ~1015'}`);
    console.log(`  ✓ Events: ${counts.events.count} ${counts.events.count === 16 ? '✓' : '❌ Expected 16'}`);
    console.log(`  ✓ Signals: ${counts.signals.count} ${counts.signals.count > 0 ? '✓' : '❌ Run pipeline first!'}`);
    console.log(`  ✓ Flags: ${counts.flags.count} ${counts.flags.count > 0 ? '✓' : '❌'}`);

    // Check demo clients exist
    console.log("\n🎯 Demo Clients:");
    const demoClients = ['CL-0001', 'CL-0003', 'CL-0012'];
    for (const clientId of demoClients) {
      const client = db.prepare("SELECT client_name FROM clients WHERE client_id = ?").get(clientId) as { client_name: string } | undefined;
      const signals = db.prepare("SELECT COUNT(*) as count FROM signals WHERE client_id = ?").get(clientId) as { count: number };
      
      if (client) {
        console.log(`  ✓ ${clientId} (${client.client_name}): ${signals.count} signals`);
      } else {
        console.log(`  ❌ ${clientId}: Not found`);
      }
    }

    // Check signals have proper structure
    console.log("\n🔍 Signal Validation:");
    const sampleSignal = db.prepare("SELECT payload FROM signals LIMIT 1").get() as { payload: string } | undefined;
    
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
      counts.clients.count === 20 &&
      counts.holdings.count >= 1000 &&
      counts.events.count === 16 &&
      counts.signals.count > 0 &&
      counts.flags.count > 0;

    console.log("\n" + "=".repeat(40));
    if (allGood) {
      console.log("✅ VERIFICATION PASSED");
      console.log("\nVerity is ready to run!");
      console.log("Start the dev server: npm run dev");
      console.log("Then open: http://localhost:3000");
    } else {
      console.log("⚠️  VERIFICATION INCOMPLETE");
      if (counts.signals.count === 0) {
        console.log("\nNext step: npm run pipeline");
      }
    }
    console.log("=".repeat(40));

  } catch (error) {
    console.error("❌ Verification failed:", error);
    console.log("\nTry running:");
    console.log("  1. npm run ingest");
    console.log("  2. npm run pipeline");
  } finally {
    closeDb();
  }
}

verify();
