/**
 * LokkedIn Background Service Worker (Manifest V3).
 *
 * - Authenticates silently in the background (uses `dev:<id>` on localhost:8000,
 *   or `chrome.identity.getAuthToken()` on Cloud Run).
 * - Automatically classifies & organizes tabs into Green ("Focus") and Red ("Break")
 *   Chrome Tab Groups when `auto_organize` is enabled.
 * - Ignores pinned tabs and internal browser URLs completely.
 * - Exposes message handlers for the popup UI.
 */

import {
  analyzeAndOrganizeCurrentWindow,
  analyzeTabs,
  checkHealth,
  clearUserCache,
  getAnalyzableTabs,
  getAuthToken,
  getMe,
  getSettings,
  isIgnorableTab,
  organizeTabsIntoGroups,
  saveSettings,
} from './api/lokkedin.js';

// Per-tab debounce timers & last-classified URL tracker to prevent duplicate calls
const pendingTabTimers = new Map();
const lastAnalyzedTabUrl = new Map();

// ---------------------------------------------------------------------------
// Lifecycle & Silent Auth Warmup
// ---------------------------------------------------------------------------

async function warmupBackgroundSession() {
  try {
    const settings = await getSettings();
    await saveSettings(settings); // Ensure defaults are persisted
    const token = await getAuthToken({ interactive: false });
    const me = await getMe({ interactiveAuth: false });
    console.log('[LokkedIn Background] Session ready:', {
      user_id: me.user_id,
      cache_entries: me.cache_entries,
      token_prefix: token.slice(0, 8),
    });
  } catch (err) {
    console.debug('[LokkedIn Background] Warmup skipped (backend offline or not signed in yet):', err.message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  warmupBackgroundSession();
});

chrome.runtime.onStartup.addListener(() => {
  warmupBackgroundSession();
});

// ---------------------------------------------------------------------------
// Automatic Background Tab Classification & Grouping (when auto_organize=true)
// ---------------------------------------------------------------------------

async function analyzeAndGroupSingleTab(tab) {
  if (isIgnorableTab(tab)) {
    return;
  }

  const settings = await getSettings();
  if (!settings.auto_organize) {
    return;
  }

  const currentKey = `${settings.target_topic}|${tab.url}`;
  if (lastAnalyzedTabUrl.get(tab.id) === currentKey) {
    return;
  }

  try {
    const result = await analyzeTabs([tab], settings, { interactiveAuth: false });
    if (result.tabs && result.tabs.length > 0) {
      lastAnalyzedTabUrl.set(tab.id, currentKey);
      await organizeTabsIntoGroups(result.tabs, settings);
    }
  } catch (err) {
    console.warn('[LokkedIn Background] Auto-analyze failed for tab:', tab.url, err.message);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Trigger only when page finishes loading or URL changes and tab is not pinned/internal
  if (changeInfo.status !== 'complete' && !changeInfo.url) {
    return;
  }
  if (isIgnorableTab(tab)) {
    return;
  }

  if (pendingTabTimers.has(tabId)) {
    clearTimeout(pendingTabTimers.get(tabId));
  }

  const timerId = setTimeout(() => {
    pendingTabTimers.delete(tabId);
    analyzeAndGroupSingleTab(tab);
  }, 600);

  pendingTabTimers.set(tabId, timerId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (pendingTabTimers.has(tabId)) {
    clearTimeout(pendingTabTimers.get(tabId));
    pendingTabTimers.delete(tabId);
  }
  lastAnalyzedTabUrl.delete(tabId);
});

// ---------------------------------------------------------------------------
// Message Passing API for Popup / UI Teammate
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }

  (async () => {
    switch (message.type) {
      case 'LOKKEDIN_ANALYZE_AND_GROUP': {
        const overrides = message.payload || {};
        if (Object.keys(overrides).length > 0) {
          await saveSettings(overrides);
        }
        const data = await analyzeAndOrganizeCurrentWindow(overrides, {
          interactiveAuth: true,
          windowId: overrides.windowId ?? chrome.windows.WINDOW_ID_CURRENT,
        });
        sendResponse({ ok: true, data });
        break;
      }

      case 'LOKKEDIN_ANALYZE_ONLY': {
        const overrides = message.payload || {};
        const tabs = await getAnalyzableTabs(
          overrides.windowId ?? chrome.windows.WINDOW_ID_CURRENT
        );
        const data = await analyzeTabs(tabs, overrides, { interactiveAuth: true });
        sendResponse({ ok: true, data });
        break;
      }

      case 'LOKKEDIN_GET_SETTINGS': {
        const data = await getSettings();
        sendResponse({ ok: true, data });
        break;
      }

      case 'LOKKEDIN_SAVE_SETTINGS': {
        const updated = await saveSettings(message.payload || {});
        // Clear per-tab URL dedup map if target_topic changed
        lastAnalyzedTabUrl.clear();
        sendResponse({ ok: true, data: updated });
        break;
      }

      case 'LOKKEDIN_GET_STATUS': {
        const [settings, health, me] = await Promise.all([
          getSettings(),
          checkHealth().catch((e) => ({ status: 'offline', error: e.message })),
          getMe({ interactiveAuth: false }).catch((e) => ({ error: e.message })),
        ]);
        sendResponse({ ok: true, data: { settings, health, me } });
        break;
      }

      case 'LOKKEDIN_CLEAR_CACHE': {
        const data = await clearUserCache({ interactiveAuth: true });
        lastAnalyzedTabUrl.clear();
        sendResponse({ ok: true, data });
        break;
      }

      default:
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    }
  })().catch((err) => {
    console.error('[LokkedIn Background] Error handling message:', message.type, err);
    sendResponse({ ok: false, error: err?.message || String(err) });
  });

  // Return true to keep the message channel open for async sendResponse
  return true;
});
