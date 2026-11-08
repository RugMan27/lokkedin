export const DEFAULT_API_BASE_URL = 'https://lokkedin.xyz';
export const FALLBACK_API_BASE_URL = 'https://lokkedin-api-276310685282.us-central1.run.app';

export const DEFAULT_FOCUS_TOPICS = [];

export const DEFAULT_SETTINGS = {
  target_topic: '',
  active_topic_id: null,
  focus_topics: [],
  always_focus: [],
  always_break: [],
  notes: '',
  auto_organize: false,
  collapse_break_group: true,
  darkMode: false,
  dyslexicFont: false,
  fontSize: 'medium',
  focusTabColor: '#238B45',
  breakTabColor: '#ff0000',
  longBreakEnabled: false,
  longBreakDurationSec: 30 * 60,
  longBreakInterval: 4,
  api_base_url: DEFAULT_API_BASE_URL,
};

export const DEFAULT_TIMER_STATE = {
  mode: 'focus',
  isRunning: false,
  isPaused: false,
  focusDurationSec: 25 * 60,
  breakDurationSec: 5 * 60,
  bonusBreakSec: 0,
  remainingSec: 25 * 60,
  targetEndTime: null,
  focusCount: 0,
  breakCount: 0,
};

export const STORAGE_KEYS = {
  SETTINGS: 'lokkedin_settings',
  CLIENT_ID: 'lokkedin_client_id',
  BEARER_TOKEN: 'lokkedin_bearer_token',
  LAST_RESULT: 'lokkedin_last_analysis',
  TIMER_STATE: 'lokkedin_timer_state',
  LOCAL_TAB_CACHE: 'lokkedin_local_tab_cache',
  PENDING_BREAK_PROMPT: 'lokkedin_pending_break_prompt',
};

const LOCAL_CACHE_MAX_ENTRIES = 500;

const IGNORED_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  'chrome-untrusted:',
  'edge:',
  'about:',
  'devtools:',
  'view-source:',
  'brave:',
];

const CHROME_GROUP_COLORS = {
  grey: [128, 134, 139],
  blue: [26, 115, 232],
  red: [217, 48, 37],
  yellow: [249, 171, 0],
  green: [24, 128, 56],
  pink: [208, 24, 132],
  purple: [147, 52, 230],
  cyan: [0, 123, 131],
  orange: [250, 144, 62],
};

function safeLocalGet(key) {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalSet(key, value) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function safeLocalRemove(key) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {}
}

export function hexToChromeGroupColor(hex, fallback = 'green') {
  if (!hex || typeof hex !== 'string') return fallback;
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return fallback;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return fallback;

  let bestName = fallback;
  let bestDist = Infinity;
  for (const [name, [cr, cg, cb]] of Object.entries(CHROME_GROUP_COLORS)) {
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestName = name;
    }
  }
  return bestName;
}

export function computeNextBreakDurationSec(settings, timer, newFocusCount) {
  const isLongBreak =
    Boolean(settings?.longBreakEnabled) &&
    Number(settings?.longBreakInterval) > 0 &&
    newFocusCount > 0 &&
    newFocusCount % Number(settings.longBreakInterval) === 0;

  const baseSec = isLongBreak
    ? Number(settings?.longBreakDurationSec) || 30 * 60
    : Number(timer?.breakDurationSec) || 5 * 60;

  return baseSec + (Number(timer?.bonusBreakSec) || 0);
}

function getStorageArea() {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    return chrome.storage.local || chrome.storage.sync;
  }
  return null;
}

export async function getSettings() {
  const storage = getStorageArea();
  if (!storage) {
    try {
      const local = safeLocalGet(STORAGE_KEYS.SETTINGS);
      return local ? { ...DEFAULT_SETTINGS, ...JSON.parse(local) } : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  const data = await storage.get(STORAGE_KEYS.SETTINGS);
  const saved = data?.[STORAGE_KEYS.SETTINGS] || {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    focus_topics: Array.isArray(saved.focus_topics) ? saved.focus_topics : [],
    api_base_url: DEFAULT_API_BASE_URL,
  };
}

export async function saveSettings(partialSettings) {
  const current = await getSettings();
  const updated = {
    ...current,
    ...partialSettings,
    api_base_url: DEFAULT_API_BASE_URL,
  };
  const storage = getStorageArea();
  if (storage) {
    await storage.set({ [STORAGE_KEYS.SETTINGS]: updated });
  } else {
    safeLocalSet(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
  }
  return updated;
}

export async function resetSettingsToDefault() {
  const current = await getSettings();
  const reset = {
    ...DEFAULT_SETTINGS,
    focus_topics: current.focus_topics || [],
    active_topic_id: current.active_topic_id || null,
    target_topic: current.target_topic || '',
    notes: current.notes || '',
    always_focus: current.always_focus || [],
    always_break: current.always_break || [],
  };
  const storage = getStorageArea();
  if (storage) {
    await storage.set({ [STORAGE_KEYS.SETTINGS]: reset });
  } else {
    safeLocalSet(STORAGE_KEYS.SETTINGS, JSON.stringify(reset));
  }
  return reset;
}

export async function getTimerState() {
  const storage = getStorageArea();
  let state = { ...DEFAULT_TIMER_STATE };
  if (storage) {
    const data = await storage.get(STORAGE_KEYS.TIMER_STATE);
    if (data?.[STORAGE_KEYS.TIMER_STATE]) {
      state = { ...DEFAULT_TIMER_STATE, ...data[STORAGE_KEYS.TIMER_STATE] };
    }
  } else {
    try {
      const raw = safeLocalGet(STORAGE_KEYS.TIMER_STATE);
      if (raw) state = { ...DEFAULT_TIMER_STATE, ...JSON.parse(raw) };
    } catch {}
  }

  if (state.isRunning && !state.isPaused && state.targetEndTime) {
    const remaining = Math.max(0, Math.ceil((state.targetEndTime - Date.now()) / 1000));
    state.remainingSec = remaining;
  }
  return state;
}

export async function saveTimerState(partialTimer) {
  const current = await getTimerState();
  const updated = { ...current, ...partialTimer };
  const storage = getStorageArea();
  if (storage) {
    await storage.set({ [STORAGE_KEYS.TIMER_STATE]: updated });
  } else {
    safeLocalSet(STORAGE_KEYS.TIMER_STATE, JSON.stringify(updated));
  }
  return updated;
}

export async function getLastAnalysis() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_RESULT);
    return data?.[STORAGE_KEYS.LAST_RESULT] || null;
  }
  return null;
}

export async function getPendingBreakPrompt() {
  const storage = getStorageArea();
  if (storage) {
    const data = await storage.get(STORAGE_KEYS.PENDING_BREAK_PROMPT);
    return data?.[STORAGE_KEYS.PENDING_BREAK_PROMPT] || null;
  }
  return null;
}

export async function setPendingBreakPrompt(promptData) {
  const storage = getStorageArea();
  if (!storage) return;
  if (!promptData) {
    await storage.remove(STORAGE_KEYS.PENDING_BREAK_PROMPT);
  } else {
    await storage.set({ [STORAGE_KEYS.PENDING_BREAK_PROMPT]: promptData });
  }
}

export async function getApiBaseUrl() {
  return DEFAULT_API_BASE_URL;
}

export function normalizeRule(rule) {
  let r = (rule || '').trim().toLowerCase();
  for (const prefix of ['https://', 'http://']) {
    if (r.startsWith(prefix)) {
      r = r.slice(prefix.length);
    }
  }
  if (r.startsWith('www.')) {
    r = r.slice(4);
  }
  return r.replace(/\/+$/, '');
}

export function splitUrl(url) {
  try {
    const p = new URL(url);
    let host = (p.hostname || '').toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    const path = (p.pathname || '').replace(/\/+$/, '').toLowerCase();
    return [host, path];
  } catch {
    return ['', ''];
  }
}

function ruleMatches(rule, host, path) {
  if (!host || !rule) return false;
  if (!rule.includes('/')) {
    return host === rule || host.endsWith(`.${rule}`);
  }
  const slashIdx = rule.indexOf('/');
  const ruleHost = rule.slice(0, slashIdx);
  const rulePath = `/${rule.slice(slashIdx + 1)}`;
  const hostOk = host === ruleHost || host.endsWith(`.${ruleHost}`);
  return hostOk && (path === rulePath || path.startsWith(`${rulePath}/`));
}

export function localRuleClassify(url, focusRules = [], breakRules = []) {
  const [host, path] = splitUrl(url);
  let bestLen = -1;
  let bestCat = null;
  for (const raw of focusRules) {
    const rule = normalizeRule(raw);
    if (rule && ruleMatches(rule, host, path) && rule.length >= bestLen) {
      bestLen = rule.length;
      bestCat = 'F';
    }
  }
  for (const raw of breakRules) {
    const rule = normalizeRule(raw);
    if (rule && ruleMatches(rule, host, path) && rule.length > bestLen) {
      bestLen = rule.length;
      bestCat = 'B';
    }
  }
  return bestCat;
}

export function buildLocalCacheKey(topic, notes, url) {
  return `${(topic || '').trim()}||${(notes || '').trim()}||${(url || '').trim()}`;
}

export async function getLocalTabCache() {
  const storage = getStorageArea();
  if (storage) {
    const data = await storage.get(STORAGE_KEYS.LOCAL_TAB_CACHE);
    return data?.[STORAGE_KEYS.LOCAL_TAB_CACHE] || {};
  }
  try {
    const raw = safeLocalGet(STORAGE_KEYS.LOCAL_TAB_CACHE);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveLocalTabCacheEntries(newEntries) {
  const cache = await getLocalTabCache();
  const updated = { ...cache, ...newEntries };
  const keys = Object.keys(updated);
  if (keys.length > LOCAL_CACHE_MAX_ENTRIES) {
    const overflow = keys.length - LOCAL_CACHE_MAX_ENTRIES;
    for (let i = 0; i < overflow; i += 1) {
      delete updated[keys[i]];
    }
  }
  const storage = getStorageArea();
  if (storage) {
    await storage.set({ [STORAGE_KEYS.LOCAL_TAB_CACHE]: updated });
  } else {
    safeLocalSet(STORAGE_KEYS.LOCAL_TAB_CACHE, JSON.stringify(updated));
  }
  return updated;
}

export async function clearLocalTabCache() {
  const storage = getStorageArea();
  if (storage) {
    await storage.remove(STORAGE_KEYS.LOCAL_TAB_CACHE);
  } else {
    safeLocalRemove(STORAGE_KEYS.LOCAL_TAB_CACHE);
  }
}

export async function resolveTabLocally(tab, settings) {
  if (!tab || isIgnorableTab(tab)) return null;
  const url = tab.url || tab.pendingUrl;
  const currentSettings = settings || (await getSettings());
  const ruleCat = localRuleClassify(
    url,
    currentSettings.always_focus || [],
    currentSettings.always_break || []
  );
  if (ruleCat) {
    return { category: ruleCat, source: 'local-rule' };
  }
  const localCache = await getLocalTabCache();
  const key = buildLocalCacheKey(
    currentSettings.target_topic,
    currentSettings.notes,
    url
  );
  if (localCache[key] === 'F' || localCache[key] === 'B') {
    return { category: localCache[key], source: 'local-cache' };
  }
  return null;
}

export async function allowSiteForActiveFocusType({ url, tabId, windowId, title }) {
  const settings = await getSettings();
  const [host] = splitUrl(url);
  const ruleToAdd = host || normalizeRule(url);
  if (!ruleToAdd) return settings;

  const updatedAlwaysFocus = Array.from(
    new Set([...(settings.always_focus || []), ruleToAdd])
  );
  const updatedAlwaysBreak = (settings.always_break || []).filter(
    (r) => normalizeRule(r) !== ruleToAdd
  );

  const updatedTopics = (settings.focus_topics || []).map((t) => {
    if (t.id === settings.active_topic_id) {
      return {
        ...t,
        always_focus: Array.from(new Set([...(t.always_focus || []), ruleToAdd])),
        always_break: (t.always_break || []).filter((r) => normalizeRule(r) !== ruleToAdd),
      };
    }
    return t;
  });

  const updatedSettings = await saveSettings({
    always_focus: updatedAlwaysFocus,
    always_break: updatedAlwaysBreak,
    focus_topics: updatedTopics,
  });

  const cacheKey = buildLocalCacheKey(
    updatedSettings.target_topic,
    updatedSettings.notes,
    url
  );
  await saveLocalTabCacheEntries({ [cacheKey]: 'F' });

  const lastResult = await getLastAnalysis();
  if (lastResult?.tabs && typeof chrome !== 'undefined' && chrome.storage?.local) {
    const mergedTabs = lastResult.tabs.map((t) =>
      t.id === tabId || t.url === url ? { ...t, category: 'F', source: 'local-rule' } : t
    );
    await chrome.storage.local.set({
      [STORAGE_KEYS.LAST_RESULT]: { ...lastResult, tabs: mergedTabs },
    });
  }

  if (tabId && windowId) {
    await organizeTabsIntoGroups(
      [{ id: tabId, windowId, title: title || url, url, category: 'F', source: 'local-rule' }],
      updatedSettings
    );
  }

  await setPendingBreakPrompt(null);
  return updatedSettings;
}

async function getOrCreateClientId() {
  const storage = getStorageArea();
  if (storage) {
    const data = await storage.get(STORAGE_KEYS.CLIENT_ID);
    let clientId = data?.[STORAGE_KEYS.CLIENT_ID];
    if (!clientId) {
      const uuid =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID().replace(/-/g, '')
          : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
      clientId = `usr_${uuid.slice(0, 20)}`;
      await storage.set({ [STORAGE_KEYS.CLIENT_ID]: clientId });
    }
    return clientId;
  }
  let localId = safeLocalGet(STORAGE_KEYS.CLIENT_ID);
  if (!localId) {
    localId = `usr_${Math.random().toString(36).slice(2, 14)}`;
    safeLocalSet(STORAGE_KEYS.CLIENT_ID, localId);
  }
  return localId;
}

export async function clearStoredBearerToken() {
  const storage = getStorageArea();
  if (storage) {
    await storage.remove(STORAGE_KEYS.BEARER_TOKEN);
  } else {
    safeLocalRemove(STORAGE_KEYS.BEARER_TOKEN);
  }
}

async function fetchWithFallback(path, fetchOptions = {}) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  try {
    return await fetch(`${DEFAULT_API_BASE_URL}${cleanPath}`, fetchOptions);
  } catch {
    return fetch(`${FALLBACK_API_BASE_URL}${cleanPath}`, fetchOptions);
  }
}

export async function getAuthToken({ forceRefresh = false } = {}) {
  const storage = getStorageArea();

  if (!forceRefresh) {
    if (storage) {
      const data = await storage.get(STORAGE_KEYS.BEARER_TOKEN);
      if (data?.[STORAGE_KEYS.BEARER_TOKEN]) {
        return data[STORAGE_KEYS.BEARER_TOKEN];
      }
    } else {
      const cached = safeLocalGet(STORAGE_KEYS.BEARER_TOKEN);
      if (cached) return cached;
    }
  }

  const clientId = await getOrCreateClientId();

  try {
    const res = await fetchWithFallback('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.token) {
        if (storage) {
          await storage.set({ [STORAGE_KEYS.BEARER_TOKEN]: data.token });
        } else {
          safeLocalSet(STORAGE_KEYS.BEARER_TOKEN, data.token);
        }
        return data.token;
      }
    }
  } catch {}

  return `client:${clientId}`;
}

export async function apiFetch(path, options = {}) {
  let token = await getAuthToken({ forceRefresh: false });

  const doRequest = async (bearerToken) => {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${bearerToken}`,
    };
    return fetchWithFallback(path, {
      ...options,
      headers,
    });
  };

  let response = await doRequest(token);

  if (response.status === 401) {
    await clearStoredBearerToken();
    token = await getAuthToken({ forceRefresh: true });
    response = await doRequest(token);
  }

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      errorDetail = errJson.detail || errorDetail;
    } catch {}
    throw new Error(errorDetail);
  }

  return response.json();
}

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

export async function getAnalyzableTabs(windowId) {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return [];
  }
  try {
    const queryOpts =
      typeof windowId === 'number' && windowId >= 0
        ? { windowId }
        : { lastFocusedWindow: true };
    const allTabs = await chrome.tabs.query(queryOpts);
    return allTabs.filter((tab) => !isIgnorableTab(tab));
  } catch {
    return [];
  }
}

export async function checkHealth() {
  const res = await fetchWithFallback('/api/health');
  return res.json();
}

export async function getMe() {
  return apiFetch('/api/me', { method: 'GET' });
}

export async function clearUserCache() {
  await clearLocalTabCache();
  return apiFetch('/api/cache', { method: 'DELETE' });
}

export async function submitContactForm({ message, email, settings, timer }) {
  const currentSettings = settings || (await getSettings());
  const currentTimer = timer || (await getTimerState());
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();

  let accountInfo = { client_id: clientId, token };
  try {
    const me = await getMe();
    accountInfo = { ...accountInfo, ...me };
  } catch {}

  const payload = {
    message,
    email: email || accountInfo.email || '',
    account: accountInfo,
    preferences: {
      darkMode: currentSettings.darkMode,
      dyslexicFont: currentSettings.dyslexicFont,
      fontSize: currentSettings.fontSize,
      focusTabColor: currentSettings.focusTabColor,
      breakTabColor: currentSettings.breakTabColor,
      longBreakEnabled: currentSettings.longBreakEnabled,
      longBreakDurationSec: currentSettings.longBreakDurationSec,
      longBreakInterval: currentSettings.longBreakInterval,
      target_topic: currentSettings.target_topic,
      active_topic_id: currentSettings.active_topic_id,
      focus_topics: currentSettings.focus_topics,
      always_focus: currentSettings.always_focus,
      always_break: currentSettings.always_break,
      notes: currentSettings.notes,
    },
    timer_state: {
      mode: currentTimer.mode,
      isRunning: currentTimer.isRunning,
      isPaused: currentTimer.isPaused,
      focusDurationSec: currentTimer.focusDurationSec,
      breakDurationSec: currentTimer.breakDurationSec,
      bonusBreakSec: currentTimer.bonusBreakSec || 0,
      focusCount: currentTimer.focusCount || 0,
      breakCount: currentTimer.breakCount || 0,
    },
    timestamp: Date.now(),
  };

  return apiFetch('/api/contact', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function analyzeTabs(tabs, overrides = {}) {
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

  const localCache = await getLocalTabCache();
  const resolvedByIndex = new Map();
  const uncachedIndices = [];
  const uncachedTabs = [];

  for (let i = 0; i < analyzable.length; i += 1) {
    const tab = analyzable[i];
    const url = tab.url || tab.pendingUrl;

    const ruleCat = localRuleClassify(
      url,
      merged.always_focus || [],
      merged.always_break || []
    );
    if (ruleCat) {
      resolvedByIndex.set(i, { category: ruleCat, source: 'local-rule' });
      continue;
    }

    const cacheKey = buildLocalCacheKey(merged.target_topic, merged.notes, url);
    const localHit = localCache[cacheKey];
    if (localHit === 'F' || localHit === 'B') {
      resolvedByIndex.set(i, { category: localHit, source: 'local-cache' });
      continue;
    }

    uncachedIndices.push(i);
    uncachedTabs.push(tab);
  }

  let serverResult = { llm_calls: 0, elapsed_seconds: 0 };
  if (uncachedTabs.length > 0) {
    const payload = {
      tabs: uncachedTabs.map((t) => ({
        title: (t.title || 'Untitled').slice(0, 300),
        url: t.url || t.pendingUrl,
      })),
      target_topic: merged.target_topic,
      always_focus: merged.always_focus || [],
      always_break: merged.always_break || [],
      notes: merged.notes || null,
    };

    serverResult = await apiFetch('/api/analyze-tabs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const newLocalEntries = {};
    for (let uIdx = 0; uIdx < uncachedTabs.length; uIdx += 1) {
      const originalIdx = uncachedIndices[uIdx];
      const tab = uncachedTabs[uIdx];
      const url = tab.url || tab.pendingUrl;
      const apiTab = serverResult.tabs?.[uIdx] || {
        url,
        category: 'B',
        source: 'default',
      };
      resolvedByIndex.set(originalIdx, {
        category: apiTab.category,
        source: apiTab.source,
      });
      if (apiTab.source !== 'default' && (apiTab.category === 'F' || apiTab.category === 'B')) {
        const key = buildLocalCacheKey(merged.target_topic, merged.notes, url);
        newLocalEntries[key] = apiTab.category;
      }
    }

    if (Object.keys(newLocalEntries).length > 0) {
      await saveLocalTabCacheEntries(newLocalEntries);
    }
  }

  const enrichedTabs = analyzable.map((tab, index) => {
    const resolved = resolvedByIndex.get(index) || {
      category: 'B',
      source: 'default',
    };
    return {
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title,
      url: tab.url || tab.pendingUrl,
      category: resolved.category,
      source: resolved.source,
    };
  });

  const previousAnalysis = await getLastAnalysis();
  const mergedTabsMap = new Map();
  if (previousAnalysis?.tabs) {
    for (const prevTab of previousAnalysis.tabs) {
      const key = prevTab.id || prevTab.url;
      if (key) mergedTabsMap.set(key, prevTab);
    }
  }
  for (const newTab of enrichedTabs) {
    const key = newTab.id || newTab.url;
    if (key) mergedTabsMap.set(key, newTab);
  }

  const storedResult = {
    status: 'success',
    elapsed_seconds: serverResult.elapsed_seconds || 0,
    target_topic: merged.target_topic,
    llm_calls: serverResult.llm_calls || 0,
    tabs: Array.from(mergedTabsMap.values()),
    timestamp: Date.now(),
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_RESULT]: storedResult });
  }

  return {
    ...storedResult,
    tabs: enrichedTabs,
  };
}

async function ensureActiveTabNotInCollapsingGroup(windowId, groupIdToCollapse, alternateGroupId) {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query || !groupIdToCollapse) {
    return;
  }
  try {
    const queryBase =
      typeof windowId === 'number' && windowId >= 0
        ? { windowId }
        : { lastFocusedWindow: true };
    const activeTabs = await chrome.tabs.query({ ...queryBase, active: true });
    const activeTab = activeTabs[0];
    if (!activeTab || activeTab.groupId !== groupIdToCollapse) {
      return;
    }

    if (alternateGroupId) {
      const altTabs = await chrome.tabs.query({ ...queryBase, groupId: alternateGroupId });
      if (altTabs.length > 0 && altTabs[0].id) {
        await chrome.tabs.update(altTabs[0].id, { active: true });
        return;
      }
    }

    const allWindowTabs = await chrome.tabs.query(queryBase);
    const fallbackTab = allWindowTabs.find((t) => t.groupId !== groupIdToCollapse && t.id);
    if (fallbackTab?.id) {
      await chrome.tabs.update(fallbackTab.id, { active: true });
    }
  } catch {}
}

async function findOrCreateGroup(windowId, title, color, tabIds, collapsed = false) {
  if (!tabIds || tabIds.length === 0) {
    return null;
  }

  try {
    let existingGroupId = null;
    if (chrome.tabGroups?.query) {
      const queryOpts =
        typeof windowId === 'number' && windowId >= 0 ? { windowId, title } : { title };
      const existingGroups = await chrome.tabGroups.query(queryOpts);
      if (existingGroups.length > 0) {
        existingGroupId = existingGroups[0].id;
      }
    }

    const groupOptions = existingGroupId
      ? { groupId: existingGroupId, tabIds }
      : typeof windowId === 'number' && windowId >= 0
      ? { createProperties: { windowId }, tabIds }
      : { tabIds };

    const groupId = await chrome.tabs.group(groupOptions);

    if (chrome.tabGroups?.update) {
      await chrome.tabGroups.update(groupId, {
        title,
        color,
        collapsed,
      });
    }

    return groupId;
  } catch {
    return null;
  }
}

export async function applyGroupCollapseForMode(mode, windowId) {
  if (typeof chrome === 'undefined' || !chrome.tabGroups?.query) {
    return;
  }
  try {
    const queryOpts =
      typeof windowId === 'number' && windowId >= 0 ? { windowId } : {};
    const groups = await chrome.tabGroups.query(queryOpts);
    const focusGroup = groups.find((g) => g.title === 'Focus');
    const breakGroup = groups.find((g) => g.title === 'Break');

    if (mode === 'focus') {
      if (focusGroup) {
        await chrome.tabGroups.update(focusGroup.id, { collapsed: false });
      }
      if (breakGroup) {
        await ensureActiveTabNotInCollapsingGroup(
          breakGroup.windowId ?? windowId,
          breakGroup.id,
          focusGroup?.id
        );
        await chrome.tabGroups.update(breakGroup.id, { collapsed: true });
      }
    } else if (mode === 'break') {
      if (breakGroup) {
        await chrome.tabGroups.update(breakGroup.id, { collapsed: false });
      }
      if (focusGroup) {
        await ensureActiveTabNotInCollapsingGroup(
          focusGroup.windowId ?? windowId,
          focusGroup.id,
          breakGroup?.id
        );
        await chrome.tabGroups.update(focusGroup.id, { collapsed: true });
      }
    }
  } catch {}
}

export async function organizeTabsIntoGroups(classifiedTabs, options = {}) {
  if (typeof chrome === 'undefined' || !chrome.tabs?.group) {
    return [];
  }

  const [settings, timer] = await Promise.all([getSettings(), getTimerState()]);
  const currentMode = options.mode || timer.mode || 'focus';

  const focusColor = hexToChromeGroupColor(
    options.focusTabColor || settings.focusTabColor,
    'green'
  );
  const breakColor = hexToChromeGroupColor(
    options.breakTabColor || settings.breakTabColor,
    'red'
  );

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
    const collapseFocus = currentMode === 'break';
    const collapseBreak = currentMode === 'focus';

    const focusGroupId = await findOrCreateGroup(
      windowId,
      'Focus',
      focusColor,
      focusIds,
      false
    );
    const breakGroupId = await findOrCreateGroup(
      windowId,
      'Break',
      breakColor,
      breakIds,
      false
    );

    try {
      if (collapseBreak && breakGroupId) {
        await ensureActiveTabNotInCollapsingGroup(windowId, breakGroupId, focusGroupId);
        await chrome.tabGroups.update(breakGroupId, { collapsed: true });
      }
      if (collapseFocus && focusGroupId) {
        await ensureActiveTabNotInCollapsingGroup(windowId, focusGroupId, breakGroupId);
        await chrome.tabGroups.update(focusGroupId, { collapsed: true });
      }
    } catch {}

    groupSummary.push({ windowId, focusGroupId, breakGroupId });
  }

  return groupSummary;
}

export async function analyzeAndOrganizeCurrentWindow(overrides = {}, { windowId } = {}) {
  const tabs = await getAnalyzableTabs(windowId);
  const analysis = await analyzeTabs(tabs, overrides);
  const groups = await organizeTabsIntoGroups(analysis.tabs, overrides);
  return {
    ...analysis,
    groups,
  };
}

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
