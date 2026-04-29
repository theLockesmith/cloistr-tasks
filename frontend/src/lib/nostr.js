// src/lib/nostr.js - Nostr authentication utilities
// Uses @cloistr/collab-common for NIP-07/NIP-46 signer management
import { nip19 } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools/pure';
import {
  connectNip07,
  connectNip46,
} from '@cloistr/collab-common/auth';

// ============================================
// NIP-07 Browser Extension Support
// ============================================

/**
 * Check if a NIP-07 compatible browser extension is available
 */
export function hasNostrExtension() {
  return typeof window !== 'undefined' && typeof window.nostr !== 'undefined';
}

/**
 * Wait for nostr extension to be available (some extensions load async)
 */
export async function waitForNostrExtension(timeoutMs = 3000) {
  if (hasNostrExtension()) return true;

  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (hasNostrExtension()) {
        clearInterval(checkInterval);
        resolve(true);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 100);
  });
}

// ============================================
// Authentication Helpers
// ============================================

/**
 * Create an unsigned authentication event for challenge-response
 */
export function createAuthEvent(pubkey, challenge, nonce) {
  const content = JSON.stringify({ challenge, nonce });

  return {
    kind: 27235, // NIP-98 HTTP Auth event kind
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['challenge', challenge],
      ['nonce', nonce]
    ],
    content,
    pubkey
  };
}

/**
 * Perform full authentication flow with NIP-07 extension
 * Uses collab-common's connectNip07 for signer management
 */
export async function authenticateWithExtension(apiBase) {
  // 1. Connect to extension via collab-common
  const signer = await connectNip07();
  const pubkey = await signer.getPublicKey();

  // 2. Get challenge from server
  const challengeResponse = await fetch(`${apiBase}/auth/challenge`);
  if (!challengeResponse.ok) {
    throw new Error('Failed to get challenge');
  }
  const { challenge, nonce } = await challengeResponse.json();

  // 3. Create unsigned event
  const unsignedEvent = createAuthEvent(pubkey, challenge, nonce);

  // 4. Sign with collab-common signer
  const signedEvent = await signer.signEvent(unsignedEvent);

  // 5. Verify the event is valid
  if (!verifyEvent(signedEvent)) {
    throw new Error('Invalid signature from extension');
  }

  // 6. Send to server for verification
  const verifyResponse = await fetch(`${apiBase}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedEvent })
  });

  if (!verifyResponse.ok) {
    const error = await verifyResponse.json();
    throw new Error(error.error || 'Authentication failed');
  }

  return verifyResponse.json();
}

/**
 * Perform full authentication flow with NIP-46 bunker
 * Uses collab-common's connectNip46 for signer management
 */
export async function authenticateWithBunker(apiBase, bunkerUrl) {
  // 1. Connect to bunker via collab-common
  const signer = await connectNip46({ bunkerUrl });
  const pubkey = await signer.getPublicKey();

  // 2. Get challenge from server
  const challengeResponse = await fetch(`${apiBase}/auth/challenge`);
  if (!challengeResponse.ok) {
    await signer.close?.();
    throw new Error('Failed to get challenge');
  }
  const { challenge, nonce } = await challengeResponse.json();

  // 3. Create unsigned event
  const unsignedEvent = createAuthEvent(pubkey, challenge, nonce);

  // 4. Sign with collab-common signer
  let signedEvent;
  try {
    signedEvent = await signer.signEvent(unsignedEvent);
  } catch (error) {
    await signer.close?.();
    throw new Error(`Bunker signing failed: ${error.message}`);
  }

  // 5. Verify the event is valid
  if (!verifyEvent(signedEvent)) {
    await signer.close?.();
    throw new Error('Invalid signature from bunker');
  }

  // 6. Send to server for verification
  const verifyResponse = await fetch(`${apiBase}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedEvent })
  });

  if (!verifyResponse.ok) {
    await signer.close?.();
    const error = await verifyResponse.json();
    throw new Error(error.error || 'Authentication failed');
  }

  // Store the signer for later use (signing future events)
  const result = await verifyResponse.json();
  result._signer = signer;

  return result;
}

// ============================================
// NIP-19 Encoding Utilities
// ============================================

/**
 * Encode a hex pubkey as npub
 */
export function encodeNpub(hexPubkey) {
  try {
    return nip19.npubEncode(hexPubkey);
  } catch (error) {
    console.error('Failed to encode npub:', error);
    return null;
  }
}

/**
 * Decode an npub to hex pubkey
 */
export function decodeNpub(npub) {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type !== 'npub') {
      throw new Error('Not an npub');
    }
    return decoded.data;
  } catch (error) {
    console.error('Failed to decode npub:', error);
    return null;
  }
}

/**
 * Format pubkey for display (truncated or npub)
 */
export function formatPubkey(pubkey, useNpub = true) {
  if (useNpub) {
    const npub = encodeNpub(pubkey);
    if (npub) {
      return npub.substring(0, 12) + '...' + npub.substring(npub.length - 4);
    }
  }
  return pubkey.substring(0, 8) + '...' + pubkey.substring(pubkey.length - 4);
}
