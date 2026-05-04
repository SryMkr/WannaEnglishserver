const db = require("../config/db");

// -------------------------------
// 处理 Unity ISO8601 时间 → MySQL DATETIME(6)
// -------------------------------
function fixTimestamp(ts) {
    if (!ts) return null;

    if (typeof ts !== "string") {
        return null;
    }

    // 去掉末尾的 Z
    ts = ts.replace("Z", "");

    // 提取小数秒部分
    const match = ts.match(/\.(\d+)/);

    if (match) {
        // 只保留 6 位微秒
        let micro = match[1].substring(0, 6);

        ts = ts.replace(/\.\d+/, "." + micro);
    }

    return ts.replace("T", " "); // MySQL 时间格式：YYYY-MM-DD HH:MM:SS.ffffff
}

function getCurrentUtcDateTime6() {
    const iso = new Date().toISOString().replace("Z", "");
    return `${iso.replace("T", " ")}000`;
}

// -------------------------------
// 获取动作类型 ID
// -------------------------------
async function getActionTypeMap(actionNames) {
    if (actionNames.length === 0) {
        return new Map();
    }

    const placeholders = actionNames.map(() => "?").join(", ");
    const [rows] = await db.query(
        `SELECT action_type_id, action_type_name
         FROM action_type
         WHERE action_type_name IN (${placeholders})`,
        actionNames
    );

    return new Map(rows.map((row) => [row.action_type_name, row.action_type_id]));
}


// -------------------------------
// 批量插入 Action Logs
// -------------------------------
exports.batchInsertActionLogs = async (req, res) => {
    try {
        const { logs } = req.body;

        if (!Array.isArray(logs) || logs.length === 0) {
            return res.status(400).json({ error: "logs 不能为空" });
        }

        const actionNames = [...new Set(
            logs
                .map((log) => log?.action_type_name)
                .filter((actionName) => typeof actionName === "string" && actionName.trim() !== "")
        )];
        const actionTypeMap = await getActionTypeMap(actionNames);
        const rowsToInsert = [];
        let skippedCount = 0;

        for (const log of logs) {
            if (!log || typeof log !== "object") {
                skippedCount++;
                continue;
            }

            const {
                action_type_name,
                user_id,
                session_id,
                round_no,
                action_detail,
                context_state,
                action_timestamp   // 🔥 Unity 传来的真实操作时间
            } = log;

            if (!action_type_name || user_id == null || session_id == null || round_no == null) {
                skippedCount++;
                continue;
            }

            const actionTypeID = actionTypeMap.get(action_type_name);
            if (!actionTypeID) {
                skippedCount++;
                continue;
            }

            const numericRoundNo = Number(round_no);
            if (!Number.isInteger(numericRoundNo) || numericRoundNo < 0) {
                skippedCount++;
                continue;
            }

            rowsToInsert.push([
                actionTypeID,
                user_id,
                session_id,
                numericRoundNo,
                JSON.stringify(action_detail ?? {}),
                context_state == null ? null : JSON.stringify(context_state),
                fixTimestamp(action_timestamp) || getCurrentUtcDateTime6()
            ]);
        }

        if (rowsToInsert.length === 0) {
            return res.status(400).json({ error: "No valid logs to insert" });
        }

        await db.query(
            `INSERT INTO action_log
             (action_type_id, user_id, session_id, round_no,
              action_detail, context_state, created_at)
             VALUES ?`,
            [rowsToInsert]
        );

        return res.json({
            success: true,
            inserted: rowsToInsert.length,
            skipped: skippedCount
        });

    } catch (err) {
        console.error("❌ batchInsertActionLogs Error:", err);

        if (err.code === "ER_NO_REFERENCED_ROW_2") {
            return res.status(400).json({ error: "Unknown action type, user, or session" });
        }

        res.status(500).json({ error: "Server error" });
    }
};

exports.getRoomActionLogs = async (req, res) => {
    try {
        const matchRoomId = typeof req.query.match_room_id === "string" ? req.query.match_room_id.trim() : "";
        const viewerUserId = Number(req.query.viewer_user_id);
        const afterId = Number(req.query.after_id) || 0;
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

        if (!matchRoomId) {
            return res.status(400).json({ success: false, message: "match_room_id 不能为空" });
        }

        if (!Number.isInteger(viewerUserId) || viewerUserId <= 0) {
            return res.status(400).json({ success: false, message: "viewer_user_id 无效" });
        }

        const [rows] = await db.execute(
            `SELECT al.action_log_id,
                    at.action_type_name,
                    al.user_id,
                    al.session_id,
                    al.round_no,
                    CAST(al.action_detail AS CHAR) AS action_detail_json,
                    CAST(al.context_state AS CHAR) AS context_state_json,
                    al.created_at
             FROM action_log al
             INNER JOIN action_type at ON at.action_type_id = al.action_type_id
             INNER JOIN user_study_session_summary usss ON usss.session_id = al.session_id
             WHERE usss.match_room_id = ?
               AND al.user_id <> ?
               AND al.action_log_id > ?
             ORDER BY al.action_log_id ASC
             LIMIT ${limit}`,
            [matchRoomId, viewerUserId, afterId]
        );

        return res.json({
            success: true,
            logs: rows.map(row => ({
                action_log_id: Number(row.action_log_id),
                action_type_name: row.action_type_name,
                user_id: Number(row.user_id),
                session_id: Number(row.session_id),
                round_no: Number(row.round_no),
                action_detail_json: row.action_detail_json || "{}",
                context_state_json: row.context_state_json || "",
                created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
            })),
            next_after_id: rows.length > 0 ? Number(rows[rows.length - 1].action_log_id) : afterId
        });
    } catch (err) {
        console.error("getRoomActionLogs Error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};
