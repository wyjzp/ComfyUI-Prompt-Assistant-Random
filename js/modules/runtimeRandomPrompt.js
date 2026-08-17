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
        .pa-runtime-random-overlay { position: fixed; z-index: 10000; width: min(520px, calc(100vw - 32px)); max-height: min(680px, calc(100vh - 32px)); display: flex; flex-direction: column; color: var(--fg-color, #ddd); background: var(--comfy-menu-bg, #252525); border: 1px solid var(--border-color, #555); border-radius: 8px; box-shadow: 0 12px 32px #0009; font: 13px sans-serif; }
        .pa-runtime-random-header, .pa-runtime-random-footer { display: flex; gap: 10px; align-items: center; padding: 12px; border-bottom: 1px solid var(--border-color, #555); }
        .pa-runtime-random-footer { border-top: 1px solid var(--border-color, #555); border-bottom: 0; justify-content: flex-end; }
        .pa-runtime-random-header strong { flex: 1; }
        .pa-runtime-random-body { overflow: auto; padding: 12px; }
        .pa-runtime-random-row { display: flex; align-items: center; gap: 7px; min-height: 28px; }
        .pa-runtime-random-branch { margin-left: 18px; border-left: 1px solid #5556; padding-left: 8px; }
        .pa-runtime-random-meta { margin: 0 0 10px; color: var(--descrip-text, #aaa); line-height: 1.5; }
        .pa-runtime-random-overlay select, .pa-runtime-random-overlay button { color: inherit; background: var(--comfy-input-bg, #333); border: 1px solid var(--border-color, #555); border-radius: 4px; padding: 5px 8px; }
        .pa-runtime-random-overlay button { cursor: pointer; }
        .pa-runtime-random-overlay .pa-runtime-random-close { border: 0; font-size: 18px; padding: 0 6px; }
        .pa-runtime-random-overlay label { cursor: pointer; user-select: none; }
    `;
    document.head.appendChild(style);
}

function buildTree(data, selectedPaths, onChange, path = []) {
    const fragment = document.createDocumentFragment();
    for (const [name, value] of Object.entries(data || {})) {
        const currentPath = [...path, name];
        const key = pathKey(currentPath);
        const row = document.createElement('div');
        row.className = 'pa-runtime-random-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedPaths.has(key);
        const label = document.createElement('label');
        label.textContent = typeof value === 'string' ? `${name}  —  ${value}` : name;
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) selectedPaths.add(key);
            else selectedPaths.delete(key);
            onChange();
        });
        row.append(checkbox, label);
        fragment.append(row);
        if (value && typeof value === 'object') {
            const branch = document.createElement('div');
            branch.className = 'pa-runtime-random-branch';
            branch.append(buildTree(value, selectedPaths, onChange, currentPath));
            fragment.append(branch);
        }
    }
    return fragment;
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
    const header = document.createElement('div');
    header.className = 'pa-runtime-random-header';
    const title = document.createElement('strong');
    title.textContent = '运行时随机提示词';
    const close = document.createElement('button');
    close.className = 'pa-runtime-random-close';
    close.textContent = '×';
    close.onclick = () => overlay.remove();
    header.append(title, close);

    const body = document.createElement('div');
    body.className = 'pa-runtime-random-body';
    const sourceRow = document.createElement('div');
    sourceRow.className = 'pa-runtime-random-row';
    const sourceLabel = document.createElement('label');
    sourceLabel.textContent = '标签文件';
    const sourceSelect = document.createElement('select');
    for (const file of files) {
        const option = new Option(file, file, false, file === sourceFile);
        sourceSelect.add(option);
    }
    sourceRow.append(sourceLabel, sourceSelect);
    const enableRow = document.createElement('div');
    enableRow.className = 'pa-runtime-random-row';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = Boolean(initial.enabled);
    const enabledLabel = document.createElement('label');
    enabledLabel.textContent = '启用：每次运行从下方范围随机抽取一条提示词';
    enableRow.append(enabled, enabledLabel);
    const lockRow = document.createElement('div');
    lockRow.className = 'pa-runtime-random-row';
    const locked = document.createElement('input');
    locked.type = 'checkbox';
    locked.checked = Boolean(initial.locked_for_queue);
    const lockLabel = document.createElement('label');
    lockLabel.textContent = '锁定本次随机结果（同一 Queue 批次使用同一条）';
    lockRow.append(locked, lockLabel);
    const meta = document.createElement('p');
    meta.className = 'pa-runtime-random-meta';
    const tree = document.createElement('div');

    const render = () => {
        tree.replaceChildren(buildTree(data, selectedPaths, render));
        meta.textContent = `候选提示词：${candidateCount(data, [...selectedPaths].map(key => ({ path: JSON.parse(key) })))} 条。选上级而不选下级时，将使用该上级全部提示词；选下级或具体提示词时，将自动缩小范围。`;
    };
    sourceSelect.onchange = async () => {
        data = await ResourceManager.loadTagsCsv(sourceSelect.value);
        selectedPaths.clear();
        render();
    };
    render();
    body.append(sourceRow, enableRow, lockRow, meta, tree);

    const footer = document.createElement('div');
    footer.className = 'pa-runtime-random-footer';
    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    cancel.onclick = () => overlay.remove();
    const apply = document.createElement('button');
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
    overlay.append(header, body, footer);
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
