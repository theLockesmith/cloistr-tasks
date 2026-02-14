// src/lib/nostr.js - Nostr authentication utilities
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';

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

/**
 * Get public key from NIP-07 extension
 */
export async function getPublicKeyFromExtension() {
  if (!hasNostrExtension()) {
    throw new Error('No Nostr extension found');
  }
  return window.nostr.getPublicKey();
}

/**
 * Sign an event using NIP-07 extension
 */
export async function signEventWithExtension(event) {
  if (!hasNostrExtension()) {
    throw new Error('No Nostr extension found');
  }
  return window.nostr.signEvent(event);
}

// ============================================
// NIP-46 Remote Signer (Bunker) Support
// ============================================

/**
 * Parse a bunker:// URL
 * Format: bunker://<remote-signer-pubkey>?relay=<relay-url>&secret=<secret>
 */
export function parseBunkerUrl(bunkerUrl) {
  if (!bunkerUrl.startsWith('bunker://')) {
    throw new Error('Invalid bunker URL format');
  }

  const url = new URL(bunkerUrl);
  const remotePubkey = url.hostname || url.pathname.replace('//', '');
  const relay = url.searchParams.get('relay');
  const secret = url.searchParams.get('secret');

  if (!remotePubkey) {
    throw new Error('Missing remote pubkey in bunker URL');
  }

  return {
    remotePubkey,
    relay: relay ? decodeURIComponent(relay) : null,
    secret: secret || null
  };
}

/**
 * NIP-46 Client for remote signing
 * Note: This is a simplified implementation. For production, use a full NIP-46 client.
 */
export class Nip46Client {
  constructor(bunkerUrl) {
    const parsed = parseBunkerUrl(bunkerUrl);
    this.remotePubkey = parsed.remotePubkey;
    this.relayUrl = parsed.relay;
    this.secret = parsed.secret;
    this.connected = false;
    this.userPubkey = null;
  }

  async connect() {
    // For now, we'll implement a basic connection
    // A full implementation would establish WebSocket connection to relay
    // and perform the NIP-46 handshake
    console.log('NIP-46 connection to:', this.remotePubkey);

    // TODO: Implement full NIP-46 protocol
    // For now, throw an error to indicate this needs implementation
    throw new Error('NIP-46 bunker support coming soon. Please use a browser extension for now.');
  }

  async signEvent(event) {
    if (!this.connected) {
      throw new Error('Not connected to bunker');
    }
    // TODO: Send sign_event request to bunker via relay
    throw new Error('Not implemented');
  }

  async disconnect() {
    this.connected = false;
  }
}

// ============================================
// Shared Signer Interface
// ============================================

/**
 * Create a unified signer interface for either NIP-07 or NIP-46
 */
export function createSigner(type, options = {}) {
  if (type === 'extension') {
    return {
      type: 'extension',
      getPublicKey: getPublicKeyFromExtension,
      signEvent: signEventWithExtension
    };
  } else if (type === 'bunker') {
    const client = new Nip46Client(options.bunkerUrl);
    return {
      type: 'bunker',
      client,
      getPublicKey: async () => {
        await client.connect();
        return client.userPubkey;
      },
      signEvent: (event) => client.signEvent(event)
    };
  }
  throw new Error(`Unknown signer type: ${type}`);
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
 */
export async function authenticateWithExtension(apiBase) {
  // 1. Get challenge from server
  const challengeResponse = await fetch(`${apiBase}/auth/challenge`);
  if (!challengeResponse.ok) {
    throw new Error('Failed to get challenge');
  }
  const { challenge, nonce } = await challengeResponse.json();

  // 2. Get public key from extension
  const pubkey = await getPublicKeyFromExtension();

  // 3. Create unsigned event
  const unsignedEvent = createAuthEvent(pubkey, challenge, nonce);

  // 4. Sign with extension
  const signedEvent = await signEventWithExtension(unsignedEvent);

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
