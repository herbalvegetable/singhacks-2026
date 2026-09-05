export function sessionIsActive(
  expiresAt: string,
  revokedAt: string | null,
  now = new Date(),
): boolean {
  const expiry = Date.parse(expiresAt);
  return (
    revokedAt === null &&
    Number.isFinite(expiry) &&
    expiry > now.getTime()
  );
}
