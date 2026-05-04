const db = require("../config/db");
const { getCodeByName } = require("../services/lookupCache");
const { normalizeWordBank } = require("../services/wordBankService");

// 读取
exports.getGameData = async (req, res) => {
    try {
        const { userID } = req.query;

        if (userID == null) {
            return res.status(400).json({ error: "Missing userID" });
        }

        const [rows] = await db.execute(`
            SELECT
                ll.language_level_name AS wordBank,
                p.pet_name AS pet,
                r.role_name AS role
            FROM user_game_data ug
            LEFT JOIN language_level_code ll ON ug.language_level_code = ll.language_level_code
            LEFT JOIN pet_code p ON ug.pet_code = p.pet_code
            LEFT JOIN role_code r ON ug.role_code = r.role_code
            WHERE ug.user_id = ?
        `, [userID]);

        if (rows.length === 0) {
            return res.json({
                userID,
                wordBank: null,
                pet: null,
                role: null
            });
        }

        res.json({
            userID,
            ...rows[0]
        });

    } catch (err) {
        console.error("getGameData error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// 保存（注册 + 更新）
exports.saveGameData = async (req, res) => {
    try {
        const { userID, wordBank, pet, role } = req.body;

        if (userID == null) {
            return res.status(400).json({ error: "Missing userID" });
        }

        const [wordCode, petCode, roleCode] = await Promise.all([
            getCodeByName("language_level_code", "language_level_name", "language_level_code", normalizeWordBank(wordBank)),
            getCodeByName("pet_code", "pet_name", "pet_code", pet),
            getCodeByName("role_code", "role_name", "role_code", role)
        ]);

        if (wordCode === undefined) {
            return res.status(400).json({ error: `Unknown wordBank: ${wordBank}` });
        }

        if (petCode === undefined) {
            return res.status(400).json({ error: `Unknown pet: ${pet}` });
        }

        if (roleCode === undefined) {
            return res.status(400).json({ error: `Unknown role: ${role}` });
        }

        const nowUTC = new Date().toISOString().slice(0, 19).replace('T', ' ');

        await db.execute(`
            INSERT INTO user_game_data
            (user_id, register_at, language_level_code, pet_code, role_code)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                language_level_code = VALUES(language_level_code),
                pet_code = VALUES(pet_code),
                role_code = VALUES(role_code)
        `, [userID, nowUTC, wordCode, petCode, roleCode]);

        res.json({ success: true });

    } catch (err) {
        console.error("saveGameData error:", err);

        if (err.code === "ER_NO_REFERENCED_ROW_2") {
            return res.status(400).json({ error: "Unknown userID" });
        }

        res.status(500).json({ error: "Server error" });
    }
};
