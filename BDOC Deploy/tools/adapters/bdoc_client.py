#!/usr/bin/env python3
"""Shared BDOC IPC client used by every adapter (Wireshark, inSSIDer, Meshtastic, ...).

BDOC is the receiver; adapters are the throwers. Adapters must NEVER crash the
source app, so every send failure is swallowed and counted, not raised.
"""

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request

BDOC_HOST = os.environ.get("BDOC_IPC_HOST", "127.0.0.1")
BDOC_PORT = int(os.environ.get("BDOC_IPC_PORT", "9876"))
BASE_URL = f"http://{BDOC_HOST}:{BDOC_PORT}/api/v1"


class BDOCClient:
    """Fire-and-forget POST client with a background queue and backoff."""

    def __init__(self, route, quiet=False, timeout=2.0):
        self.route = route.strip("/")
        self.url = f"{BASE_URL}/{self.route}"
        self.quiet = quiet
        self.timeout = timeout
        self.sent = 0
        self.failed = 0
        self.last_error = None
        self._offline_until = 0.0

    def status(self):
        """Return receiver status dict, or None if BDOC is not running."""
        try:
            with urllib.request.urlopen(f"{BASE_URL}/status", timeout=self.timeout) as r:
                return json.loads(r.read().decode())
        except Exception:
            return None

    def send(self, payload):
        """POST one record. Returns True on 2xx."""
        now = time.time()
        if now < self._offline_until:
            self.failed += 1
            return False

        body = json.dumps(payload).encode()
        req = urllib.request.Request(
            self.url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                r.read()
                self.sent += 1
                return True
        except urllib.error.HTTPError as e:
            # 4xx = our payload is wrong; surface it, it's a bug not an outage.
            detail = e.read().decode(errors="replace")[:200]
            self.failed += 1
            self.last_error = f"HTTP {e.code}: {detail}"
            if not self.quiet:
                print(f"[bdoc] {self.route} rejected: {self.last_error}", file=sys.stderr)
            return False
        except Exception as e:
            # Receiver down: back off 5s so we don't hammer a dead port.
            self.failed += 1
            self.last_error = str(e)
            self._offline_until = now + 5.0
            if not self.quiet:
                print(f"[bdoc] {self.route} unreachable ({e}); backing off 5s", file=sys.stderr)
            return False

    def stats(self):
        return {"route": self.route, "sent": self.sent, "failed": self.failed,
                "last_error": self.last_error}


class RateLimiter:
    """Cap records/sec so a busy interface can't flood the globe."""

    def __init__(self, per_sec):
        self.per_sec = max(0.0, float(per_sec))
        self._tokens = self.per_sec
        self._last = time.time()
        self._lock = threading.Lock()

    def allow(self):
        if self.per_sec <= 0:
            return True
        with self._lock:
            now = time.time()
            self._tokens = min(self.per_sec, self._tokens + (now - self._last) * self.per_sec)
            self._last = now
            if self._tokens >= 1.0:
                self._tokens -= 1.0
                return True
            return False
