// fieldLibraryManager.js
// 字段库管理模块：可复用列字段的增删改查，以及从字段库创建/扩充表格
import { BASE, EDITOR, SYSTEM, USER } from '../../core/manager.js';
import { Form } from '../../components/formManager.js';

// ─────────────────────────────────────────────────────────────
// 数据层：字段库的读写
// 字段结构：{ uid, name, value, columnDataType, description }
//   uid            - 唯一标识符
//   name           - 在字段库中显示的名称（可与列标题不同）
//   value          - 插入表格时使用的列标题文字
//   columnDataType - 数据类型，目前仅支持 'text'
//   description    - 说明（仅显示在字段库中，不影响表格）
// ─────────────────────────────────────────────────────────────

function getLibrary() {
    const settings = USER.getSettings();
    if (!Array.isArray(settings.table_field_library)) {
        settings.table_field_library = [];
    }
    return settings.table_field_library;
}

function saveLibrary(fields) {
    USER.getSettings().table_field_library = fields;
    USER.saveSettings();
}

export function createField(data) {
    const field = {
        uid: `field_${SYSTEM.generateRandomString(8)}`,
        name: (data.name || data.value || '未命名字段').trim(),
        value: (data.value || '').trim(),
        columnDataType: data.columnDataType || 'text',
        description: (data.description || '').trim(),
    };
    const lib = getLibrary();
    lib.push(field);
    saveLibrary(lib);
    return field;
}

function updateField(uid, data) {
    const lib = getLibrary();
    const idx = lib.findIndex(f => f.uid === uid);
    if (idx === -1) return null;
    lib[idx] = { ...lib[idx], ...data };
    saveLibrary(lib);
    return lib[idx];
}

export function deleteField(uid) {
    saveLibrary(getLibrary().filter(f => f.uid !== uid));
}

// ─────────────────────────────────────────────────────────────
// UI 层：弹窗
// ─────────────────────────────────────────────────────────────

const TYPE_LABEL = { text: '文本', number: '数字', option: '选项' };

const fieldFormConfig = {
    formTitle: '编辑字段',
    formDescription: '设置字段的名称、列标题和数据类型。',
    fields: [
        {
            label: '字段名称',
            type: 'text',
            dataKey: 'name',
            description: '在字段库中显示的名称，方便识别',
        },
        {
            label: '列标题（插入表格时显示的文字）',
            type: 'text',
            dataKey: 'value',
        },
        {
            label: '数据类型',
            type: 'select',
            dataKey: 'columnDataType',
            options: [{ value: 'text', text: '文本' }],
        },
        {
            label: '说明',
            type: 'textarea',
            rows: 2,
            dataKey: 'description',
            description: '字段的备注说明（仅在字段库中显示，不影响表格内容）',
        },
    ],
};

/** 打开单个字段的编辑弹窗，返回表单数据或 null（取消） */
async function openFieldEditPopup(initialData = {}) {
    const formInstance = new Form(fieldFormConfig, {
        name: '', value: '', columnDataType: 'text', description: '',
        ...initialData,
    });
    const popup = new EDITOR.Popup(
        formInstance.renderForm(),
        EDITOR.POPUP_TYPE.CONFIRM,
        '',
        { okButton: '保存', cancelButton: '取消', allowVerticalScrolling: true },
    );
    await popup.show();
    return popup.result ? formInstance.result() : null;
}

// ─── 字段库列表 HTML 渲染 ────────────────────────────────────

function renderLibraryHTML() {
    const lib = getLibrary();

    const itemsHTML = lib.length === 0
        ? `<div style="color:var(--SmartThemeEmColor);text-align:center;padding:24px 0;">
               字段库为空，点击「新建字段」开始添加。
           </div>`
        : lib.map(f => `
            <div class="fl-item" data-uid="${f.uid}" style="
                display:flex; align-items:center; justify-content:space-between;
                padding:8px 10px; margin-bottom:6px;
                border:1px solid var(--SmartThemeBorderColor);
                border-radius:4px; background:var(--SmartThemeBlurTintColor);
            ">
                <div style="flex:1; min-width:0; margin-right:8px;">
                    <div style="font-weight:bold; font-size:0.9rem;">${f.name}</div>
                    <div style="font-size:0.75rem; color:var(--SmartThemeEmColor); margin-top:2px;">
                        列标题：${f.value || '<em>未设置</em>'}
                        &nbsp;·&nbsp;
                        类型：${TYPE_LABEL[f.columnDataType] || f.columnDataType}
                        ${f.description ? `&nbsp;·&nbsp; ${f.description}` : ''}
                    </div>
                </div>
                <div style="display:flex; gap:4px; flex-shrink:0;">
                    <i class="fa-solid fa-pen menu_button menu_button_icon fl-edit"
                       data-uid="${f.uid}" title="编辑字段"
                       style="height:26px; width:26px;"></i>
                    <i class="fa-solid fa-trash-alt menu_button menu_button_icon fl-delete"
                       data-uid="${f.uid}" title="删除字段"
                       style="height:26px; width:26px;"></i>
                </div>
            </div>`).join('');

    return `
        <div class="wide100p padding5 dataBankAttachments" id="fl-root">
            <h2 class="marginBot5"><span>字段库</span></h2>
            <small>在此管理可复用的列字段。创建表格时可从字段库快速组合，也可向已有表格插入字段。</small>
            <hr/>
            <div style="margin-bottom:10px;">
                <button id="fl-add" class="menu_button"
                        style="padding:4px 14px; cursor:pointer; font-size:0.85rem;">
                    <i class="fa-solid fa-plus"></i>&nbsp;新建字段
                </button>
            </div>
            <div id="fl-list">${itemsHTML}</div>
        </div>`;
}

/** 打开字段库管理弹窗（增删改查） */
export async function openFieldLibraryPopup() {
    const container = document.createElement('div');
    container.innerHTML = renderLibraryHTML();

    const popup = new EDITOR.Popup(container, EDITOR.POPUP_TYPE.TEXT, '', {
        okButton: '关闭',
        allowVerticalScrolling: true,
    });

    function bindEvents() {
        container.querySelector('#fl-add')?.addEventListener('click', async () => {
            const result = await openFieldEditPopup();
            if (!result) return;
            createField(result);
            container.innerHTML = renderLibraryHTML();
            bindEvents();
        });

        container.querySelectorAll('.fl-edit').forEach(btn => {
            btn.addEventListener('click', async () => {
                const uid = btn.dataset.uid;
                const field = getLibrary().find(f => f.uid === uid);
                if (!field) return;
                const result = await openFieldEditPopup({ ...field });
                if (!result) return;
                updateField(uid, result);
                container.innerHTML = renderLibraryHTML();
                bindEvents();
            });
        });

        container.querySelectorAll('.fl-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const uid = btn.dataset.uid;
                const field = getLibrary().find(f => f.uid === uid);
                if (!field) return;
                if (!confirm(`确定删除字段「${field.name}」？此操作不可撤销。`)) return;
                deleteField(uid);
                container.innerHTML = renderLibraryHTML();
                bindEvents();
            });
        });
    }

    bindEvents();
    await popup.show();
}

// ─── 字段选取器（通用，可复用） ──────────────────────────────

/**
 * 打开字段选取弹窗，让用户从字段库中勾选字段。
 * @param {string} title   - 弹窗标题
 * @param {string} subtitle - 弹窗副标题说明
 * @returns {Array|null} 选中的字段对象数组，取消返回 null，空选返回 null
 */
async function openFieldPickerPopup(title, subtitle) {
    const lib = getLibrary();
    if (lib.length === 0) {
        alert('字段库为空，请先在字段库中创建字段。');
        return null;
    }

    const itemsHTML = lib.map(f => `
        <label style="
            display:flex; align-items:center; gap:10px; padding:8px 10px;
            border:1px solid var(--SmartThemeBorderColor); border-radius:4px;
            background:var(--SmartThemeBlurTintColor); cursor:pointer;
            transition: background 0.1s;
        ">
            <input type="checkbox" class="fp-cb" value="${f.uid}"
                   style="flex-shrink:0; width:15px; height:15px;" />
            <div style="flex:1;">
                <div style="font-weight:bold; font-size:0.9rem;">${f.name}</div>
                <div style="font-size:0.75rem; color:var(--SmartThemeEmColor); margin-top:2px;">
                    列标题：${f.value || '<em>未设置</em>'}
                    &nbsp;·&nbsp;
                    ${TYPE_LABEL[f.columnDataType] || f.columnDataType}
                    ${f.description ? `&nbsp;·&nbsp; ${f.description}` : ''}
                </div>
            </div>
        </label>`).join('');

    const html = `
        <div class="wide100p padding5 dataBankAttachments">
            <h2 class="marginBot5"><span>${title}</span></h2>
            <small>${subtitle}</small>
            <hr/>
            <div style="display:flex; flex-direction:column; gap:6px;">
                ${itemsHTML}
            </div>
        </div>`;

    const popup = new EDITOR.Popup(html, EDITOR.POPUP_TYPE.CONFIRM, '', {
        okButton: '确认', cancelButton: '取消', allowVerticalScrolling: true,
    });
    await popup.show();

    if (!popup.result) return null;

    const selectedUids = Array.from(
        document.querySelectorAll('.fp-cb:checked'),
    ).map(cb => cb.value);

    if (selectedUids.length === 0) return null;
    return selectedUids.map(uid => lib.find(f => f.uid === uid)).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────
// 核心操作
// ─────────────────────────────────────────────────────────────

/**
 * 将字段插入到已有的 sheet/template 中（作为新列追加到最右侧）。
 * @param {object} sheet - Sheet 或 SheetTemplate 实例
 * @returns {boolean} 是否成功插入
 */
export async function insertFieldsToSheet(sheet) {
    const fields = await openFieldPickerPopup(
        '从字段库添加列',
        `选择要插入到表格「${sheet.name || '未命名'}」的字段，将依次追加为新列。`,
    );
    if (!fields) return false;

    // 获取当前最右侧的列标题单元格
    let lastHeader = sheet.cells.get(
        sheet.hashSheet[0][sheet.hashSheet[0].length - 1],
    );

    fields.forEach(field => {
        // insertRightColumn 会在 hashSheet 中新增一列，isSave=false 暂不保存
        lastHeader.newAction('insertRightColumn', undefined, false);

        // 新列标题现在在 hashSheet[0] 的最末位
        const newHeader = sheet.cells.get(
            sheet.hashSheet[0][sheet.hashSheet[0].length - 1],
        );
        if (newHeader) {
            newHeader.data.value = field.value;
            if (field.columnDataType) newHeader.data.columnDataType = field.columnDataType;
            lastHeader = newHeader;
        }
    });

    sheet.save();
    return true;
}

/**
 * 将当前列标题单元格的定义保存到字段库。
 * @param {object} cell - column_header 类型的 Cell 实例
 * @returns {boolean} 是否保存成功
 */
export async function saveColumnAsField(cell) {
    const result = await openFieldEditPopup({
        name: cell.data.value || '',
        value: cell.data.value || '',
        columnDataType: cell.data.columnDataType || 'text',
        description: '',
    });
    if (!result) return false;
    createField(result);
    return true;
}

/**
 * 从字段库中选取字段，创建一张新的 sheet/template。
 * 只负责创建并返回新对象，不负责更新 UI 下拉列表（由调用方处理）。
 *
 * @param {string} scope - 'chat' 或 'global'
 * @returns {object|null} 创建的 sheet/template 实例，取消返回 null
 */
export async function createSheetFromFields(scope) {
    const lib = getLibrary();
    if (lib.length === 0) {
        alert('字段库为空，请先在字段库中创建字段。');
        return null;
    }

    const itemsHTML = lib.map(f => `
        <label style="
            display:flex; align-items:center; gap:10px; padding:8px 10px;
            border:1px solid var(--SmartThemeBorderColor); border-radius:4px;
            background:var(--SmartThemeBlurTintColor); cursor:pointer;
        ">
            <input type="checkbox" class="cff-cb" value="${f.uid}"
                   style="flex-shrink:0; width:15px; height:15px;" />
            <div style="flex:1;">
                <div style="font-weight:bold; font-size:0.9rem;">${f.name}</div>
                <div style="font-size:0.75rem; color:var(--SmartThemeEmColor); margin-top:2px;">
                    列标题：${f.value || '<em>未设置</em>'}
                    &nbsp;·&nbsp;
                    ${TYPE_LABEL[f.columnDataType] || f.columnDataType}
                    ${f.description ? `&nbsp;·&nbsp; ${f.description}` : ''}
                </div>
            </div>
        </label>`).join('');

    const html = `
        <div class="wide100p padding5 dataBankAttachments">
            <h2 class="marginBot5"><span>从字段库创建表格</span></h2>
            <small>选择字段，将按选中顺序作为新表格的列；并为表格设置名称。</small>
            <hr/>
            <div style="margin-bottom:14px;">
                <label style="display:block; margin-bottom:4px;">表格名称</label>
                <input type="text" id="cff-name" class="text_pole" value="新表格" />
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
                ${itemsHTML}
            </div>
        </div>`;

    const popup = new EDITOR.Popup(html, EDITOR.POPUP_TYPE.CONFIRM, '', {
        okButton: '创建表格', cancelButton: '取消', allowVerticalScrolling: true,
    });
    await popup.show();
    if (!popup.result) return null;

    const tableName = (document.querySelector('#cff-name')?.value || '新表格').trim();
    const selectedUids = Array.from(
        document.querySelectorAll('.cff-cb:checked'),
    ).map(cb => cb.value);

    if (selectedUids.length === 0) return null;

    const fields = selectedUids.map(uid => lib.find(f => f.uid === uid)).filter(Boolean);
    const colCount = fields.length + 1; // +1 为 sheet_origin 占位列

    // 创建 sheet/template（不立即保存，由下面统一设置后再保存）
    let newSheet;
    if (scope === 'chat') {
        newSheet = BASE.createChatSheet(colCount, 2);
    } else {
        newSheet = new BASE.SheetTemplate().createNewTemplate(colCount, 2, false);
    }

    newSheet.name = tableName;

    // 将字段数据写入列标题单元格
    // hashSheet[0][0] 是 sheet_origin，字段从 [0][1] 开始
    fields.forEach((field, i) => {
        const colHeader = newSheet.cells.get(newSheet.hashSheet[0][i + 1]);
        if (colHeader) {
            colHeader.data.value = field.value;
            if (field.columnDataType) colHeader.data.columnDataType = field.columnDataType;
        }
    });

    // 保存（chat 域 save 写入 chatMetadata.sheets；global 域 save 写入 table_database_templates）
    newSheet.save();
    return newSheet;
}
