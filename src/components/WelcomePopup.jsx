import { useEffect, useRef } from 'react';

const STEPS = [
  {
    icon: '🔑',
    title: 'Add connections to your bank accounts',
    text: 'Visit the SimpleFin Bridge website (https://beta-bridge.simplefin.org/), add connections to your bank accounts.',
  },
  {
    icon: '🔌',
    title: 'Create a new token',
    text: 'Create a new token on the SimpleFin Bridge website, and copy to your clipboard.',
  },
  {
    icon: '⏳',
    title: 'Wait for the first sync',
    text: 'Simple Finance Client will automatically fetch your accounts and recent transactions.',
  },
  {
    icon: '🏷️',
    title: 'Categorize transactions',
    text: 'Head to Transactions to categorize spending and see your dashboard come alive.',
  },
];

// Onboarding popup for new users with no bank connections. Two dismiss paths:
//   - × / Escape / backdrop click → transient close (will reappear next visit)
//   - "Don't show this again" → permanent close (sets localStorage flag)
export default function WelcomePopup({ isOpen, onClose, onDismissForever }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (isOpen) dialogRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (isOpen && e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleSetup = () => {
    window.location.hash = '#/connections';
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="modal welcome-modal"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
      >
        <button
          className="welcome-close"
          onClick={onClose}
          aria-label="Close welcome guide"
          title="Close"
        >
          ×
        </button>

        <h2 id="welcome-title">Welcome to Simple Finance Client</h2>
        <p className="welcome-subtitle">
          Let&apos;s get your first bank connection set up in four simple steps.
        </p>

        <ol className="welcome-steps">
          {STEPS.map((step, i) => (
            <li key={i} className="welcome-step">
              <span className="welcome-step-number">{i + 1}</span>
              <div className="welcome-step-content">
                <div className="welcome-step-title">
                  <span>{step.icon}</span>
                  <span>{step.title}</span>
                </div>
                <div className="welcome-step-text">{step.text}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="modal-actions welcome-actions">
          <button
            type="button"
            className="welcome-dismiss"
            onClick={onDismissForever}
          >
            Don&apos;t show this again
          </button>
          <button type="button" className="primary" onClick={handleSetup}>
            Set up a connection
          </button>
        </div>
      </div>
    </div>
  );
}
