import { createHash } from "crypto";
import type { ContextPack } from "../contracts/chat";

const OMITTED_KEYS = new Set([
  "client_name",
  "rm_name",
  "nationality",
  "country_of_residence",
  "source_of_wealth",
  "pep_status",
]);

export function clientPseudonym(clientId: string): string {
  return `CLIENT-${createHash("sha256").update(clientId).digest("hex").slice(0, 10)}`;
}

export function restoreClientPseudonym(
  text: string,
  clientId: string,
  clientName: string,
): string {
  return text.replaceAll(clientPseudonym(clientId), clientName);
}

export function minimizeModelPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(minimizeModelPayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !OMITTED_KEYS.has(key))
        .map(([key, item]) => [key, minimizeModelPayload(item)]),
    );
  }
  return value;
}

export function contextPackForModel(pack: ContextPack): unknown {
  const minimized = minimizeModelPayload(pack) as Record<string, unknown>;
  return {
    ...minimized,
    client_name: clientPseudonym(pack.client_id),
  };
}
