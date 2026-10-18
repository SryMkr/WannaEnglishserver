const db = require("../config/db");
const { normalizeWordBank } = require("../services/wordBankService");
const { formatChinaDateTime, normalizeToChinaDateTime } = require("../services/timeService");

const ALLOWED_ENTRY_MODES = new Set([
    "human_practice",
    "match_human",
    "match_bot",
    "custom_training",
    "friend_room"
]);

let schemaReadyPromise = null;

async function assertSchema() {
    const requiredColumns = [
        "event_id",
        "user_id",
        "entry_mode",
        "word_bank",
        "source",
        "client_time",
        "detail_json",
        "created_at"
    ];
    const [rows] = await db.execute(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'user_mode_entry_event'
           AND COLUMN_NAME IN (${requiredColumns.map(() => "?").join(", ")})`,
        requiredColumns
    );

    if (rows.length !== requiredColumns.length) {
        const present = new Set(rows.map(row => row.COLUMN_NAME));
        const missing = requiredColumns.filter(column => !present.has(column));
        throw new Error(`Database migration required: user_mode_entry_event missing columns ${missing.join(", ")}`);
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

function normalizeUserId(value) {
    const userId = Number(value);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function normalizeText(value, maxLength) {
    if (value == null) {
        return null;
    }

    const text = String(value).trim();
    if (!text) {
        return null;
    }

    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeDetail(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

exports.ensureSchema = ensureSchema;

exports.recordModeEntry = async (req, res) => {
    try {
        await ensureSchema();

        const userId = normalizeUserId(req.body.user_id ?? req.body.userID);
        const entryMode = normalizeText(req.body.entry_mode ?? req.body.entryMode, 32);
        if (userId == null) {
            return res.status(400).json({ success: false, message: "user_id 无效" });
        }

        if (!entryMode || !ALLOWED_ENTRY_MODES.has(entryMode)) {
            return res.status(400).json({ success: false, message: "entry_mode 无效" });
        }

        const [result] = await db.execute(
            `INSERT INTO user_mode_entry_event
                (user_id, entry_mode, word_bank, source, client_time, detail_json, created_at)
             VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
            [
                userId,
                entryMode,
                normalizeWordBank(req.body.word_bank ?? req.body.wordBank),
                normalizeText(req.body.source, 64),
                normalizeToChinaDateTime(req.body.client_time ?? req.body.clientTime, 6),
                JSON.stringify(normalizeDetail(req.body.detail)),
                formatChinaDateTime(new Date(), 6)
            ]
        );

        return res.json({ success: true, event_id: Number(result.insertId) });
    } catch (err) {
        console.error("recordModeEntry error:", err);

        if (err.code === "ER_NO_REFERENCED_ROW_2") {
            return res.status(400).json({ success: false, message: "Unknown user" });
        }

        return res.status(500).json({ success: false, message: "Server error" });
    }
};
