/**
 * 记忆表格编辑器 UI 模块
 * 提供记忆模式的设置面板：创建/编辑/删除表格、字段管理、模板编辑、数据查看
 */

import { USER, EDITOR } from '../../core/manager.js';
import { MemoryManager } from '../../core/memory/memoryManager.js';
import { MemoryTable, MemoryRow, PRESET_TEMPLATES } from '../../core/memory/memoryTable.js';
import { renderRow, extractFieldNamesFromTemplate } from '../../core/memory/templateEngine.js';

// ─────────────────────────────────────────────────────────────────
// 主入口：初始化记忆编辑器 UI（挂载到 settings 面板中的 #memory_mode_section）
// ─────────────────────────────────────────────────────────────────

/**
 * 初始化记忆表格编辑器，将面板挂载到目标容器内。
 * @param {HTMLElement|string} container - 容器元素或选择器
 */
export function initMemoryTableEditor(container) {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return;
    el.innerHTML = buildEditorHtml();
    bindEditorEvents(el);
    refreshEditorView(el);
}

// ─────────────────────────────────────────────────────────────────
// HTML 构建
// ─────────────────────────────────────────────────────────────────

function buildEditorHtml() {
    return `
<div class="memory-editor wide100p" style="margin-top:8px">

    <!-- 记忆模式总开关 -->
    <div class="checkbox_label range-block justifyLeft" style="margin-bottom:10px">
        <input type="checkbox" id="mem_mode_switch">
        <span>启用记忆模式（Memory Mode）</span>
        <small class="toggle-description justifyLeft">
            开启后使用字段式记忆表格，AI 以 &lt;memoryEdit&gt; 标签更新记忆，替代旧的 &lt;tableEdit&gt; 方式
        </small>
    </div>

    <!-- 表格列表 -->
    <div id="mem_table_list_section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h4 style="margin:0">记忆表格</h4>
            <div style="display:flex;gap:6px">
                <button class="menu_button" id="mem_add_table_btn" title="新建空白表格">+ 新建表格</button>
                <button class="menu_button" id="mem_add_preset_btn" title="从预设模板创建">从预设创建</button>
            </div>
        </div>
        <div id="mem_table_list" style="display:flex;flex-direction:column;gap:6px">
            <!-- 动态渲染 -->
        </div>
    </div>

    <!-- 表格编辑面板（点击表格后展开） -->
    <div id="mem_table_edit_panel" style="display:none;margin-top:12px;border:1px solid #444;border-radius:6px;padding:10px">
        <h4 style="margin:0 0 8px">编辑表格</h4>

        <!-- 基本信息 -->
        <label>表格名称</label>
        <input type="text" id="mem_edit_name" class="text_pole" style="margin-bottom:8px">

        <label>显示模板
            <small>（用花括号标记字段，如 <code>#{序号} [{时间}] {事件} @{地点}</code>）</small>
        </label>
        <input type="text" id="mem_edit_template" class="text_pole" style="margin-bottom:4px">
        <div id="mem_template_preview" style="font-size:0.85em;color:#aaa;margin-bottom:8px;padding:4px;background:#222;border-radius:4px">
            预览：(在上方输入模板后实时显示)
        </div>

        <!-- 关联功能 -->
        <div class="checkbox_label justifyLeft" style="margin-bottom:8px">
            <input type="checkbox" id="mem_edit_allow_relation">
            <span>启用关联功能（在行尾追加 | 关联:#N）</span>
        </div>

        <!-- 字段列表 -->
        <label>字段列表</label>
        <div id="mem_field_list" style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px">
            <!-- 动态渲染 -->
        </div>
        <button class="menu_button" id="mem_add_field_btn" style="margin-bottom:8px">+ 添加字段</button>

        <!-- 操作按钮 -->
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
            <button class="menu_button" id="mem_save_table_btn">保存</button>
            <button class="menu_button" id="mem_delete_table_btn" style="color:#e55">删除此表格</button>
            <button class="menu_button" id="mem_cancel_edit_btn">取消</button>
        </div>
    </div>

    <!-- 数据查看面板 -->
    <div id="mem_data_view_panel" style="margin-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h4 style="margin:0">当前记忆数据</h4>
            <button class="menu_button" id="mem_refresh_data_btn" title="刷新数据视图">刷新</button>
        </div>
        <div id="mem_data_content" style="font-size:0.85em;background:#1a1a1a;border-radius:4px;padding:8px;white-space:pre-wrap;max-height:300px;overflow-y:auto;font-family:monospace;color:#ccc">
            (无数据)
        </div>
    </div>

</div>
`;
}

// ─────────────────────────────────────────────────────────────────
// 事件绑定
// ─────────────────────────────────────────────────────────────────

/** 当前正在编辑的表格 ID（null 表示新建） */
let _editingTableId = null;

function bindEditorEvents(root) {
    // 总开关
    root.querySelector('#mem_mode_switch')?.addEventListener('change', e => {
        USER.tableBaseSetting.memory_mode = e.target.checked;
        USER.saveSettings?.();
    });

    // 新建空白表格
    root.querySelector('#mem_add_table_btn')?.addEventListener('click', () => {
        openEditPanel(root, null);
    });

    // 从预设创建
    root.querySelector('#mem_add_preset_btn')?.addEventListener('click', () => {
        showPresetPicker(root);
    });

    // 保存
    root.querySelector('#mem_save_table_btn')?.addEventListener('click', () => {
        saveEditingTable(root);
    });

    // 删除
    root.querySelector('#mem_delete_table_btn')?.addEventListener('click', () => {
        deleteEditingTable(root);
    });

    // 取消
    root.querySelector('#mem_cancel_edit_btn')?.addEventListener('click', () => {
        closeEditPanel(root);
    });

    // 添加字段
    root.querySelector('#mem_add_field_btn')?.addEventListener('click', () => {
        addFieldRow(root);
    });

    // 模板实时预览
    root.querySelector('#mem_edit_template')?.addEventListener('input', e => {
        updateTemplatePreview(root, e.target.value);
    });

    // 刷新数据视图
    root.querySelector('#mem_refresh_data_btn')?.addEventListener('click', () => {
        refreshDataView(root);
    });
}

// ─────────────────────────────────────────────────────────────────
// 视图刷新
// ─────────────────────────────────────────────────────────────────

function refreshEditorView(root) {
    // 同步总开关
    const sw = root.querySelector('#mem_mode_switch');
    if (sw) sw.checked = MemoryManager.isMemoryModeEnabled();

    refreshTableList(root);
    refreshDataView(root);
}

function refreshTableList(root) {
    const listEl = root.querySelector('#mem_table_list');
    if (!listEl) return;

    const schemas = MemoryManager.getSchemas();
    if (schemas.length === 0) {
        listEl.innerHTML = '<div style="color:#888;font-size:0.85em">还没有创建任何记忆表格。</div>';
        return;
    }

    listEl.innerHTML = schemas.map(s => `
        <div class="mem-table-item" data-table-id="${s.tableId}"
             style="display:flex;justify-content:space-between;align-items:center;
                    background:#2a2a2a;border-radius:4px;padding:6px 10px;cursor:pointer">
            <div>
                <strong>${escHtml(s.tableName)}</strong>
                <small style="color:#888;margin-left:8px">${escHtml(s.displayTemplate)}</small>
            </div>
            <button class="menu_button mem-edit-btn" data-table-id="${s.tableId}" style="padding:2px 8px;font-size:0.8em">编辑</button>
        </div>
    `).join('');

    // 点击编辑按钮
    listEl.querySelectorAll('.mem-edit-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            openEditPanel(root, btn.dataset.tableId);
        });
    });
}

function refreshDataView(root) {
    const el = root.querySelector('#mem_data_content');
    if (!el) return;

    try {
        const block = MemoryManager.renderMemoryBlock();
        el.textContent = block || '(当前对话无记忆数据)';
    } catch (err) {
        el.textContent = '(渲染失败: ' + err.message + ')';
    }
}

// ─────────────────────────────────────────────────────────────────
// 编辑面板
// ─────────────────────────────────────────────────────────────────

function openEditPanel(root, tableId) {
    _editingTableId = tableId;
    const panel = root.querySelector('#mem_table_edit_panel');
    if (!panel) return;

    if (tableId) {
        // 编辑已有表格
        const schemas = MemoryManager.getSchemas();
        const schema = schemas.find(s => s.tableId === tableId);
        if (!schema) return;

        root.querySelector('#mem_edit_name').value = schema.tableName || '';
        root.querySelector('#mem_edit_template').value = schema.displayTemplate || '';
        root.querySelector('#mem_edit_allow_relation').checked = schema.allowRelation ?? false;
        populateFieldList(root, schema.fields || []);
        updateTemplatePreview(root, schema.displayTemplate || '');
    } else {
        // 新建
        root.querySelector('#mem_edit_name').value = '新表格';
        root.querySelector('#mem_edit_template').value = '#{序号} {内容}';
        root.querySelector('#mem_edit_allow_relation').checked = false;
        populateFieldList(root, [{ key: 'content', name: '内容', required: true }]);
        updateTemplatePreview(root, '#{序号} {内容}');
    }

    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeEditPanel(root) {
    _editingTableId = null;
    const panel = root.querySelector('#mem_table_edit_panel');
    if (panel) panel.style.display = 'none';
}

function saveEditingTable(root) {
    const name = (root.querySelector('#mem_edit_name')?.value || '').trim();
    const template = (root.querySelector('#mem_edit_template')?.value || '').trim();
    const allowRelation = root.querySelector('#mem_edit_allow_relation')?.checked ?? false;

    if (!name) {
        EDITOR.warning?.('请输入表格名称');
        return;
    }
    if (!template) {
        EDITOR.warning?.('请输入显示模板');
        return;
    }

    const fields = collectFieldsFromDom(root);
    if (fields.length === 0) {
        EDITOR.warning?.('请至少添加一个字段');
        return;
    }

    const schemas = MemoryManager.getSchemas();

    if (_editingTableId) {
        // 更新已有
        const idx = schemas.findIndex(s => s.tableId === _editingTableId);
        if (idx !== -1) {
            schemas[idx] = {
                ...schemas[idx],
                tableName: name,
                displayTemplate: template,
                allowRelation,
                fields,
            };
        }
    } else {
        // 新建
        const newTable = new MemoryTable({ tableName: name, fields, displayTemplate: template, allowRelation });
        schemas.push(newTable.schemaToJSON());
    }

    MemoryManager.saveSchemas(schemas);
    closeEditPanel(root);
    refreshTableList(root);
    refreshDataView(root);
}

function deleteEditingTable(root) {
    if (!_editingTableId) return;
    if (!confirm(`确定要删除此表格吗？行数据也会被清除。`)) return;

    const schemas = MemoryManager.getSchemas().filter(s => s.tableId !== _editingTableId);
    MemoryManager.saveSchemas(schemas);

    // 同时清除行数据
    const rowsMap = MemoryManager.getRowsMap();
    delete rowsMap[_editingTableId];
    MemoryManager.saveRowsMap(rowsMap);

    closeEditPanel(root);
    refreshTableList(root);
    refreshDataView(root);
}

// ─────────────────────────────────────────────────────────────────
// 字段列表
// ─────────────────────────────────────────────────────────────────

function populateFieldList(root, fields) {
    const listEl = root.querySelector('#mem_field_list');
    if (!listEl) return;
    listEl.innerHTML = '';
    fields.forEach(f => appendFieldRow(listEl, f));
}

function addFieldRow(root) {
    const listEl = root.querySelector('#mem_field_list');
    if (!listEl) return;
    appendFieldRow(listEl, { key: '', name: '', required: false });
}

function appendFieldRow(listEl, field) {
    const row = document.createElement('div');
    row.className = 'mem-field-row';
    row.style.cssText = 'display:flex;gap:6px;align-items:center';
    row.innerHTML = `
        <input type="text" class="text_pole mem-field-key" placeholder="key（英文）"
               value="${escHtml(field.key)}" style="width:120px;flex:none">
        <input type="text" class="text_pole mem-field-name" placeholder="字段名（中文）"
               value="${escHtml(field.name)}" style="flex:1">
        <label style="display:flex;align-items:center;gap:3px;white-space:nowrap">
            <input type="checkbox" class="mem-field-required" ${field.required ? 'checked' : ''}> 必填
        </label>
        <button class="menu_button mem-del-field-btn" style="padding:2px 6px;color:#e55" title="删除字段">×</button>
    `;
    row.querySelector('.mem-del-field-btn').addEventListener('click', () => row.remove());
    listEl.appendChild(row);
}

function collectFieldsFromDom(root) {
    return Array.from(root.querySelectorAll('.mem-field-row')).map(row => ({
        key: row.querySelector('.mem-field-key')?.value?.trim() || '',
        name: row.querySelector('.mem-field-name')?.value?.trim() || '',
        required: row.querySelector('.mem-field-required')?.checked ?? false,
    })).filter(f => f.key && f.name);
}

// ─────────────────────────────────────────────────────────────────
// 模板预览
// ─────────────────────────────────────────────────────────────────

function updateTemplatePreview(root, template) {
    const previewEl = root.querySelector('#mem_template_preview');
    if (!previewEl) return;

    const fields = collectFieldsFromDom(root);
    // 生成示例行数据
    const sampleData = {};
    fields.forEach((f, i) => { sampleData[f.key] = f.name + '示例'; });
    const sampleRow = { id: 1, data: sampleData, relations: [] };
    const allowRelation = root.querySelector('#mem_edit_allow_relation')?.checked ?? false;

    try {
        const rendered = renderRow(template, fields, sampleRow, allowRelation);
        previewEl.textContent = '预览：' + rendered;
        previewEl.style.color = '#8f8';
    } catch (err) {
        previewEl.textContent = '模板错误：' + err.message;
        previewEl.style.color = '#f88';
    }
}

// ─────────────────────────────────────────────────────────────────
// 预设选择器
// ─────────────────────────────────────────────────────────────────

async function showPresetPicker(root) {
    const items = PRESET_TEMPLATES.map((p, i) => `<option value="${i}">${escHtml(p.name)}</option>`).join('');
    const select = $(`
        <div>
            <p>选择一个预设模板：</p>
            <select class="text_pole" id="mem_preset_select">${items}</select>
            <small style="color:#aaa;display:block;margin-top:4px" id="mem_preset_desc"></small>
        </div>
    `);

    const popup = new EDITOR.Popup(select, EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: '创建', cancelButton: '取消' });

    select.find('#mem_preset_select').on('change', function () {
        const p = PRESET_TEMPLATES[parseInt(this.value)];
        select.find('#mem_preset_desc').text(`模板：${p.config.displayTemplate}`);
    }).trigger('change');

    await popup.show();
    if (!popup.result) return;

    const idx = parseInt(select.find('#mem_preset_select').val());
    const preset = PRESET_TEMPLATES[idx];
    if (!preset) return;

    const schemas = MemoryManager.getSchemas();
    const newTable = new MemoryTable({ ...preset.config });
    schemas.push(newTable.schemaToJSON());
    MemoryManager.saveSchemas(schemas);
    refreshTableList(root);
    openEditPanel(root, newTable.tableId);
}

// ─────────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────────

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
