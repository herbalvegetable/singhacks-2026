export class AgentsDisabledError extends Error {
  constructor() {
    super("AI agents are disabled");
  }
}

export function agentsEnabled(): boolean {
  return (
    process.env.VERITY_AGENTS_ENABLED === "true" &&
    Boolean(process.env.OPENAI_API_KEY)
  );
}

export function requireAgentsEnabled(): void {
  if (!agentsEnabled()) throw new AgentsDisabledError();
}

export const OPENAI_REQUEST_OPTIONS = {
  timeout: 30_000,
  maxRetries: 1,
} as const;
