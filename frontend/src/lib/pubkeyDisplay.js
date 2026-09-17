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
