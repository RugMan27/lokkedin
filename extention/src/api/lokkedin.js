/**
 * LokkedIn Non-UI API, Auth, Storage, and Chrome Tab Grouping Client.
 *
 * - Uses `http://localhost:8000` by default (with automatic `Bearer dev:<id>` token).
 * - Automatically switches to `chrome.identity.getAuthToken()` when pointed at a Cloud Run URL.
 * - Ignores pinned tabs and internal browser URLs (`chrome://`, `about:`, etc.).
 * - Groups Focus ('F') tabs into a green "Focus" Chrome Tab Group and Break ('B') tabs into a red "Break" group.
 */

export const DEFAULT_API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
  'http://localhost:8000';

export const DEFAULT_SETTINGS = {
  target_topic: 'Developing a Chrome extension with React and Python FastAPI',
  always_focus: [],
  always_break: [],
  notes: '',
  auto_organize: false,
  collapse_break_group: false,
  api_base_url: DEFAULT_API_BASE_URL,
};

const STORAGE_KEYS = {
  SETTINGS: 'lokkedin_settings',
  DEV_USER_ID: 'lokkedin_dev_user_id',
  LAST_RESULT: 'lokkedin_last_analysis',
};

const IGNORED_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  ' chrome-untrusted:',
  'edge:',
  'about:',
  'devtools:',
  'view-source:',
  'brave:',
];

// ---------------------------------------------------------------------------
// Storage Helpers (Settings & Per-Install Dev Identity)
// ---------------------------------------------------------------------------

function getStorageArea() {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    return chrome.storage.sync || chrome.storage.local;
  }
  return null;
}

export async function getSettings() {
  const storage = getStorageArea();
  if (!storage) {
    return { ...DEFAULT_SETTINGS };
  }
  const data = await storage.get(STORAGE_KEYS.SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...(data?.[STORAGE_KEYS.SETTINGS] || {}),
  };
}

export async function saveSettings(partialSettings) {
  const current = await getSettings();
  const updated = { ...current, ...partialSettings };
  const storage = getStorageArea();
  if (storage) {
    await storage.set({ [STORAGE_KEYS.SETTINGS]: updated });
  }
  return updated;
}

export async function getApiBaseUrl() {
  const settings = await getSettings();
  return (settings.api_base_url || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

export function isLocalhostUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return true;
  }
}

async function getOrCreateDevToken() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const data = await chrome.storage.local.get(STORAGE_KEYS.DEV_USER_ID);
    let devId = data?.[STORAGE_KEYS.DEV_USER_ID];
    if (!devId) {
      const randomPart =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10);
      devId = `ext-${randomPart}`;
      await chrome.storage.local.set({ [STORAGE_KEYS.DEV_USER_ID]: devId });
    }
    return `dev:${devId}`;
  }
  return 'dev-token';
}

// ---------------------------------------------------------------------------
// Background Authentication (Localhost Dev Token vs Cloud Run Google OAuth)
// ---------------------------------------------------------------------------

function getChromeIdentityToken(interactive = false) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.identity?.getAuthToken) {
      reject(new Error('chrome.identity API is not available'));
      return;
    }
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const err = chrome.runtime?.lastError;
      if (err || !token) {
        reject(new Error(err?.message || 'Failed to obtain Google OAuth token'));
        return;
      }
      resolve(token);
    });
  });
}

export function removeCachedChromeToken(token) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.identity?.removeCachedAuthToken || !token) {
      resolve();
      return;
    }
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

/**
 * Resolves the Bearer token to send to the backend:
 * - On `localhost` / `127.0.0.1`: returns a persistent `dev:<id>` token so each browser
 *   gets its own isolated session & cache on the local backend without needing Google Cloud OAuth setup.
 * - On Cloud Run (non-localhost): uses `chrome.identity.getAuthToken()`.
 */
export async function getAuthToken({ interactive = false, baseUrl } = {}) {
  const targetUrl = baseUrl || (await getApiBaseUrl());
  if (isLocalhostUrl(targetUrl)) {
    return getOrCreateDevToken();
  }
  return getChromeIdentityToken(interactive);
}

// ---------------------------------------------------------------------------
// Authenticated Fetch Wrapper
// ---------------------------------------------------------------------------

export async function apiFetch(path, options = {}, { interactiveAuth = false } = {}) {
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const usingLocalhost = isLocalhostUrl(baseUrl);

  let token = await getAuthToken({ interactive: interactiveAuth, baseUrl });

  const doRequest = async (bearerToken) => {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${bearerToken}`,
    };
    return fetch(url, {
      ...options,
      headers,
    });
  };

  let response = await doRequest(token);

  // If using Google OAuth on Cloud Run and the cached token expired, refresh once
  if (response.status === 401 && !usingLocalhost) {
    await removeCachedChromeToken(token);
    token = await getAuthToken({ interactive: true, baseUrl });
    response = await doRequest(token);
  }

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      errorDetail = errJson.detail || errorDetail;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(errorDetail);
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Tab Filtering & Querying (Ignores Pinned Tabs & Internal Browser Pages)
// ---------------------------------------------------------------------------

export function isIgnorableTab(tab) {
  if (!tab || tab.pinned) {
    return true;
  }
  const rawUrl = (tab.url || tab.pendingUrl || '').trim();
  if (!rawUrl) {
    return true;
  }
  const lower = rawUrl.toLowerCase();
  if (IGNORED_PROTOCOLS.some((proto) => lower.startsWith(proto))) {
    return true;
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol !== 'http:' && parsed.protocol !== 'https:';
  } catch {
    return true;
  }
}

export async function getAnalyzableTabs(windowId = chrome.windows.WINDOW_ID_CURRENT) {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return [];
  }
  const allTabs = await chrome.tabs.query({ windowId });
  return allTabs.filter((tab) => !isIgnorableTab(tab));
}

// ---------------------------------------------------------------------------
// Backend API Endpoints
// ---------------------------------------------------------------------------

export async function checkHealth() {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/health`);
  return res.json();
}

export async function getMe({ interactiveAuth = false } = {}) {
  return apiFetch('/api/me', { method: 'GET' }, { interactiveAuth });
}

export async function clearUserCache({ interactiveAuth = false } = {}) {
  return apiFetch('/api/cache', { method: 'DELETE' }, { interactiveAuth });
}

export async function analyzeTabs(tabs, overrides = {}, { interactiveAuth = false } = {}) {
  const settings = await getSettings();
  const merged = { ...settings, ...overrides };

  const analyzable = tabs.filter((t) => !isIgnorableTab(t));
  if (analyzable.length === 0) {
    return {
      status: 'success',
      elapsed_seconds: 0,
      target_topic: merged.target_topic,
      tabs: [],
      llm_calls: 0,
    };
  }

  const payload = {
    tabs: analyzable.map((t) => ({
      title: (t.title || 'Untitled').slice(0, 300),
      url: t.url || t.pendingUrl,
    })),
    target_topic: merged.target_topic,
    always_focus: merged.always_focus || [],
    always_break: merged.always_break || [],
    notes: merged.notes || null,
  };

  const result = await apiFetch(
    '/api/analyze-tabs',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { interactiveAuth }
  );

  // Attach original tab IDs by matching order/URL
  const enrichedTabs = analyzable.map((tab, index) => {
    const apiTab = result.tabs?.[index] || {
      url: tab.url,
      category: 'B',
      source: 'default',
    };
    return {
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title,
      url: tab.url,
      category: apiTab.category, // 'F' or 'B'
      source: apiTab.source,
    };
  });

  const finalResult = {
    ...result,
    tabs: enrichedTabs,
    timestamp: Date.now(),
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_RESULT]: finalResult });
  }

  return finalResult;
}

// ---------------------------------------------------------------------------
// Chrome Tab Groups Organizer (Focus = Green, Break = Red)
// ---------------------------------------------------------------------------

async function findOrCreateGroup(windowId, title, color, tabIds, collapsed = false) {
  if (!tabIds || tabIds.length === 0) {
    return null;
  }

  let existingGroupId = null;
  if (chrome.tabGroups?.query) {
    const existingGroups = await chrome.tabGroups.query({ windowId, title });
    if (existingGroups.length > 0) {
      existingGroupId = existingGroups[0].id;
    }
  }

  const groupOptions = existingGroupId
    ? { groupId: existingGroupId, tabIds }
    : { createProperties: { windowId }, tabIds };

  const groupId = await chrome.tabs.group(groupOptions);

  if (chrome.tabGroups?.update) {
    await chrome.tabGroups.update(groupId, {
      title,
      color,
      collapsed,
    });
  }

  return groupId;
}

/**
 * Moves classified tabs into Chrome Tab Groups:
 * - Focus ('F') -> Green group titled "Focus"
 * - Break ('B') -> Red group titled "Break"
 * Pinned and internal browser tabs are never touched.
 */
export async function organizeTabsIntoGroups(classifiedTabs, options = {}) {
  if (typeof chrome === 'undefined' || !chrome.tabs?.group) {
    return { focusGroupId: null, breakGroupId: null };
  }

  const settings = await getSettings();
  const collapseBreak =
    options.collapse_break_group !== undefined
      ? options.collapse_break_group
      : Boolean(settings.collapse_break_group);

  // Group tabs per browser windowId so multi-window setups don't cross-move tabs
  const byWindow = new Map();
  for (const item of classifiedTabs) {
    if (!item?.id || !item?.windowId) continue;
    if (!byWindow.has(item.windowId)) {
      byWindow.set(item.windowId, { focusIds: [], breakIds: [] });
    }
    const bucket = byWindow.get(item.windowId);
    if (item.category === 'F') {
      bucket.focusIds.push(item.id);
    } else if (item.category === 'B') {
      bucket.breakIds.push(item.id);
    }
  }

  const groupSummary = [];
  for (const [windowId, { focusIds, breakIds }] of byWindow.entries()) {
    const focusGroupId = await findOrCreateGroup(windowId, 'Focus', 'green', focusIds, false);
    const breakGroupId = await findOrCreateGroup(
      windowId,
      'Break',
      'red',
      breakIds,
      collapseBreak
    );
    groupSummary.push({ windowId, focusGroupId, breakGroupId });
  }

  return groupSummary;
}

/**
 * One-call helper: queries current window's non-pinned HTTP(S) tabs,
 * classifies them via the backend API, and moves them into Green (Focus) / Red (Break) tab groups.
 */
export async function analyzeAndOrganizeCurrentWindow(
  overrides = {},
  { interactiveAuth = true, windowId = chrome.windows.WINDOW_ID_CURRENT } = {}
) {
  const tabs = await getAnalyzableTabs(windowId);
  const analysis = await analyzeTabs(tabs, overrides, { interactiveAuth });
  const groups = await organizeTabsIntoGroups(analysis.tabs, overrides);
  return {
    ...analysis,
    groups,
  };
}

// ---------------------------------------------------------------------------
// Runtime Message Helpers (for UI teammates to trigger background worker)
// ---------------------------------------------------------------------------

export function sendBackgroundMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new Error('chrome.runtime.sendMessage is not available'));
      return;
    }
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (response && response.ok === false) {
        reject(new Error(response.error || 'Background task failed'));
        return;
      }
      resolve(response?.data ?? response);
    });
  });
}
