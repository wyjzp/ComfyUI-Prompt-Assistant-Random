from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SERVICE_PATH = PLUGIN_ROOT / "services" / "runtime_random_prompt.py"
SPEC = importlib.util.spec_from_file_location("runtime_random_prompt", SERVICE_PATH)
runtime_random_prompt = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runtime_random_prompt
SPEC.loader.exec_module(runtime_random_prompt)

Candidate = runtime_random_prompt.Candidate
LockedSelectionStore = runtime_random_prompt.LockedSelectionStore
choose_candidate = runtime_random_prompt.choose_candidate
join_prompt_text = runtime_random_prompt.join_prompt_text
resolve_candidates = runtime_random_prompt.resolve_candidates


TREE = {
    "A": {
        "一": {"a1": "a1", "a2": "a2"},
        "二": {"a3": "a3", "a4": "a4"},
        "三": {"a5": "a5"},
    },
    "B": {
        "一": {"b1": "b1", "b2": "b2", "b3": "b3"},
    },
    "C": {
        "一": {"c1": "c1"},
        "二": {"c2": "c2"},
    },
}


def values(selections):
    return [candidate.value for candidate in resolve_candidates(TREE, selections)]


class RuntimeRandomPromptTests(unittest.TestCase):
    def test_selected_category_includes_all_descendants(self):
        self.assertEqual(values([{"path": ["A"]}]), ["a1", "a2", "a3", "a4", "a5"])

    def test_selected_children_refine_selected_parent(self):
        self.assertEqual(
            values([{"path": ["A"]}, {"path": ["A", "二"]}, {"path": ["A", "三"]}]),
            ["a3", "a4", "a5"],
        )

    def test_selected_leaf_refines_selected_tag_and_category(self):
        self.assertEqual(
            values([{"path": ["B"]}, {"path": ["B", "一"]}, {"path": ["B", "一", "b1"]}, {"path": ["B", "一", "b3"]}]),
            ["b1", "b3"],
        )

    def test_multiple_top_categories_form_one_pool(self):
        self.assertEqual(
            values([
                {"path": ["A", "二"]},
                {"path": ["A", "三"]},
                {"path": ["B", "一", "b1"]},
                {"path": ["B", "一", "b3"]},
                {"path": ["C"]},
            ]),
            ["a3", "a4", "a5", "b1", "b3", "c1", "c2"],
        )

    def test_join_preserves_fixed_prompt(self):
        self.assertEqual(join_prompt_text("fixed prompt", "random tag"), "fixed prompt, random tag")
        self.assertEqual(join_prompt_text("fixed prompt,", "random tag"), "fixed prompt, random tag")
        self.assertEqual(join_prompt_text("", "random tag"), "random tag")

    def test_locked_choice_reuses_the_first_value(self):
        store = LockedSelectionStore()
        candidates = [Candidate(("A",), "first"), Candidate(("B",), "second")]
        calls = []

        def chooser(pool):
            calls.append(pool)
            return pool[-1]

        first = store.get_or_create(("client", "group", "1", "text"), candidates, chooser)
        second = store.get_or_create(("client", "group", "1", "text"), candidates, chooser)
        self.assertEqual(first.value, "second")
        self.assertEqual(second.value, "second")
        self.assertEqual(len(calls), 1)

    def test_unlocked_choice_calls_chooser_per_run(self):
        candidates = [Candidate(("A",), "first")]
        calls = []
        chooser = lambda pool: calls.append(pool) or pool[0]
        choose_candidate(candidates, locked=False, lock_key=None, chooser=chooser)
        choose_candidate(candidates, locked=False, lock_key=None, chooser=chooser)
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
