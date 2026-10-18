const db = require("../config/db");
const { formatChinaDateTime } = require("../services/timeService");

const ALLOWED_STATUSES = new Set(["seen", "completed", "skipped"]);

let schemaReadyPromise = null;

async function assertSchema() {
    const requiredColumns = [
        "user_id",
        "tutorial_key",
        "status",
        "version",
        "updated_at",
        "created_at"
    ];
    const [rows] = await db.execute(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'user_tutorial_state'
           AND COLUMN_NAME IN (${requiredColumns.map(() => "?").join(", ")})`,
        requiredColumns
    );

    if (rows.length !== requiredColumns.length) {
        const present = new Set(rows.map(row => row.COLUMN_NAME));
        const missing = requiredColumns.filter(column => !present.has(column));
        throw new Error(`Database migration required: user_tutorial_state missing columns ${missing.join(", ")}`);
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
        return "";
    }

    const text = String(value).trim();
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function buildState(row) {
    if (!row) {
        return null;
    }

    return {
        user_id: Number(row.user_id),
        tutorial_key: row.tutorial_key,
        status: row.status,
        version: row.version || null,
        updated_at: row.updated_at
    };
}

exports.ensureSchema = ensureSchema;

exports.getTutorialState = async (req, res) => {
    try {
        await ensureSchema();

        const userId = normalizeUserId(req.query.user_id ?? req.query.userID);
        const tutorialKey = normalizeText(req.query.tutorial_key ?? req.query.tutorialKey, 96);
        if (userId == null) {
            return res.status(400).json({ success: false, message: "user_id 无效" });
        }

        if (!tutorialKey) {
            return res.status(400).json({ success: false, message: "tutorial_key 不能为空" });
        }

        const [rows] = await db.execute(
            `SELECT user_id, tutorial_key, status, version, updated_at
             FROM user_tutorial_state
             WHERE user_id = ? AND tutorial_key = ?
             LIMIT 1`,
            [userId, tutorialKey]
        );

        return res.json({ success: true, state: buildState(rows[0]) });
    } catch (err) {
        console.error("getTutorialState error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.saveTutorialState = async (req, res) => {
    try {
        await ensureSchema();

        const userId = normalizeUserId(req.body.user_id ?? req.body.userID);
        const tutorialKey = normalizeText(req.body.tutorial_key ?? req.body.tutorialKey, 96);
        const status = normalizeText(req.body.status, 16);
        const version = normalizeText(req.body.version, 32) || null;

        if (userId == null) {
            return res.status(400).json({ success: false, message: "user_id 无效" });
        }

        if (!tutorialKey) {
            return res.status(400).json({ success: false, message: "tutorial_key 不能为空" });
        }

        if (!ALLOWED_STATUSES.has(status)) {
            return res.status(400).json({ success: false, message: "status 无效" });
        }

        const now = formatChinaDateTime(new Date(), 6);
        await db.execute(
            `INSERT INTO user_tutorial_state
                (user_id, tutorial_key, status, version, updated_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                status = VALUES(status),
                version = VALUES(version),
                updated_at = VALUES(updated_at)`,
            [userId, tutorialKey, status, version, now, now]
        );

        const [rows] = await db.execute(
            `SELECT user_id, tutorial_key, status, version, updated_at
             FROM user_tutorial_state
             WHERE user_id = ? AND tutorial_key = ?
             LIMIT 1`,
            [userId, tutorialKey]
        );

        return res.json({ success: true, state: buildState(rows[0]) });
    } catch (err) {
        console.error("saveTutorialState error:", err);

        if (err.code === "ER_NO_REFERENCED_ROW_2") {
            return res.status(400).json({ success: false, message: "Unknown user" });
        }

        return res.status(500).json({ success: false, message: "Server error" });
    }
};
