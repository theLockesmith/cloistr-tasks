/**
 * Minimal markdown renderer. HTML is escaped (disabled by design).
 * Returns an HTML string safe for dangerouslySetInnerHTML.
 */

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch { /* invalid URL */ }
  return null;
}

export default function renderMarkdown(text) {
  if (!text) return '';

  let html = escapeHtml(text);

  // Fenced code blocks: ```...```
  html = html.replace(/```([\s\S]*?)```/g, (_, code) =>
    '<pre class="md-code-block"><code>' + code.trim() + '</code></pre>'
  );

  // Inline code: `...`
  html = html.replace(/`([^`\n]+)`/g, '<code class="md-code-inline">$1</code>');

  // Bold + italic: ***text*** or ___text___
  html = html.replace(/\*{3}(.+?)\*{3}/g, '<strong><em>$1</em></strong>');
  html = html.replace(/_{3}(.+?)_{3}/g, '<strong><em>$1</em></strong>');

  // Bold: **text** or __text__
  html = html.replace(/\*{2}(.+?)\*{2}/g, '<strong>$1</strong>');
  html = html.replace(/_{2}(.+?)_{2}/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');

  // Strikethrough: ~~text~~
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safe = sanitizeUrl(url);
    if (!safe) return label;
    return '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  });

  // Line breaks (two consecutive newlines = paragraph break, single = <br>)
  html = html
    .split(/\n{2,}/)
    .map(block => '<p>' + block.replace(/\n/g, '<br>') + '</p>')
    .join('');

  return html;
}
