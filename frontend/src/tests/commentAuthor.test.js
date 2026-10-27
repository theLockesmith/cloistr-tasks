/**
 * Comment author display: the name is bound to the signing key.
 *
 * author_label is free text the poster sends with a comment. It used to be
 * shown AS the author ("label || pubkey"), so anyone with write access could
 * post as "Alice" or as the board owner. The shown name now always comes
 * from author_pubkey; a label is only an annotation after it.
 */

import fs from 'fs';
import path from 'path';
import { nip19 } from 'nostr-tools';
import * as pubkeyDisplay from '../lib/pubkeyDisplay';

const ME = 'a'.repeat(64);
const MALLORY = 'b'.repeat(64);
const { commentAuthor } = pubkeyDisplay;

describe('commentAuthor', () => {
  test('a spoofed label never becomes the name', () => {
    const shown = commentAuthor({ author_pubkey: MALLORY, author_label: 'You' }, ME);
    expect(shown.name).not.toContain('You');
    expect(shown.name.startsWith('npub1')).toBe(true);
    expect(shown.npub).toBe(nip19.npubEncode(MALLORY));
    expect(shown.label).toBe('You');
  });

  test('my own comment shows as You', () => {
    expect(commentAuthor({ author_pubkey: ME, author_label: null }, ME).name).toBe('You');
  });

  test('no label means no annotation', () => {
    expect(commentAuthor({ author_pubkey: MALLORY, author_label: '  ' }, ME).label).toBeNull();
  });

  test('a missing key shows Unknown, not the label', () => {
    expect(commentAuthor({ author_pubkey: null, author_label: 'Owner' }, ME).name).toBe('Unknown');
  });
});

describe('BoardCardModal renders authors through commentAuthor', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../components/BoardCardModal.js'), 'utf8');

  test('no place shows author_label in place of the key', () => {
    expect(src).not.toMatch(/author_label\s*\|\|/);
  });

  test('both comment headers (list and expanded view) use CommentAuthor', () => {
    expect(src.match(/<CommentAuthor\b/g) || []).toHaveLength(2);
  });
});
