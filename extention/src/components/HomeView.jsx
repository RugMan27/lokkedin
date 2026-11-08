import { useState } from 'react';
import { computeNextBreakDurationSec } from '../api/lokkedin.js';
import PopupNotification from './PopupNotification.jsx';

function formatTime(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const mins = String(Math.floor(safe / 60)).padStart(2, '0');
  const secs = String(safe % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function parseTimeInput(value, fallbackSec) {
  const clean = value.trim();
  if (/^\d+$/.test(clean)) {
    const mins = Math.max(1, Math.min(180, parseInt(clean, 10)));
    return mins * 60;
  }
  if (/^\d{1,3}:\d{1,2}$/.test(clean)) {
    const [m, s] = clean.split(':').map((n) => parseInt(n, 10));
    return Math.max(5, m * 60 + s);
  }
  return fallbackSec;
}

export default function HomeView({
  tabs,
  timer,
  settings,
  isAnalyzing,
  statusText,
  onStartOrPause,
  onEnd,
  onConfirmNextCycle,
  onUpdateDurations,
}) {
  const [editingFocus, setEditingFocus] = useState(null);
  const [editingBreak, setEditingBreak] = useState(null);
  const [showNextCycleModal, setShowNextCycleModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);

  const focusColor = settings?.focusTabColor || '#238B45';
  const breakColor = settings?.breakTabColor || '#ff0000';

  const upcomingFocusCount = (timer.focusCount || 0) + 1;
  const upcomingBreakSec = computeNextBreakDurationSec(
    settings,
    timer,
    upcomingFocusCount
  );

  const focusDisplaySec =
    timer.mode === 'focus' ? timer.remainingSec : timer.focusDurationSec;
  const breakDisplaySec =
    timer.mode === 'break' ? timer.remainingSec : upcomingBreakSec;

  const commitFocusDuration = () => {
    if (editingFocus === null) return;
    const nextSec = parseTimeInput(editingFocus, timer.focusDurationSec);
    setEditingFocus(null);
    onUpdateDurations(nextSec, timer.breakDurationSec);
  };

  const commitBreakDuration = () => {
    if (editingBreak === null) return;
    const nextSec = parseTimeInput(editingBreak, timer.breakDurationSec);
    setEditingBreak(null);
    onUpdateDurations(timer.focusDurationSec, nextSec);
  };

  const primaryButtonLabel = !timer.isRunning
    ? 'Start'
    : timer.isPaused
    ? 'Unpause'
    : 'Pause';

  return (
    <>
      <div className="horizontal-container">
        <header>
          Active Tabs ({tabs.length})
          {isAnalyzing ? ' - Sorting...' : statusText ? ` - ${statusText}` : ''}
        </header>
      </div>

      <div className="active-tabs">
        {tabs.length === 0 ? (
          <div style={{ textAlign: 'center', opacity: 0.7 }}>No active tabs</div>
        ) : (
          tabs.map((tab, idx) => {
            const badgeColor =
              tab.category === 'F'
                ? focusColor
                : tab.category === 'B'
                ? breakColor
                : '#71717a';
            const badgeLabel =
              tab.category === 'F'
                ? 'Focus'
                : tab.category === 'B'
                ? 'Break'
                : 'Unclassified';

            return (
              <div
                key={tab.id || `${tab.url}-${idx}`}
                className="tab-row"
                onClick={() => {
                  if (typeof chrome !== 'undefined' && chrome.tabs?.update && tab.id) {
                    chrome.tabs.update(tab.id, { active: true });
                  }
                }}
                style={{ cursor: tab.id ? 'pointer' : 'default' }}
                title={tab.url}
              >
                <span className="tab-row-title">{tab.title || tab.url || 'Untitled'}</span>
                <span className="tab-badge" style={{ backgroundColor: badgeColor }}>
                  {badgeLabel}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="horizontal-container">
        <header>Focus Timer</header>
        <header>Break Timer</header>
      </div>

      <div className="horizontal-container">
        <div
          className="timer"
          style={{
            borderColor: timer.mode === 'focus' && timer.isRunning ? focusColor : undefined,
          }}
        >
          {!timer.isRunning ? (
            <input
              type="text"
              value={editingFocus !== null ? editingFocus : formatTime(focusDisplaySec)}
              onFocus={() => setEditingFocus(formatTime(focusDisplaySec))}
              onChange={(e) => setEditingFocus(e.target.value)}
              onBlur={commitFocusDuration}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              title="Click to edit Focus time (MM:SS or minutes)"
            />
          ) : (
            formatTime(focusDisplaySec)
          )}
        </div>

        <div
          className="timer"
          style={{
            borderColor: timer.mode === 'break' && timer.isRunning ? breakColor : undefined,
          }}
        >
          {!timer.isRunning ? (
            <input
              type="text"
              value={editingBreak !== null ? editingBreak : formatTime(breakDisplaySec)}
              onFocus={() => setEditingBreak(formatTime(timer.breakDurationSec))}
              onChange={(e) => setEditingBreak(e.target.value)}
              onBlur={commitBreakDuration}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              title="Click to edit Break time (MM:SS or minutes)"
            />
          ) : (
            formatTime(breakDisplaySec)
          )}
        </div>
      </div>

      <div className="horizontal-container">
        <button onClick={onStartOrPause}>{primaryButtonLabel}</button>
        <button className="end-button" onClick={() => setShowEndModal(true)}>
          END
        </button>
        <button onClick={() => setShowNextCycleModal(true)}>Next Cycle</button>
      </div>

      <div className="cycle-counters">
        <span>Focuses: {timer.focusCount || 0}</span>
        <span>Breaks: {timer.breakCount || 0}</span>
      </div>

      {showEndModal && (
        <PopupNotification
          title="End Session"
          message="Are you sure you want to end your session? This will clear all cycles and reset the timer."
          actions={[
            {
              label: 'END Session',
              danger: true,
              onClick: () => {
                setShowEndModal(false);
                onEnd();
              },
            },
            {
              label: 'Cancel',
              onClick: () => setShowEndModal(false),
            },
          ]}
        />
      )}

      {showNextCycleModal && (
        <PopupNotification
          title="Next Cycle"
          message={
            timer.mode === 'focus'
              ? 'Are you sure you want to move to the Break cycle?'
              : `Move to Focus cycle? Add remaining break time (${formatTime(
                  timer.remainingSec
                )}) to your next Break timer?`
          }
          actions={
            timer.mode === 'focus'
              ? [
                  {
                    label: 'Confirm',
                    onClick: () => {
                      setShowNextCycleModal(false);
                      onConfirmNextCycle({ addRemainingBreak: false });
                    },
                  },
                  {
                    label: 'Cancel',
                    onClick: () => setShowNextCycleModal(false),
                  },
                ]
              : [
                  {
                    label: 'Yes, Add Time',
                    onClick: () => {
                      setShowNextCycleModal(false);
                      onConfirmNextCycle({ addRemainingBreak: true });
                    },
                  },
                  {
                    label: 'No, Normal Break',
                    onClick: () => {
                      setShowNextCycleModal(false);
                      onConfirmNextCycle({ addRemainingBreak: false });
                    },
                  },
                  {
                    label: 'Cancel',
                    onClick: () => setShowNextCycleModal(false),
                  },
                ]
          }
        />
      )}
    </>
  );
}
