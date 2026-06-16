"""In-process TTL cache — replaces Redis for single-user local deployment."""
import time
from threading import Lock


class TTLCache:
    def __init__(self, ttl: int = 60) -> None:
        self._store: dict[str, tuple[object, float]] = {}
        self._ttl = ttl
        self._lock = Lock()

    def get(self, key: str) -> object | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            val, ts = entry
            if time.monotonic() - ts > self._ttl:
                del self._store[key]
                return None
            return val

    def set(self, key: str, val: object) -> None:
        with self._lock:
            self._store[key] = (val, time.monotonic())

    def invalidate_prefix(self, prefix: str) -> None:
        with self._lock:
            for key in [k for k in self._store if k.startswith(prefix)]:
                del self._store[key]


# Module-level singleton; 60-second TTL is fine for single-user interactive use
query_cache = TTLCache(ttl=60)
