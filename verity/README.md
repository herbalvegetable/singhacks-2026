# Verity — Wealth Intelligence Workbench

**Built for SingHacks 2026, Track 1 (Julius Baer, Wealth Intelligence)**

> Verity turns five years of scattered portfolio data into the three things an RM actually needs before a client call: what changed, why it happened, and what to consider doing about it — with every claim traceable back to source.

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env.local
# Add the OpenAI key and RM identity values.
# Generate VERITY_AUTH_PASSWORD_HASH without storing a plaintext password:
npm run hash-password -- <pilot-password>

# 3. Ingest data and run pipeline
npm run ingest     # Load data into SQLite
npm run pipeline   # Generate signals

# 4. Start the app
npm run dev        # Open http://localhost:3000
```

## 📊 What's Built

### ✅ Completed (M0-M2)

**M0 - Foundations**
- ✅ Next.js 15 + TypeScript + Tailwind CSS with Verity color system
- ✅ SQLite database (`verity.db`) with full schema
- ✅ Data ingestion script (`scripts/ingest.ts`)
  - Loads 13 CSV files + 1 JSON file
  - Unpivots time-series data (prices, AUM, facility snapshots, FX)
  - Synthesizes event IDs and tokenizes transmission channels
  - Detects data quality flags (missing cost basis, pre-relationship snapshots, lagged marks)
- ✅ Zod contracts for Signal, SourceRef, DataQualityFlag

**M1 - Deterministic Compute Engine**
- ✅ Repository layer for database access
- ✅ Snapshot diffing (`lib/compute/snapshotDiff.ts`)
  - 4-way decomposition (price, quantity, FX, residual)
  - Client-directed vs market-driven attribution
  - Duration signal generation for fixed income
- ✅ Look-through analysis (`lib/compute/lookThrough.ts`)
  - Household exposure aggregation
  - Structured product decomposition via `underlyingMap.ts`
  - Concentration signal generation (>15% threshold)
- ✅ Pipeline script (`scripts/pipeline.ts`)
  - Generates 36 signals across 20 clients
  - Detects key demo signals:
    - **CL-0001** (Hartono): 42.6% concentration in Bara Nusantara Energy
    - **CL-0012** (Cheung): $2.7M duration-driven losses in fixed income
    - **CL-0003** (Voss-Brenner): 26.1% concentration + $1.6M bond losses

**M2 - UI Shell**
- ✅ Morning Brief page (`/`)
  - Shows all clients with signals
  - Sorted by urgency score
  - Signal previews with type-specific styling
- ✅ Client Dossier page (`/client/[clientId]`)
  - Full client profile
  - All signals with detailed breakdowns
  - Data quality flags highlighted
  - Top holdings and portfolio list
- ✅ Signal Card component with expandable AI analysis
- ✅ Color system: Navy/Bronze header, Grounded (teal) for verified content, Risk hierarchy

**M3 - AI Agents (Partial)**
- ✅ Narrative Agent (`lib/agents/narrativeAgent.ts`)
  - Uses OpenAI `gpt-4o` with Zod structured outputs
  - Generates 3-paragraph story (what/why/what-to-do)
  - Opening line for client conversations
  - Recommended actions with confidence scores
  - Explicit caveats for uncertainties
- ✅ API route (`/api/narrative/[signalId]`)
  - On-demand narrative generation
  - Caching in `narratives` table
- ⚠️ **Not yet implemented**: Event grounding agent, prioritization agent

### 🚧 Remaining Work (M4-M6)

**M4 - Decisions & Audit** (Not implemented)
- Accept/Edit/Reject actions
- Hash-chained audit log
- `confidence_at_decision` and `prompt_version` tracking

**M5 - Priority & Copilot** (Not implemented)
- Stage 5: Prioritization agent (RM perspective)
- Stage 6: RM Copilot chatbot with context-switching
- Tool-use for inline charts (`get_timeseries`, `render_chart`)

**M6 - Polish** (Not implemented)
- Golden-number tests for compute engine
- Demo-specific UI polish for CL-0001, CL-0003, CL-0012
- Performance optimization
- Error handling

## 🎯 Demo Clients

The system is preconfigured with three compelling demo clients:

### CL-0012: Cheung Kwok Wing (71, Retired)
**Dashboard says**: "Income portfolio down USD 2.10m YTD"

**Verity says**: USD 3.96m of his bonds are *perpetual* — they have no maturity date, so "wait for them to come back" is not a plan. He has a USD 997k gain in a shipping stock he can harvest instead of selling at the loss he refuses to take.

**Signals detected**:
- ✅ Duration-driven losses: $2.7M
- ✅ Concentration: 20.8% in US Treasury 2.375% due 2045

### CL-0001: Hartono Wijaya Kusuma (34)
**Dashboard says**: "Household up 12.4% YTD, no mandate breaches"

**Verity says**: 41.4% of his wealth is one Indonesian coal stock sitting in a custody account no mandate check ever looks at. A 15.5% fall in that stock re-triggers the margin call on his SGD 8m Lombard.

**Signals detected**:
- ✅ Concentration: 42.6% in Bara Nusantara Energy (with look-through)
- ✅ Duration losses: $211k

### CL-0003: Margarethe Voss-Brenner (58)
**Dashboard says**: "Portfolio EUR 20.3m, +0.2% YTD"

**Verity says**: She was profiled Conservative (equity band 10–30%) and is holding 71.5% equity, because she inherited the portfolio and nobody has changed it. An EUR 3.4m tax instalment is due within four months against EUR 1.56m of cash.

**Signals detected**:
- ✅ Concentration: 26.1% in Global Luxury and Consumer Brands Fund
- ✅ Duration losses: $1.6M
- ✅ Data quality flag: Missing cost basis for Nordvind Industrial

## 🏗️ Architecture

### Core Principles (from spec)
1. **Grounding over generation**: Every "why" traces to a specific row in source data
2. **Deterministic compute, generative narration**: All math is TypeScript; LLMs only narrate verified facts
3. **Human always in the loop**: No AI output reaches clients directly
4. **Depth over coverage**: Structurally supports all 20 clients; demo goes deep on three
5. **Honest uncertainty**: Where data is ambiguous, Verity says so

### Tech Stack
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript
- **Database**: SQLite via `better-sqlite3`
- **Styling**: Tailwind CSS v4 with custom Verity color system
- **AI**: OpenAI `gpt-4o` with Zod structured outputs
- **Validation**: Zod schemas throughout (contracts, agent I/O)
- **Charts**: Recharts (not yet implemented)

### Data Flow
```
CSV/JSON files 
  → scripts/ingest.ts → verity.db
  → scripts/pipeline.ts → signals table
  → UI fetches signals
  → User clicks "AI Analysis"
  → /api/narrative/[signalId] → OpenAI → cached in narratives table
```

## 📁 Project Structure

```
verity/
├── app/
│   ├── page.tsx                    # Morning Brief (home)
│   ├── client/[clientId]/page.tsx  # Client Dossier
│   ├── api/narrative/[signalId]/   # AI narrative generation
│   └── globals.css                 # Tailwind + custom styles
├── lib/
│   ├── db/
│   │   ├── client.ts               # Database connection
│   │   └── repository.ts           # Data access layer
│   ├── compute/
│   │   ├── snapshotDiff.ts         # 4-way decomposition
│   │   ├── lookThrough.ts          # Household aggregation
│   │   └── underlyingMap.ts        # Structured product mappings
│   ├── agents/
│   │   └── narrativeAgent.ts       # OpenAI narrative generation
│   └── contracts/
│       └── signal.ts               # Zod schemas
├── components/verity/
│   └── SignalCard.tsx              # Expandable signal display
├── scripts/
│   ├── ingest.ts                   # Data ingestion
│   └── pipeline.ts                 # Signal generation
├── data/                           # Symlink/copy of singhacks data
└── verity.db                       # SQLite database (gitignored)
```

## 🧪 Testing

```bash
# Run ingestion
npm run ingest

# Expected output:
# ✓ Clients: 20
# ✓ Holdings: 1015
# ✓ Events: 16
# ✓ DQ Flags: 4

# Run pipeline
npm run pipeline

# Expected output:
# ✓ Pipeline complete: 36 signals generated
# ✓ CL-0001: 42.6% concentrated in Bara Nusantara
# ✓ CL-0012: Duration signal for $2.7M
```

## 🎨 Color System

- **Navy** (#0B2545): Primary brand, headers
- **Bronze** (#C9A24B): Accent, borders
- **Grounded** (#0F6E56): Teal for verified/grounded content
- **Risk High** (#A32D2D): Critical risks
- **Risk Mid** (#BA7517): Moderate risks
- **Opportunity** (#3B6D11): Positive signals
- **BG** (#F7F5F0): Warm off-white background
- **Ink** (#2C2C2A): Primary text

## 🔑 Key Features

### ✅ Implemented
- Deterministic compute engine (no AI in arithmetic)
- Look-through concentration analysis
- Duration attribution for bond losses
- Data quality flag detection and display
- On-demand AI narrative generation with confidence scores
- Grounding citations for every signal
- Signal urgency scoring

### 🚧 Partially Implemented
- Event grounding (data structure ready, agent not built)
- Confidence ceilings (logic ready, not applied in UI)

### ❌ Not Implemented
- Accept/Edit/Reject workflow
- Hash-chained audit log
- Prioritization agent
- RM Copilot chatbot
- Mandate band checks
- LTV trace for credit facilities
- Liquidity ladder
- Inline chart rendering
- Unit tests

## 📝 Notes

- **OpenAI API Key Required**: Set `OPENAI_API_KEY` in `.env.local` for narrative generation
- **Data Location**: The `/data` directory should contain the SingHacks dataset (symlink or copy)
- **Database**: `verity.db` is created on first `npm run ingest`
- **Performance**: Pipeline takes ~6s for 20 clients; UI is fast (SQLite queries <10ms)

## 🏆 Alignment with Spec

This implementation follows the detailed specification in `/verity-spec/`:
- ✅ Separation of deterministic compute and generative narration
- ✅ Evidence-backed signals with SourceRef citations
- ✅ Confidence scoring and uncertainty handling
- ✅ Data quality flag detection
- ✅ Three demo clients with verified numbers
- ✅ Modern private banking aesthetic (Navy + Bronze)
- ⚠️ Partial: Agent system (1 of 4 agents built)
- ❌ Missing: Audit log, Accept/Edit/Reject, Copilot, golden tests

## 🎓 What This Demonstrates

1. **Grounding & Traceability**: Every signal cites specific source rows
2. **Honest AI**: Confidence scores, caveats, and data quality flags
3. **Deterministic Core**: All math is code; LLMs only narrate
4. **Look-Through Intelligence**: Sees through structured products to underlying risk
5. **Real Client Value**: Turns "portfolio is down" into "these 3 perpetual bonds won't mature"
6. **Production-Ready Architecture**: SQLite for speed, Zod for contracts, type-safe throughout

---

Built with Next.js 15, TypeScript, SQLite, and OpenAI `gpt-4o`.
