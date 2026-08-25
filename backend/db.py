"""
Persistent storage for Lingoa - Postgres via asyncpg.

Replaces what used to be plain in-memory dicts (user_streaks, daily_completions),
which got wiped on every backend restart/deploy. Also adds a minimal events log
so real usage (opened app / started a session / completed a session) can actually
be measured over time instead of disappearing with the process.

Deliberately NOT an ORM - this is a handful of tables for a small app, plain SQL
via asyncpg is simpler to read and debug than adding SQLAlchemy for this scale.
"""

import os
import json
from datetime import date, timedelta
from typing import Optional

import asyncpg

_pool: Optional[asyncpg.Pool] = None


async def init_db() -> None:
    """Create the connection pool and make sure tables exist. Call once at startup."""
    global _pool

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("[DB] No DATABASE_URL set - persistence disabled, falling back to in-memory only.")
        return

    try:
        _pool = await asyncpg.create_pool(database_url, min_size=1, max_size=5, command_timeout=10)
        async with _pool.acquire() as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS user_stats (
                    user_id TEXT PRIMARY KEY,
                    streak INTEGER NOT NULL DEFAULT 0,
                    last_completed_date DATE,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                """
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS events (
                    id BIGSERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    target_language TEXT,
                    session_id TEXT,
                    metadata JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                """
            )
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);")
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);")
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);")
        print("[DB] Connected and schema ready.")
    except Exception as e:
        print(f"[DB] Failed to connect/initialize: {e}")
        _pool = None


async def close_db() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def is_available() -> bool:
    return _pool is not None


async def get_user_stats(user_id: str) -> dict:
    """Returns {"streak": int, "completed_today": bool}. Falls back to zeros if DB is unavailable."""
    if not _pool:
        return {"streak": 0, "completed_today": False}
    try:
        async with _pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT streak, last_completed_date FROM user_stats WHERE user_id = $1", user_id
            )
        if not row:
            return {"streak": 0, "completed_today": False}
        completed_today = row["last_completed_date"] == date.today()
        return {"streak": row["streak"], "completed_today": completed_today}
    except Exception as e:
        print(f"[DB] get_user_stats failed: {e}")
        return {"streak": 0, "completed_today": False}


async def record_completion(user_id: str) -> int:
    """
    Record that the user completed a full (>=5min) session today, and return
    their up-to-date streak.

    Streak rules:
    - Completing more than once on the same day does NOT double-count.
    - Completing on the day right after the last completed day continues the streak.
    - Any gap of more than one day resets the streak to 1.
    - If persistence is unavailable, returns 1 as a harmless fallback (matches
      old in-memory behavior's rough shape without crashing the request).
    """
    if not _pool:
        return 1

    today = date.today()
    try:
        async with _pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    "SELECT streak, last_completed_date FROM user_stats WHERE user_id = $1 FOR UPDATE",
                    user_id,
                )

                if row is None:
                    new_streak = 1
                    await conn.execute(
                        "INSERT INTO user_stats (user_id, streak, last_completed_date) VALUES ($1, $2, $3)",
                        user_id, new_streak, today,
                    )
                    return new_streak

                last_date = row["last_completed_date"]
                current_streak = row["streak"]

                if last_date == today:
                    # Already completed today - don't double count a second session.
                    return current_streak

                if last_date == today - timedelta(days=1):
                    new_streak = current_streak + 1
                else:
                    # Missed at least one day (or very first completion) - restart.
                    new_streak = 1

                await conn.execute(
                    "UPDATE user_stats SET streak = $1, last_completed_date = $2, updated_at = now() WHERE user_id = $3",
                    new_streak, today, user_id,
                )
                return new_streak
    except Exception as e:
        print(f"[DB] record_completion failed: {e}")
        return 1


async def log_event(
    user_id: str,
    event_type: str,
    target_language: Optional[str] = None,
    session_id: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    """Best-effort usage event logging. Never raises - a logging failure should
    never break the actual request it's attached to."""
    if not _pool:
        return
    try:
        async with _pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO events (user_id, event_type, target_language, session_id, metadata)
                VALUES ($1, $2, $3, $4, $5)
                """,
                user_id,
                event_type,
                target_language,
                session_id,
                json.dumps(metadata) if metadata is not None else None,
            )
    except Exception as e:
        print(f"[DB] log_event({event_type}) failed: {e}")
