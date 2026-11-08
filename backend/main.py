import asyncio
from collections import OrderedDict, deque
from dataclasses import dataclass, field
import hashlib
import hmac
import logging
import os
from pathlib import Path
import secrets
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google import genai
from google.auth.transport import requests as google_requests
from google.genai import types
from google.oauth2 import id_token
from pydantic import BaseModel, Field, field_validator
import requests
import uvicorn


def _load_dotenv_file(env_path: Path) -> None:
    try:
        from dotenv import load_dotenv

        load_dotenv(dotenv_path=env_path)
        return
    except ImportError:
        pass

    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv_file(Path(__file__).resolve().parent / ".env")

logging.basicConfig(
    level=logging.DEBUG if os.environ.get("LOKKEDIN_DEBUG", "0") == "1" else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("lokkedin")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
if not GEMINI_API_KEY:
    raise RuntimeError("Set the GEMINI_API_KEY environment variable")

MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
DEBUG = os.environ.get("LOKKEDIN_DEBUG", "0") == "1"

DEV_MODE = os.environ.get("DEV_MODE", "0") == "1"
DEV_AUTH_TOKEN = os.environ.get("DEV_AUTH_TOKEN", "dev-token")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip() or None
AUTH_SECRET = os.environ.get("AUTH_SECRET", GEMINI_API_KEY).encode("utf-8")

MAX_TABS = int(os.environ.get("MAX_TABS", "25"))
MAX_RULES = int(os.environ.get("MAX_RULES", "500"))
USER_CACHE_LIMIT = int(os.environ.get("USER_CACHE_LIMIT", "500"))
CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", "3600"))
MAX_USER_SESSIONS = int(os.environ.get("MAX_USER_SESSIONS", "1000"))
RATE_LIMIT_PER_MINUTE = int(os.environ.get("RATE_LIMIT_PER_MINUTE", "30"))
TOKEN_CACHE_TTL_SECONDS = 900

raw_origins = os.environ.get("ALLOWED_ORIGINS", "*").strip()
ALLOWED_ORIGINS = [o.strip() for o in raw_origins.split(",") if o.strip()] or ["*"]

client = genai.Client(api_key=GEMINI_API_KEY)

SYSTEM_PROMPT = """Classify each numbered browser tab as F (Focus) or B (Break) relative to the Target Topic.

F: technical docs, APIs, code repos, tutorials, developer tools; technical forums or communities
directly relevant to the work (Stack Overflow, GitHub discussions, r/webdev, r/reactjs);
passive background audio (lofi, synthwave, ambient focus music).
B: entertainment, gaming, non-tech social feeds, general news, shopping, non-technical forums,
active video entertainment (vlogs, shows, comedy, commentary).
If ambiguous, choose F only if the tab directly helps with the Target Topic.
If User Notes are provided, they override the defaults above.

Output ONLY comma-separated pairs in the form <number>:<F|B>. Example: 0:F,1:B,2:F
No spaces, no explanations, no other text."""

GENAI_CONFIG = types.GenerateContentConfig(
    system_instruction=SYSTEM_PROMPT,
    thinking_config=types.ThinkingConfig(thinking_level="MINIMAL"),
    max_output_tokens=120,
    temperature=0.0,
)


class TTLLRUCache:
    def __init__(self, maxsize: int, ttl_seconds: int) -> None:
        self.maxsize = maxsize
        self.ttl_seconds = ttl_seconds
        self._data: OrderedDict[Any, Tuple[Any, float]] = OrderedDict()

    def get(self, key: Any) -> Optional[Any]:
        item = self._data.get(key)
        if item is None:
            return None
        value, expires_at = item
        if time.monotonic() >= expires_at:
            self._data.pop(key, None)
            return None
        self._data.move_to_end(key)
        return value

    def set(self, key: Any, value: Any, custom_ttl: Optional[int] = None) -> None:
        ttl = custom_ttl if custom_ttl is not None else self.ttl_seconds
        if ttl <= 0:
            return
        if key in self._data:
            self._data.move_to_end(key)
        self._data[key] = (value, time.monotonic() + ttl)
        while len(self._data) > self.maxsize:
            self._data.popitem(last=False)

    def clear(self) -> int:
        count = len(self._data)
        self._data.clear()
        return count

    def __len__(self) -> int:
        now = time.monotonic()
        expired = [k for k, (_, exp) in self._data.items() if now >= exp]
        for k in expired:
            self._data.pop(k, None)
        return len(self._data)


@dataclass
class UserSession:
    user_id: str
    email: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)
    cache: TTLLRUCache = field(
        default_factory=lambda: TTLLRUCache(maxsize=USER_CACHE_LIMIT, ttl_seconds=CACHE_TTL_SECONDS)
    )
    request_timestamps: deque = field(default_factory=deque)
    total_requests: int = 0
    total_llm_calls: int = 0
    total_cache_hits: int = 0

    def check_rate_limit(self) -> None:
        now = time.monotonic()
        window_start = now - 60.0
        while self.request_timestamps and self.request_timestamps[0] < window_start:
            self.request_timestamps.popleft()
        if len(self.request_timestamps) >= RATE_LIMIT_PER_MINUTE:
            retry_after = max(1, int(60 - (now - self.request_timestamps[0])))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded ({RATE_LIMIT_PER_MINUTE} requests/min). Try again in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )
        self.request_timestamps.append(now)
        self.last_active = time.time()
        self.total_requests += 1


class SessionManager:
    def __init__(self, max_users: int) -> None:
        self.max_users = max_users
        self._sessions: OrderedDict[str, UserSession] = OrderedDict()

    def get_or_create(self, user_id: str, email: Optional[str] = None) -> UserSession:
        session = self._sessions.get(user_id)
        if session is not None:
            self._sessions.move_to_end(user_id)
            if email and not session.email:
                session.email = email
            return session

        session = UserSession(user_id=user_id, email=email)
        self._sessions[user_id] = session
        while len(self._sessions) > self.max_users:
            evicted_id, _ = self._sessions.popitem(last=False)
            logger.info("Evicted inactive session for user_id=%s", evicted_id)
        return session

    @property
    def active_user_count(self) -> int:
        return len(self._sessions)


session_manager = SessionManager(max_users=MAX_USER_SESSIONS)
verified_token_cache = TTLLRUCache(maxsize=2000, ttl_seconds=TOKEN_CACHE_TTL_SECONDS)
_google_http_request = google_requests.Request()

security = HTTPBearer(auto_error=False)


def create_signed_client_token(client_id: str) -> str:
    clean_id = "".join(c for c in client_id if c.isalnum() or c in "-_")[:64]
    if not clean_id:
        clean_id = secrets.token_hex(12)
    sig = hmac.new(AUTH_SECRET, clean_id.encode("utf-8"), hashlib.sha256).hexdigest()[:32]
    return f"lk_{clean_id}.{sig}"


def verify_signed_client_token(token: str) -> Optional[str]:
    if not token.startswith("lk_") or "." not in token:
        return None
    body, _, sig = token.partition(".")
    client_id = body[3:]
    if not client_id:
        return None
    expected = hmac.new(AUTH_SECRET, client_id.encode("utf-8"), hashlib.sha256).hexdigest()[:32]
    if hmac.compare_digest(sig, expected):
        return f"client:{client_id}"
    return None


def _verify_google_token_sync(token: str) -> Dict[str, Any]:
    if token.count(".") == 2:
        try:
            claims = id_token.verify_oauth2_token(
                token, _google_http_request, audience=GOOGLE_CLIENT_ID
            )
            exp = int(claims.get("exp", time.time() + 300))
            ttl = max(1, min(TOKEN_CACHE_TTL_SECONDS, int(exp - time.time())))
            return {
                "sub": f"google:{claims['sub']}",
                "email": claims.get("email"),
                "ttl": ttl,
            }
        except Exception as exc:
            raise ValueError(f"Invalid Google ID token: {exc}") from exc

    resp = requests.get(
        "https://oauth2.googleapis.com/tokeninfo",
        params={"access_token": token},
        timeout=5,
    )
    if resp.status_code != 200:
        raise ValueError("Invalid or expired Google OAuth access token")

    data = resp.json()
    if GOOGLE_CLIENT_ID and data.get("aud") != GOOGLE_CLIENT_ID and data.get("azp") != GOOGLE_CLIENT_ID:
        raise ValueError("Token client_id does not match GOOGLE_CLIENT_ID")

    sub = data.get("sub") or data.get("email")
    if not sub:
        raise ValueError("Google token does not contain a user identifier")

    expires_in = int(data.get("expires_in", 300))
    ttl = max(1, min(TOKEN_CACHE_TTL_SECONDS, expires_in))
    return {
        "sub": f"google:{sub}",
        "email": data.get("email"),
        "ttl": ttl,
    }


async def get_current_session(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> UserSession:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials.strip()

    signed_user_id = verify_signed_client_token(token)
    if signed_user_id:
        return session_manager.get_or_create(signed_user_id)

    if token.startswith("client:") and len(token) > 7:
        clean_client = "".join(c for c in token[7:] if c.isalnum() or c in "-_")[:64]
        if clean_client:
            return session_manager.get_or_create(f"client:{clean_client}")

    if DEV_MODE:
        if token == DEV_AUTH_TOKEN:
            dev_user = request.headers.get("X-Dev-User", "local-dev").strip() or "local-dev"
            return session_manager.get_or_create(f"dev:{dev_user}", email=f"{dev_user}@localhost")
        if token.startswith("dev:") and len(token) > 4:
            dev_user = token[4:].strip()
            return session_manager.get_or_create(f"dev:{dev_user}", email=f"{dev_user}@localhost")

    cached_identity = verified_token_cache.get(token)
    if cached_identity is not None:
        return session_manager.get_or_create(
            cached_identity["sub"], email=cached_identity.get("email")
        )

    try:
        identity = await asyncio.to_thread(_verify_google_token_sync, token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except Exception as exc:
        logger.error("Error verifying Google OAuth token: %r", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to verify token with Google OAuth service",
        ) from exc

    verified_token_cache.set(token, identity, custom_ttl=identity["ttl"])
    return session_manager.get_or_create(identity["sub"], email=identity.get("email"))


app = FastAPI(title="LokkedIn API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Dev-User"],
)


class SessionInitRequest(BaseModel):
    client_id: Optional[str] = Field(default=None, max_length=64)


class TabItem(BaseModel):
    title: str = Field(..., max_length=300)
    url: str = Field(..., min_length=1, max_length=2048)

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Tab URL cannot be empty")
        return v


class TabAnalysisRequest(BaseModel):
    tabs: List[TabItem] = Field(..., min_length=1)
    target_topic: Optional[str] = Field(
        default="Developing a Chrome extension with React and Python FastAPI",
        max_length=300,
    )
    always_focus: List[str] = Field(default_factory=list)
    always_break: List[str] = Field(default_factory=list)
    notes: Optional[str] = Field(default=None, max_length=500)


class ContactSubmissionRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=5000)
    email: Optional[str] = Field(default=None, max_length=320)
    account: Optional[Dict[str, Any]] = None
    preferences: Optional[Dict[str, Any]] = None
    timer_state: Optional[Dict[str, Any]] = None
    timestamp: Optional[int] = None


def normalize_rule(rule: str) -> str:
    r = rule.strip().lower()
    for prefix in ("https://", "http://"):
        if r.startswith(prefix):
            r = r[len(prefix) :]
    if r.startswith("www."):
        r = r[4:]
    return r.rstrip("/")


def split_url(url: str) -> Tuple[str, str]:
    p = urlparse(url)
    host = (p.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host, p.path.rstrip("/").lower()


def rule_matches(rule: str, host: str, path: str) -> bool:
    if not host:
        return False
    if "/" not in rule:
        return host == rule or host.endswith("." + rule)
    rule_host, _, rule_path = rule.partition("/")
    rule_path = "/" + rule_path
    host_ok = host == rule_host or host.endswith("." + rule_host)
    return host_ok and (path == rule_path or path.startswith(rule_path + "/"))


def client_rule_classify(url: str, focus_rules: List[str], break_rules: List[str]) -> Optional[str]:
    host, path = split_url(url)
    best_len, best_cat = -1, None
    for rule in focus_rules:
        if rule and rule_matches(rule, host, path) and len(rule) >= best_len:
            best_len, best_cat = len(rule), "F"
    for rule in break_rules:
        if rule and rule_matches(rule, host, path) and len(rule) > best_len:
            best_len, best_cat = len(rule), "B"
    return best_cat


def describe(tab: TabItem) -> str:
    host, path = split_url(tab.url)
    return f"{tab.title[:70]} | {host}{path[:40]}"


def parse_output(raw: str) -> Dict[int, str]:
    results: Dict[int, str] = {}
    for part in raw.replace("\n", ",").split(","):
        if ":" in part:
            idx, cat = part.split(":", 1)
            idx, cat = idx.strip(), cat.strip().upper()
            if idx.isdigit() and cat in ("F", "B"):
                results[int(idx)] = cat
    return results


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "app": "LokkedIn",
        "model": MODEL,
        "dev_mode": DEV_MODE,
        "active_user_sessions": session_manager.active_user_count,
    }


@app.post("/api/auth/session")
def issue_client_session(payload: Optional[SessionInitRequest] = None):
    raw_id = (payload.client_id if payload and payload.client_id else None) or secrets.token_hex(12)
    token = create_signed_client_token(raw_id)
    user_id = verify_signed_client_token(token) or f"client:{raw_id}"
    session_manager.get_or_create(user_id)
    return {
        "token": token,
        "token_type": "Bearer",
        "user_id": user_id,
    }


@app.get("/api/me")
async def get_me(session: UserSession = Depends(get_current_session)):
    return {
        "user_id": session.user_id,
        "email": session.email,
        "cache_entries": len(session.cache),
        "cache_limit": USER_CACHE_LIMIT,
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "total_requests": session.total_requests,
        "total_llm_calls": session.total_llm_calls,
        "total_cache_hits": session.total_cache_hits,
    }


@app.delete("/api/cache")
async def clear_user_cache(session: UserSession = Depends(get_current_session)):
    cleared = session.cache.clear()
    return {
        "status": "cleared",
        "user_id": session.user_id,
        "cleared_entries": cleared,
    }


@app.post("/api/contact")
async def submit_contact(
    payload: ContactSubmissionRequest,
    session: UserSession = Depends(get_current_session),
):
    logger.info(
        "/api/contact [user=%s, email=%s]: message=%r preferences=%s",
        session.user_id,
        payload.email or session.email,
        payload.message,
        payload.preferences,
    )
    return {
        "status": "received",
        "user_id": session.user_id,
        "email": payload.email or session.email,
    }


@app.post("/api/analyze-tabs")
async def analyze_tabs(
    payload: TabAnalysisRequest,
    session: UserSession = Depends(get_current_session),
):
    session.check_rate_limit()
    start_time = time.perf_counter()

    logger.info(
        "/api/analyze-tabs [user=%s]: %d tab(s), %d focus rule(s), %d break rule(s)",
        session.user_id,
        len(payload.tabs),
        len(payload.always_focus),
        len(payload.always_break),
    )

    topic = (payload.target_topic or "").strip()
    notes = (payload.notes or "").strip()[:500]
    focus_rules = [normalize_rule(r) for r in payload.always_focus[:MAX_RULES]]
    break_rules = [normalize_rule(r) for r in payload.always_break[:MAX_RULES]]

    tabs = payload.tabs[:MAX_TABS]
    categories: Dict[int, str] = {}
    sources: Dict[int, str] = {}
    pending: List[int] = []

    for i, tab in enumerate(tabs):
        rule_cat = client_rule_classify(tab.url, focus_rules, break_rules)
        if rule_cat:
            categories[i], sources[i] = rule_cat, "rule"
            continue
        cached = session.cache.get((topic, notes, tab.url))
        if cached:
            categories[i], sources[i] = cached, "cache"
            session.total_cache_hits += 1
            continue
        pending.append(i)

    raw_text = ""
    if pending:
        tabs_text = "\n".join(f"{n}. {describe(tabs[i])}" for n, i in enumerate(pending))
        prompt = f"Target Topic: {topic}\n"
        if notes:
            prompt += f"User Notes: {notes}\n"
        prompt += f"\nTabs:\n{tabs_text}"

        if DEBUG:
            logger.debug("--- PROMPT ---\n%s\n--------------", prompt)

        try:
            response = await client.aio.models.generate_content(
                model=MODEL,
                contents=prompt,
                config=GENAI_CONFIG,
            )
            session.total_llm_calls += 1
            um = response.usage_metadata
            if um:
                logger.info(
                    "tokens [user=%s]: prompt=%s output=%s thoughts=%s",
                    session.user_id,
                    um.prompt_token_count,
                    um.candidates_token_count,
                    um.thoughts_token_count,
                )
        except Exception as e:
            elapsed = round(time.perf_counter() - start_time, 2)
            logger.error("Gemini error after %ss: %r", elapsed, e)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Gemini API error: {str(e)}",
            ) from e

        raw_text = response.text.strip() if response.text else ""
        if DEBUG:
            logger.debug("--- RESPONSE ---\n%s\n----------------", raw_text)

        parsed = parse_output(raw_text)

        for n, i in enumerate(pending):
            if n in parsed:
                categories[i], sources[i] = parsed[n], "llm"
                session.cache.set((topic, notes, tabs[i].url), parsed[n])
            else:
                categories[i], sources[i] = "B", "default"

    elapsed = round(time.perf_counter() - start_time, 2)
    logger.info(
        "Done in %ss [user=%s] (llm_calls=%d, pending=%d, user_cache_size=%d)",
        elapsed,
        session.user_id,
        1 if pending else 0,
        len(pending),
        len(session.cache),
    )

    return {
        "status": "success",
        "elapsed_seconds": elapsed,
        "user_id": session.user_id,
        "target_topic": topic,
        "tabs": [
            {"url": tab.url, "category": categories[i], "source": sources[i]}
            for i, tab in enumerate(tabs)
        ],
        "llm_calls": 1 if pending else 0,
        "user_cache_size": len(session.cache),
        "raw_output": raw_text,
    }


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=DEV_MODE)
