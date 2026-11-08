import { useCallback, useEffect, useState } from 'react';
import './App.css';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TIMER_STATE,
  STORAGE_KEYS,
  allowSiteForActiveFocusType,
  analyzeAndOrganizeCurrentWindow,
  applyGroupCollapseForMode,
  computeNextBreakDurationSec,
  getAnalyzableTabs,
  getLastAnalysis,
  getPendingBreakPrompt,
  getSettings,
  getTimerState,
  organizeTabsIntoGroups,
  resetSettingsToDefault,
  resolveTabLocally,
  saveSettings,
  saveTimerState,
  sendBackgroundMessage,
  setPendingBreakPrompt,
} from './api/lokkedin.js';
import BaseLayout from './components/BaseLayout.jsx';
import ContactUsView from './components/ContactUsView.jsx';
import FocusTopicView from './components/FocusTopicView.jsx';
import HomeView from './components/HomeView.jsx';
import PopupNotification from './components/PopupNotification.jsx';
import SettingsView from './components/SettingsView.jsx';

export default function App() {
  const [activePage, setActivePage] = useState('home');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [timer, setTimer] = useState(DEFAULT_TIMER_STATE);
  const [tabs, setTabs] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [breakPrompt, setBreakPrompt] = useState(null);

  const refreshTabsWithCategories = useCallback(async (overrideSettings) => {
    const [openTabs, lastResult, currentSettings] = await Promise.all([
      getAnalyzableTabs(),
      getLastAnalysis(),
      overrideSettings ? Promise.resolve(overrideSettings) : getSettings(),
    ]);

    const categoryById = new Map();
    const categoryByUrl = new Map();
    if (lastResult?.tabs) {
      for (const item of lastResult.tabs) {
        if (item?.id && item?.category) {
          categoryById.set(item.id, item.category);
        }
        if (item?.url && item?.category) {
          categoryByUrl.set(item.url, item.category);
        }
      }
    }

    const mapped = await Promise.all(
      openTabs.map(async (t) => {
        let cat = categoryById.get(t.id) || categoryByUrl.get(t.url) || null;
        if (!cat) {
          const localHit = await resolveTabLocally(t, currentSettings);
          if (localHit?.category) {
            cat = localHit.category;
          }
        }
        return {
          id: t.id,
          windowId: t.windowId,
          title: t.title || 'Untitled',
          url: t.url,
          category: cat,
        };
      })
    );

    setTabs(mapped);
  }, []);

  useEffect(() => {
    (async () => {
      const [loadedSettings, loadedTimer, loadedPrompt] = await Promise.all([
        getSettings(),
        getTimerState(),
        getPendingBreakPrompt(),
      ]);
      setSettings(loadedSettings);
      setTimer(loadedTimer);
      setBreakPrompt(loadedPrompt);
      await refreshTabsWithCategories(loadedSettings);
    })();
  }, [refreshTabsWithCategories]);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
      return;
    }
    const listener = (changes) => {
      if (changes[STORAGE_KEYS.SETTINGS]?.newValue) {
        setSettings((prev) => ({ ...prev, ...changes[STORAGE_KEYS.SETTINGS].newValue }));
      }
      if (changes[STORAGE_KEYS.TIMER_STATE]?.newValue) {
        setTimer((prev) => ({ ...prev, ...changes[STORAGE_KEYS.TIMER_STATE].newValue }));
      }
      if (changes[STORAGE_KEYS.LAST_RESULT] || changes[STORAGE_KEYS.LOCAL_TAB_CACHE]) {
        refreshTabsWithCategories();
      }
      if (changes[STORAGE_KEYS.PENDING_BREAK_PROMPT]) {
        setBreakPrompt(changes[STORAGE_KEYS.PENDING_BREAK_PROMPT].newValue || null);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [refreshTabsWithCategories]);

  const syncTimerToBackground = useCallback(async (patch) => {
    const updated = await saveTimerState(patch);
    setTimer(updated);
    sendBackgroundMessage('LOKKEDIN_SYNC_TIMER', updated).catch(() => {});
    return updated;
  }, []);

  const syncModeGroupCollapse = useCallback(async (mode) => {
    try {
      await sendBackgroundMessage('LOKKEDIN_APPLY_MODE_GROUPS', { mode });
    } catch {
      await applyGroupCollapseForMode(mode);
    }
  }, []);

  const runTabSorting = useCallback(
    async (overrideSettings = {}) => {
      setIsAnalyzing(true);
      setStatusText('');
      try {
        try {
          await sendBackgroundMessage('LOKKEDIN_ANALYZE_AND_GROUP', overrideSettings);
        } catch {
          await analyzeAndOrganizeCurrentWindow(overrideSettings);
        }
        await refreshTabsWithCategories();
        setStatusText('Sorted');
      } catch (err) {
        setStatusText(err.message || 'Backend error');
      } finally {
        setIsAnalyzing(false);
      }
    },
    [refreshTabsWithCategories]
  );

  useEffect(() => {
    if (!timer.isRunning || timer.isPaused || !timer.targetEndTime) {
      return;
    }

    const intervalId = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((timer.targetEndTime - Date.now()) / 1000));
      if (remaining <= 0) {
        const finishedFocus = timer.mode === 'focus';
        const nextMode = finishedFocus ? 'break' : 'focus';
        const newFocusCount = (timer.focusCount || 0) + (finishedFocus ? 1 : 0);
        const newBreakCount = (timer.breakCount || 0) + (finishedFocus ? 0 : 1);

        const nextDuration =
          nextMode === 'focus'
            ? timer.focusDurationSec
            : computeNextBreakDurationSec(settings, timer, newFocusCount);

        syncTimerToBackground({
          mode: nextMode,
          isRunning: true,
          isPaused: false,
          remainingSec: nextDuration,
          bonusBreakSec: 0,
          targetEndTime: Date.now() + nextDuration * 1000,
          focusCount: newFocusCount,
          breakCount: newBreakCount,
        });
        saveSettings({ auto_organize: nextMode === 'focus' });
        syncModeGroupCollapse(nextMode);
        if (nextMode === 'focus') {
          runTabSorting();
        }
      } else {
        setTimer((prev) => ({ ...prev, remainingSec: remaining }));
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [timer, settings, syncTimerToBackground, syncModeGroupCollapse, runTabSorting]);

  const handleUpdateSettings = async (patch) => {
    const updated = await saveSettings(patch);
    setSettings(updated);
    sendBackgroundMessage('LOKKEDIN_SAVE_SETTINGS', patch).catch(() => {});
    return updated;
  };

  const handleSaveAndApplyColors = async (patch) => {
    const updated = await handleUpdateSettings(patch);
    const classified = tabs.filter((t) => t.category === 'F' || t.category === 'B');
    if (classified.length > 0) {
      await organizeTabsIntoGroups(classified, updated);
    }
  };

  const handleResetToDefault = async () => {
    const reset = await resetSettingsToDefault();
    setSettings(reset);
    sendBackgroundMessage('LOKKEDIN_SAVE_SETTINGS', reset).catch(() => {});
    const classified = tabs.filter((t) => t.category === 'F' || t.category === 'B');
    if (classified.length > 0) {
      await organizeTabsIntoGroups(classified, reset);
    }
  };

  const handleStartOrPause = async () => {
    if (!timer.isRunning) {
      const hasTopic =
        Array.isArray(settings.focus_topics) &&
        settings.focus_topics.length > 0 &&
        Boolean(settings.target_topic?.trim());

      if (!hasTopic) {
        setActivePage('focustopic');
        return;
      }

      const duration =
        timer.remainingSec > 0
          ? timer.remainingSec
          : timer.mode === 'focus'
          ? timer.focusDurationSec
          : computeNextBreakDurationSec(settings, timer, (timer.focusCount || 0) + 1);

      await syncTimerToBackground({
        isRunning: true,
        isPaused: false,
        remainingSec: duration,
        targetEndTime: Date.now() + duration * 1000,
      });

      if (timer.mode === 'focus') {
        await handleUpdateSettings({ auto_organize: true });
        await runTabSorting();
      } else {
        await syncModeGroupCollapse('break');
      }
      return;
    }

    if (timer.isPaused) {
      await syncTimerToBackground({
        isPaused: false,
        targetEndTime: Date.now() + timer.remainingSec * 1000,
      });
    } else {
      const currentRemaining = timer.targetEndTime
        ? Math.max(0, Math.ceil((timer.targetEndTime - Date.now()) / 1000))
        : timer.remainingSec;
      await syncTimerToBackground({
        isPaused: true,
        remainingSec: currentRemaining,
        targetEndTime: null,
      });
    }
  };

  const handleEnd = async () => {
    await syncTimerToBackground({
      mode: 'focus',
      isRunning: false,
      isPaused: false,
      remainingSec: timer.focusDurationSec,
      bonusBreakSec: 0,
      targetEndTime: null,
      focusCount: 0,
      breakCount: 0,
    });
    await handleUpdateSettings({ auto_organize: false });
    await setPendingBreakPrompt(null);
    setBreakPrompt(null);
    setStatusText('');
  };

  const handleConfirmNextCycle = async ({ addRemainingBreak = false } = {}) => {
    const finishedFocus = timer.mode === 'focus';
    const nextMode = finishedFocus ? 'break' : 'focus';
    const newFocusCount = (timer.focusCount || 0) + (finishedFocus ? 1 : 0);
    const newBreakCount = (timer.breakCount || 0) + (finishedFocus ? 0 : 1);

    const currentRemaining =
      timer.isRunning && !timer.isPaused && timer.targetEndTime
        ? Math.max(0, Math.ceil((timer.targetEndTime - Date.now()) / 1000))
        : timer.remainingSec;

    const nextBonusBreakSec = finishedFocus
      ? 0
      : addRemainingBreak
      ? Math.max(0, currentRemaining)
      : 0;

    const nextDuration =
      nextMode === 'focus'
        ? timer.focusDurationSec
        : computeNextBreakDurationSec(settings, timer, newFocusCount);

    await syncTimerToBackground({
      mode: nextMode,
      remainingSec: nextDuration,
      bonusBreakSec: nextBonusBreakSec,
      targetEndTime:
        timer.isRunning && !timer.isPaused ? Date.now() + nextDuration * 1000 : null,
      focusCount: newFocusCount,
      breakCount: newBreakCount,
    });

    await syncModeGroupCollapse(nextMode);

    if (timer.isRunning) {
      await handleUpdateSettings({ auto_organize: nextMode === 'focus' });
      if (nextMode === 'focus') {
        await runTabSorting();
      }
    }
  };

  const handleUpdateDurations = async (focusDurationSec, breakDurationSec) => {
    const remainingSec =
      timer.mode === 'focus'
        ? focusDurationSec
        : breakDurationSec + (timer.bonusBreakSec || 0);
    await syncTimerToBackground({
      focusDurationSec,
      breakDurationSec,
      remainingSec,
      targetEndTime: null,
    });
  };

  const handleAllowBreakPromptSite = async () => {
    if (!breakPrompt) return;
    try {
      await sendBackgroundMessage('LOKKEDIN_ALLOW_BREAK_SITE', breakPrompt);
    } catch {
      await allowSiteForActiveFocusType(breakPrompt);
    }
    setBreakPrompt(null);
    const updatedSettings = await getSettings();
    setSettings(updatedSettings);
    await refreshTabsWithCategories(updatedSettings);
  };

  const handleDismissBreakPromptSite = async () => {
    if (!breakPrompt) return;
    try {
      await sendBackgroundMessage('LOKKEDIN_DISMISS_BREAK_SITE', breakPrompt);
    } catch {
      await setPendingBreakPrompt(null);
    }
    setBreakPrompt(null);
    await refreshTabsWithCategories();
  };

  return (
    <BaseLayout
      activePage={activePage}
      onNavigate={setActivePage}
      settings={settings}
    >
      {activePage === 'home' && (
        <HomeView
          tabs={tabs}
          timer={timer}
          settings={settings}
          isAnalyzing={isAnalyzing}
          statusText={statusText}
          onStartOrPause={handleStartOrPause}
          onEnd={handleEnd}
          onConfirmNextCycle={handleConfirmNextCycle}
          onUpdateDurations={handleUpdateDurations}
        />
      )}

      {activePage === 'focustopic' && (
        <FocusTopicView
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
        />
      )}

      {activePage === 'settings' && (
        <SettingsView
          settings={settings}
          onSaveAndApplyColors={handleSaveAndApplyColors}
          onResetToDefault={handleResetToDefault}
        />
      )}

      {activePage === 'contactus' && (
        <ContactUsView settings={settings} timer={timer} />
      )}

      {breakPrompt && (
        <PopupNotification
          title="Break Tab Detected"
          message={`Are you supposed to be on ${breakPrompt.host} for "${
            breakPrompt.topicName || 'Focus'
          }"?`}
          actions={[
            {
              label: 'Yes, Safe Site',
              onClick: handleAllowBreakPromptSite,
            },
            {
              label: 'No, Minimize',
              onClick: handleDismissBreakPromptSite,
            },
          ]}
        />
      )}
    </BaseLayout>
  );
}
