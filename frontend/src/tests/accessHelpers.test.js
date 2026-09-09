/**
 * Tests for the list access helpers.
 *
 * THE CRITICAL INVARIANT (carried from the backend access.test.js):
 * assert the shared user IS admitted, not just that a stranger is
 * refused.  A helper that returns false for everyone passes every
 * refusal test you can write.  The ADMISSION tests below catch that.
 */

import {
  isListOwner,
  canWriteList,
  isSharedList,
  shareLabel,
} from '../lib/accessHelpers';

// ── isListOwner ──────────────────────────────────────────────────────────

describe('isListOwner', () => {
  test('true for owner',             () => expect(isListOwner({ access: 'owner' })).toBe(true));
  test('false for write (REFUSAL)',  () => expect(isListOwner({ access: 'write' })).toBe(false));
  test('false for read (REFUSAL)',   () => expect(isListOwner({ access: 'read' })).toBe(false));
  test('false for null list',        () => expect(isListOwner(null)).toBe(false));
  test('false for undefined list',   () => expect(isListOwner(undefined)).toBe(false));
  test('false for missing access',   () => expect(isListOwner({})).toBe(false));
});

// ── canWriteList ─────────────────────────────────────────────────────────

describe('canWriteList', () => {
  test('true for owner (ADMISSION)',  () => expect(canWriteList({ access: 'owner' })).toBe(true));
  test('true for write (ADMISSION)',  () => expect(canWriteList({ access: 'write' })).toBe(true));
  test('false for read (REFUSAL)',    () => expect(canWriteList({ access: 'read' })).toBe(false));
  test('false for null list',         () => expect(canWriteList(null)).toBe(false));
  test('false for undefined list',    () => expect(canWriteList(undefined)).toBe(false));
  test('false for missing access',    () => expect(canWriteList({})).toBe(false));
});

// ── isSharedList ─────────────────────────────────────────────────────────

describe('isSharedList', () => {
  test('false for owner',            () => expect(isSharedList({ access: 'owner' })).toBe(false));
  test('true for write (ADMISSION)', () => expect(isSharedList({ access: 'write' })).toBe(true));
  test('true for read (ADMISSION)',  () => expect(isSharedList({ access: 'read' })).toBe(true));
  test('false for null list',        () => expect(isSharedList(null)).toBe(false));
  test('false for missing access',   () => expect(isSharedList({})).toBe(false));
});

// ── shareLabel ───────────────────────────────────────────────────────────

describe('shareLabel', () => {
  test('null for owned list',           () => expect(shareLabel({ access: 'owner' })).toBeNull());
  test('"Shared (write)" for write',    () => expect(shareLabel({ access: 'write' })).toBe('Shared (write)'));
  test('"Shared (read)" for read',      () => expect(shareLabel({ access: 'read' })).toBe('Shared (read)'));
  test('null for null list',            () => expect(shareLabel(null)).toBeNull());
  test('null for missing access',       () => expect(shareLabel({})).toBeNull());
});
