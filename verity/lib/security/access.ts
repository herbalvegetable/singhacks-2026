import type { Repository } from "../db/repository";

export class ResourceNotFoundError extends Error {
  constructor() {
    super("Resource not found");
  }
}

export function requireClientAccess(
  repository: Repository,
  rmId: string,
  clientId: string,
): void {
  if (!repository.clientBelongsToRm(clientId, rmId)) {
    throw new ResourceNotFoundError();
  }
}

export function requireSignalAccess(
  repository: Repository,
  rmId: string,
  signalId: string,
): void {
  if (!repository.signalBelongsToRm(signalId, rmId)) {
    throw new ResourceNotFoundError();
  }
}
