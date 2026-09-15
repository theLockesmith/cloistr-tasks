/**
 * Pure access-level helpers for list sharing.
 *
 * GET /api/lists returns an `access` field per row: 'owner', 'admin',
 * 'write', or 'read'.  These helpers centralise the checks so the
 * components don't repeat string comparisons and the logic is testable
 * without a DOM.
 *
 * Hierarchy: read(1) < write(2) < admin(3) < owner(4).
 */

/** The caller owns the list and can delete it or transfer ownership. */
export function isListOwner(list) {
  return list?.access === 'owner';
}

/** The caller can manage the list: rename, settings, shares, columns. Owner implies admin. */
export function canAdminList(list) {
  return list?.access === 'owner' || list?.access === 'admin';
}

/** The caller can modify tasks (toggle, create, reorder, edit). Admin and owner imply write. */
export function canWriteList(list) {
  return list?.access === 'owner' || list?.access === 'admin' || list?.access === 'write';
}

/** The list was shared TO this user (they are not the owner). */
export function isSharedList(list) {
  return !!list?.access && list.access !== 'owner';
}

/** Human-readable label for the share badge, or null for owned lists. */
export function shareLabel(list) {
  if (!isSharedList(list)) return null;
  return `Shared (${list.access})`;
}
