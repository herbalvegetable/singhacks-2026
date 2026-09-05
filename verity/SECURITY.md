# Security boundary

Verity's custom credential and session implementation is a pilot control, not
the final authentication design for a regulated deployment. Replace it with the
bank's OIDC provider before production rollout. Sessions are opaque, hashed in
the server-side store, revocable, and carried only in an HttpOnly cookie.

## Required pilot controls

- Store `OPENAI_API_KEY` and authentication values in the deployment secret
  manager. Never copy `.env.local` or database credentials into an image or
  repository.
- Generate `VERITY_AUTH_PASSWORD_HASH` with
  `npm run hash-password -- <password>`. Do not configure a plaintext password.
- Set `VERITY_AGENTS_ENABLED=false` during an incident or whenever the model
  processing agreement is not active.
- Provision Neon through the approved Vercel Marketplace integration. Use the
  pooled `DATABASE_URL` for application traffic and `DATABASE_URL_UNPOOLED`
  only for migrations and trusted seed operations.
- Enable Neon preview branching so preview deployments cannot write to the
  production database. Verify encryption, region, access controls, backups,
  retention, and deletion policy before processing non-synthetic data.
- Terminate TLS at the trusted ingress. HSTS is emitted in production.
- Set `VERITY_PRIORITY_ADMIN_RM_IDS` to the small set allowed to trigger
  book-wide model generation.
- Use an enterprise model endpoint with approved residency and zero-retention
  terms before processing non-synthetic client data.

## Secret response

If an API key or credential has been shared, synchronized to an unapproved
service, or force-added to Git, revoke it at the provider before creating a
replacement. The repository ignores local secrets, but ignore rules do not
protect screenshots, backups, shell history, or compromised workstations.

## Reporting

Report vulnerabilities privately to the repository owner. Do not include
client payloads, credentials, session cookies, or full model prompts in an
issue. Include a correlation time, affected route, and a redacted reproduction.
