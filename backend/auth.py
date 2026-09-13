"""
Optional Clerk verification for the sync endpoints.

PostureGuard is guest-first: a participant never needs an account, so the API
must keep working for anonymous clients. Auth therefore has three modes, chosen
by environment rather than by a flag the caller can influence:

* **disabled**  - no Clerk key configured. Anonymous sync is accepted. This is
  the local-development and pilot default, and /api/health says so out loud.
* **optional**  - a key is configured. A valid token attaches a user id to the
  session; a request without one is still accepted as anonymous.
* **required**  - CLERK_REQUIRE_AUTH=1. Only authenticated requests are stored.

Verification is done against the PEM public key when CLERK_JWT_KEY is set, which
is a local signature check with no outbound request per API call.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

CLERK_SECRET_KEY = os.environ.get("CLERK_SECRET_KEY", "").strip()
CLERK_JWT_KEY = os.environ.get("CLERK_JWT_KEY", "").strip()
REQUIRE_AUTH = os.environ.get("CLERK_REQUIRE_AUTH", "").strip() in {"1", "true", "yes"}

AUTHORIZED_PARTIES = [
    p.strip() for p in os.environ.get("CLERK_AUTHORIZED_PARTIES", "").split(",") if p.strip()
]


def configured() -> bool:
    return bool(CLERK_SECRET_KEY or CLERK_JWT_KEY)


def mode() -> str:
    if not configured():
        return "disabled"
    return "required" if REQUIRE_AUTH else "optional"


@dataclass(frozen=True)
class Identity:
    """Who a request belongs to. user_id is None for an anonymous guest."""

    user_id: str | None
    authenticated: bool

    @property
    def is_guest(self) -> bool:
        return not self.authenticated


GUEST = Identity(user_id=None, authenticated=False)


def identify(request) -> Identity:
    """
    Resolve the caller. Never raises: a malformed or expired token is treated as
    an anonymous request, and it is the caller's job to reject that when the
    deployment requires auth.
    """
    if not configured():
        return GUEST

    try:
        from clerk_backend_api import Clerk
        from clerk_backend_api.jwks_helpers import AuthenticateRequestOptions
    except ImportError:
        # The SDK is an optional dependency; without it we cannot verify, so we
        # must not pretend the request is authenticated.
        return GUEST

    try:
        with Clerk(bearer_auth=CLERK_SECRET_KEY or None) as clerk:
            options = AuthenticateRequestOptions(
                authorized_parties=AUTHORIZED_PARTIES or None,
                jwt_key=CLERK_JWT_KEY or None,
            )
            state = clerk.authenticate_request(request, options)
            if not state.is_signed_in:
                return GUEST
            payload = state.payload or {}
            return Identity(user_id=payload.get("sub"), authenticated=True)
    except Exception:
        return GUEST
