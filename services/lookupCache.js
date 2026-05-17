const db = require("../config/db");

const TABLE_CACHE_TTL_MS = Number(process.env.LOOKUP_CACHE_TTL_MS) || 5 * 60 * 1000;

const tableCache = new Map();
const wordIdCache = new Map();
const testTypeCodeCache = new Map();

function normalizeLookupKey(value) {
    if (value == null) {
        return "";
    }

    return String(value).trim().toLowerCase();
}

async function loadTableMap(table, nameField, codeField) {
    const cacheKey = `${table}:${nameField}:${codeField}`;
    const now = Date.now();
    const cached = tableCache.get(cacheKey);

    if (cached?.value && cached.expiresAt > now) {
        return cached.value;
    }

    if (cached?.promise) {
        return cached.promise;
    }

    const promise = db.query(
        `SELECT ${nameField} AS name, ${codeField} AS code FROM ${table}`
    ).then(([rows]) => {
        const map = new Map();
        for (const row of rows) {
            const key = normalizeLookupKey(row.name);
            if (key) {
                map.set(key, row.code);
            }
        }

        tableCache.set(cacheKey, {
            value: map,
            expiresAt: Date.now() + TABLE_CACHE_TTL_MS
        });

        return map;
    }).catch(error => {
        tableCache.delete(cacheKey);
        throw error;
    });

    tableCache.set(cacheKey, { promise, expiresAt: now + TABLE_CACHE_TTL_MS });
    return promise;
}

async function getCodeByName(table, nameField, codeField, value) {
    if (value == null || value === "") {
        return null;
    }

    const normalizedKey = normalizeLookupKey(value);
    if (!normalizedKey) {
        return null;
    }

    const lookup = await loadTableMap(table, nameField, codeField);
    return lookup.has(normalizedKey) ? lookup.get(normalizedKey) : undefined;
}

async function getWordId(word) {
    const normalizedKey = normalizeLookupKey(word);
    if (!normalizedKey) {
        return null;
    }

    if (wordIdCache.has(normalizedKey)) {
        return wordIdCache.get(normalizedKey);
    }

    const [rows] = await db.execute(
        "SELECT word_id FROM vocabulary WHERE LOWER(word_form) = ? LIMIT 1",
        [normalizedKey]
    );

    const wordId = rows.length > 0 ? rows[0].word_id : null;
    wordIdCache.set(normalizedKey, wordId);
    return wordId;
}

async function getTestTypeCode(typeName) {
    const normalizedKey = normalizeLookupKey(typeName);
    if (!normalizedKey) {
        return null;
    }

    if (testTypeCodeCache.has(normalizedKey)) {
        return testTypeCodeCache.get(normalizedKey);
    }

    const [rows] = await db.execute(
        "SELECT test_type_code FROM test_type_code WHERE type_name_en = ? LIMIT 1",
        [String(typeName).trim()]
    );

    const testTypeCode = rows.length > 0 ? rows[0].test_type_code : null;
    testTypeCodeCache.set(normalizedKey, testTypeCode);
    return testTypeCode;
}

module.exports = {
    getCodeByName,
    getWordId,
    getTestTypeCode
};
