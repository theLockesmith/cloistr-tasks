import React, { useState, useEffect } from 'react';
import renderMarkdown from '../lib/renderMarkdown';
import { priorityColor, dueLabel } from '../lib/cardFace';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * Read-only view of a public board for anyone, signed in or not (TASKS-49).
 *
 * Mounted by App outside the auth providers, so it never waits on a signer
 * or shows the login prompt. The request is sent without credentials so a
 * signed-in member sees exactly what a stranger sees: the server's
 * signed-out view, which names no people and carries no timestamps.
 */
function PublicBoardView({ boardId }) {
  const [state, setState] = useState({ status: 'loading', board: null, columns: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/public/boards/${boardId}`, { credentials: 'omit' });
        if (cancelled) return;
        if (res.status === 404) return setState({ status: 'missing', board: null, columns: [] });
        if (!res.ok) return setState({ status: 'error', board: null, columns: [] });
        const data = await res.json();
        if (cancelled) return;
        document.title = data.board.name + ' · Tasks';
        setState({ status: 'ready', board: data.board, columns: data.columns || [] });
      } catch {
        if (!cancelled) setState({ status: 'error', board: null, columns: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [boardId]);

  if (state.status === 'loading') {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading board...</p>
        </div>
      </div>
    );
  }

  if (state.status !== 'ready') {
    return (
      <div className="app public-board-page">
        <div className="public-board-message">
          <h2>{state.status === 'missing' ? 'Board not available' : 'Could not load this board'}</h2>
          <p>
            {state.status === 'missing'
              ? 'This board does not exist, or its owner has not made it public.'
              : 'Something went wrong loading the board. Try again in a moment.'}
          </p>
          <a className="btn btn-primary" href="/">Open Tasks</a>
        </div>
      </div>
    );
  }

  return (
    <div className="app public-board-page">
      <header className="public-board-header">
        <h1>{state.board.name}</h1>
        <span className="public-board-badge">Public board · read only</span>
        <a className="btn btn-secondary btn-small" href="/">Open Tasks</a>
      </header>
      <div className="board-container">
        {state.columns.map(column => (
          <section key={column.id} className="board-column" aria-label={column.name}>
            <div className="board-column-header" style={{ borderTopColor: column.color || 'var(--primary)' }}>
              <h3>{column.name}</h3>
              <span className="board-column-count">({column.cards.length})</span>
            </div>
            <div className="board-column-cards">
              {column.cards.map(card => (
                <PublicCard key={card.id} card={card} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function PublicCard({ card }) {
  const due = dueLabel(card.due_date);
  const face = (
    <>
      <div className="board-card-title">{card.title}</div>
      <div className="board-card-meta">
        {card.priority && card.priority <= 5 && (
          <span className="board-card-priority" style={{ color: priorityColor(card.priority) }}>
            P{card.priority}
          </span>
        )}
        {due && (
          <span className={'board-card-due board-card-due-' + due.level} style={{ color: due.color }} title={'Due ' + due.text}>
            <span className="board-card-due-dot" style={{ backgroundColor: due.color }} />
            {due.text}
          </span>
        )}
      </div>
      {card.checklist && (
        <span className="board-card-checklist-badge">
          {card.checklist.done}/{card.checklist.total}
        </span>
      )}
      {card.tags.length > 0 && (
        <div className="board-card-tags">
          {card.tags.map(tag => (
            <span key={tag.name} className="board-card-tag-pill" style={{ backgroundColor: tag.color || '#6b7280' }}>
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </>
  );

  if (!card.description) return <div className="board-card public-board-card">{face}</div>;

  return (
    <details className="board-card public-board-card">
      <summary>{face}</summary>
      <div
        className="public-board-card-description md-rendered"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(card.description) }}
      />
    </details>
  );
}

export default PublicBoardView;
