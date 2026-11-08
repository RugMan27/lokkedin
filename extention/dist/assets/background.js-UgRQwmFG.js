import { C as saveTimerState, E as splitUrl, S as saveSettings, T as setPendingBreakPrompt, _ as getTimerState, a as analyzeAndOrganizeCurrentWindow, c as checkHealth, d as getAnalyzableTabs, f as getAuthToken, g as getSettings, i as allowSiteForActiveFocusType, l as clearUserCache, m as getMe, o as analyzeTabs, s as applyGroupCollapseForMode, u as computeNextBreakDurationSec, v as isIgnorableTab, x as resolveTabLocally, y as organizeTabsIntoGroups } from "./lokkedin-D_Jnd2lH.js";
// src/background.js
var TAB_DWELL_MS = 3e4;
var pendingTabTimers = /* @__PURE__ */ new Map();
var lastAnalyzedTabUrl = /* @__PURE__ */ new Map();
var cycleTimeoutId = null;
function clearAllPendingTabTimers() {
	for (const timerId of pendingTabTimers.values()) clearTimeout(timerId);
	pendingTabTimers.clear();
}
function injectBreakTabPopupOnPage(tab, settings) {
	if (typeof chrome === "undefined" || !chrome.scripting?.executeScript || !tab?.id) return;
	const [host] = splitUrl(tab.url || "");
	const logoUrl = chrome.runtime.getURL("images/LokkedIn-removebg-preview 1.png");
	const darkMode = Boolean(settings?.darkMode);
	const dyslexicFont = Boolean(settings?.dyslexicFont);
	const fontSize = settings?.fontSize || "medium";
	const topicName = settings?.target_topic || "Focus";
	chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: (payload) => {
			const existing = document.getElementById("lokkedin-break-prompt-host");
			if (existing) existing.remove();
			const hostEl = document.createElement("div");
			hostEl.id = "lokkedin-break-prompt-host";
			hostEl.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);";
			const bg = payload.darkMode ? "#27272a" : "white";
			const fg = payload.darkMode ? "#f4f4f5" : "black";
			const borderCol = payload.darkMode ? "#71717a" : "black";
			const fontFam = payload.dyslexicFont ? "\"Comic Sans MS\", \"Trebuchet MS\", Verdana, sans-serif" : "\"Times New Roman\", Times, serif";
			const fontPx = payload.fontSize === "small" ? "13px" : payload.fontSize === "large" ? "19px" : "16px";
			const imgFilter = payload.darkMode ? "invert(1) hue-rotate(180deg)" : "none";
			const shadow = hostEl.attachShadow({ mode: "open" });
			shadow.innerHTML = `
          <style>
            .popup-notification {
              min-height: 150px;
              width: 300px;
              display: flex;
              flex-direction: column;
              overflow: hidden;
              border-radius: 10px;
              border: 2px solid ${borderCol};
              background: ${bg};
              color: ${fg};
              font-family: ${fontFam};
              box-sizing: border-box;
              box-shadow: 0 10px 25px rgba(0,0,0,0.35);
            }
            .popup-header {
              display: flex;
              align-items: center;
              justify-content: left;
              padding: 10px 20px;
              border-bottom: 2px solid ${borderCol};
            }
            .popup-header img {
              height: 20px;
              width: auto;
              max-width: 100%;
              object-fit: contain;
              flex-shrink: 0;
              display: block;
              filter: ${imgFilter};
            }
            .popup-title {
              justify-content: right;
              margin-left: 20px;
              font-weight: bold;
              font-size: ${fontPx};
            }
            .content {
              flex: 1;
              padding: 10px 20px;
              font-size: ${fontPx};
            }
            .popup-text {
              display: block;
              margin-bottom: 12px;
            }
            .actions {
              display: flex;
              gap: 8px;
              justify-content: center;
            }
            button {
              border-radius: 5px;
              border: 2px solid ${borderCol};
              padding: 4px 10px;
              cursor: pointer;
              font-family: inherit;
              background: #f0f0f0;
              color: black;
            }
            button:hover {
              background-color: lightskyblue;
            }
          </style>
          <div class="popup-notification">
            <div class="popup-header">
              <img src="${payload.logoUrl}" alt="LokkedIn" />
              <div class="popup-title">
                <header>Break Tab Detected</header>
              </div>
            </div>
            <main class="content">
              <header class="popup-text">
                Are you supposed to be on <b>${payload.host}</b> for "${payload.topicName}"?
              </header>
              <div class="actions">
                <button id="lokkedin-allow-btn">Yes, Safe Site</button>
                <button id="lokkedin-dismiss-btn">No, Minimize</button>
              </div>
            </main>
          </div>
        `;
			document.documentElement.appendChild(hostEl);
			shadow.getElementById("lokkedin-allow-btn").addEventListener("click", () => {
				chrome.runtime.sendMessage({
					type: "LOKKEDIN_ALLOW_BREAK_SITE",
					payload: {
						tabId: payload.tabId,
						windowId: payload.windowId,
						url: payload.url,
						title: payload.title
					}
				});
				hostEl.remove();
			});
			shadow.getElementById("lokkedin-dismiss-btn").addEventListener("click", () => {
				chrome.runtime.sendMessage({
					type: "LOKKEDIN_DISMISS_BREAK_SITE",
					payload: {
						tabId: payload.tabId,
						windowId: payload.windowId,
						url: payload.url,
						title: payload.title
					}
				});
				hostEl.remove();
			});
		},
		args: [{
			tabId: tab.id,
			windowId: tab.windowId,
			url: tab.url,
			title: tab.title || tab.url,
			host: host || tab.url,
			topicName,
			logoUrl,
			darkMode,
			dyslexicFont,
			fontSize
		}]
	}).catch(() => {});
}
function scheduleBackgroundTimerTransition(timerState) {
	if (cycleTimeoutId) {
		clearTimeout(cycleTimeoutId);
		cycleTimeoutId = null;
	}
	if (!timerState.isRunning || timerState.isPaused || !timerState.targetEndTime) {
		clearAllPendingTabTimers();
		return;
	}
	const delayMs = Math.max(0, timerState.targetEndTime - Date.now());
	cycleTimeoutId = setTimeout(async () => {
		const [latest, settings] = await Promise.all([getTimerState(), getSettings()]);
		if (!latest.isRunning || latest.isPaused) return;
		const finishedFocus = latest.mode === "focus";
		const nextMode = finishedFocus ? "break" : "focus";
		const newFocusCount = (latest.focusCount || 0) + (finishedFocus ? 1 : 0);
		const newBreakCount = (latest.breakCount || 0) + (finishedFocus ? 0 : 1);
		const nextDuration = nextMode === "focus" ? latest.focusDurationSec : computeNextBreakDurationSec(settings, latest, newFocusCount);
		const updated = await saveTimerState({
			mode: nextMode,
			remainingSec: nextDuration,
			bonusBreakSec: nextMode === "break" ? 0 : latest.bonusBreakSec || 0,
			targetEndTime: Date.now() + nextDuration * 1e3,
			focusCount: newFocusCount,
			breakCount: newBreakCount
		});
		await saveSettings({ auto_organize: nextMode === "focus" });
		await applyGroupCollapseForMode(nextMode);
		if (nextMode === "focus") try {
			await analyzeAndOrganizeCurrentWindow({});
		} catch {}
		else clearAllPendingTabTimers();
		scheduleBackgroundTimerTransition(updated);
	}, delayMs);
}
async function warmupBackgroundSession() {
	try {
		const settings = await getSettings();
		await saveSettings(settings);
		scheduleBackgroundTimerTransition(await getTimerState());
		await getAuthToken();
	} catch {}
}
chrome.runtime.onInstalled.addListener(() => {
	warmupBackgroundSession();
});
chrome.runtime.onStartup.addListener(() => {
	warmupBackgroundSession();
});
async function handleTabCheckWithCacheAndDwell(tabId) {
	if (!tabId || typeof chrome === "undefined" || !chrome.tabs?.get) return;
	let tab;
	try {
		tab = await chrome.tabs.get(tabId);
	} catch {
		return;
	}
	if (isIgnorableTab(tab)) return;
	const [settings, timer] = await Promise.all([getSettings(), getTimerState()]);
	if (!settings.auto_organize || !timer.isRunning || timer.isPaused || timer.mode !== "focus") return;
	const currentKey = `${settings.target_topic}||${settings.notes || ""}||${tab.url}`;
	if (lastAnalyzedTabUrl.get(tabId) === currentKey) return;
	const localHit = await resolveTabLocally(tab, settings);
	if (localHit) {
		lastAnalyzedTabUrl.set(tabId, currentKey);
		await organizeTabsIntoGroups([{
			id: tab.id,
			windowId: tab.windowId,
			title: tab.title,
			url: tab.url,
			category: localHit.category,
			source: localHit.source
		}], settings);
		return;
	}
	if (pendingTabTimers.has(tabId)) clearTimeout(pendingTabTimers.get(tabId));
	const expectedUrl = tab.url;
	const timerId = setTimeout(async () => {
		pendingTabTimers.delete(tabId);
		try {
			const freshTab = await chrome.tabs.get(tabId);
			if (isIgnorableTab(freshTab) || freshTab.url !== expectedUrl) return;
			const [freshSettings, freshTimer] = await Promise.all([getSettings(), getTimerState()]);
			if (!freshSettings.auto_organize || !freshTimer.isRunning || freshTimer.isPaused || freshTimer.mode !== "focus") return;
			const result = await analyzeTabs([freshTab], freshSettings);
			if (result.tabs && result.tabs.length > 0) {
				const classifiedTab = result.tabs[0];
				lastAnalyzedTabUrl.set(tabId, currentKey);
				if (classifiedTab.category === "B") {
					const [host] = splitUrl(freshTab.url);
					await setPendingBreakPrompt({
						tabId: freshTab.id,
						windowId: freshTab.windowId,
						url: freshTab.url,
						title: freshTab.title || freshTab.url,
						host: host || freshTab.url,
						topicName: freshSettings.target_topic
					});
					injectBreakTabPopupOnPage(freshTab, freshSettings);
				} else await organizeTabsIntoGroups(result.tabs, freshSettings);
			}
		} catch {}
	}, TAB_DWELL_MS);
	pendingTabTimers.set(tabId, timerId);
}
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status !== "complete") return;
	if (isIgnorableTab(tab)) return;
	handleTabCheckWithCacheAndDwell(tabId);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
	handleTabCheckWithCacheAndDwell(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
	if (pendingTabTimers.has(tabId)) {
		clearTimeout(pendingTabTimers.get(tabId));
		pendingTabTimers.delete(tabId);
	}
	lastAnalyzedTabUrl.delete(tabId);
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!message || typeof message.type !== "string") return false;
	(async () => {
		switch (message.type) {
			case "LOKKEDIN_ANALYZE_AND_GROUP": {
				const overrides = message.payload || {};
				if (Object.keys(overrides).length > 0) await saveSettings(overrides);
				sendResponse({
					ok: true,
					data: await analyzeAndOrganizeCurrentWindow(overrides, { windowId: overrides.windowId })
				});
				break;
			}
			case "LOKKEDIN_ANALYZE_ONLY": {
				const overrides = message.payload || {};
				const tabs = await getAnalyzableTabs(overrides.windowId);
				sendResponse({
					ok: true,
					data: await analyzeTabs(tabs, overrides)
				});
				break;
			}
			case "LOKKEDIN_APPLY_MODE_GROUPS": {
				const { mode, windowId } = message.payload || {};
				await applyGroupCollapseForMode(mode, windowId);
				sendResponse({ ok: true });
				break;
			}
			case "LOKKEDIN_ALLOW_BREAK_SITE": {
				const updatedSettings = await allowSiteForActiveFocusType(message.payload || {});
				lastAnalyzedTabUrl.clear();
				sendResponse({
					ok: true,
					data: updatedSettings
				});
				break;
			}
			case "LOKKEDIN_DISMISS_BREAK_SITE": {
				const { tabId, windowId, url, title } = message.payload || {};
				await setPendingBreakPrompt(null);
				const settings = await getSettings();
				if (tabId && windowId) await organizeTabsIntoGroups([{
					id: tabId,
					windowId,
					title: title || url,
					url,
					category: "B",
					source: "llm"
				}], settings);
				sendResponse({ ok: true });
				break;
			}
			case "LOKKEDIN_GET_SETTINGS":
				sendResponse({
					ok: true,
					data: await getSettings()
				});
				break;
			case "LOKKEDIN_SAVE_SETTINGS": {
				const updated = await saveSettings(message.payload || {});
				lastAnalyzedTabUrl.clear();
				sendResponse({
					ok: true,
					data: updated
				});
				break;
			}
			case "LOKKEDIN_SYNC_TIMER": {
				const updatedTimer = await saveTimerState(message.payload || {});
				scheduleBackgroundTimerTransition(updatedTimer);
				sendResponse({
					ok: true,
					data: updatedTimer
				});
				break;
			}
			case "LOKKEDIN_GET_STATUS": {
				const [settings, timer, health, me] = await Promise.all([
					getSettings(),
					getTimerState(),
					checkHealth().catch((e) => ({
						status: "offline",
						error: e.message
					})),
					getMe().catch((e) => ({ error: e.message }))
				]);
				sendResponse({
					ok: true,
					data: {
						settings,
						timer,
						health,
						me
					}
				});
				break;
			}
			case "LOKKEDIN_CLEAR_CACHE": {
				const data = await clearUserCache();
				lastAnalyzedTabUrl.clear();
				sendResponse({
					ok: true,
					data
				});
				break;
			}
			default: sendResponse({
				ok: false,
				error: `Unknown message type: ${message.type}`
			});
		}
	})().catch((err) => {
		sendResponse({
			ok: false,
			error: err?.message || String(err)
		});
	});
	return true;
});
