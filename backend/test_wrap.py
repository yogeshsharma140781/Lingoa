import random
import wrap


def test_not_asked_too_early_or_too_often():
    assert not wrap.may_check(3, None)
    assert wrap.may_check(4, None)
    assert not wrap.may_check(8, 5)  # only 3 turns since the last offer
    assert wrap.may_check(10, 5)


def test_backstop():
    assert not wrap.must_offer(11, None)
    assert wrap.must_offer(12, None)
    assert not wrap.must_offer(15, 6)


def test_verdict_is_conservative():
    assert wrap.clean_verdict({"verdict": "switch"}, False) == "switch"
    assert wrap.clean_verdict({"verdict": "end"}, False) == "end"
    assert wrap.clean_verdict({"verdict": "continue"}, False) == "continue"
    for odd in (None, "end", [], {}, {"verdict": 3}, {"verdict": "STOP"}):
        assert wrap.clean_verdict(odd, False) == "continue"


def test_roleplay_can_only_end():
    assert wrap.clean_verdict({"verdict": "switch"}, True) == "continue"
    assert wrap.clean_verdict({"verdict": "end"}, True) == "end"
    assert wrap.forced_verdict(True) == "end"
    assert wrap.forced_verdict(False) == "switch"


def test_next_topic_is_new():
    topics = ["daily", "food", "random", "travel"]
    rng = random.Random(1)
    for _ in range(50):
        t = wrap.pick_next_topic(topics, "daily", ["food"], rng)
        assert t == "travel"  # the only one that is neither current, used nor "random"
    # all used: start over, but not the current one
    for _ in range(50):
        t = wrap.pick_next_topic(topics, "daily", ["food", "travel", "daily"], rng)
        assert t in ("food", "travel")
    assert wrap.pick_next_topic(["random"], "random", [], rng) == "random"
