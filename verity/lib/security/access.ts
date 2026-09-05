import type { Repository } from "../db/repository";

export class ResourceNotFoundError extends Error {
  constructor() {
    super("Resource not found");
  }
}

export async function requireClientAccess(
  repository: Repository,
  rmId: string,
  clientId: string,
): Promise<void> {
  if (!(await repository.clientBelongsToRm(clientId, rmId))) {
    throw new ResourceNotFoundError();
  }
}

export async function requireSignalAccess(
  repository: Repository,
  rmId: string,
  signalId: string,
): Promise<void> {
  if (!(await repository.signalBelongsToRm(signalId, rmId))) {
    throw new ResourceNotFoundError();
  }
}
