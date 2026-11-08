function resolveAssetUrl(relativePath) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(relativePath);
  }
  return relativePath;
}

export default function PopupNotification({ title, message, actions = [] }) {
  const logoSrc = resolveAssetUrl('images/LokkedIn-removebg-preview 1.png');

  return (
    <div className="modal-overlay">
      <div className="popup-notification">
        <div className="popup-header">
          <img src={logoSrc} alt="LokkedIn" />
          <div className="popup-title">
            <header>{title}</header>
          </div>
        </div>

        <main className="content">
          <header className="popup-text">{message}</header>
          {actions.length > 0 && (
            <div className="popup-actions">
              {actions.map((action, idx) => (
                <button
                  key={idx}
                  className={action.danger ? 'end-button' : ''}
                  onClick={action.onClick}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
