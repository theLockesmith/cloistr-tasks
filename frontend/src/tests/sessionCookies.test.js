/**
 * Session cookies must not cross environments (staging-environment.md, rule 4).
 *
 * No jsdom here (see signerResilience.test.js), so window/document are minimal
 * stubs: document.cookie records every string written to it, which is exactly
 * what the browser would be asked to store. session.js resolves its cookie
 * names at import, so each case re-imports it with its own runtime config.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';

async function load({ host, config }) {
  vi.resetModules();
  vi.doMock('../lib/serviceConfig', () => ({ serviceConfig: config }));
  const writes = [];
  globalThis.window = { location: { hostname: host } };
  globalThis.document = {
    get cookie() { return ''; },
    set cookie(v) { writes.push(v); },
  };
  const session = await import('../lib/session');
  return { session, writes };
}

const SESSION = { method: 'nip46', pubkey: 'a'.repeat(64), bunkerUrl: 'bunker://x' };

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  vi.doUnmock('../lib/serviceConfig');
});

describe('session cookies per environment', () => {
  it('production keeps the original names and .cloistr.xyz scope', async () => {
    const { session, writes } = await load({
      host: 'tasks.cloistr.xyz',
      config: { environment: 'production', appUrl: 'https://tasks.cloistr.xyz' },
    });
    session.saveSharedSession(SESSION);
    expect(writes).toHaveLength(3);
    expect(writes[0]).toMatch(/^cloistr_auth_method=nip46; domain=\.cloistr\.xyz;/);
    expect(writes[1]).toMatch(/^cloistr_auth_pubkey=/);
    expect(writes[2]).toMatch(/^cloistr_auth_bunker=/);
  });

  it('staging scopes to .staging.cloistr.xyz under its own names', async () => {
    const { session, writes } = await load({
      host: 'tasks.staging.cloistr.xyz',
      config: { environment: 'staging', appUrl: 'https://tasks.staging.cloistr.xyz' },
    });
    session.saveSharedSession(SESSION);
    for (const w of writes) {
      expect(w).toMatch(/^cloistr_staging_/);
      expect(w).toContain('domain=.staging.cloistr.xyz;');
      expect(w).not.toMatch(/domain=\.cloistr\.xyz/);
    }
  });

  it('staging logout clears only staging cookies', async () => {
    const { session, writes } = await load({
      host: 'tasks.staging.cloistr.xyz',
      config: { environment: 'staging', appUrl: 'https://tasks.staging.cloistr.xyz' },
    });
    session.clearSharedSession();
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(w).toMatch(/^cloistr_staging_/);
      expect(w).not.toMatch(/domain=\.cloistr\.xyz/);
    }
  });

  it('an image opened off its own domain sets host-only cookies', async () => {
    const { session, writes } = await load({
      host: 'localhost',
      config: { environment: 'staging', appUrl: 'https://tasks.staging.cloistr.xyz' },
    });
    session.saveSharedSession(SESSION);
    for (const w of writes) expect(w).not.toContain('domain=');
  });

  it('vite dev without appUrl keeps the original .cloistr.xyz rule', async () => {
    const { session } = await load({ host: 'tasks.cloistr.xyz', config: { environment: 'production' } });
    expect(session.getCookieDomain()).toBe('.cloistr.xyz');
  });
});
