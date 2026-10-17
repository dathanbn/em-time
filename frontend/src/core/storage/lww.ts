import type { EntityMeta } from '../types';

/**
 * The single last-write-wins rule (contract 3.7, mirrored by the em_lww_guard trigger):
 * greater updatedAt wins; on a tie a tombstone beats a live row; otherwise keep local.
 */
export function applyRemoteRow<T extends EntityMeta>(local: T | undefined, remote: T): T {
  if (local === undefined) return remote;
  if (remote.updatedAt > local.updatedAt) return remote;
  if (remote.updatedAt < local.updatedAt) return local;
  if (remote.deletedAt !== null && local.deletedAt === null) return remote;
  return local;
}
