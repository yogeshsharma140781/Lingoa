"""
When should the AI offer to wrap up or switch topic? Pure rules (no network), so they can be tested.

The model judges the conversation ("continue" / "switch" / "end"); these rules decide whether it may
be asked at all, clean up its answer, and choose the next topic.
"""

import random
from typing import Iterable, Optional

# Not before the learner has said this many things: an offer in the first exchanges is just annoying.
MIN_USER_TURNS = 4
# After an offer (whatever they chose), stay quiet for this many of their turns.
COOLDOWN_TURNS = 5
# Backstop for people who talk a lot and never reach a natural close: offer a change anyway.
FORCE_AFTER_TURNS = 12

Verdict = str  # "continue" | "switch" | "end"

WRAP_SYSTEM_PROMPT = """You watch a spoken practice conversation between an AI partner and a language learner, and decide whether it has reached a natural point to change topic or stop. You only see the last few lines.

Answer with JSON: {"verdict": "continue" | "switch" | "end"}

"end": the exchange has reached a natural conclusion. For example the learner says goodbye or "that's all", the little scene they were playing is finished (the coffee is ordered and paid, the directions are given), or both sides have clearly wrapped up.
"switch": the subject has been explored for several turns and is running dry. For example the learner's answers are getting shorter, they say they do not know or skip, or the AI is starting to repeat or rephrase the same question.
"continue": anything else. The learner is engaged, the topic still has life in it, or you are not sure.

Be conservative. A learner who is still talking happily should never be interrupted. When in doubt, answer "continue"."""


def may_check(user_turns: int, last_offer_turn: Optional[int]) -> bool:
    """Is the model allowed to be asked? (Enough turns so far, and not right after an earlier offer.)
    `last_offer_turn` is the learner's turn count when the last offer was made, None if there was none."""
    if user_turns < MIN_USER_TURNS:
        return False
    return last_offer_turn is None or user_turns - last_offer_turn >= COOLDOWN_TURNS


def must_offer(user_turns: int, last_offer_turn: Optional[int]) -> bool:
    """Has the conversation gone on so long since the last offer (or the start) that one is due whatever the model says?"""
    return user_turns - (last_offer_turn or 0) >= FORCE_AFTER_TURNS


def clean_verdict(parsed: object, is_roleplay: bool) -> Verdict:
    """The model's JSON as a safe verdict. Anything odd means "continue". In a role-play there is no
    topic to switch (the scene is the topic), so only an ending can be offered."""
    verdict = parsed.get("verdict") if isinstance(parsed, dict) else None
    if verdict not in ("switch", "end"):
        return "continue"
    if is_roleplay and verdict == "switch":
        return "continue"
    return verdict


def forced_verdict(is_roleplay: bool) -> Verdict:
    return "end" if is_roleplay else "switch"


def pick_next_topic(topics: Iterable[str], current: Optional[str], used: Iterable[str], rng: Optional[random.Random] = None) -> str:
    """A topic they have not just had: never "random" (it is the open-ended one) and never the current one.
    When every topic has been used, start over with all but the current one."""
    rng = rng or random
    candidates = [t for t in topics if t != "random"]
    used_set = set(used)
    fresh = [t for t in candidates if t != current and t not in used_set]
    if not fresh:
        fresh = [t for t in candidates if t != current]
    return rng.choice(fresh) if fresh else (current or "random")
