# ComfyUI Prompt Assistant Random

This is a personal modification of [yawiii/ComfyUI-Prompt-Assistant](https://github.com/yawiii/ComfyUI-Prompt-Assistant).

The upstream project provides prompt assistance, tag management, prompt enhancement, translation, image/video captioning, and related tools. The upstream project and this modification are licensed under [GNU GPL v3.0](LICENSE).

## Features added in this repository

### Runtime random prompt tags

A **Runtime Random Prompt** button is provided next to the original manual tag tool. It does not rewrite the fixed text in the prompt field. When ComfyUI queues/runs the workflow, it selects exactly one tag from the configured candidate pool and temporarily appends it to the submitted prompt.

Downstream nodes, including Show Text, receive the actual prompt used for that execution:

```text
fixed prompt, randomly selected prompt tag
```

### Hierarchical random selection

You can select multiple categories, tags within categories, or individual prompt tags. All eligible values form one candidate pool, and exactly one value is selected.

- Selecting a category without selecting a child uses all prompt tags below that category.
- Selecting child tags narrows the category to those selected branches.
- Selecting individual prompt tags narrows the branch to those exact values.
- Multiple categories can be combined into one pool; only one final value is selected.

### Locking a queue batch

- **Unlocked:** every execution in a queued batch selects a new prompt tag.
- **Locked:** all executions in one Queue action reuse the first selected tag; the next Queue action selects again.

## Upstream project

- Upstream repository: https://github.com/yawiii/ComfyUI-Prompt-Assistant
- See the upstream repository for the original installation instructions and feature documentation.
- If this project is useful, please visit the upstream repository and give the original author a Star.

## Language

The Chinese README is the default documentation. This file provides an English version for international users.
