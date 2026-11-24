/**
 * What a card's face shows for priority and due date. Shared by the board
 * (BoardView) and the signed-out public board page (PublicBoardView).
 */

export function priorityColor(p) {
  if (p <= 1) return 'var(--error)';
  if (p <= 3) return 'var(--warning)';
  if (p <= 5) return '#eab308';
  return 'var(--text-secondary)';
}

// Due-date indicator for the card face: overdue = red, due within the
// next 3 days = amber, further out = subtle gray. Compares whole
// calendar days (local midnight to local midnight) so "diff" isn't
// thrown off by the time of day the check happens to run at.
export function dueLabel(d, now = new Date()) {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  const due = new Date(y, m - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((due - today) / (1000 * 60 * 60 * 24));

  if (diff < 0) return { text: 'Overdue', color: 'var(--error)', level: 'overdue' };
  if (diff <= 3) {
    const text = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { text, color: 'var(--warning)', level: 'soon' };
  }
  return { text: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), color: 'var(--text-secondary)', level: 'later' };
}
