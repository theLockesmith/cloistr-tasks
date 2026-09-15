/**
 * renderMarkdown unit tests.
 *
 * The renderer escapes HTML (security: no raw HTML), then converts markdown
 * syntax to safe HTML. Verifies escaping, formatting, links, and URL sanitisation.
 */

import renderMarkdown from '../lib/renderMarkdown';

describe('renderMarkdown', () => {
  test('returns empty string for falsy input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
  });

  test('escapes HTML tags', () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  test('renders bold with **', () => {
    const result = renderMarkdown('**bold text**');
    expect(result).toContain('<strong>bold text</strong>');
  });

  test('renders italic with *', () => {
    const result = renderMarkdown('*italic text*');
    expect(result).toContain('<em>italic text</em>');
  });

  test('renders bold+italic with ***', () => {
    const result = renderMarkdown('***bold italic***');
    expect(result).toContain('<strong><em>bold italic</em></strong>');
  });

  test('renders inline code with backticks', () => {
    const result = renderMarkdown('use `npm install` here');
    expect(result).toContain('<code class="md-code-inline">npm install</code>');
  });

  test('renders fenced code blocks', () => {
    const result = renderMarkdown('```\nconst x = 1;\n```');
    expect(result).toContain('<pre class="md-code-block"><code>');
    expect(result).toContain('const x = 1;');
  });

  test('renders strikethrough with ~~', () => {
    const result = renderMarkdown('~~deleted~~');
    expect(result).toContain('<del>deleted</del>');
  });

  test('renders links with safe URLs', () => {
    const result = renderMarkdown('[example](https://example.com)');
    expect(result).toContain('href="https://example.com/"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('>example</a>');
  });

  test('strips javascript: URLs from links', () => {
    const result = renderMarkdown('[click](javascript:alert(1))');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('click');
    expect(result).not.toContain('<a');
  });

  test('strips data: URLs from links', () => {
    const result = renderMarkdown('[click](data:text/html,<h1>hi</h1>)');
    expect(result).not.toContain('data:');
    expect(result).not.toContain('<a');
  });

  test('converts double newlines to paragraph breaks', () => {
    const result = renderMarkdown('first\n\nsecond');
    expect(result).toContain('<p>first</p>');
    expect(result).toContain('<p>second</p>');
  });

  test('converts single newlines to <br>', () => {
    const result = renderMarkdown('line one\nline two');
    expect(result).toContain('line one<br>line two');
  });

  test('escapes & < > " characters', () => {
    const result = renderMarkdown('a & b < c > d "e"');
    expect(result).toContain('&amp;');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
    expect(result).toContain('&quot;');
  });
});
