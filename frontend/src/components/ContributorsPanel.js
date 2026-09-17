import React, { useState, useEffect } from 'react';
import { formatPubkey, parsePubkeyInput } from '../lib/pubkeyDisplay';

function ContributorsPanel({ listId, access, apiCall, user }) {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newPubkey, setNewPubkey] = useState('');
  const [newPermission, setNewPermission] = useState('write');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  const isOwner = access === 'owner';
  const canAdmin = access === 'owner' || access === 'admin';

  useEffect(() => {
    loadShares();
  }, [listId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadShares = async () => {
    try {
      const res = await apiCall('/lists/' + listId + '/shares');
      if (res.ok) {
        setShares(await res.json());
      }
    } catch (e) {
      console.error('Error loading shares:', e);
    } finally {
      setLoading(false);
    }
  };

  const addContributor = async (e) => {
    e.preventDefault();
    setError(null);
    const hex = parsePubkeyInput(newPubkey);
    if (!hex) {
      setError('Enter a valid hex pubkey or npub address.');
      return;
    }
    if (hex === user?.pubkey || hex === user?.id) {
      setError('Cannot share with yourself.');
      return;
    }

    setAdding(true);
    try {
      const res = await apiCall('/lists/' + listId + '/shares', {
        method: 'POST',
        body: JSON.stringify({ pubkey: hex, permission: newPermission }),
      });
      if (res.ok) {
        setNewPubkey('');
        await loadShares();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to add contributor');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setAdding(false);
    }
  };

  const updatePermission = async (pubkey, permission) => {
    try {
      const res = await apiCall('/lists/' + listId + '/shares', {
        method: 'POST',
        body: JSON.stringify({ pubkey, permission }),
      });
      if (res.ok) await loadShares();
    } catch (e) {
      console.error('Error updating permission:', e);
    }
  };

  const removeContributor = async (pubkey) => {
    if (!window.confirm('Remove this contributor? They will lose access to the board.')) return;
    try {
      const res = await apiCall('/lists/' + listId + '/shares/' + pubkey, {
        method: 'DELETE',
      });
      if (res.ok || res.status === 204) {
        setShares(prev => prev.filter(s => s.pubkey !== pubkey));
      }
    } catch (e) {
      console.error('Error removing share:', e);
    }
  };

  const permLabel = (p) => {
    if (p === 'read') return 'Read';
    if (p === 'write') return 'Write';
    if (p === 'admin') return 'Admin';
    return p;
  };

  if (!canAdmin) return null;

  return (
    <div className="contributors-panel">
      <h4>Contributors</h4>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading...</p>
      ) : shares.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontStyle: 'italic' }}>
          No contributors yet. Add someone by their Nostr pubkey or npub.
        </p>
      ) : (
        <div className="contributors-list">
          {shares.map(share => (
            <div key={share.id} className="contributor-row">
              <span className="contributor-pubkey" title={share.pubkey}>
                {formatPubkey(share.pubkey)}
              </span>
              {canAdmin ? (
                <select
                  className="contributor-perm-select"
                  value={share.permission}
                  onChange={(e) => updatePermission(share.pubkey, e.target.value)}
                  disabled={share.permission === 'admin' && !isOwner}
                >
                  <option value="read">Read</option>
                  <option value="write">Write</option>
                  {isOwner && <option value="admin">Admin</option>}
                </select>
              ) : (
                <span className="contributor-perm-label">{permLabel(share.permission)}</span>
              )}
              {canAdmin && (
                <button
                  className="btn btn-danger btn-small contributor-remove"
                  onClick={() => removeContributor(share.pubkey)}
                  disabled={share.permission === 'admin' && !isOwner}
                  title="Remove contributor"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canAdmin && (
        <form className="contributor-add-form" onSubmit={addContributor}>
          <input
            type="text"
            placeholder="Pubkey (hex or npub1...)"
            value={newPubkey}
            onChange={(e) => { setNewPubkey(e.target.value); setError(null); }}
            style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.85rem' }}
          />
          <select
            value={newPermission}
            onChange={(e) => setNewPermission(e.target.value)}
            className="contributor-perm-select"
          >
            <option value="read">Read</option>
            <option value="write">Write</option>
            {isOwner && <option value="admin">Admin</option>}
          </select>
          <button
            type="submit"
            className="btn btn-primary btn-small"
            disabled={adding || !newPubkey.trim()}
          >
            {adding ? '...' : 'Add'}
          </button>
        </form>
      )}

      {error && (
        <p style={{ color: 'var(--danger, #ef4444)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
          {error}
        </p>
      )}
    </div>
  );
}

export default ContributorsPanel;
