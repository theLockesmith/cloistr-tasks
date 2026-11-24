/**
 * Public board links: /public/board/<id>.
 *
 * <id> is task_lists.id of a board whose visibility is 'public'. The page at
 * this path renders without signing in (App mounts it outside the auth
 * providers) and reads GET /api/public/boards/<id>, which answers 404 for a
 * private or missing board alike.
 */

const PUBLIC_BOARD_PATH = /^\/public\/board\/(\d{1,10})\/?$/;

/** The board id in a pathname like "/public/board/12", or null if it is not one. */
export function parsePublicBoardPath(pathname) {
  const m = PUBLIC_BOARD_PATH.exec(pathname || '');
  if (!m) return null;
  const id = Number(m[1]);
  return id > 0 && id <= 2147483647 ? id : null;
}

/** The pathname for a public board. */
export function publicBoardPath(boardId) {
  return '/public/board/' + boardId;
}

/** The full shareable URL for a public board on this deployment. */
export function publicBoardUrl(boardId, origin = window.location.origin) {
  return origin + publicBoardPath(boardId);
}
