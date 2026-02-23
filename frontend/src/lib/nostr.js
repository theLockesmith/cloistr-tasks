// src/lib/nostr.js - Nostr authentication utilities
import { finalizeEvent, verifyEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';

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

// Store client secret key in memory (generated once per session)
let clientSecretKey = null;

/**
 * Get or create the client secret key for NIP-46 communication
 */
export function getClientSecretKey() {
  if (!clientSecretKey) {
    clientSecretKey = generateSecretKey();
  }
  return clientSecretKey;
}

/**
 * Get the client's public key (derived from secret key)
 */
export function getClientPublicKey() {
  return getPublicKey(getClientSecretKey());
}

/**
 * NIP-46 Client wrapper for remote signing
 * Uses nostr-tools BunkerSigner internally
 */
export class Nip46Client {
  constructor(bunkerUrl) {
    this.bunkerUrl = bunkerUrl;
    this.signer = null;
    this.connected = false;
    this.userPubkey = null;
  }

  async connect() {
    console.log('NIP-46 connecting to:', this.bunkerUrl);

    // Parse the bunker URL
    const bunkerPointer = await parseBunkerInput(this.bunkerUrl);
    if (!bunkerPointer) {
      throw new Error('Invalid bunker URL or NIP-05 identifier');
    }

    if (!bunkerPointer.relays || bunkerPointer.relays.length === 0) {
      throw new Error('No relays specified in bunker URL');
    }

    console.log('Bunker pointer:', bunkerPointer);

    // Create the signer with our client secret key
    const secretKey = getClientSecretKey();
    this.signer = BunkerSigner.fromBunker(secretKey, bunkerPointer, {
      onauth: (url) => {
        // Handle auth URL - open in new window for user to approve
        console.log('Auth required, opening:', url);
        window.open(url, '_blank', 'width=600,height=800');
      }
    });

    // Connect to the bunker
    await this.signer.connect();

    // Get the user's public key
    this.userPubkey = await this.signer.getPublicKey();
    this.connected = true;

    console.log('NIP-46 connected, user pubkey:', this.userPubkey);
    return this.userPubkey;
  }

  async getPublicKey() {
    if (!this.connected || !this.signer) {
      throw new Error('Not connected to bunker');
    }
    return this.signer.getPublicKey();
  }

  async signEvent(event) {
    if (!this.connected || !this.signer) {
      throw new Error('Not connected to bunker');
    }
    return this.signer.signEvent(event);
  }

  async disconnect() {
    if (this.signer) {
      await this.signer.close();
    }
    this.connected = false;
    this.signer = null;
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

/**
 * Perform full authentication flow with NIP-46 bunker
 */
export async function authenticateWithBunker(apiBase, bunkerUrl) {
  // 1. Create and connect to bunker
  const client = new Nip46Client(bunkerUrl);
  const pubkey = await client.connect();

  // 2. Get challenge from server
  const challengeResponse = await fetch(`${apiBase}/auth/challenge`);
  if (!challengeResponse.ok) {
    await client.disconnect();
    throw new Error('Failed to get challenge');
  }
  const { challenge, nonce } = await challengeResponse.json();

  // 3. Create unsigned event
  const unsignedEvent = createAuthEvent(pubkey, challenge, nonce);

  // 4. Sign with bunker
  let signedEvent;
  try {
    signedEvent = await client.signEvent(unsignedEvent);
  } catch (error) {
    await client.disconnect();
    throw new Error(`Bunker signing failed: ${error.message}`);
  }

  // 5. Verify the event is valid
  if (!verifyEvent(signedEvent)) {
    await client.disconnect();
    throw new Error('Invalid signature from bunker');
  }

  // 6. Send to server for verification
  const verifyResponse = await fetch(`${apiBase}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedEvent })
  });

  if (!verifyResponse.ok) {
    await client.disconnect();
    const error = await verifyResponse.json();
    throw new Error(error.error || 'Authentication failed');
  }

  // Store the client for later use (signing future events)
  // Note: In a real app, you might want to store this in context
  const result = await verifyResponse.json();
  result._bunkerClient = client;

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
