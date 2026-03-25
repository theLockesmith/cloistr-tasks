import React, { useState } from 'react';

const PRESET_ICONS = [
  // Daily routines
  { emoji: '🌅', label: 'Morning' },
  { emoji: '🌙', label: 'Evening' },
  { emoji: '☀️', label: 'Day' },
  { emoji: '🛏️', label: 'Sleep' },
  // Work
  { emoji: '💼', label: 'Work' },
  { emoji: '💻', label: 'Computer' },
  { emoji: '📧', label: 'Email' },
  { emoji: '📊', label: 'Analytics' },
  { emoji: '📝', label: 'Notes' },
  { emoji: '📋', label: 'Checklist' },
  // Health & fitness
  { emoji: '🏃', label: 'Exercise' },
  { emoji: '🧘', label: 'Yoga' },
  { emoji: '💪', label: 'Strength' },
  { emoji: '🥗', label: 'Nutrition' },
  { emoji: '💊', label: 'Medicine' },
  // Home
  { emoji: '🏠', label: 'Home' },
  { emoji: '🧹', label: 'Cleaning' },
  { emoji: '🛒', label: 'Shopping' },
  { emoji: '🍳', label: 'Cooking' },
  // Learning & hobbies
  { emoji: '📚', label: 'Reading' },
  { emoji: '🎯', label: 'Goals' },
  { emoji: '🎨', label: 'Creative' },
  { emoji: '🎵', label: 'Music' },
  // Finance
  { emoji: '💰', label: 'Finance' },
  { emoji: '📈', label: 'Investing' },
  // Social
  { emoji: '👥', label: 'Social' },
  { emoji: '📞', label: 'Calls' },
  // Misc
  { emoji: '⭐', label: 'Important' },
  { emoji: '🔧', label: 'Maintenance' },
  { emoji: '✨', label: 'Misc' }
];

function IconPicker({ value, onChange, color }) {
  const [showPicker, setShowPicker] = useState(false);

  const handleSelect = (emoji) => {
    onChange(emoji);
    setShowPicker(false);
  };

  const displayValue = value || '📋';

  return (
    <div className="icon-picker">
      <label>Icon</label>
      <div className="icon-picker-trigger-container">
        <button
          type="button"
          className="icon-picker-trigger"
          onClick={() => setShowPicker(!showPicker)}
          style={{ backgroundColor: color || 'var(--primary)' }}
        >
          {displayValue}
        </button>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={2}
          className="icon-picker-custom-input"
          aria-label="Custom icon character"
        />
      </div>

      {showPicker && (
        <div className="icon-picker-dropdown">
          <div className="icon-picker-grid">
            {PRESET_ICONS.map(({ emoji, label }) => (
              <button
                key={emoji}
                type="button"
                className={`icon-picker-option ${value === emoji ? 'selected' : ''}`}
                onClick={() => handleSelect(emoji)}
                title={label}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default IconPicker;
