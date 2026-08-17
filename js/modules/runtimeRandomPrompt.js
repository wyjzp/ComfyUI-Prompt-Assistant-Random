import { ResourceManager } from '../utils/resourceManager.js';
import { logger } from '../utils/logger.js';

const PROPERTY_KEY = 'prompt_assistant_runtime_random';
let activeOverlay = null;
let activeOverlayClose = null;

function getConfig(node, inputName) {
    const root = node.properties?.[PROPERTY_KEY] || {};
    return {
        enabled: false,
        source_file: '',
        locked_for_queue: false,
        placement: 'append',
        popup_width: 720,
        popup_height: 560,
        selections: [],
        ...(root.targets?.[inputName] || {}),
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

function pathKey(path) {
    return JSON.stringify(path);
}

function isBranch(value) {
    return value !== null && typeof value === 'object';
}

function getNodeAtPath(data, path) {
    let current = data;
    for (const segment of path) {
        if (!isBranch(current) || !(segment in current)) return undefined;
        current = current[segment];
    }
    return current;
}

function collectLeaves(value, path = []) {
    if (typeof value === 'string' && value.trim()) {
        return [{ path, name: path.at(-1), value: value.trim() }];
    }
    if (!isBranch(value)) return [];
    return Object.entries(value).flatMap(([name, child]) => (
        collectLeaves(child, [...path, name])
    ));
}

function normalizeSelections(selections) {
    return new Set(
        (selections || [])
            .filter(item => Array.isArray(item?.path) && item.path.length)
            .map(item => pathKey(item.path))
    );
}

function selectedPaths(selectionSet) {
    return [...selectionSet].map(key => JSON.parse(key));
}

function hasSelectedDescendant(selectionSet, path) {
    return selectedPaths(selectionSet).some(other => (
        other.length > path.length && path.every((part, index) => other[index] === part)
    ));
}

function selectionState(selectionSet, path) {
    if (selectionSet.has(pathKey(path))) return 'all';
    return hasSelectedDescendant(selectionSet, path) ? 'partial' : 'none';
}

function effectiveSelectedPaths(selectionSet) {
    const paths = selectedPaths(selectionSet);
    return paths.filter(path => !paths.some(other => (
        other.length > path.length && path.every((part, index) => other[index] === part)
    )));
}

function candidateCount(data, selectionSet) {
    const values = new Set();
    for (const path of effectiveSelectedPaths(selectionSet)) {
        for (const leaf of collectLeaves(getNodeAtPath(data, path), path)) {
            values.add(leaf.value);
        }
    }
    return values.size;
}

function searchMatches(name, value, query) {
    if (!query) return true;
    const lower = query.toLocaleLowerCase();
    return name.toLocaleLowerCase().includes(lower)
        || (typeof value === 'string' && value.toLocaleLowerCase().includes(lower));
}

function branchMatches(value, path, query) {
    if (!query) return true;
    return collectLeaves(value, path).some(leaf => (
        searchMatches(leaf.name, leaf.value, query)
        || leaf.path.some(segment => segment.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    ));
}

function styleOverlay() {
    if (document.getElementById('pa-runtime-random-styles')) return;
    const style = document.createElement('style');
    style.id = 'pa-runtime-random-styles';
    style.textContent = `
        .pa-random-popup { position: fixed; z-index: 10000; width: min(720px, calc(100vw - 32px)); height: min(560px, calc(100vh - 32px)); display: flex; flex-direction: column; color: var(--fg-color, #ddd); background: var(--comfy-menu-bg, #252525); border: 1px solid var(--border-color, #555); border-radius: 10px; box-shadow: 0 14px 36px #000b; font: 14px sans-serif; overflow: hidden; }
        .pa-random-popup .popup_title_bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border-color, #555); }
        .pa-random-popup .pa-random-title { font-weight: 700; font-size: 15px; white-space: nowrap; }
        .pa-random-popup .pa-random-search { flex: 1; min-width: 120px; padding: 7px 12px; color: inherit; background: var(--comfy-input-bg, #333); border: 1px solid var(--border-color, #555); border-radius: 18px; }
        .pa-random-popup .pa-random-options { display: flex; gap: 9px; white-space: nowrap; font-size: 12px; }
        .pa-random-popup .pa-random-options label { display: flex; gap: 4px; align-items: center; cursor: pointer; }
        .pa-random-popup button, .pa-random-popup select { color: inherit; background: var(--comfy-input-bg, #333); border: 1px solid var(--border-color, #555); border-radius: 5px; padding: 5px 9px; cursor: pointer; }
        .pa-random-popup .pa-random-close { border: 0; font-size: 20px; padding: 0 5px; }
        .pa-random-popup .popup_tabs_container { display: flex; min-height: 44px; overflow-x: auto; border-bottom: 1px solid var(--border-color, #555); scrollbar-width: thin; }
        .pa-random-popup .popup_tabs { display: flex; gap: 4px; align-items: flex-end; padding: 5px 10px 0; }
        .pa-random-popup .popup_tab { position: relative; border: 0; border-radius: 0; padding: 9px 10px 10px; background: transparent; white-space: nowrap; opacity: .75; }
        .pa-random-popup .popup_tab:hover { opacity: 1; }
        .pa-random-popup .popup_tab.active { color: var(--input-text-color, #fff); opacity: 1; border-bottom: 3px solid #58a6ff; }
        .pa-random-popup .popup_tab { display: inline-flex; align-items: center; gap: 5px; }
        .pa-random-popup .pa-tab-selection-indicator { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #3fb950; flex: none; }
        .pa-random-popup .pa-tab-selection-indicator.partial { box-sizing: border-box; background: transparent; border: 2px solid #3fb950; }
        .pa-random-popup .pa-random-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; }
        .pa-random-popup .pa-random-meta { margin: 0 0 10px; color: var(--descrip-text, #aaa); font-size: 12px; }
        .pa-random-popup .tag_accordion { margin: 0 0 4px; border: 0; background: transparent; }
        .pa-random-popup .tag_accordion_header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; color: inherit; background: #233044; border-radius: 6px; cursor: pointer; user-select: none; }
        .pa-random-popup .pa-random-body > .pa-random-chips { gap: 1px; margin: 0; }
        .pa-random-popup .tag_accordion_header.pa-selected { background: #1e6b36; }
        .pa-random-popup .tag_accordion_header.pa-partial { box-shadow: inset 3px 0 #3fb950; }
        .pa-random-popup .pa-random-select-indicator { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: 1px solid #888; border-radius: 4px; font-size: 12px; color: transparent; flex: none; }
        .pa-random-popup .pa-random-select-indicator.all { color: #fff; background: #238636; border-color: #3fb950; }
        .pa-random-popup .pa-random-select-indicator.partial { border-color: #3fb950; background: linear-gradient(90deg, #3fb950 50%, transparent 50%); }
        .pa-random-popup .tag_accordion_title { flex: 1; }
        .pa-random-popup .pa-random-count { color: #aab7c4; font-size: 12px; font-weight: normal; }
        .pa-random-popup .tag_accordion_content { display: none; padding: 2px 1px 1px; }
        .pa-random-popup .tag_accordion_content.active { display: block; }
        .pa-random-popup .pa-random-chips { display: flex; flex-wrap: wrap; gap: 1px; }
        .pa-random-popup .tag_item { border: 0; border-radius: 12px; padding: 2px 3px; color: inherit; background: var(--comfy-input-bg, #373737); cursor: pointer; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
        .pa-random-popup .tag_item:hover { filter: brightness(1.15); }
        .pa-random-popup .tag_item.used { background: #238636; color: #fff; }
        .pa-random-popup .tag_item.partial { box-shadow: inset 0 0 0 2px #3fb950; }
        .pa-random-popup .pa-random-search-result { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; margin-bottom: 6px; border-radius: 6px; background: var(--comfy-input-bg, #333); cursor: pointer; }
        .pa-random-popup .pa-random-search-result.used { background: #238636; }
        .pa-random-popup .pa-random-search-path { color: var(--descrip-text, #aaa); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pa-random-popup .pa-random-empty { padding: 45px 0; color: var(--descrip-text, #888); text-align: center; }
        .pa-random-popup .pa-random-footer { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-top: 1px solid var(--border-color, #555); }
        .pa-random-popup .pa-random-actions { display: flex; gap: 8px; }
        .pa-random-popup .pa-random-save { background: #238636; border-color: #3fb950; }
        .pa-random-popup .pa-random-resize-handle { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: se-resize; z-index: 20; }
        .pa-random-popup .pa-random-resize-handle::after { content: '⋰'; position: absolute; right: 3px; bottom: -2px; color: #aaa; font-size: 18px; }
    `;
    document.head.appendChild(style);
}

function updateSelection(selectionSet, path) {
    const key = pathKey(path);
    if (selectionSet.has(key)) selectionSet.delete(key);
    else selectionSet.add(key);
}

function makeIndicator(state) {
    const indicator = document.createElement('span');
    indicator.className = `pa-random-select-indicator ${state}`;
    indicator.textContent = state === 'all' ? '✓' : '';
    return indicator;
}

function makeAccordion(name, value, path, selectionSet, query, rerender, open = false) {
    const accordion = document.createElement('div');
    accordion.className = 'tag_accordion';
    const state = selectionState(selectionSet, path);
    const header = document.createElement('div');
    header.className = `tag_accordion_header ${state === 'all' ? 'pa-selected' : state === 'partial' ? 'pa-partial' : ''}`;
    const arrow = document.createElement('span');
    arrow.textContent = open ? '▾' : '▸';
    const title = document.createElement('span');
    title.className = 'tag_accordion_title';
    title.textContent = name;
    const count = document.createElement('span');
    count.className = 'pa-random-count';
    count.textContent = `${collectLeaves(value, path).length}`;
    const content = document.createElement('div');
    content.className = `tag_accordion_content ${open ? 'active' : ''}`;

    const toggleButton = makeIndicator(state);
    toggleButton.title = '选中或取消整个分类';
    toggleButton.onclick = event => {
        event.stopPropagation();
        updateSelection(selectionSet, path);
        rerender();
    };
    header.onclick = () => {
        const expanded = content.classList.toggle('active');
        arrow.textContent = expanded ? '▾' : '▸';
    };
    header.append(arrow, toggleButton, title, count);

    let firstBranch = true;
    const chips = document.createElement('div');
    chips.className = 'pa-random-chips';
    for (const [childName, childValue] of Object.entries(value)) {
        const childPath = [...path, childName];
        if (isBranch(childValue)) {
            if (branchMatches(childValue, childPath, query)) {
                content.append(makeAccordion(
                    childName, childValue, childPath, selectionSet, query, rerender,
                    Boolean(query) || firstBranch
                ));
                firstBranch = false;
            }
        } else if (searchMatches(childName, childValue, query)) {
            const stateForLeaf = selectionState(selectionSet, childPath);
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `tag_item ${stateForLeaf === 'all' ? 'used' : ''}`;
            chip.textContent = childName;
            chip.title = childValue;
            chip.onclick = () => {
                updateSelection(selectionSet, childPath);
                rerender();
            };
            chips.append(chip);
        }
    }
    if (chips.childNodes.length) content.prepend(chips);
    accordion.append(header, content);
    return accordion;
}

function makeSearchResults(data, selectionSet, query, rerender) {
    const container = document.createElement('div');
    const matches = collectLeaves(data).filter(leaf => (
        searchMatches(leaf.name, leaf.value, query)
        || leaf.path.slice(0, -1).some(part => part.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    ));
    if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'pa-random-empty';
        empty.textContent = '没有匹配的标签';
        container.append(empty);
        return container;
    }
    for (const leaf of matches) {
        const state = selectionState(selectionSet, leaf.path);
        const row = document.createElement('div');
        row.className = `pa-random-search-result ${state === 'all' ? 'used' : ''}`;
        row.title = leaf.value;
        const name = document.createElement('strong');
        name.textContent = leaf.name;
        const path = document.createElement('span');
        path.className = 'pa-random-search-path';
        path.textContent = leaf.path.slice(0, -1).join(' / ');
        row.append(name, path);
        row.onclick = () => {
            updateSelection(selectionSet, leaf.path);
            rerender();
        };
        container.append(row);
    }
    return container;
}

export async function showRuntimeRandomPromptOverlay(widget) {
    const node = widget?.node;
    if (!node) return;
    activeOverlayClose?.();
    styleOverlay();

    const initial = getConfig(node, widget.inputId);
    const files = await ResourceManager.getTagFileList();
    const sourceFile = initial.source_file || await ResourceManager.getSelectedTagFile();
    let data = sourceFile ? await ResourceManager.loadTagsCsv(sourceFile) : {};
    const selectionSet = normalizeSelections(initial.selections);
    let activeCategory = Object.keys(data).find(key => isBranch(data[key])) || null;
    let query = '';

    const popup = document.createElement('div');
    popup.className = 'popup_container tag_popup pa-random-popup';
    activeOverlay = popup;
    let outsideHandler = null;
    let resizeCleanup = null;
    const closePopup = () => {
        persist();
        resizeCleanup?.();
        resizeCleanup = null;
        if (outsideHandler) document.removeEventListener('pointerdown', outsideHandler, true);
        if (activeOverlay === popup) activeOverlay = null;
        if (activeOverlayClose === closePopup) activeOverlayClose = null;
        popup.remove();
    };
    activeOverlayClose = closePopup;

    const titleBar = document.createElement('div');
    titleBar.className = 'popup_title_bar';
    const title = document.createElement('span');
    title.className = 'pa-random-title';
    title.textContent = '运行时随机提示词';
    const sourceSelect = document.createElement('select');
    for (const file of files) sourceSelect.add(new Option(file, file, false, file === sourceFile));
    const placementSelect = document.createElement('select');
    placementSelect.add(new Option('固定提示词在前', 'append'));
    placementSelect.add(new Option('随机提示词在前', 'prepend'));
    placementSelect.value = initial.placement === 'prepend' ? 'prepend' : 'append';
    placementSelect.title = '随机提示词与固定提示词的拼接顺序';
    const search = document.createElement('input');
    search.className = 'pa-random-search';
    search.placeholder = '搜索标签…';
    const lockLabel = document.createElement('label');
    const locked = document.createElement('input');
    locked.type = 'checkbox';
    locked.checked = Boolean(initial.locked_for_queue);
    lockLabel.append(locked, document.createTextNode('锁定本批次'));
    const persist = () => {
        saveConfig(node, widget.inputId, {
            enabled: enabled.checked,
            source_file: sourceSelect.value,
            locked_for_queue: locked.checked,
            placement: placementSelect.value === 'prepend' ? 'prepend' : 'append',
            popup_width: popup?.offsetWidth || Number(initial.popup_width) || 720,
            popup_height: popup?.offsetHeight || Number(initial.popup_height) || 560,
            selections: selectedPaths(selectionSet).map(path => ({ path })),
        });
    };
    const enabledLabel = document.createElement('label');
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = Boolean(initial.enabled);
    enabledLabel.append(enabled, document.createTextNode('启用随机'));
    const options = document.createElement('span');
    options.className = 'pa-random-options';
    options.append(lockLabel, enabledLabel);
    const close = document.createElement('button');
    close.className = 'pa-random-close';
    close.textContent = '×';
    close.onclick = closePopup;
    titleBar.append(title, sourceSelect, placementSelect, search, options, close);

    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'popup_tabs_container';
    const tabs = document.createElement('div');
    tabs.className = 'popup_tabs';
    tabsContainer.append(tabs);
    const body = document.createElement('div');
    body.className = 'pa-random-body';
    const meta = document.createElement('p');
    meta.className = 'pa-random-meta';
    const content = document.createElement('div');
    const footer = document.createElement('div');
    footer.className = 'pa-random-footer';

    const rerender = () => {
        persist();
        const count = candidateCount(data, selectionSet);
        meta.textContent = `候选提示词：${count} 条。点选分类、标签或具体标题即可设置随机范围；绿色为已选，绿色描边为部分选中。`;
        tabs.replaceChildren();
        content.replaceChildren();
        if (query) {
            tabsContainer.style.display = 'none';
            content.append(makeSearchResults(data, selectionSet, query, rerender));
        } else {
            tabsContainer.style.display = '';
            for (const [categoryName, categoryData] of Object.entries(data)) {
                if (!isBranch(categoryData)) continue;
                const state = selectionState(selectionSet, [categoryName]);
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.className = `popup_tab ${activeCategory === categoryName ? 'active' : ''}`;
                tab.textContent = categoryName;
                if (state !== 'none') {
                    const indicator = document.createElement('span');
                    indicator.className = `pa-tab-selection-indicator ${state === 'partial' ? 'partial' : ''}`;
                    indicator.title = state === 'all' ? '整个分类已选' : '分类中部分内容已选';
                    tab.append(indicator);
                }
                tab.onclick = () => {
                    activeCategory = categoryName;
                    rerender();
                };
                tab.oncontextmenu = event => {
                    event.preventDefault();
                    updateSelection(selectionSet, [categoryName]);
                    rerender();
                };
                tabs.append(tab);
            }
            const categoryData = data[activeCategory];
            if (isBranch(categoryData)) {
                const direct = document.createElement('div');
                direct.className = 'pa-random-chips';
                let firstBranch = true;
                for (const [name, value] of Object.entries(categoryData)) {
                    // Some CSV files repeat the root category as their first
                    // child; the original panel suppresses this duplicate header.
                    if (name === activeCategory && isBranch(value)) {
                        for (const [childName, childValue] of Object.entries(value)) {
                            const childPath = [activeCategory, childName];
                            if (isBranch(childValue)) direct.append(makeAccordion(childName, childValue, childPath, selectionSet, '', rerender, firstBranch));
                            else if (searchMatches(childName, childValue, '')) {
                                const chip = document.createElement('button');
                                chip.type = 'button';
                                chip.className = `tag_item ${selectionState(selectionSet, childPath) === 'all' ? 'used' : ''}`;
                                chip.textContent = childName;
                                chip.title = childValue;
                                chip.onclick = () => { updateSelection(selectionSet, childPath); rerender(); };
                                direct.append(chip);
                            }
                            firstBranch = false;
                        }
                        continue;
                    }
                    const path = [activeCategory, name];
                    if (isBranch(value)) {
                        direct.append(makeAccordion(name, value, path, selectionSet, '', rerender, firstBranch));
                        firstBranch = false;
                    } else if (searchMatches(name, value, '')) {
                        const chip = document.createElement('button');
                        chip.type = 'button';
                        chip.className = `tag_item ${selectionState(selectionSet, path) === 'all' ? 'used' : ''}`;
                        chip.textContent = name;
                        chip.title = value;
                        chip.onclick = () => { updateSelection(selectionSet, path); rerender(); };
                        direct.append(chip);
                    }
                }
                content.append(direct);
            }
        }
    };

    search.oninput = () => {
        query = search.value.trim();
        rerender();
    };
    enabled.onchange = persist;
    locked.onchange = persist;
    placementSelect.onchange = persist;
    sourceSelect.onchange = async () => {
        data = await ResourceManager.loadTagsCsv(sourceSelect.value);
        selectionSet.clear();
        activeCategory = Object.keys(data).find(key => isBranch(data[key])) || null;
        query = '';
        search.value = '';
        persist();
        rerender();
    };

    const clearButton = document.createElement('button');
    clearButton.textContent = '清空选择';
    clearButton.onclick = () => {
        selectionSet.clear();
        persist();
        rerender();
    };
    footer.append(clearButton);

    body.append(meta, content);
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'pa-random-resize-handle';
    popup.append(titleBar, tabsContainer, body, footer, resizeHandle);
    document.body.append(popup);
    const startResize = event => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const startWidth = popup.offsetWidth;
        const startHeight = popup.offsetHeight;
        const move = moveEvent => {
            const rect = popup.getBoundingClientRect();
            const width = Math.min(Math.max(420, startWidth + moveEvent.clientX - startX), window.innerWidth - rect.left - 8);
            const height = Math.min(Math.max(320, startHeight + moveEvent.clientY - startY), window.innerHeight - rect.top - 8);
            popup.style.width = `${width}px`;
            popup.style.height = `${height}px`;
        };
        const stop = () => {
            document.removeEventListener('mousemove', move, true);
            document.removeEventListener('mouseup', stop, true);
            document.body.style.userSelect = '';
            persist();
        };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseup', stop, true);
        document.body.style.userSelect = 'none';
        resizeCleanup = stop;
    };
    resizeHandle.addEventListener('mousedown', startResize, true);
    const savedWidth = Number(initial.popup_width);
    const savedHeight = Number(initial.popup_height);
    if (Number.isFinite(savedWidth) && savedWidth >= 420) popup.style.width = `${savedWidth}px`;
    if (Number.isFinite(savedHeight) && savedHeight >= 320) popup.style.height = `${savedHeight}px`;
    outsideHandler = event => {
        if (!popup.contains(event.target)) closePopup();
    };
    document.addEventListener('pointerdown', outsideHandler, true);
    rerender();

    const rect = widget.element?.getBoundingClientRect?.();
    popup.style.left = `${Math.max(16, Math.min(rect?.left || 16, window.innerWidth - popup.offsetWidth - 16))}px`;
    popup.style.top = `${Math.max(16, Math.min((rect?.bottom || 16) + 8, window.innerHeight - popup.offsetHeight - 16))}px`;
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
        const nextPrompt = { ...prompt, workflow: { ...workflow, prompt_assistant_queue_group: queueGroupId } };
        return original.call(this, number, nextPrompt);
    };
    wrapped.__paRuntimeRandomWrapped = true;
    api.queuePrompt = wrapped;
}
