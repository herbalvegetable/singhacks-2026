# Verity Quick Start

## Prerequisites

- Node.js 20+
- A Neon Postgres database
- An OpenAI API key for agent-powered features

## 1. Install

```powershell
cd verity
npm install
Copy-Item .env.example .env.local
```

Connect Neon through the Vercel Marketplace or create a Neon project directly. Configure:

```dotenv
DATABASE_URL=postgresql://pooled-connection
DATABASE_URL_UNPOOLED=postgresql://direct-connection
OPENAI_API_KEY=your-key
VERITY_AGENTS_ENABLED=true
VERITY_AUTH_USERNAME=priscilla
VERITY_AUTH_PASSWORD_HASH=generated-hash
VERITY_AUTH_RM_ID=RM-SG-014
VERITY_AUTH_DISPLAY_NAME=Priscilla Ong
VERITY_PRIORITY_ADMIN_RM_IDS=RM-SG-014
```

Generate the pilot password hash:

```powershell
npm run hash-password -- "your-password"
```

## 2. Create and seed the database

```powershell
npm run migrate
npm run seed
npm run pipeline
npm run verify
```

Expected verification:

```text
Clients: 20
Holdings: 1015
Events: 16
Signals: 36
Data-quality flags: 5
```

## 3. Run locally

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 4. Deploy to Vercel

1. Import the GitHub repository into Vercel.
2. Set the project root to `verity`.
3. Provision and connect Neon from Vercel Marketplace.
4. Enable Preview Branching.
5. Configure the OpenAI and `VERITY_*` variables.
6. Run migration, seed, pipeline, and verification once against the intended Neon branch.
7. Deploy with `npx vercel --prod` or from the Vercel dashboard.

Use `DATABASE_URL` for runtime traffic and `DATABASE_URL_UNPOOLED` for migrations and seeding. Do not run the seed automatically on every production deployment.

## Validation

```powershell
npx tsc --noEmit
npm test
npm run lint
npm run build
```

See `README.md` for full architecture and `SECURITY.md` for production boundaries.
