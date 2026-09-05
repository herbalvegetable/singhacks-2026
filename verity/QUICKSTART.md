# Verity Quick Start

Get Verity up and running in 5 minutes.

## Prerequisites

- Node.js 18+ installed
- OpenAI API key (for AI narrative generation)

## Setup

```bash
# 1. Navigate to the project
cd verity

# 2. Install dependencies (if not already done)
npm install

# 3. Configure environment
cp .env.local.example .env.local
# Edit .env.local and add your OpenAI API key
```

## Run

```bash
# Step 1: Ingest the data (takes ~5 seconds)
npm run ingest

# Expected output:
# ✓ Clients: 20
# ✓ Holdings: 1015
# ✓ Events: 16
# ✓ DQ Flags: 4

# Step 2: Generate signals (takes ~6 seconds)
npm run pipeline

# Expected output:
# ✓ Pipeline complete: 36 signals generated
# Processing CL-0001 (Hartono Wijaya Kusuma)...
#   ✓ Concentration signal: Household 42.6% concentrated in Bara Nusantara Energy Tbk
# Processing CL-0012 (Cheung Kwok Wing)...
#   ✓ Duration signal: Fixed income down 2685574 USD driven by duration
# ...

# Step 3: Start the web app
npm run dev

# Open http://localhost:3000
```

## What You'll See

### Morning Brief (Home Page)
- List of all 20 clients sorted by signal urgency
- Preview of top 2 signals per client
- Click any client to see their full dossier

### Client Dossier
- Full client profile (age, risk profile, objectives)
- All signals with detailed breakdowns
- Data quality flags (if any)
- Top 10 holdings
- **AI Analysis**: Click "AI Analysis →" on any signal to generate:
  - 3-paragraph narrative (what/why/what-to-do)
  - Opening line for client conversation
  - Recommended actions with steps
  - Caveats and uncertainties

## Demo Clients

Try these three clients for the best demo experience:

1. **CL-0001** (Hartono Wijaya Kusuma): 42.6% concentration in coal stock
2. **CL-0012** (Cheung Kwok Wing): $2.7M duration losses in perpetual bonds
3. **CL-0003** (Margarethe Voss-Brenner): 71.5% equity despite Conservative mandate

## Troubleshooting

### Port 3000 already in use
```bash
# Kill the process and restart
taskkill /F /IM node.exe
npm run dev
```

### OpenAI API errors
- Check that `OPENAI_API_KEY` is set correctly in `.env.local`
- Ensure your API key has access to `gpt-4o`
- The app works without OpenAI (just can't generate narratives)

### No signals showing
```bash
# Re-run the pipeline
npm run pipeline
```

### Database issues
```bash
# Delete and re-ingest
del verity.db
npm run ingest
npm run pipeline
```

## What's Working

✅ **Stage 1**: Data ingestion (13 CSVs + 1 JSON → SQLite)
✅ **Stage 2**: Deterministic compute (snapshot diff + look-through)
✅ **Signals**: 36 signals across 20 clients
✅ **Stage 4**: AI narrative generation (OpenAI gpt-4o)
✅ **UI**: Morning brief + client dossier pages
✅ **Grounding**: Every signal cites source rows
✅ **Data Quality**: Flags for missing data/stale marks

## Next Steps

For production deployment:
- Add Accept/Edit/Reject workflow (M4)
- Add hash-chained audit log (M4)
- Add prioritization agent (M5)
- Add RM Copilot chatbot (M5)
- Add mandate band checks
- Add LTV trace for credit facilities
- Add liquidity ladder
- Add inline chart rendering
- Add unit tests

---

**Need help?** Check the full README.md for architecture details and troubleshooting.
