/**
 * AddListModal structural tests.
 *
 * Verifies the list creation form offers all list types and wires them
 * correctly to the backend POST /api/lists endpoint.
 */

import fs from 'fs';
import path from 'path';

const componentPath = path.resolve(
  __dirname, '../components/AddListModal.js',
);
const src = fs.readFileSync(componentPath, 'utf8');

describe('list type options', () => {
  test('offers recurring list type', () => {
    expect(src).toMatch(/value=["']recurring["']/);
  });

  test('offers completion list type', () => {
    expect(src).toMatch(/value=["']completion["']/);
  });

  test('offers board list type', () => {
    expect(src).toMatch(/value=["']board["']/);
  });

  test('board option label mentions Kanban', () => {
    // The user-facing label should make it clear what a board is.
    const boardOption = src.slice(
      src.indexOf("value=\"board\""),
      src.indexOf("value=\"board\"") + 200,
    );
    expect(boardOption).toMatch(/[Kk]anban/);
  });
});

describe('form submission', () => {
  test('sends list_type in the POST body', () => {
    expect(src).toMatch(/list_type:\s*formData\.listType/);
  });

  test('defaults listType to recurring', () => {
    expect(src).toMatch(/listType:\s*['"]recurring['"]/);
  });
});

describe('recurrence fields visibility', () => {
  test('recurrence fields are gated on recurring list type', () => {
    // Reset time/days should only show for recurring lists, not boards.
    expect(src).toMatch(/listType\s*===\s*['"]recurring['"]/);
  });
});

describe('contextual help text', () => {
  test('shows board-specific description when board is selected', () => {
    expect(src).toMatch(/listType\s*===\s*['"]board['"]/);
    expect(src).toMatch(/Kanban board/i);
  });
});
