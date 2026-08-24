import React from 'react';

// Small coloured pill displaying a label name.
// `onRemove` is optional — when provided a remove button is shown (used in
// edit contexts); when absent the chip is display-only.
function LabelChip({ label, onRemove }) {
  // Darken the label colour slightly for the text so it stays readable on the
  // chip's tinted background.
  const bg = label.color + '28'; // 16% opacity in hex
  return (
    <span
      className="label-chip"
      style={{ backgroundColor: bg, borderColor: label.color, color: label.color }}
    >
      {label.name}
      {onRemove && (
        <button
          type="button"
          className="label-chip-remove"
          onClick={() => onRemove(label)}
          aria-label={'Remove label ' + label.name}
        >
          ×
        </button>
      )}
    </span>
  );
}

export default LabelChip;
