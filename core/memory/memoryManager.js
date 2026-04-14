/**
 * 记忆管理器模块
 * 负责记忆表格的存储、读取、渲染和解析。
 *
 * 存储策略：
 *   - 表格 schema（字段定义、模板）：extension_settings（全局）或角色卡扩展数据（角色级）
 *   - 行数据：chatMetadata（每个对话独立）
 *   - 全局自增 ID 计数器：chatMetadata（每个对话独立）
 */

import { USER } from '../manager.js';
import { MemoryTable, MemoryRow } from './memoryTable.js';
import { parseLine, renderRow } from './templateEngine.js';

/** chatMetadata 中用于存储行数据的键 */
const ROWS_KEY = 'memory_table_rows';
/** chatMetadata 中用于存储下一个可用 ID 的键 */
const NEXT_ID_KEY = 'memory_table_next_id';
/** extension_settings（tableBaseSetting）中用于存储 schema 的键 */
const SCHEMAS_KEY = 'memory_tables';

// ─────────────────────────────────────────────────────────────────
// 内部辅助：获取 chatMetadata（自动初始化）
// ─────────────────────────────────────────────────────────────────
function getChatMeta() {
    const ctx = USER.getContext?.();
    if (!ctx) return null;
    if (!ctx.chatMetadata) ctx.chatMetadata = {};
    return ctx.chatMetadata;
}

// ─────────────────────────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────────────────────────
export const MemoryManager = {

    // ── Schema 管理（全局/角色级持久化） ──────────────────────────

    /**
     * 获取当前生效的 schema 列表。
     * 优先使用角色卡扩展数据，其次全局 extension_settings。
     * @returns {Object[]} 纯对象数组（MemoryTable.schemaToJSON 格式）
     */
    getSchemas() {
        // 角色卡级别优先
        try {
            const charData = USER.getCharacterExtensionData?.();
            if (charData?.[SCHEMAS_KEY]) return charData[SCHEMAS_KEY];
        } catch (_) { /* ignore */ }

        // 全局兜底
        return USER.tableBaseSetting[SCHEMAS_KEY] || [];
    },

    /**
     * 保存 schema 列表。
     * @param {Object[]} schemas
     * @param {'global'|'character'} [scope='global']
     */
    saveSchemas(schemas, scope = 'global') {
        if (scope === 'character') {
            try {
                const charData = USER.getCharacterExtensionData?.();
                if (charData) {
                    charData[SCHEMAS_KEY] = schemas;
                    USER.saveCharacter?.();
                    return;
                }
            } catch (_) { /* ignore */ }
        }
        USER.tableBaseSetting[SCHEMAS_KEY] = schemas;
        USER.saveSettings?.();
    },

    // ── 行数据管理（per-chat chatMetadata） ──────────────────────

    /**
     * 获取当前对话的行数据 map：{ tableId: MemoryRow[] }
     * @returns {Object}
     */
    getRowsMap() {
        const meta = getChatMeta();
        if (!meta) return {};
        if (!meta[ROWS_KEY]) meta[ROWS_KEY] = {};
        return meta[ROWS_KEY];
    },

    /**
     * 保存行数据 map 并持久化聊天。
     * @param {Object} rowsMap
     */
    saveRowsMap(rowsMap) {
        const meta = getChatMeta();
        if (!meta) return;
        meta[ROWS_KEY] = rowsMap;
        USER.saveChat?.();
    },

    /**
     * 分配并返回下一个行 ID（全局自增，不复用）。
     * @returns {number}
     */
    allocId() {
        const meta = getChatMeta();
        if (!meta) return 1;
        const id = (meta[NEXT_ID_KEY] || 0) + 1;
        meta[NEXT_ID_KEY] = id;
        return id;
    },

    // ── 组合：获取包含行数据的完整 MemoryTable 列表 ───────────────

    /**
     * 获取带行数据的 MemoryTable 实例列表（运行时视图）。
     * @returns {MemoryTable[]}
     */
    getTables() {
        const schemas = this.getSchemas();
        const rowsMap = this.getRowsMap();

        return schemas.map(schema => {
            const table = new MemoryTable(schema);
            const rawRows = rowsMap[schema.tableId] || [];
            table.rows = rawRows.map(r => new MemoryRow(r));
            return table;
        });
    },

    /**
     * 将带行数据的表格列表保存（schema + 行数据分开存储）。
     * @param {MemoryTable[]} tables
     * @param {'global'|'character'} [scope='global']
     */
    saveTables(tables, scope = 'global') {
        const schemas = tables.map(t => t.schemaToJSON());
        const rowsMap = {};
        tables.forEach(t => {
            rowsMap[t.tableId] = t.rows.map(r => r.toJSON());
        });
        this.saveSchemas(schemas, scope);
        this.saveRowsMap(rowsMap);
    },

    // ── 渲染：生成注入 AI 的 <memory> 文本 ───────────────────────

    /**
     * 将所有表格渲染为 <memory>…</memory> 标签内容。
     * 空表格不输出（无行数据的表格跳过）。
     * @returns {string}
     */
    renderMemoryBlock() {
        const tables = this.getTables();
        const nonEmpty = tables.filter(t => t.rows.length > 0);
        if (nonEmpty.length === 0) return '';

        const sections = nonEmpty.map(t => {
            const lines = t.rows.map(row =>
                renderRow(t.displayTemplate, t.fields, row, t.allowRelation)
            );
            return `## ${t.tableName}\n${lines.join('\n')}`;
        });

        return `<memory>\n${sections.join('\n\n')}\n</memory>`;
    },

    /**
     * 构建完整的"记忆系统"提示词（含 <memory> 块 + 更新规则）。
     * @returns {string}
     */
    buildMemoryPrompt() {
        const tables = this.getTables();
        if (tables.length === 0) return '';

        const memoryBlock = this.renderMemoryBlock();
        const rules = this._buildUpdateRules(tables);

        const memorySection = memoryBlock
            ? `<memory> 标签中是当前已记录的历史信息，请在撰写剧情时参考这些记忆保持一致性。\n\n${memoryBlock}`
            : '当前还没有记忆记录。';

        return `# 记忆系统\n\n${memorySection}\n\n${rules}`;
    },

    /**
     * 动态生成"记忆更新规则"部分。
     * @param {MemoryTable[]} tables
     * @returns {string}
     * @private
     */
    _buildUpdateRules(tables) {
        const multiTable = tables.length > 1;

        // 生成 ADD 示例（从模板去掉 #{序号}）
        const addExamples = tables.map(t => {
            const addTpl = t.displayTemplate.replace(/^#\{序号\}\s*/, '');
            const tablePrefix = multiTable ? `${t.tableName} ` : '';
            const relSuffix = t.allowRelation ? ' | 关联:#相关序号' : '';
            return `ADD ${tablePrefix}${addTpl}${relSuffix}`;
        });

        const firstTable = tables[0];
        const firstField = firstTable?.fields?.[0];
        const editExample = firstField
            ? `EDIT #3 ${firstField.name}: 新值`
            : 'EDIT #3 字段名: 新值';

        const multiTableNote = multiTable
            ? `\n- 如有多张表，在 ADD 后加表名区分，例如：ADD ${firstTable.tableName} ...`
            : '';

        return `# 记忆更新规则

每次回复正文后，如果本轮剧情中有值得记录的新信息，请在 <memoryEdit> 标签中更新记忆。

操作说明：
- 新发生的事 → 用 ADD 添加一条新记忆
- 修正/补充已有记忆的某个细节 → 用 EDIT #序号 字段名: 新值
- 某条记忆已经不再相关 → 用 DEL #序号 删除
- 如果这条新事件和之前某条记忆有关，在末尾加上 | 关联:#序号${multiTableNote}

格式要求：
- ADD 的格式与上方 <memory> 中的记录格式一致（不需要写序号，序号自动分配）
- 每条操作占一行
- 不需要每次都更新，只在有新的重要剧情进展时更新

示例：
<memoryEdit>
${addExamples.join('\n')}
${editExample}
DEL #5
</memoryEdit>`;
    },

    // ── 解析：从 AI 回复中提取并执行 <memoryEdit> ────────────────

    /**
     * 从 AI 消息文本中提取 <memoryEdit> 标签内的全部操作，并执行。
     * @param {string} mes - AI 回复文本
     * @returns {boolean} 是否有任何变更发生
     */
    applyMemoryEdit(mes) {
        const ops = this._parseMemoryEdit(mes);
        if (ops.length === 0) return false;

        const tables = this.getTables();
        const rowsMap = this.getRowsMap();
        let changed = false;

        for (const op of ops) {
            let ok = false;
            if (op.type === 'ADD') {
                ok = this._execAdd(op.content, tables, rowsMap);
            } else if (op.type === 'DEL') {
                ok = this._execDel(op.id, rowsMap);
            } else if (op.type === 'EDIT') {
                ok = this._execEdit(op.id, op.fieldName, op.value, tables, rowsMap);
            }
            if (ok) changed = true;
        }

        if (changed) this.saveRowsMap(rowsMap);
        return changed;
    },

    /**
     * 从文本中提取 <memoryEdit> 块并解析每行操作。
     * @param {string} mes
     * @returns {Array<{type:'ADD'|'DEL'|'EDIT', ...}>}
     * @private
     */
    _parseMemoryEdit(mes) {
        const tagRegex = /<memoryEdit>([\s\S]*?)<\/memoryEdit>/gi;
        const ops = [];
        let m;

        while ((m = tagRegex.exec(mes)) !== null) {
            const block = m[1];
            for (const rawLine of block.split('\n')) {
                const line = rawLine.trim();
                if (!line) continue;
                const op = this._parseSingleOp(line);
                if (op) ops.push(op);
            }
        }

        return ops;
    },

    /**
     * 解析单行操作指令。
     * 支持：
     *   ADD [可选表名] <内容>
     *   DEL #<序号>
     *   EDIT #<序号> <字段名>: <新值>
     * @param {string} line
     * @returns {Object|null}
     * @private
     */
    _parseSingleOp(line) {
        // ADD
        const addMatch = line.match(/^ADD\s+([\s\S]+)/i);
        if (addMatch) return { type: 'ADD', content: addMatch[1].trim() };

        // DEL
        const delMatch = line.match(/^DEL\s+#(\d+)/i);
        if (delMatch) return { type: 'DEL', id: parseInt(delMatch[1], 10) };

        // EDIT  — 字段名可包含中文/英文，值可包含冒号
        const editMatch = line.match(/^EDIT\s+#(\d+)\s+([^:：]+)[：:]\s*([\s\S]*)/i);
        if (editMatch) {
            return {
                type: 'EDIT',
                id: parseInt(editMatch[1], 10),
                fieldName: editMatch[2].trim(),
                value: editMatch[3].trim(),
            };
        }

        return null;
    },

    // ── 执行 ADD ─────────────────────────────────────────────────

    /**
     * @param {string} content - ADD 后面的内容（可能以表名开头）
     * @param {MemoryTable[]} tables
     * @param {Object} rowsMap - 当前行数据 map（就地修改）
     * @returns {boolean}
     * @private
     */
    _execAdd(content, tables, rowsMap) {
        let targetTable = null;
        let actualContent = content;

        // 优先检查内容是否以某个表名开头
        for (const table of tables) {
            const prefix = table.tableName;
            if (
                content.startsWith(prefix + ' ') ||
                content.startsWith(prefix + '　') ||
                content === prefix
            ) {
                targetTable = table;
                actualContent = content.slice(prefix.length).trim();
                break;
            }
        }

        // 尝试按每张表的模板匹配（去掉序号部分的模板）
        if (!targetTable) {
            for (const table of tables) {
                if (!table.displayTemplate) continue;
                const addTpl = table.displayTemplate.replace(/^#\{序号\}\s*/, '');
                const parsed = parseLine(content, addTpl, table.fields, false);
                if (parsed) {
                    targetTable = table;
                    actualContent = content;
                    break;
                }
            }
        }

        // 兜底：使用第一张表
        if (!targetTable && tables.length > 0) {
            targetTable = tables[0];
            actualContent = content;
        }

        if (!targetTable) return false;

        // 解析字段值
        const addTpl = targetTable.displayTemplate.replace(/^#\{序号\}\s*/, '');
        const parsed = parseLine(actualContent, addTpl, targetTable.fields, false);

        let rowData = {};
        let relations = [];

        if (parsed) {
            rowData = parsed.data;
            relations = parsed.relations || [];
        } else {
            // 容错兜底：将整段文本存入第一个字段
            const firstField = targetTable.fields.find(f => f.required) || targetTable.fields[0];
            if (firstField) rowData[firstField.key] = actualContent;
            console.warn('[MemoryManager] ADD 解析失败，使用兜底存储:', actualContent);
        }

        const id = this.allocId();
        if (!rowsMap[targetTable.tableId]) rowsMap[targetTable.tableId] = [];
        rowsMap[targetTable.tableId].push({ id, data: rowData, relations });
        return true;
    },

    // ── 执行 DEL ─────────────────────────────────────────────────

    /**
     * @param {number} id
     * @param {Object} rowsMap
     * @returns {boolean}
     * @private
     */
    _execDel(id, rowsMap) {
        for (const tableId of Object.keys(rowsMap)) {
            const rows = rowsMap[tableId];
            const idx = rows.findIndex(r => r.id === id);
            if (idx !== -1) {
                rows.splice(idx, 1);
                return true;
            }
        }
        console.warn('[MemoryManager] DEL 未找到 id:', id);
        return false;
    },

    // ── 执行 EDIT ────────────────────────────────────────────────

    /**
     * @param {number} id
     * @param {string} fieldName - 字段显示名（name）
     * @param {string} value
     * @param {MemoryTable[]} tables
     * @param {Object} rowsMap
     * @returns {boolean}
     * @private
     */
    _execEdit(id, fieldName, value, tables, rowsMap) {
        for (const table of tables) {
            const rows = rowsMap[table.tableId];
            if (!rows) continue;
            const row = rows.find(r => r.id === id);
            if (!row) continue;

            // 优先通过字段显示名匹配
            const field = table.fields.find(f => f.name === fieldName);
            if (field) {
                row.data[field.key] = value;
                return true;
            }
            // 兜底：直接用 fieldName 作为 key
            row.data[fieldName] = value;
            return true;
        }
        console.warn('[MemoryManager] EDIT 未找到 id:', id, 'field:', fieldName);
        return false;
    },

    // ── 工具方法 ─────────────────────────────────────────────────

    /**
     * 判断当前是否处于记忆模式（memory_mode 开关开启）。
     * @returns {boolean}
     */
    isMemoryModeEnabled() {
        return USER.tableBaseSetting.memory_mode === true;
    },

    /**
     * 检查消息中是否含有 <memoryEdit> 标签。
     * @param {string} mes
     * @returns {boolean}
     */
    hasMemoryEdit(mes) {
        return /<memoryEdit>[\s\S]*?<\/memoryEdit>/i.test(mes);
    },
};
