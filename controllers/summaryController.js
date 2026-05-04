const db = require("../config/db");

exports.saveDailySummary = async (req, res) => {
    try {
        const { userID, gameModeID } = req.body;

        if (userID == null || gameModeID == null) {
            return res.status(400).json({ error: "Missing params" });
        }

        const numericGameModeID = Number(gameModeID);
        if (!Number.isInteger(numericGameModeID) || numericGameModeID <= 0 || numericGameModeID > 255) {
            return res.status(400).json({ error: "Invalid gameModeID" });
        }

        const today = new Date().toISOString().slice(0, 10);
        const nowUTC = new Date().toISOString().slice(0, 19).replace("T", " ");

        await db.execute(
            `INSERT INTO user_daily_summary
             (user_id, game_mode_id, game_date, entry_count, first_enter_at)
             VALUES (?, ?, ?, 1, ?)
             ON DUPLICATE KEY UPDATE
                 entry_count = entry_count + 1,
                 first_enter_at = COALESCE(first_enter_at, VALUES(first_enter_at))`,
            [userID, numericGameModeID, today, nowUTC]
        );

        return res.json({ success: true });

    } catch (err) {
        console.error("Daily summary error:", err);

        if (err.code === "ER_NO_REFERENCED_ROW_2" || err.code === "ER_WARN_DATA_OUT_OF_RANGE") {
            return res.status(400).json({ error: "Unknown userID or gameModeID" });
        }

        res.status(500).json({ error: "Server Error" });
    }
};
