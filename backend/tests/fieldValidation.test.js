/**
 * Structural tests for field-length validation (server.js).
 *
 * WHY SOURCE-LEVEL:
 * The fieldTooLong helper and FIELD_LIMITS constant live inside server.js and
 * are not exported.  Source-level assertions verify that:
 *   1. The helper behaves correctly (extracted and evaluated in isolation).
 *   2. Every create/update route that handles a name or title field calls
 *      fieldTooLong, so new routes cannot silently skip the guard.
 *   3. The SQLSTATE 22001 error handler is present as a belt-and-braces
 *      backstop for any column the per-field guard doesn't cover.
 *   4. Free-text columns (comment body) are intentionally NOT capped, so the
 *      absence of fieldTooLong in those handlers is asserted as a negative.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const serverSrc = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the async handler body for `app.<method>('<routePath>', authenticateToken, ...)`.
 * Returns null if the route is not registered or does not wire authenticateToken.
 */
function extractRouteBody(source, method, routePath) {
  const escapedPath = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = new RegExp(
    `app\\.${method}\\(['"]${escapedPath}['"],\\s*authenticateToken`
  );
  const match = source.match(startPattern);
  if (!match) return null;

  let i = match.index + match[0].length;
  while (i < source.length && source[i] !== '{') i++;
  if (i >= source.length) return null;

  let depth = 0;
  const start = i;
  while (i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
    i++;
  }
  return null;
}

/**
 * Extract the source text of a plain (non-exported) function declaration by
 * name.  Uses the same brace-counting walk as extractExportedFn in
 * boardRoutes.test.js.
 */
function extractFunctionDecl(source, name) {
  const marker = `function ${name}(`;
  const funcIdx = source.indexOf(marker);
  if (funcIdx === -1) return null;

  let i = funcIdx;
  let depth = 0;
  let started = false;
  while (i < source.length) {
    if (source[i] === '{') { depth++; started = true; }
    else if (source[i] === '}') {
      depth--;
      if (started && depth === 0) return source.slice(funcIdx, i + 1);
    }
    i++;
  }
  return null;
}

/**
 * Evaluate the fieldTooLong function in isolation and return a callable.
 * The function has no dependencies — it only uses String() and template
 * literals — so a plain eval() is safe here.
 */
function loadFieldTooLong() {
  const src = extractFunctionDecl(serverSrc, 'fieldTooLong');
  if (!src) throw new Error('fieldTooLong not found in server.js');
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${src}\nreturn fieldTooLong;`);
  return factory();
}

const fieldTooLong = loadFieldTooLong();

// ── 1. fieldTooLong helper — unit tests ───────────────────────────────────

describe('fieldTooLong helper — pure function behaviour', () => {
  test('returns null for a value under the limit', () => {
    expect(fieldTooLong('hello', 'name', 8192)).toBeNull();
  });

  test('returns null for a value exactly at the limit', () => {
    const atLimit = 'x'.repeat(8192);
    expect(fieldTooLong(atLimit, 'name', 8192)).toBeNull();
  });

  test('returns an error object for a value one character over the limit', () => {
    const overLimit = 'x'.repeat(8193);
    const result = fieldTooLong(overLimit, 'name', 8192);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty('field', 'name');
    expect(result).toHaveProperty('limit', 8192);
    expect(result).toHaveProperty('actual', 8193);
  });

  test('error message includes the field name', () => {
    const result = fieldTooLong('x'.repeat(100), 'title', 50);
    expect(result.error).toContain('title');
  });

  test('error message includes the limit', () => {
    const result = fieldTooLong('x'.repeat(100), 'title', 50);
    expect(result.error).toContain('50');
  });

  test('returns null for null value (null is not capped)', () => {
    expect(fieldTooLong(null, 'name', 8192)).toBeNull();
  });

  test('returns null for undefined value', () => {
    expect(fieldTooLong(undefined, 'name', 8192)).toBeNull();
  });

  test('returns null for an empty string (empty is not over-limit)', () => {
    expect(fieldTooLong('', 'name', 8192)).toBeNull();
  });

  test('coerces non-string values to string before measuring length', () => {
    // Number 12345 → "12345" → length 5; limit 3 → error
    const result = fieldTooLong(12345, 'code', 3);
    expect(result).not.toBeNull();
    expect(result.actual).toBe(5);
  });

  test('respects a tighter label_name limit of 2000', () => {
    const justOver = 'a'.repeat(2001);
    const result = fieldTooLong(justOver, 'name', 2000);
    expect(result).not.toBeNull();
    expect(result.limit).toBe(2000);
    expect(result.actual).toBe(2001);
  });

  test('returns null for a label name exactly at 2000 characters', () => {
    expect(fieldTooLong('a'.repeat(2000), 'name', 2000)).toBeNull();
  });
});

// ── 2. FIELD_LIMITS constant ──────────────────────────────────────────────

describe('FIELD_LIMITS constant is defined with the correct values', () => {
  test('name limit is 8192', () => {
    expect(serverSrc).toContain('name: 8192');
  });

  test('title limit is 8192', () => {
    expect(serverSrc).toContain('title: 8192');
  });

  test('label_name limit is 2000', () => {
    expect(serverSrc).toContain('label_name: 2000');
  });
});

// ── 3. Routes with name validation (FIELD_LIMITS.name = 8192) ────────────

describe('name-validated routes call fieldTooLong', () => {
  const nameRoutes = [
    ['post', '/api/lists',                              'POST /api/lists'],
    ['put',  '/api/lists/:listId',                     'PUT /api/lists/:listId'],
    ['post', '/api/lists/:listId/templates',           'POST /api/lists/:listId/templates'],
    ['put',  '/api/templates/:templateId',             'PUT /api/templates/:templateId'],
    ['post', '/api/boards/:listId/columns',            'POST /api/boards/:listId/columns'],
    ['put',  '/api/boards/:listId/columns/:columnId',  'PUT /api/boards/:listId/columns/:columnId'],
  ];

  for (const [method, routePath, label] of nameRoutes) {
    test(`${label} calls fieldTooLong`, () => {
      const body = extractRouteBody(serverSrc, method, routePath);
      expect(body).not.toBeNull();
      expect(body).toContain('fieldTooLong');
    });
  }
});

// ── 4. Routes with title validation (FIELD_LIMITS.title = 8192) ──────────

describe('title-validated routes call fieldTooLong', () => {
  const titleRoutes = [
    ['post', '/api/boards/:listId/cards',          'POST /api/boards/:listId/cards'],
    ['put',  '/api/boards/:listId/cards/:cardId',  'PUT /api/boards/:listId/cards/:cardId'],
  ];

  for (const [method, routePath, label] of titleRoutes) {
    test(`${label} calls fieldTooLong`, () => {
      const body = extractRouteBody(serverSrc, method, routePath);
      expect(body).not.toBeNull();
      expect(body).toContain('fieldTooLong');
    });
  }
});

// ── 5. Routes with label_name validation (FIELD_LIMITS.label_name = 2000) ─

describe('label_name-validated routes call fieldTooLong', () => {
  const labelRoutes = [
    ['post', '/api/labels',           'POST /api/labels'],
    ['put',  '/api/labels/:labelId',  'PUT /api/labels/:labelId'],
  ];

  for (const [method, routePath, label] of labelRoutes) {
    test(`${label} calls fieldTooLong`, () => {
      const body = extractRouteBody(serverSrc, method, routePath);
      expect(body).not.toBeNull();
      expect(body).toContain('fieldTooLong');
    });
  }
});

// ── 6. SQLSTATE 22001 error handler ──────────────────────────────────────

describe('error handling middleware catches SQLSTATE 22001', () => {
  test('error middleware source contains "22001"', () => {
    // The middleware is an app.use() with a 4-arity handler (error, req, res, next).
    // Assert the SQLSTATE code appears in the server source.
    expect(serverSrc).toContain('22001');
  });

  test('error middleware responds with HTTP 400 on 22001', () => {
    // The handler must use status(400), not 500, for truncation errors so the
    // client receives a clear validation signal rather than an opaque server fault.
    const errMiddlewareIdx = serverSrc.indexOf("'22001'");
    expect(errMiddlewareIdx).toBeGreaterThan(-1);
    // Extract a reasonable window after the 22001 check to confirm 400.
    const window = serverSrc.slice(errMiddlewareIdx, errMiddlewareIdx + 200);
    expect(window).toContain('400');
  });
});

// ── 7. Free-text columns are NOT capped (negative test) ──────────────────

describe('comment body routes do NOT call fieldTooLong (body is uncapped)', () => {
  test('POST .../comments does not apply fieldTooLong to body', () => {
    const body = extractRouteBody(
      serverSrc, 'post', '/api/boards/:listId/cards/:cardId/comments'
    );
    expect(body).not.toBeNull();
    // The route validates that body is non-empty, but must NOT cap its length.
    expect(body).not.toContain('fieldTooLong');
  });

  test('PUT .../comments/:commentId does not apply fieldTooLong to body', () => {
    const body = extractRouteBody(
      serverSrc, 'put', '/api/boards/:listId/comments/:commentId'
    );
    expect(body).not.toBeNull();
    expect(body).not.toContain('fieldTooLong');
  });
});
