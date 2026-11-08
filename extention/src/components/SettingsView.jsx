import { useEffect, useState } from 'react';

function formatMinutesOrTime(sec) {
  const safe = Math.max(60, Math.floor(sec || 1800));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return secs === 0
    ? `${String(mins).padStart(2, '0')}:00`
    : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function parseDurationToSeconds(val, fallbackSec = 1800) {
  const clean = String(val || '').trim();
  if (/^\d+$/.test(clean)) {
    return Math.max(1, Math.min(240, parseInt(clean, 10))) * 60;
  }
  if (/^\d{1,3}:\d{1,2}$/.test(clean)) {
    const [m, s] = clean.split(':').map((n) => parseInt(n, 10));
    return Math.max(30, m * 60 + s);
  }
  return fallbackSec;
}

export default function SettingsView({
  settings,
  onSaveAndApplyColors,
  onResetToDefault,
}) {
  const [darkMode, setDarkMode] = useState(Boolean(settings?.darkMode));
  const [dyslexicFont, setDyslexicFont] = useState(Boolean(settings?.dyslexicFont));
  const [fontSize, setFontSize] = useState(settings?.fontSize || 'medium');
  const [focusTabColor, setFocusTabColor] = useState(
    settings?.focusTabColor || '#238B45'
  );
  const [breakTabColor, setBreakTabColor] = useState(
    settings?.breakTabColor || '#ff0000'
  );
  const [longBreakEnabled, setLongBreakEnabled] = useState(
    Boolean(settings?.longBreakEnabled)
  );
  const [longBreakDurationText, setLongBreakDurationText] = useState(
    formatMinutesOrTime(settings?.longBreakDurationSec ?? 1800)
  );
  const [longBreakInterval, setLongBreakInterval] = useState(
    settings?.longBreakInterval ?? 4
  );
  const [savedNotice, setSavedNotice] = useState('');

  useEffect(() => {
    setDarkMode(Boolean(settings?.darkMode));
    setDyslexicFont(Boolean(settings?.dyslexicFont));
    setFontSize(settings?.fontSize || 'medium');
    setFocusTabColor(settings?.focusTabColor || '#238B45');
    setBreakTabColor(settings?.breakTabColor || '#ff0000');
    setLongBreakEnabled(Boolean(settings?.longBreakEnabled));
    setLongBreakDurationText(
      formatMinutesOrTime(settings?.longBreakDurationSec ?? 1800)
    );
    setLongBreakInterval(settings?.longBreakInterval ?? 4);
  }, [settings]);

  const handleSaveButton = async () => {
    const parsedLongBreakSec = parseDurationToSeconds(longBreakDurationText, 1800);
    const parsedInterval = Math.max(1, Math.min(50, parseInt(longBreakInterval, 10) || 4));
    await onSaveAndApplyColors({
      darkMode,
      dyslexicFont,
      fontSize,
      focusTabColor,
      breakTabColor,
      longBreakEnabled,
      longBreakDurationSec: parsedLongBreakSec,
      longBreakInterval: parsedInterval,
    });
    setLongBreakDurationText(formatMinutesOrTime(parsedLongBreakSec));
    setLongBreakInterval(parsedInterval);
    setSavedNotice('Saved!');
    setTimeout(() => setSavedNotice(''), 1800);
  };

  const handleResetButton = async () => {
    await onResetToDefault();
    setSavedNotice('Reset to Default!');
    setTimeout(() => setSavedNotice(''), 1800);
  };

  return (
    <>
      <header className="section-header">Accessibility</header>
      <input
        type="checkbox"
        id="darkmode"
        name="dark mode"
        checked={darkMode}
        onChange={(e) => setDarkMode(e.target.checked)}
        className="checkbox"
      />
      <label htmlFor="darkmode">Dark Mode</label> <br />

      <input
        type="checkbox"
        id="dyslexicfont"
        name="Dyslexic Font"
        checked={dyslexicFont}
        onChange={(e) => setDyslexicFont(e.target.checked)}
        className="checkbox"
      />
      <label htmlFor="dyslexicfont">Dyslexic Font</label> <br />

      <header className="section-header">Font Size</header>
      <input
        type="radio"
        id="small"
        name="FontSize"
        value="small"
        checked={fontSize === 'small'}
        onChange={(e) => setFontSize(e.target.value)}
      />
      <label htmlFor="small">Small</label>{' '}
      <input
        type="radio"
        id="medium"
        name="FontSize"
        value="medium"
        checked={fontSize === 'medium'}
        onChange={(e) => setFontSize(e.target.value)}
      />
      <label htmlFor="medium">Medium</label>{' '}
      <input
        type="radio"
        id="large"
        name="FontSize"
        value="large"
        checked={fontSize === 'large'}
        onChange={(e) => setFontSize(e.target.value)}
      />
      <label htmlFor="large">Large</label>

      <header className="section-header">Tab Customization</header>
      <label htmlFor="focustabcolor">Focus Tab Color:</label>{' '}
      <input
        type="color"
        id="focustabcolor"
        name="focustabcolor"
        value={focusTabColor}
        onChange={(e) => setFocusTabColor(e.target.value)}
        className="checkbox"
      />
      <br />

      <label htmlFor="breaktabcolor">Break Tab Color:</label>{' '}
      <input
        type="color"
        id="breaktabcolor"
        name="breaktabcolor"
        value={breakTabColor}
        onChange={(e) => setBreakTabColor(e.target.value)}
      />
      <br />

      <header className="section-header">Long Break</header>
      <input
        type="checkbox"
        id="longbreak"
        name="longbreak"
        checked={longBreakEnabled}
        onChange={(e) => setLongBreakEnabled(e.target.checked)}
        className="checkbox"
      />
      <label htmlFor="longbreak">Long Break</label> <br />

      <label htmlFor="longbreakduration">Long Break Duration:</label>
      <input
        type="text"
        id="longbreakduration"
        className="settings-input"
        value={longBreakDurationText}
        onChange={(e) => setLongBreakDurationText(e.target.value)}
        placeholder="30:00"
      />
      <br />

      <label htmlFor="longbreakcycles">Long Break per (X) cycles:</label>
      <input
        type="number"
        id="longbreakcycles"
        min="1"
        max="50"
        className="settings-input"
        value={longBreakInterval}
        onChange={(e) => setLongBreakInterval(e.target.value)}
      />
      <br />

      <button className="savebutton" onClick={handleSaveButton}>
        Save Settings
      </button>
      <button className="savebutton" onClick={handleResetButton}>
        Reset to Default
      </button>
      {savedNotice ? (
        <span style={{ fontWeight: 'bold' }}>{savedNotice}</span>
      ) : null}
    </>
  );
}
