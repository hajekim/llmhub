import pytest
from scrape_prices import parse_price, merge


def test_parse_price_standard():
    assert parse_price("$1.25 / MTok") == 1.25

def test_parse_price_small():
    assert parse_price("$0.075 / MTok") == 0.075

def test_parse_price_none():
    assert parse_price("N/A") is None

def test_merge_updates_price():
    existing = {"models": [{"id": "m1", "name": "M1", "provider": "x",
                             "input_price_per_mtok": 1.0, "output_price_per_mtok": 2.0,
                             "deprecated": False}]}
    scraped = [{"id": "m1", "name": "M1", "provider": "x",
                "input_price_per_mtok": 1.5, "output_price_per_mtok": 3.0,
                "deprecated": False}]
    result = merge(existing, scraped)
    m = next(m for m in result["models"] if m["id"] == "m1")
    assert m["input_price_per_mtok"] == 1.5

def test_merge_preserves_long_context():
    existing = {"models": [{"id": "m1", "name": "M1", "provider": "x",
                             "input_price_per_mtok": 1.0, "output_price_per_mtok": 2.0,
                             "deprecated": False,
                             "long_context": {"threshold_tokens": 200000,
                                              "input_price_per_mtok": 2.0,
                                              "output_price_per_mtok": 2.0}}]}
    scraped = [{"id": "m1", "name": "M1", "provider": "x",
                "input_price_per_mtok": 1.5, "output_price_per_mtok": 2.5,
                "deprecated": False}]
    result = merge(existing, scraped)
    m = next(m for m in result["models"] if m["id"] == "m1")
    assert "long_context" in m

def test_merge_adds_new_model():
    existing = {"models": []}
    scraped = [{"id": "new", "name": "New", "provider": "x",
                "input_price_per_mtok": 0.5, "output_price_per_mtok": 1.0,
                "deprecated": False}]
    result = merge(existing, scraped)
    assert len(result["models"]) == 1
