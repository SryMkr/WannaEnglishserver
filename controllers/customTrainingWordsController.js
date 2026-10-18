const db = require("../config/db");

const MAX_TRAINING_WORDS = 5;

let schemaReadyPromise = null;

async function assertSchema() {
    const requiredColumns = [
        "user_id",
        "word_id",
        "sort_order",
        "created_at",
        "updated_at"
    ];
    const [rows] = await db.execute(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'user_custom_training_word'
           AND COLUMN_NAME IN (${requiredColumns.map(() => "?").join(", ")})`,
        requiredColumns
    );

    if (rows.length !== requiredColumns.length) {
        const present = new Set(rows.map(row => row.COLUMN_NAME));
        const missing = requiredColumns.filter(column => !present.has(column));
        throw new Error(`Database migration required: user_custom_training_word missing columns ${missing.join(", ")}`);
    }
}

async function ensureSchema() {
    if (schemaReadyPromise) {
        return schemaReadyPromise;
    }

    schemaReadyPromise = assertSchema().catch(error => {
        schemaReadyPromise = null;
        throw error;
    });

    return schemaReadyPromise;
}

function parseJsonField(value, fallback) {
    if (value == null) {
        return fallback;
    }

    if (typeof value === "string") {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }

    return value;
}

function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function ok(res, extra = {}) {
    return res.json({ success: true, ...extra });
}

function fail(res, status, message) {
    return res.status(status).json({ success: false, message });
}

function extractPrimaryMeaning(detail) {
    const meanings = parseJsonField(detail, []);
    if (!Array.isArray(meanings) || meanings.length === 0) {
        return { wordType: "", primaryMeaning: "" };
    }

    const first = meanings.find(item => item && (normalizeText(item.chinese) || normalizeText(item.cn))) || meanings[0];
    return {
        wordType: normalizeText(first?.type) || normalizeText(first?.pos),
        primaryMeaning: normalizeText(first?.chinese) || normalizeText(first?.cn)
    };
}

function extractIpa(phonetic) {
    const parsed = parseJsonField(phonetic, {});
    if (parsed && typeof parsed === "object") {
        return normalizeText(parsed.ipa);
    }

    return normalizeText(parsed);
}

function buildTrainingWord(row) {
    const meaning = extractPrimaryMeaning(row.detail);
    return {
        word_id: Number(row.word_id),
        word: row.word_form,
        ipa: extractIpa(row.phonetic),
        wordType: meaning.wordType || row.word_type || "",
        primaryMeaning: meaning.primaryMeaning,
        wordBank: row.word_bank || null,
        language_level_code: row.language_level_code == null ? 0 : Number(row.language_level_code),
        sort_order: row.sort_order == null ? 0 : Number(row.sort_order)
    };
}

async function loadTrainingWords(userId) {
    const [rows] = await db.execute(
        `SELECT
             v.word_id,
             v.word_form,
             v.phonetic,
             v.detail,
             v.word_type,
             ll.language_level_name AS word_bank,
             CAST(JSON_UNQUOTE(JSON_EXTRACT(vlr.language_level_codes, '$[0]')) AS UNSIGNED) AS language_level_code,
             uctw.sort_order
         FROM user_custom_training_word uctw
         INNER JOIN vocabulary v ON v.word_id = uctw.word_id
         LEFT JOIN vocabulary_level_relation vlr ON vlr.word_id = v.word_id
         LEFT JOIN language_level_code ll
             ON ll.language_level_code = CAST(JSON_UNQUOTE(JSON_EXTRACT(vlr.language_level_codes, '$[0]')) AS UNSIGNED)
         WHERE uctw.user_id = ?
         ORDER BY uctw.sort_order ASC
         LIMIT ${MAX_TRAINING_WORDS}`,
        [userId]
    );

    return rows.map(buildTrainingWord);
}

async function userExists(userId, connection = db) {
    const [rows] = await connection.execute(
        "SELECT user_id FROM user_profile WHERE user_id = ? LIMIT 1",
        [userId]
    );
    return rows.length > 0;
}

function normalizeSubmittedWordIds(source) {
    const wordIds = Array.isArray(source) ? source : [];
    const normalized = [];
    const seen = new Set();

    for (const rawWordId of wordIds) {
        const wordId = Number(rawWordId);
        if (!Number.isInteger(wordId) || wordId <= 0 || seen.has(wordId)) {
            continue;
        }

        seen.add(wordId);
        normalized.push(wordId);
    }

    return normalized;
}

exports.MAX_TRAINING_WORDS = MAX_TRAINING_WORDS;
exports.ensureSchema = ensureSchema;
exports.loadTrainingWords = loadTrainingWords;

exports.getCustomTrainingWords = async (req, res) => {
    try {
        await ensureSchema();

        const userId = Number(req.query.user_id);
        if (!Number.isInteger(userId) || userId <= 0) {
            return fail(res, 400, "user_id 无效");
        }

        if (!await userExists(userId)) {
            return fail(res, 404, "用户不存在");
        }

        const words = await loadTrainingWords(userId);
        return ok(res, { max_words: MAX_TRAINING_WORDS, words });
    } catch (err) {
        console.error("getCustomTrainingWords error:", err);
        return fail(res, 500, "Server error");
    }
};

exports.saveCustomTrainingWords = async (req, res) => {
    try {
        await ensureSchema();

        const userId = Number(req.body.user_id);

        if (!Number.isInteger(userId) || userId <= 0) {
            return fail(res, 400, "user_id 无效");
        }

        const normalizedWordIds = normalizeSubmittedWordIds(req.body.word_ids);
        if (normalizedWordIds.length > MAX_TRAINING_WORDS) {
            return fail(res, 400, `最多只能选择 ${MAX_TRAINING_WORDS} 个单词`);
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            if (!await userExists(userId, connection)) {
                await connection.rollback();
                return fail(res, 404, "用户不存在");
            }

            if (normalizedWordIds.length > 0) {
                const placeholders = normalizedWordIds.map(() => "?").join(", ");
                const [existingRows] = await connection.execute(
                    `SELECT word_id FROM vocabulary WHERE word_id IN (${placeholders})`,
                    normalizedWordIds
                );
                const existing = new Set(existingRows.map(row => Number(row.word_id)));
                const missing = normalizedWordIds.filter(wordId => !existing.has(wordId));
                if (missing.length > 0) {
                    await connection.rollback();
                    return fail(res, 400, "存在未收录单词，无法保存");
                }
            }

            await connection.execute(
                "DELETE FROM user_custom_training_word WHERE user_id = ?",
                [userId]
            );

            if (normalizedWordIds.length > 0) {
                const values = [];
                const placeholders = normalizedWordIds.map((wordId, index) => {
                    values.push(userId, wordId, index);
                    return "(?, ?, ?)";
                }).join(", ");

                await connection.execute(
                    `INSERT INTO user_custom_training_word (user_id, word_id, sort_order)
                     VALUES ${placeholders}`,
                    values
                );
            }

            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

        const words = await loadTrainingWords(userId);
        return ok(res, { max_words: MAX_TRAINING_WORDS, words });
    } catch (err) {
        console.error("saveCustomTrainingWords error:", err);

        if (err.code === "ER_NO_REFERENCED_ROW_2") {
            return fail(res, 400, "Unknown user or word");
        }

        return fail(res, 500, "Server error");
    }
};
