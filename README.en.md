# ComfyUI Prompt Assistant Random

This is a personal modification of [yawiii/ComfyUI-Prompt-Assistant](https://github.com/yawiii/ComfyUI-Prompt-Assistant).

The upstream project provides prompt assistance, a tag panel, prompt enhancement, translation, and image/video captioning. The upstream project and this modified version are licensed under [GNU GPL v3.0](LICENSE).

## Features added in this fork

### Runtime random prompt tags

A new **Runtime Random Prompt** button is available alongside the original manual tag tool. It never rewrites the fixed text authored in the prompt field. Instead, when ComfyUI queues/runs the workflow, it randomly chooses **one** tag value from the selected pool and temporarily appends it to the submitted prompt.

Downstream nodes, including Show Text, receive the actual text used for the run:

```text
fixed prompt, randomly selected prompt tag
```

### Hierarchical random pool selection

Select multiple categories, tags inside a category, or individual prompt tags. All eligible values form one pool, and exactly one value is selected per run.

- A selected category with no selected child includes all of its descendant prompt tags.
- Selecting child tags narrows the selected category to those tags.
- Selecting individual tags narrows the selected tag branch to those individual values.
- Multiple categories may be mixed, but only one final value is chosen from the combined pool.

### Lock a random result for a queue batch

- **Unlocked:** every execution in a batch queue draws a new prompt tag.
- **Locked:** every execution in one Queue action reuses the first selected tag; the next Queue action starts a new selection.

## Upstream project

- Upstream repository: https://github.com/yawiii/ComfyUI-Prompt-Assistant
- See the upstream repository for installation instructions, original features, and changelog.
