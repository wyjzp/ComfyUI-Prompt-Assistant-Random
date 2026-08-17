import { ResourceManager } from '../utils/resourceManager.js';
import { logger } from '../utils/logger.js';

const PROPERTY_KEY = 'prompt_assistant_runtime_random';
let activeOverlay = null;

function getConfig(node, inputName) {
    const root = node.properties?.[PROPERTY_KEY] || {};
    return root.targets?.[inputName] || {
        enabled: false,
        source_file: '',
        locked_for_queue: false,
        selections: [],
    };
}

function saveConfig(node, inputName, config) {
    node.properties ||= {};
    const root = node.properties[PROPERTY_KEY] ||= { version: 1, targets: {} };
    root.targets ||= {};
    root.targets[inputName] = config;
    node.setDirtyCanvas?.(true, true);
    node.graph?.setDirtyCanvas?.(true, true);
}

function collectLeaves(value, path = []) {
    if (typeof value === 'string' && value.trim()) {
        return [{ path, value: value.trim() }];
    }
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, child]) => collectLeaves(child, [...path, key]));
}

function pathKey(path) {
    return JSON.stringify(path);
}

function normalizeSelections(selections) {
    const unique = new Map();
    for (const selection of selections || []) {
        if (Array.isArray(selection?.path) && selection.path.length) {
            unique.set(pathKey(selection.path), { path: selection.path });
        }
    }
    return [...unique.values()];
}

function candidateCount(data, selections) {
    const selected = normalizeSelections(selections);
    const selectedPaths = selected.map(item => item.path);
    const effective = selectedPaths.filter(path => !selectedPaths.some(
        other => other.length > path.length && path.every((part, index) => other[index] === part)
    ));
    const values = new Set();
    for (const path of effective) {
        let current = data;
        for (const segment of path) current = current?.[segment];
        for (const leaf of collectLeaves(current, path)) values.add(leaf.value);
    }
    return values.size;
}

function styleOverlay() {
    if (document.getElementById('pa-runtime-random-styles')) return;
    const style = document.createElement('style');
    style.id = 'pa-runtime-random-styles';
    style.textContent = `
        .pa-runtime-random-overlay { position: fixed; z-index: 10000; width: min(620px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 32px)); display: flex; flex-direction: column; color: var(--fg-color, #ddd); background: var(--comfy-menu-bg, #252525); border: 1px solid var(--border-color, #555); border-radius: 10px; box-shadow: 0 12px 32px #0009; font: 13px sans-serif; overflow: hidden; }
        .pa-runtime-random-titlebar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border-color, #555); }
        .pa-runtime-random-titlebar strong { flex: 1; font-size: 14px; }
        .pa-runtime-random-titlebar label { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
        .pa-runtime-random-tabs { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 12px 0; }
        .pa-runtime-random-tab { padding: 5px 12px; border-radius: 6px 6px 0 0; cursor: pointer; border: 1px solid var(--border-color, #555); border-bottom: 0; background: var(--comfy-input-bg, #333); color: inherit; }
        .pa-runtime-random-tab.active { background: var(--comfy-menu-bg, #2a2a2a); border-color: var(--input-text-color, #888); }
        .pa-runtime-random-tab .pa-count { opacity: .65; font-size: 11px; margin-left: 4px; }
        .pa-runtime-random-body { flex: 1; overflow: auto; padding: 12px; border-top: 1px solid var(--border-color, #555); }
        .pa-runtime-random-meta { margin: 0 0 10px; color: var(--descrip-text, #aaa); line-height: 1.5; }
        .pa-runtime-random-footer { display: flex; gap: 10px; justify-content: flex-end; align-items: center; padding: 10px 12px; border-top: 1px solid var(--border-color, #555); }
        .pa-runtime-random-group { margin-bottom: 10px; }
        .pa-runtime-random-group-title { display: flex; align-items: center; gap: 8px; padding: 6px 4px; cursor: pointer; user-select: none; font-weight: 600; }
        .pa-runtime-random-group-title .pa-arrow { transition: transform .15s; }
        .pa-runtime-random-group.open > .pa-runtime-random-group-title .pa-arrow { transform: rotate(90deg); }
        .pa-runtime-random-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .pa-runtime-random-chips.collapsed { display: none; }
        .pa-runtime-random-chip { padding: 5px 10px; border-radius: 8px; cursor: pointer; border: 1px solid var(--border-color, #555); background: var(--comfy-input-bg, #333); color: inherit; }
        .pa-runtime-random-chip:hover { border-color: var(--input-text-color, #999); }
        .pa-runtime-random-chip.selected { background: var(--success-bg, #2d5a3d); border-color: var(--success-text, #8fd19a); color: var(--success-text, #c6f0ce); }
        .pa-runtime-random-chip.leaf { background: var(--comfy-input-bg, #3a3a3a); }
        .pa-runtime-random-chip.leaf.selected { background: var(--success-bg, #2d5a3d); }
        .pa-runtime-random-chip .pa-value { opacity: .7; font-size: 11px; margin-left: 6px; }
        .pa-runtime-random-empty { padding: 30px 0; text-align: center; color: var(--descrip-text, #888); }
        .pa-runtime-random-overlay select, .pa-runtime-random-overlay button { color: inherit; background: var(--comfy-input-bg, #333); border: 1px solid var(--border-color, #555); border-radius: 5px; padding: 5px 10px; cursor: pointer; }
        .pa-runtime-random-footer .pa-save { background: var(--success-bg, #2d5a3d); border-color: var(--success-text, #8fd19a); }
    `;
    document.head.appendChild(style);
}

function toggleSelection(selectedPaths, path, onChange) {
    const key = pathKey(path);
    if (selectedPaths.has(key)) selectedPaths.delete(key);
    else selectedPaths.add(key);
    onChange();
}

function addChip(container, name, value, path, selectedPaths, onChange) {
    const key = pathKey(path);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'pa-runtime-random-chip' + (value !== undefined ? ' leaf' : '');
    chip.textContent = name;
    chip.dataset.path = key;
    if (value !== undefined) {
        const span = document.createElement('span');
        span.className = 'pa-value';
        span.textContent = value;
        chip.append(span);
    }
    const refresh = () => chip.classList.toggle('selected', selectedPaths.has(key));
    refresh();
    chip.onclick = () => {
        toggleSelection(selectedPaths, path, onChange);
        refresh();
    };
    container.append(chip);
}

function buildGroup(data, selectedPaths, onChange, path = []) {
    const group = document.createElement('div');
    group.className = 'pa-runtime-random-group open';
    const title = document.createElement('div');
    title.className = 'pa-runtime-random-group-title';
    const arrow = document.createElement('span');
    arrow.className = 'pa-arrow';
    arrow.textContent = '▸';
    const chips = document.createElement('div');
    chips.className = 'pa-runtime-random-chips';
    title.append(arrow);
    for (const [name, value] of Object.entries(data || {})) {
        const currentPath = [...path, name];
        if (value && typeof value === 'object') {
            title.append(buildGroupTitle(name, value, currentPath, selectedPaths, onChange, chips));
        } else {
            addChip(chips, name, value, currentPath, selectedPaths, onChange);
        }
    }
    title.addEventListener('click', () => group.classList.toggle('open'));
    group.append(title, chips);
    return group;
}

function buildGroupTitle(name, subtree, currentPath, selectedPaths, onChange, container) {
    const wrapper = document.createElement('span');
    wrapper.className = 'pa-runtime-random-group-title-name';
    const label = document.createElement('span');
    label.textContent = name;
    wrapper.append(label);
    wrapper.classList.toggle('selected', selectedPaths.has(pathKey(currentPath)));
    wrapper.onclick = (event) => {
        event.stopPropagation();
        toggleSelection(selectedPaths, currentPath, onChange);
        wrapper.classList.toggle('selected', selectedPaths.has(pathKey(currentPath)));
    };
    container.append(wrapper);
    // Render children beneath this group title.
    const childContainer = document.createElement('div');
    childContainer.className = 'pa-runtime-random-group';
    childContainer.append(buildGroup(subtree, selectedPaths, onChange, currentPath));
    container.append(childContainer);
    return wrapper;
}

export async function showRuntimeRandomPromptOverlay(widget) {
    const node = widget?.node;
    if (!node) return;
    activeOverlay?.remove();
    styleOverlay();

    const initial = getConfig(node, widget.inputId);
    const files = await ResourceManager.getTagFileList();
    const sourceFile = initial.source_file || await ResourceManager.getSelectedTagFile();
    let data = sourceFile ? await ResourceManager.loadTagsCsv(sourceFile) : {};
    const selectedPaths = new Set((initial.selections || []).map(item => pathKey(item.path)));

    const overlay = document.createElement('div');
    overlay.className = 'pa-runtime-random-overlay';
    activeOverlay = overlay;

    const titleBar = document.createElement('div');
    titleBar.className = 'pa-runtime-random-titlebar';
    const title = document.createElement('strong');
    title.textContent = '运行时随机提示词';
    const sourceSelect = document.createElement('select');
    for (const file of files) sourceSelect.add(new Option(file, file, false, file === sourceFile));
    const lockLabel = document.createElement('label');
    const locked = document.createElement('input');
    locked.type = 'checkbox';
    locked.checked = Boolean(initial.locked_for_queue);
    lockLabel.append(locked, document.createTextNode('锁定本批次'));
    const enabledLabel = document.createElement('label');
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = Boolean(initial.enabled);
    enabledLabel.append(enabled, document.createTextNode('启用随机'));
    const close = document.createElement('button');
    close.textContent = '×';
    close.onclick = () => overlay.remove();
    titleBar.append(title, sourceSelect, lockLabel, enabledLabel, close);

    const tabs = document.createElement('div');
    tabs.className = 'pa-runtime-random-tabs';
    const body = document.createElement('div');
    body.className = 'pa-runtime-random-body';
    const meta = document.createElement('p');
    meta.className = 'pa-runtime-random-meta';
    const content = document.createElement('div');

    let activeCategory = null;
    const render = () => {
        meta.textContent = `候选提示词：${candidateCount(data, [...selectedPaths].map(key => ({ path: JSON.parse(key) })))} 条。选上级而不选下级时将使用该上级全部提示词；选中下级或具体提示词时自动缩小范围。`;
        tabs.replaceChildren();
        content.replaceChildren();
        for (const [categoryName, subtree] of Object.entries(data || {})) {
            if (!subtree || typeof subtree !== 'object') continue;
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'pa-runtime-random-tab';
            const count = document.createElement('span');
            count.className = 'pa-count';
            count.textContent = String(collectLeaves(subtree).length);
            tab.append(document.createTextNode(categoryName), count);
            tab.onclick = () => {
                activeCategory = categoryName;
                tabs.querySelectorAll('.pa-runtime-random-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                content.replaceChildren(buildGroup(subtree, selectedPaths, render));
            };
            tabs.append(tab);
            if (!activeCategory) {
                activeCategory = categoryName;
                tab.classList.add('active');
            }
        }
        if (activeCategory && data?.[activeCategory] && typeof data[activeCategory] === 'object') {
            content.replaceChildren(buildGroup(data[activeCategory], selectedPaths, render));
        } else if (!content.childNodes.length) {
            const empty = document.createElement('div');
            empty.className = 'pa-runtime-random-empty';
            empty.textContent = '没有可用标签数据';
            content.append(empty);
        }
    };
    sourceSelect.onchange = async () => {
        data = await ResourceManager.loadTagsCsv(sourceSelect.value);
        selectedPaths.clear();
        activeCategory = null;
        render();
    };
    render();
    body.append(meta, content);

    const footer = document.createElement('div');
    footer.className = 'pa-runtime-random-footer';
    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    cancel.onclick = () => overlay.remove();
    const apply = document.createElement('button');
    apply.className = 'pa-save';
    apply.textContent = '保存';
    apply.onclick = () => {
        saveConfig(node, widget.inputId, {
            enabled: enabled.checked,
            source_file: sourceSelect.value,
            locked_for_queue: locked.checked,
            selections: [...selectedPaths].map(key => ({ path: JSON.parse(key) })),
        });
        logger.log(`运行时随机提示词已保存 | 节点:${node.id} 输入:${widget.inputId}`);
        overlay.remove();
    };
    footer.append(cancel, apply);
    overlay.append(titleBar, tabs, body, footer);
    document.body.append(overlay);

    const rect = widget.element?.getBoundingClientRect?.();
    overlay.style.left = `${Math.max(16, Math.min((rect?.left || 16), window.innerWidth - overlay.offsetWidth - 16))}px`;
    overlay.style.top = `${Math.max(16, Math.min((rect?.bottom || 16) + 8, window.innerHeight - overlay.offsetHeight - 16))}px`;
}

export function installRuntimeRandomQueueGrouping(api) {
    if (!api?.queuePrompt || api.queuePrompt.__paRuntimeRandomWrapped) return;
    const original = api.queuePrompt;
    const wrapped = async function(number, prompt) {
        const workflow = prompt?.workflow;
        if (!workflow || typeof workflow !== 'object') {
            return original.call(this, number, prompt);
        }
        const queueGroupId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        const nextWorkflow = { ...workflow };
        const nextPrompt = { ...prompt, workflow: nextWorkflow };
        nextPrompt.workflow.prompt_assistant_queue_group = queueGroupId;
        return original.call(this, number, nextPrompt);
    };
    wrapped.__paRuntimeRandomWrapped = true;
    api.queuePrompt = wrapped;
}
