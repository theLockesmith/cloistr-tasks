import { nip19 } from 'nostr-tools';

export function formatPubkey(hex, length = 16) {
  if (!hex) return '';
  try {
    const npub = nip19.npubEncode(hex);
    if (length >= npub.length) return npub;
    const half = Math.floor((length - 3) / 2);
    return npub.slice(0, half + 5) + '...' + npub.slice(-half);
  } catch {
    return hex.slice(0, 8) + '...' + hex.slice(-4);
  }
}

export function parsePubkeyInput(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[0-9a-f]{64}$/.test(trimmed)) return trimmed;
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === 'npub') return decoded.data;
  } catch {}
  return null;
}

/**
 * Who wrote a comment, for display. The name shown is always derived from
 * author_pubkey, which the server takes from the signed-in session, so it
 * cannot be chosen by the poster. author_label is free text the poster sends
 * (the fleet bridge names its agents with it); it is returned separately and
 * must only ever be shown as an unverified annotation, never as the name.
 */
export function commentAuthor(comment, myPubkey) {
  const pubkey = comment?.author_pubkey || '';
  const isMe = !!pubkey && pubkey === myPubkey;
  const label = (comment?.author_label || '').trim();
  return {
    name: isMe ? 'You' : (formatPubkey(pubkey, 20) || 'Unknown'),
    npub: formatPubkey(pubkey, 1000),
    label: label || null,
  };
}
