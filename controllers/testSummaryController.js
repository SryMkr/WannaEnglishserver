const db = require("../config/db");
const { getWordId, getTestTypeCode } = require("../services/lookupCache");
const VALID_RESULTS = new Set(["correct", "wrong", "skip"]);

// ---- 主逻辑：保存每日单题统计 ----
exports.saveTestSummary = async (req, res) => {
    try {
        const { userID, word, testType, result, responseTime } = req.body;

        if (userID == null || !word || !testType || !result || responseTime == null) {
            return res.status(400).json({ error: "Missing parameters" });
        }

        if (!VALID_RESULTS.has(result)) {
            return res.status(400).json({ error: `Invalid result: ${result}` });
        }

        const numericResponseTime = Number(responseTime);
        if (!Number.isFinite(numericResponseTime) || numericResponseTime < 0) {
            return res.status(400).json({ error: "Invalid responseTime" });
        }
        const normalizedResponseTime = Number(numericResponseTime.toFixed(2));

        const wordID = await getWordId(word);
        if (!wordID) {
            return res.status(400).json({ error: `Unknown word: ${word}` });
        }

        const testTypeCode = await getTestTypeCode(testType);
        if (!testTypeCode) {
            return res.status(400).json({ error: `Unknown testType: ${testType}` });
        }

        const today = new Date().toISOString().slice(0, 10);
        const correct = result === "correct" ? 1 : 0;
        const wrong = result === "wrong" ? 1 : 0;
        const skip = result === "skip" ? 1 : 0;
        const lastResult = result === "skip" ? null : (correct === 1 ? 1 : 0);

        await db.execute(
            `INSERT INTO user_test_daily_summary
             (user_id, word_id, test_type_code, game_date,
              correct_count, wrong_count, skip_count,
              avg_response_t, last_result)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                avg_response_t = ROUND(
                    (
                        COALESCE(avg_response_t, 0) * (correct_count + wrong_count + skip_count)
                        + VALUES(avg_response_t)
                    ) / (correct_count + wrong_count + skip_count + 1),
                    2
                ),
                correct_count = correct_count + VALUES(correct_count),
                wrong_count = wrong_count + VALUES(wrong_count),
                skip_count = skip_count + VALUES(skip_count),
                last_result = VALUES(last_result)`,
            [
                userID,
                wordID,
                testTypeCode,
                today,
                correct,
                wrong,
                skip,
                normalizedResponseTime,
                lastResult
            ]
        );

        return res.json({ success: true });

    } catch (err) {
        console.error("saveTestSummary error:", err);

        if (err.code === "ER_NO_REFERENCED_ROW_2") {
            return res.status(400).json({ error: "Unknown userID, word, or testType" });
        }

        res.status(500).json({ error: "Server Error" });
    }
};
