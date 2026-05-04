// controllers/progressController.js
const db = require("../config/db");
const { getWordId } = require("../services/lookupCache");

exports.saveWordProgress = async (req, res) => {
    try {
        const { userID, word } = req.body;

        if (userID == null || !word) {
            return res.status(400).json({ error: "Missing params" });
        }

        const wordID = await getWordId(word);
        if (!wordID) {
            return res.status(400).json({ error: "Unknown word: " + word });
        }

        const nowUTC = new Date().toISOString().slice(0, 19).replace('T', ' ');

        await db.execute(
            `INSERT INTO user_word_progress
             (user_id, word_id, word_proficiency, study_count, last_studied_at)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                study_count = study_count + 1,
                last_studied_at = VALUES(last_studied_at)`,
            [userID, wordID, 0, 1, nowUTC]
        );

        return res.json({ success: true });

    } catch (err) {
        console.error("saveWordProgress error:", err);

        if (err.code === "ER_NO_REFERENCED_ROW_2") {
            return res.status(400).json({ error: "Unknown userID or word" });
        }

        res.status(500).json({ error: "Server Error" });
    }
};
