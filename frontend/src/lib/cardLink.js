/**
 * Per-card deep links: /card/<id>.
 *
 * <id> is board_cards.id, the same number shown as "#231" on a card. It is a
 * database serial, so it never changes for the life of the card, including
 * when the card moves between columns.
 *
 * The path is the canonical form. nginx's try_files falls back to index.html
 * for it, and the app reads it at startup (AuthenticatedApp) to open the
 * board that holds the card with the card's detail already open.
 */

const CARD_PATH = /^\/card\/(\d{1,10})\/?$/;

/** The card id in a pathname like "/card/231", or null if it is not one. */
export function parseCardPath(pathname) {
  const m = CARD_PATH.exec(pathname || '');
  if (!m) return null;
  const id = Number(m[1]);
  return id > 0 && id <= 2147483647 ? id : null;
}

/** The pathname for a card. */
export function cardPath(cardId) {
  return '/card/' + cardId;
}

/** The full shareable URL for a card on this deployment. */
export function cardUrl(cardId, origin = window.location.origin) {
  return origin + cardPath(cardId);
}

/**
 * Point the address bar at a card while its detail is open, or back at the
 * app root when it closes, without adding history entries. Board filter
 * params (q, assignee, ...) in the query string are kept either way.
 */
export function showCardInAddressBar(cardId) {
  const path = cardId ? cardPath(cardId) : '/';
  if (window.location.pathname === path) return;
  window.history.replaceState(null, '', path + window.location.search);
}

/** Copy text to the clipboard. Resolves true on success, false otherwise. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
