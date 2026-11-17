"""Peças falsas para testar o Engine sem o D6: aparelho (FakeDeck), relógio (FakeClock) e a montagem (EngineRig)."""

from tests.fakes.clock import FakeClock
from tests.fakes.deck import DeckProtocol, FakeDeck, FakeDeckFactory, decode

__all__ = ["DeckProtocol", "FakeClock", "FakeDeck", "FakeDeckFactory", "decode"]
