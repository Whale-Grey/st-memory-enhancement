/**
 * 记忆表格数据结构模块
 * 实现基于命名字段的记忆表格，替代旧的网格式表格系统
 */

/**
 * 记忆行 - 一条记忆记录
 */
export class MemoryRow {
    /**
     * @param {Object} config
     * @param {number} config.id - 自动分配的全局唯一序号，删除后不复用
     * @param {Object} config.data - 字段键值对 { fieldKey: value }
     * @param {number[]} config.relations - 关联的其他行序号
     */
    constructor({ id, data = {}, relations = [] }) {
        this.id = id;
        this.data = { ...data };
        this.relations = [...relations];
    }

    toJSON() {
        return {
            id: this.id,
            data: { ...this.data },
            relations: [...this.relations],
        };
    }
}

/**
 * 记忆表格 - 包含字段定义和行数据的表格
 */
export class MemoryTable {
    /**
     * @param {Object} config
     * @param {string} config.tableId - 表格唯一标识
     * @param {string} config.tableName - 显示名称
     * @param {Array<{key:string, name:string, required:boolean}>} config.fields - 字段列表
     * @param {string} config.displayTemplate - 显示模板，如 "#{序号} [{时间}] {事件} @{地点}"
     * @param {boolean} config.allowRelation - 是否启用关联功能
     * @param {MemoryRow[]} [config.rows] - 行数据（可选，用于加载已有数据）
     */
    constructor(config) {
        this.tableId = config.tableId || `mt_${Math.random().toString(36).slice(2, 10)}`;
        this.tableName = config.tableName || '未命名表格';
        this.fields = Array.isArray(config.fields) ? config.fields : [];
        this.displayTemplate = config.displayTemplate || '';
        this.allowRelation = config.allowRelation ?? false;
        this.rows = [];

        if (Array.isArray(config.rows)) {
            this.rows = config.rows.map(r =>
                r instanceof MemoryRow ? r : new MemoryRow(r)
            );
        }
    }

    /** 返回仅包含 schema 定义（不含行数据）的纯对象，用于持久化到扩展设置 */
    schemaToJSON() {
        return {
            tableId: this.tableId,
            tableName: this.tableName,
            fields: this.fields.map(f => ({ ...f })),
            displayTemplate: this.displayTemplate,
            allowRelation: this.allowRelation,
        };
    }

    /** 返回完整对象（含行数据） */
    toJSON() {
        return {
            ...this.schemaToJSON(),
            rows: this.rows.map(r => r.toJSON()),
        };
    }
}

/**
 * 内置预设表格模板
 */
export const PRESET_TEMPLATES = [
    {
        name: '历史事件表（推荐预设）',
        config: {
            tableName: '历史事件',
            fields: [
                { key: 'time',     name: '时间', required: true  },
                { key: 'event',    name: '事件', required: true  },
                { key: 'location', name: '地点', required: false },
            ],
            displayTemplate: '#{序号} [{时间}] {事件} @{地点}',
            allowRelation: true,
        },
    },
    {
        name: '角色状态表',
        config: {
            tableName: '角色状态',
            fields: [
                { key: 'character', name: '角色名',   required: true  },
                { key: 'status',    name: '当前状态', required: true  },
            ],
            displayTemplate: '- {角色名}: {当前状态}',
            allowRelation: false,
        },
    },
    {
        name: '重要物品表',
        config: {
            tableName: '重要物品',
            fields: [
                { key: 'owner', name: '持有人', required: true  },
                { key: 'item',  name: '物品',   required: true  },
                { key: 'note',  name: '备注',   required: false },
            ],
            displayTemplate: '#{序号} {持有人} → {物品}（{备注}）',
            allowRelation: false,
        },
    },
];
