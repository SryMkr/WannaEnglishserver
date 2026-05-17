const db = require("../config/db");
const { getCodeByName } = require("../services/lookupCache");

exports.submitSurvey = async (req, res) => {
    let connection;

    try {
        const { 
            userID, 
            surveyVersion,
            gender, 
            province, 
            degree,
            suggestion 
        } = req.body;

        const parsedUserID = Number(userID);
        if (!Number.isInteger(parsedUserID) || parsedUserID <= 0 || !gender || !province || !degree) {
            return res.status(400).json({ error: "Missing parameters" });
        }

        const genderCode = await getCodeByName("gender_code", "gender_name", "gender_code", gender);
        const provinceCode = await getCodeByName("province_code", "province_name", "province_code", province);
        const eduCode = await getCodeByName("education_level_code", "education_level_name", "education_level_code", degree);

        if (genderCode == null || provinceCode == null || eduCode == null) {
            return res.status(400).json({ error: "Mapping failed. Check parameters." });
        }

        const version = String(surveyVersion ?? "v1.0").trim() || "v1.0";
        const suggestionText = typeof suggestion === "string" ? suggestion.trim() : "";

        connection = await db.getConnection();
        await connection.beginTransaction();

        await connection.execute(
            `INSERT INTO user_profile (user_id, gender_code, province_code, education_level_code)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 gender_code = VALUES(gender_code),
                 province_code = VALUES(province_code),
                 education_level_code = VALUES(education_level_code)`,
            [parsedUserID, genderCode, provinceCode, eduCode]
        );

        const [resp] = await connection.execute(
            `INSERT INTO survey_response (user_id, survey_version)
             VALUES (?, ?)`,
            [parsedUserID, version]
        );

        const responseID = resp.insertId;

        if (suggestionText !== "") {
            await connection.execute(
                `INSERT INTO survey_suggestion (response_id, suggestion_text)
                 VALUES (?, ?)`,
                [responseID, suggestionText]
            );
        }

        await connection.commit();

        return res.json({
            success: true,
            responseID: responseID
        });

    } catch (err) {
        console.error("Survey submit error:", err);

        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Survey rollback error:", rollbackError);
            }
        }

        if (err.code === "ER_DATA_TOO_LONG") {
            return res.status(400).json({ error: "surveyVersion or suggestion is too long" });
        }

        res.status(500).json({ error: "Server Error" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};
