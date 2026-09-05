import "server-only";

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db/client";
import { SESSION_COOKIE } from "./constants";
import { sessionIsActive } from "./sessionPolicy";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface AuthSession {
  rmId: string;
  displayName: string;
  expiresAt: string;
}

export class AuthenticationError extends Error {
  constructor() {
    super("Authentication required");
  }
}

export class AuthConfigurationError extends Error {
  constructor() {
    super("Server authentication is not configured");
  }
}

function ensureSessionTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      rm_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
      ON auth_sessions(expires_at);
  `);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function verifyPassword(password: string, encodedHash: string): boolean {
  const [saltHex, expectedHex] = encodedHash.split(":");
  if (!saltHex || !expectedHex) return false;
  try {
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashPassword(password: string, salt = randomBytes(16)): string {
  return `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function authenticateCredentials(
  username: string,
  password: string,
): Omit<AuthSession, "expiresAt"> | null {
  const configuredUsername = process.env.VERITY_AUTH_USERNAME;
  const configuredHash = process.env.VERITY_AUTH_PASSWORD_HASH;
  const rmId = process.env.VERITY_AUTH_RM_ID;
  const displayName =
    process.env.VERITY_AUTH_DISPLAY_NAME ?? configuredUsername;
  if (!configuredUsername || !configuredHash || !rmId || !displayName) {
    throw new AuthConfigurationError();
  }
  const usernameMatches = safeEqual(username.trim(), configuredUsername);
  const passwordMatches = verifyPassword(password, configuredHash);
  if (!usernameMatches || !passwordMatches) {
    return null;
  }
  return { rmId, displayName };
}

export async function createSession(
  identity: Omit<AuthSession, "expiresAt">,
): Promise<AuthSession> {
  ensureSessionTable();
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
  getDb()
    .prepare(
      `INSERT INTO auth_sessions
       (token_hash, rm_id, display_name, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      sha256(token),
      identity.rmId,
      identity.displayName,
      createdAt.toISOString(),
      expiresAt.toISOString(),
    );
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { ...identity, expiresAt: expiresAt.toISOString() };
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  ensureSessionTable();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT rm_id, display_name, expires_at, revoked_at
       FROM auth_sessions
       WHERE token_hash = ?`,
    )
    .get(sha256(token)) as
    | {
        rm_id: string;
        display_name: string;
        expires_at: string;
        revoked_at: string | null;
      }
    | undefined;
  if (!row || !sessionIsActive(row.expires_at, row.revoked_at)) return null;
  return {
    rmId: row.rm_id,
    displayName: row.display_name,
    expiresAt: row.expires_at,
  };
}

export async function requireApiSession(): Promise<AuthSession> {
  const session = await getCurrentSession();
  if (!session) throw new AuthenticationError();
  return session;
}

export async function requirePageSession(): Promise<AuthSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

export async function revokeCurrentSession(): Promise<void> {
  ensureSessionTable();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    getDb()
      .prepare(
        "UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
      )
      .run(new Date().toISOString(), sha256(token));
  }
  cookieStore.delete(SESSION_COOKIE);
}
