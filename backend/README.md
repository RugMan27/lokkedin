# LokkedIn Backend API

FastAPI cloud backend for the **LokkedIn** Chrome Extension — classifies browser tabs into **Focus (`F`)** or **Break (`B`)** using a central Gemini API key, **Google Chrome Identity (`chrome.identity`) authentication**, and **isolated per-user sessions & LRU+TTL caches**.

---

## 1. Local Development

1. Copy `.env.example` to `.env` and set your `GEMINI_API_KEY`:
   ```bash
   cp .env.example .env
   ```
2. Start the server:
   ```bash
   python main.py
   ```
   - Interactive Swagger UI: `http://localhost:8000/docs`
   - Click **Authorize** in Swagger UI and enter `dev-token` (or `dev:alice`, `dev:bob` to test separate user sessions locally when `DEV_MODE=1`).

---

## 2. Deploy to Google Cloud Run (1 Command)

Make sure you have the [Google Cloud CLI (`gcloud`)](https://cloud.google.com/sdk/docs/install) installed and logged in (`gcloud auth login`).

Run this from the `backend/` folder:

```bash
gcloud run deploy lokkedin-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --session-affinity \
  --max-instances 3 \
  --set-env-vars="GEMINI_API_KEY=YOUR_GEMINI_KEY,DEV_MODE=0,GOOGLE_CLIENT_ID=YOUR_EXTENSION_CLIENT_ID.apps.googleusercontent.com"
```

> **Why `--session-affinity`?** It routes repeated requests from the same Chrome Extension user to the same container instance so their in-memory `UserSession` and `TTLLRUCache` stay warm.

---

## 3. Chrome Extension Integration (`chrome.identity`)

### `manifest.json`
Add the `identity` permission and your Google OAuth2 Client ID (created in **Google Cloud Console -> APIs & Services -> Credentials -> Create OAuth client ID -> Chrome Extension**):

```json
{
  "manifest_version": 3,
  "name": "LokkedIn",
  "version": "1.0.0",
  "permissions": ["tabs", "tabGroups", "storage", "identity"],
  "oauth2": {
    "client_id": "YOUR_EXTENSION_CLIENT_ID.apps.googleusercontent.com",
    "scopes": ["openid", "email"]
  }
}
```

### Calling the API from your Extension (`background.js` / `popup.js`)

```javascript
const API_BASE_URL = "https://lokkedin-api-xxxxx-uc.a.run.app"; // or http://localhost:8000

function getGoogleAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError || new Error("No auth token"));
      } else {
        resolve(token);
      }
    });
  });
}

async function analyzeTabs(tabs, targetTopic, alwaysFocus = [], alwaysBreak = [], notes = "") {
  const token = await getGoogleAuthToken(true);

  const response = await fetch(`${API_BASE_URL}/api/analyze-tabs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`, // Or "Bearer dev-token" when testing locally
    },
    body: JSON.stringify({
      tabs: tabs.map((t) => ({ title: t.title || "", url: t.url })),
      target_topic: targetTopic,
      always_focus: alwaysFocus,
      always_break: alwaysBreak,
      notes,
    }),
  });

  if (response.status === 401) {
    // Token expired: evict cached Chrome token and retry once
    chrome.identity.removeCachedAuthToken({ token }, () => {});
    throw new Error("Unauthorized - token refreshed, please retry");
  }

  return await response.json();
}
```

---

## 4. API Endpoints

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | Health check & active session count |
| `GET` | `/api/me` | `Bearer <token>` | Returns current user's ID, email, cache stats & request count |
| `DELETE` | `/api/cache` | `Bearer <token>` | Clears **only** the authenticated user's tab cache |
| `POST` | `/api/analyze-tabs` | `Bearer <token>` | Classifies tabs (`F` or `B`) using rules -> user cache -> Gemini |
