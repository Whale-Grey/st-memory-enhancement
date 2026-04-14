/**
 * 模板引擎模块
 * 负责将用户定义的显示模板转换为正则表达式，以及将行数据渲染为文本。
 *
 * 设计原则：AI 看到的记忆格式 == AI 输出的格式，只是 ADD 时去掉 #{序号}。
 */

/**
 * 转义正则特殊字符（保留用于字面量匹配）
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
    return str.replace(/[.+*?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 将显示模板转换为正则表达式，同时返回各捕获组对应的字段 key 列表。
 *
 * @param {string} template - 用户定义的显示模板，如 "#{序号} [{时间}] {事件} @{地点}"
 * @param {Array<{key:string, name:string}>} fields - 字段定义列表
 * @param {boolean} [includeId=true] - 是否包含 #{序号} 捕获组（ADD 命令解析时为 false）
 * @returns {{ regex: RegExp, captureKeys: string[] }}
 *   captureKeys 中的特殊值：'__id__' 对应序号，'__relations__' 对应关联
 */
export function templateToRegex(template, fields, includeId = true) {
    const captureKeys = [];
    let regexStr = '';
    let i = 0;

    while (i < template.length) {
        // 检测 #{序号} 占位符
        if (
            template[i] === '#' &&
            i + 1 < template.length &&
            template[i + 1] === '{'
        ) {
            const end = template.indexOf('}', i + 2);
            if (end !== -1) {
                const inner = template.slice(i + 2, end);
                if (inner === '序号') {
                    if (includeId) {
                        regexStr += '#(\\d+)';
                        captureKeys.push('__id__');
                    }
                    // 如果 !includeId，跳过该占位符及其后的可选空白
                    i = end + 1;
                    // 跳过紧随其后的空格（ADD 时序号不存在，整体向前移一段）
                    if (!includeId) {
                        while (i < template.length && template[i] === ' ') i++;
                    }
                    continue;
                }
            }
        }

        // 检测 {字段名} 占位符
        if (template[i] === '{') {
            const end = template.indexOf('}', i + 1);
            if (end !== -1) {
                const fieldName = template.slice(i + 1, end);
                const field = fields.find(f => f.name === fieldName);
                if (field) {
                    // 使用非贪婪匹配，允许字段值包含多数字符（但不跨行）
                    regexStr += '(.+?)';
                    captureKeys.push(field.key);
                    i = end + 1;
                    continue;
                }
            }
        }

        // 普通字符：转义后作为字面量
        regexStr += escapeRegex(template[i]);
        i++;
    }

    // 追加可选的关联捕获组：| 关联:#8,#10 或 ｜关联：#8，#10 等宽松写法
    regexStr += '(?:\\s*[|｜]\\s*关联[：:]\\s*(#\\d+(?:[,，\\s]+#\\d+)*))?';
    captureKeys.push('__relations__');

    // 行首允许可选空白，行尾同样
    return {
        regex: new RegExp('^\\s*' + regexStr + '\\s*$', 'i'),
        captureKeys,
    };
}

/**
 * 使用模板正则解析一行文本，提取字段值。
 *
 * @param {string} line - 待解析的文本行
 * @param {string} template - 显示模板
 * @param {Array<{key:string, name:string}>} fields - 字段定义
 * @param {boolean} [includeId=true] - 是否解析 #{序号}（ADD 时为 false）
 * @returns {{ id?: number, data: Object, relations: number[] } | null}
 */
export function parseLine(line, template, fields, includeId = true) {
    const { regex, captureKeys } = templateToRegex(template, fields, includeId);
    const match = regex.exec(line.trim());
    if (!match) return null;

    const result = { data: {}, relations: [] };

    captureKeys.forEach((key, idx) => {
        const value = match[idx + 1]; // match[0] 是全匹配
        if (value === undefined || value === null) return;

        if (key === '__id__') {
            result.id = parseInt(value, 10);
        } else if (key === '__relations__') {
            // 解析 "#8,#10" → [8, 10]
            const nums = value.match(/#(\d+)/g);
            if (nums) {
                result.relations = nums.map(s => parseInt(s.slice(1), 10));
            }
        } else {
            result.data[key] = value.trim();
        }
    });

    return result;
}

/**
 * 将一行数据渲染为显示文本（使用显示模板）。
 *
 * @param {string} template - 显示模板
 * @param {Array<{key:string, name:string}>} fields - 字段定义
 * @param {{ id: number, data: Object, relations: number[] }} row - 行数据
 * @param {boolean} [allowRelation=false] - 是否在行尾追加关联信息
 * @returns {string}
 */
export function renderRow(template, fields, row, allowRelation = false) {
    let text = template;

    // 替换 #{序号}
    text = text.replace(/#{序号}/g, `#${row.id}`);

    // 替换 {字段名}
    for (const field of fields) {
        const value = row.data?.[field.key] ?? '';
        // 使用全局替换（防止同一字段名出现多次）
        text = text.replace(
            new RegExp(`\\{${escapeRegex(field.name)}\\}`, 'g'),
            value
        );
    }

    // 追加关联
    if (allowRelation && Array.isArray(row.relations) && row.relations.length > 0) {
        text += ` | 关联:${row.relations.map(id => `#${id}`).join(',')}`;
    }

    return text;
}

/**
 * 从模板字符串中提取所有 {字段名} 占位符的名称列表（按出现顺序，去重）。
 * 用于 UI 实时预览时校验字段名是否全部被使用。
 *
 * @param {string} template
 * @returns {string[]}
 */
export function extractFieldNamesFromTemplate(template) {
    const names = [];
    const re = /\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(template)) !== null) {
        if (m[1] !== '序号' && !names.includes(m[1])) {
            names.push(m[1]);
        }
    }
    return names;
}
