"""Run-time random tag selection for Prompt Assistant text widgets."""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from secrets import choice
from time import monotonic
from typing import Any, Callable, Iterable, Mapping


RANDOM_PROPERTY_KEY = "prompt_assistant_runtime_random"
LOCK_TTL_SECONDS = 300


@dataclass(frozen=True)
class Candidate:
    """A selectable CSV leaf value and its category path."""

    path: tuple[str, ...]
    value: str


class LockedSelectionStore:
    """Short-lived selection cache scoped to one Comfy queue action."""

    def __init__(self, ttl_seconds: float = LOCK_TTL_SECONDS):
        self.ttl_seconds = ttl_seconds
        self._values: dict[tuple[str, ...], tuple[float, Candidate]] = {}

    def get_or_create(
        self,
        key: tuple[str, ...],
        candidates: list[Candidate],
        chooser: Callable[[list[Candidate]], Candidate] = choice,
    ) -> Candidate:
        self._purge_expired()
        if key in self._values:
            return self._values[key][1]
        selected = chooser(candidates)
        self._values[key] = (monotonic(), selected)
        return selected

    def _purge_expired(self) -> None:
        cutoff = monotonic() - self.ttl_seconds
        self._values = {
            key: value for key, value in self._values.items()
            if value[0] >= cutoff
        }


LOCKED_SELECTIONS = LockedSelectionStore()


def _leaf_candidates(tree: Mapping[str, Any], path: tuple[str, ...] = ()) -> list[Candidate]:
    candidates: list[Candidate] = []
    for key, value in tree.items():
        next_path = (*path, str(key))
        if isinstance(value, Mapping):
            candidates.extend(_leaf_candidates(value, next_path))
        elif isinstance(value, str) and value.strip():
            candidates.append(Candidate(next_path, value.strip()))
    return candidates


def _node_at_path(tree: Mapping[str, Any], path: Iterable[str]) -> Any:
    current: Any = tree
    for segment in path:
        if not isinstance(current, Mapping) or segment not in current:
            return None
        current = current[segment]
    return current


def _candidates_for_path(tree: Mapping[str, Any], path: Iterable[str]) -> list[Candidate]:
    normalized_path = tuple(str(segment) for segment in path)
    node = _node_at_path(tree, normalized_path)
    if isinstance(node, Mapping):
        return _leaf_candidates(node, normalized_path)
    if isinstance(node, str) and node.strip():
        return [Candidate(normalized_path, node.strip())]
    return []


def resolve_candidates(tree: Mapping[str, Any], selections: Iterable[Mapping[str, Any]]) -> list[Candidate]:
    """Resolve hierarchy selections into one ordered, unique candidate pool.

    A selection path may point to a category or a leaf. The frontend writes only
    the most specific chosen paths, so a category contributes every descendant
    leaf unless it has been refined by selected descendants. Individual leaves
    naturally contribute only themselves.
    """
    selected_paths = list(dict.fromkeys(
        tuple(str(segment) for segment in item.get("path", ()))
        for item in selections
        if isinstance(item, Mapping) and item.get("path")
    ))
    if not selected_paths:
        return []

    # Drop an ancestor when a selected child exists: the child intentionally
    # narrows the ancestor's all-descendants default range. Keep the selection
    # order so diagnostics and tests match the order visible in the panel.
    effective_paths = [
        path for path in selected_paths
        if not any(other != path and other[:len(path)] == path for other in selected_paths)
    ]

    unique: OrderedDict[str, Candidate] = OrderedDict()
    for path in effective_paths:
        for candidate in _candidates_for_path(tree, path):
            unique.setdefault(candidate.value, candidate)
    return list(unique.values())


def join_prompt_text(fixed_text: Any, random_text: str) -> str:
    """Combine a fixed widget value and one selected tag without dirtying UI text."""
    fixed = "" if fixed_text is None else str(fixed_text).strip()
    selected = str(random_text).strip()
    if not fixed:
        return selected
    if not selected:
        return fixed
    if fixed.endswith((",", "，", ";", "；", "\n")):
        return f"{fixed} {selected}"
    return f"{fixed}, {selected}"


def choose_candidate(
    candidates: list[Candidate],
    *,
    locked: bool,
    lock_key: tuple[str, ...] | None,
    chooser: Callable[[list[Candidate]], Candidate] = choice,
) -> Candidate:
    """Choose once per submission, or reuse within a locked queue group."""
    if not candidates:
        raise ValueError("Cannot choose from an empty random-prompt candidate pool")
    if locked and lock_key:
        return LOCKED_SELECTIONS.get_or_create(lock_key, candidates, chooser)
    return chooser(candidates)
