const db = require("../config/db");

const VALID_SUBMISSION_TYPES = new Set(["new_word", "correction"]);
const VALID_WORD_TYPES = new Set(["independent", "morphology", "compound"]);
const VALID_DECISIONS = new Set(["approved", "rejected"]);

function parsePositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeString(value, maxLength) {
    const text = typeof value === "string" ? value.trim() : "";
    return text.slice(0, maxLength);
}

function normalizeWord(value) {
    return normalizeString(value, 64).toLowerCase().replace(/\s+/g, "");
}

function hasUnsafeText(value) {
    return typeof value === "string" && /[<>]/.test(value);
}

function parseJsonColumn(value, fallback) {
    if (value == null) {
        return fallback;
    }
    if (typeof value !== "string") {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

function toStatusLabel(status) {
    if (status === "approved") {
        return "已通过";
    }
    if (status === "rejected") {
        return "已驳回";
    }
    return "待审核";
}

function toReviewDecisionLabel(decision) {
    return decision === "approved" ? "通过" : "驳回";
}

function toSubmissionDto(row, reviews = []) {
    const languageLevels = parseJsonColumn(row.language_levels, []);
    const detail = parseJsonColumn(row.detail, []);
    const phonetic = parseJsonColumn(row.phonetic, {});
    const structure = parseJsonColumn(row.structure, []);
    const notes = reviews.map(review => `${toReviewDecisionLabel(review.decision)}：${review.note}`);

    return {
        id: String(row.contribution_id),
        contributionID: row.contribution_id,
        source: "server",
        submissionType: row.submission_type,
        targetWord: row.target_word || "",
        word: row.word_form,
        ipa: phonetic.ipa || "",
        levels: Array.isArray(languageLevels)
            ? languageLevels.map(level => Number(level.language_level_code)).filter(Number.isInteger)
            : [],
        languageLevels,
        wordType: row.word_type,
        meanings: Array.isArray(detail) ? detail : [],
        structures: Array.isArray(structure) ? structure : [],
        origin: row.origin || "",
        status: toStatusLabel(row.status),
        rawStatus: row.status,
        progress: row.status === "approved" ? "审核完成" : row.status === "rejected" ? "审核未通过" : "等待审核",
        notes,
        submitterUserID: row.submitter_user_id,
        submitterUserName: row.submitter_user_name || "",
        submittedAt: row.submitted_at,
        reviewedAt: row.reviewed_at,
        titlePrefix: row.submission_type === "correction" ? "我的纠错" : "我的提交"
    };
}

function toExistingWordDto(row) {
    const phonetic = parseJsonColumn(row.phonetic, {});
    const detail = parseJsonColumn(row.detail, []);
    const structure = parseJsonColumn(row.structure, []);
    const levelCodes = Array.isArray(row.language_level_codes)
        ? row.language_level_codes.map(Number).filter(Number.isInteger)
        : [];

    return {
        word: row.word_form,
        ipa: phonetic.ipa || "",
        levels: levelCodes,
        languageLevels: levelCodes.map(code => {
            const nameMap = {
                1: "小学",
                2: "初中",
                3: "高中",
                4: "四级",
                5: "六级",
                6: "雅思",
                7: "托福",
                8: "随机"
            };
            return {
                language_level_code: code,
                language_level_name: nameMap[code] || ""
            };
        }),
        wordType: row.word_type,
        meanings: Array.isArray(detail) ? detail : [],
        structures: Array.isArray(structure) ? structure : [],
        origin: row.origin || ""
    };
}

function getLevelCodes(languageLevels) {
    if (!Array.isArray(languageLevels)) {
        return [];
    }

    return Array.from(new Set(
        languageLevels
            .map(level => Number(level.language_level_code))
            .filter(Number.isInteger)
    )).sort((a, b) => a - b);
}

async function ensureUserExists(connection, userID) {
    const [rows] = await connection.execute(
        "SELECT user_id FROM user_profile WHERE user_id = ? LIMIT 1",
        [userID]
    );
    return rows.length > 0;
}

function validateContributionPayload(payload) {
    const userID = parsePositiveInteger(payload.userID ?? payload.user_id);
    const userName = normalizeString(payload.userName ?? payload.user_name, 64);
    const submissionType = normalizeString(payload.submission_type, 32);
    const targetWord = normalizeWord(payload.target_word);
    const wordForm = normalizeWord(payload.word_form);
    const wordType = normalizeString(payload.word_type, 32);
    const phonetic = payload.phonetic && typeof payload.phonetic === "object" ? payload.phonetic : {};
    const languageLevels = Array.isArray(payload.language_levels) ? payload.language_levels : [];
    const detail = Array.isArray(payload.detail) ? payload.detail : [];
    const structure = Array.isArray(payload.structure) ? payload.structure : [];
    const origin = normalizeString(payload.origin, 500);
    const resubmissionOf = parsePositiveInteger(payload.resubmission_of);

    if (!userID) {
        return { error: "Missing userID" };
    }
    if (!VALID_SUBMISSION_TYPES.has(submissionType)) {
        return { error: "Invalid submission_type" };
    }
    if (submissionType === "correction" && !targetWord) {
        return { error: "Missing target_word" };
    }
    if (!wordForm || !/^[a-z][a-z'-]*$/.test(wordForm)) {
        return { error: "Invalid word_form" };
    }
    if (!VALID_WORD_TYPES.has(wordType)) {
        return { error: "Invalid word_type" };
    }
    if (!phonetic.ipa || typeof phonetic.ipa !== "string" || phonetic.ipa.length > 80 || hasUnsafeText(phonetic.ipa)) {
        return { error: "Invalid phonetic" };
    }
    if (languageLevels.length === 0) {
        return { error: "Missing language_levels" };
    }
    for (const level of languageLevels) {
        if (!parsePositiveInteger(level.language_level_code)) {
            return { error: "Invalid language_level_code" };
        }
    }
    if (detail.length === 0) {
        return { error: "Missing detail" };
    }
    for (const item of detail) {
        if (!item || !item.type || !item.chinese || hasUnsafeText(item.chinese)) {
            return { error: "Invalid detail" };
        }
    }
    if ((wordType === "morphology" || wordType === "compound") && structure.length === 0) {
        return { error: "Missing structure" };
    }
    for (const item of structure) {
        if (!item || !item.part || !item.role || !item.meaning || hasUnsafeText(item.part) || hasUnsafeText(item.meaning)) {
            return { error: "Invalid structure" };
        }
    }
    if (hasUnsafeText(origin)) {
        return { error: "Invalid origin" };
    }

    return {
        value: {
            userID,
            userName,
            submissionType,
            targetWord,
            wordForm,
            wordType,
            phonetic: { ipa: normalizeString(phonetic.ipa, 80) },
            languageLevels: languageLevels.map(level => ({
                language_level_code: Number(level.language_level_code),
                language_level_name: normalizeString(level.language_level_name, 32)
            })),
            detail: detail.map(item => ({
                type: normalizeString(item.type, 16),
                chinese: normalizeString(item.chinese, 128)
            })),
            structure: structure.map(item => ({
                part: normalizeString(item.part, 64),
                role: normalizeString(item.role, 32),
                refID: Number(item.refID) || 0,
                meaning: normalizeString(item.meaning, 128)
            })),
            origin,
            resubmissionOf
        }
    };
}

async function fetchReviewsForContributions(connection, contributionIDs) {
    if (contributionIDs.length === 0) {
        return new Map();
    }

    const placeholders = contributionIDs.map(() => "?").join(",");
    const [rows] = await connection.query(
        `SELECT contribution_id, decision, note
         FROM vocabulary_contribution_review
         WHERE contribution_id IN (${placeholders})
         ORDER BY created_at ASC`,
        contributionIDs
    );

    const map = new Map();
    rows.forEach(row => {
        if (!map.has(row.contribution_id)) {
            map.set(row.contribution_id, []);
        }
        map.get(row.contribution_id).push(row);
    });
    return map;
}

exports.submitContribution = async (req, res) => {
    const validation = validateContributionPayload(req.body);
    if (validation.error) {
        return res.status(400).json({ error: validation.error });
    }

    let connection;
    try {
        const payload = validation.value;
        connection = await db.getConnection();
        await connection.beginTransaction();

        if (!(await ensureUserExists(connection, payload.userID))) {
            await connection.rollback();
            return res.status(404).json({ error: "User not found" });
        }

        if (payload.resubmissionOf) {
            const [existingRows] = await connection.execute(
                `SELECT contribution_id, submitter_user_id, status, resubmission_count
                 FROM vocabulary_contribution
                 WHERE contribution_id = ?
                 FOR UPDATE`,
                [payload.resubmissionOf]
            );

            if (existingRows.length === 0 || Number(existingRows[0].submitter_user_id) !== payload.userID) {
                await connection.rollback();
                return res.status(404).json({ error: "Contribution not found" });
            }
            if (existingRows[0].status !== "rejected") {
                await connection.rollback();
                return res.status(409).json({ error: "Only rejected contributions can be resubmitted" });
            }

            await connection.execute(
                `UPDATE vocabulary_contribution
                 SET submitter_user_name = ?,
                     submission_type = ?,
                     target_word = ?,
                     word_form = ?,
                     phonetic = ?,
                     language_levels = ?,
                     word_type = ?,
                     detail = ?,
                     structure = ?,
                     origin = ?,
                     status = 'pending',
                     resubmission_count = resubmission_count + 1,
                     submitted_at = CURRENT_TIMESTAMP,
                     reviewed_at = NULL
                 WHERE contribution_id = ?`,
                [
                    payload.userName,
                    payload.submissionType,
                    payload.targetWord || null,
                    payload.wordForm,
                    JSON.stringify(payload.phonetic),
                    JSON.stringify(payload.languageLevels),
                    payload.wordType,
                    JSON.stringify(payload.detail),
                    JSON.stringify(payload.structure),
                    payload.origin || null,
                    payload.resubmissionOf
                ]
            );

            await connection.commit();
            return res.json({
                success: true,
                contributionID: payload.resubmissionOf,
                status: "pending",
                resubmitted: true
            });
        }

        const [result] = await connection.execute(
            `INSERT INTO vocabulary_contribution
             (submitter_user_id, submitter_user_name, submission_type, target_word, word_form,
              phonetic, language_levels, word_type, detail, structure, origin)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.userID,
                payload.userName,
                payload.submissionType,
                payload.targetWord || null,
                payload.wordForm,
                JSON.stringify(payload.phonetic),
                JSON.stringify(payload.languageLevels),
                payload.wordType,
                JSON.stringify(payload.detail),
                JSON.stringify(payload.structure),
                payload.origin || null
            ]
        );

        await connection.commit();
        return res.json({
            success: true,
            contributionID: result.insertId,
            status: "pending"
        });
    } catch (error) {
        console.error("Vocabulary contribution submit error:", error);
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Vocabulary contribution rollback error:", rollbackError);
            }
        }
        return res.status(500).json({ error: "Server Error" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

exports.listMine = async (req, res) => {
    const userID = parsePositiveInteger(req.query.userID ?? req.query.user_id);
    if (!userID) {
        return res.status(400).json({ error: "Missing userID" });
    }

    let connection;
    try {
        connection = await db.getConnection();
        const [rows] = await connection.execute(
            `SELECT *
             FROM vocabulary_contribution
             WHERE submitter_user_id = ?
             ORDER BY updated_at DESC
             LIMIT 100`,
            [userID]
        );
        const reviewsByContribution = await fetchReviewsForContributions(
            connection,
            rows.map(row => row.contribution_id)
        );
        return res.json({
            success: true,
            submissions: rows.map(row => toSubmissionDto(row, reviewsByContribution.get(row.contribution_id) || []))
        });
    } catch (error) {
        console.error("Vocabulary contribution list mine error:", error);
        return res.status(500).json({ error: "Server Error" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

exports.searchWords = async (req, res) => {
    const query = normalizeWord(req.query.query);
    if (!query) {
        return res.status(400).json({ error: "Missing query" });
    }

    let connection;
    try {
        connection = await db.getConnection();
        const [rows] = await connection.execute(
            `SELECT
                 v.word_form,
                 v.phonetic,
                 v.detail,
                 v.origin,
                 v.word_type,
                 v.structure,
                 vlr.language_level_codes
             FROM vocabulary v
             LEFT JOIN vocabulary_level_relation vlr ON vlr.word_id = v.word_id
             WHERE v.word_form LIKE CONCAT('%', ?, '%')
             ORDER BY
                 CASE WHEN v.word_form = ? THEN 0 ELSE 1 END,
                 CHAR_LENGTH(v.word_form),
                 v.word_form
             LIMIT 20`,
            [query, query]
        );

        return res.json({
            success: true,
            words: rows.map(toExistingWordDto)
        });
    } catch (error) {
        console.error("Vocabulary contribution search word error:", error);
        return res.status(500).json({ error: "Server Error" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

exports.listReviewQueue = async (req, res) => {
    const userID = parsePositiveInteger(req.query.userID ?? req.query.user_id);
    const includeCompleted = req.query.includeCompleted === "true";
    if (!userID) {
        return res.status(400).json({ error: "Missing userID" });
    }

    let connection;
    try {
        connection = await db.getConnection();
        const params = [userID];
        let statusClause = "status = 'pending'";
        if (includeCompleted) {
            statusClause = "status IN ('pending', 'approved', 'rejected')";
        }

        const [rows] = await connection.execute(
            `SELECT *
             FROM vocabulary_contribution
             WHERE submitter_user_id <> ?
               AND ${statusClause}
             ORDER BY updated_at DESC
             LIMIT 100`,
            params
        );
        const reviewsByContribution = await fetchReviewsForContributions(
            connection,
            rows.map(row => row.contribution_id)
        );
        return res.json({
            success: true,
            submissions: rows.map(row => {
                const dto = toSubmissionDto(row, reviewsByContribution.get(row.contribution_id) || []);
                return {
                    ...dto,
                    source: "review",
                    status: row.status === "pending" ? "待我审核" : toStatusLabel(row.status),
                    titlePrefix: row.submission_type === "correction" ? "待审核纠错" : "待审核提交"
                };
            })
        });
    } catch (error) {
        console.error("Vocabulary contribution review queue error:", error);
        return res.status(500).json({ error: "Server Error" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

async function applyApprovedContributionToVocabulary(connection, contribution) {
    const phonetic = parseJsonColumn(contribution.phonetic, {});
    const languageLevels = parseJsonColumn(contribution.language_levels, []);
    const detail = parseJsonColumn(contribution.detail, []);
    const structure = parseJsonColumn(contribution.structure, []);
    const wordForm = normalizeWord(contribution.word_form);
    const targetWord = normalizeWord(contribution.target_word);
    const levelCodes = getLevelCodes(languageLevels);

    if (!wordForm || !Array.isArray(detail) || detail.length === 0 || levelCodes.length === 0) {
        throw new Error("Invalid approved contribution payload");
    }

    if (contribution.submission_type === "correction") {
        const [targetRows] = await connection.execute(
            `SELECT word_id
             FROM vocabulary
             WHERE word_form = ?
             FOR UPDATE`,
            [targetWord || wordForm]
        );

        if (targetRows.length === 0) {
            throw new Error("Target vocabulary word not found");
        }

        const wordID = targetRows[0].word_id;
        const [sameWordRows] = await connection.execute(
            `SELECT word_id
             FROM vocabulary
             WHERE word_form = ?
             FOR UPDATE`,
            [wordForm]
        );

        if (sameWordRows.length > 0 && Number(sameWordRows[0].word_id) !== Number(wordID)) {
            throw new Error("Corrected word form already exists");
        }

        await connection.execute(
            `UPDATE vocabulary
             SET word_form = ?,
                 phonetic = ?,
                 detail = ?,
                 origin = ?,
                 word_type = ?,
                 structure = ?
             WHERE word_id = ?`,
            [
                wordForm,
                JSON.stringify(phonetic),
                JSON.stringify(detail),
                contribution.origin || null,
                contribution.word_type,
                JSON.stringify(Array.isArray(structure) ? structure : []),
                wordID
            ]
        );

        await connection.execute(
            `INSERT INTO vocabulary_level_relation (word_id, language_level_codes)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE
                 language_level_codes = VALUES(language_level_codes)`,
            [wordID, JSON.stringify(levelCodes)]
        );
        return wordID;
    }

    const [result] = await connection.execute(
        `INSERT INTO vocabulary
         (word_form, phonetic, audio_url, detail, origin, word_type, structure)
         VALUES (?, ?, NULL, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             phonetic = VALUES(phonetic),
             detail = VALUES(detail),
             origin = VALUES(origin),
             word_type = VALUES(word_type),
             structure = VALUES(structure)`,
        [
            wordForm,
            JSON.stringify(phonetic),
            JSON.stringify(detail),
            contribution.origin || null,
            contribution.word_type,
            JSON.stringify(Array.isArray(structure) ? structure : [])
        ]
    );

    let wordID = result.insertId;
    if (!wordID) {
        const [rows] = await connection.execute(
            `SELECT word_id
             FROM vocabulary
             WHERE word_form = ?
             LIMIT 1`,
            [wordForm]
        );
        if (rows.length === 0) {
            throw new Error("Vocabulary upsert failed");
        }
        wordID = rows[0].word_id;
    }

    await connection.execute(
        `INSERT INTO vocabulary_level_relation (word_id, language_level_codes)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE
             language_level_codes = VALUES(language_level_codes)`,
        [wordID, JSON.stringify(levelCodes)]
    );

    return wordID;
}

exports.reviewContribution = async (req, res) => {
    const contributionID = parsePositiveInteger(req.params.id);
    const reviewerUserID = parsePositiveInteger(req.body.userID ?? req.body.user_id);
    const reviewerUserName = normalizeString(req.body.userName ?? req.body.user_name, 64);
    const decision = normalizeString(req.body.decision, 16);
    const note = normalizeString(req.body.note, 300);

    if (!contributionID || !reviewerUserID || !VALID_DECISIONS.has(decision) || !note) {
        return res.status(400).json({ error: "Missing parameters" });
    }
    if (hasUnsafeText(note)) {
        return res.status(400).json({ error: "Invalid note" });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        if (!(await ensureUserExists(connection, reviewerUserID))) {
            await connection.rollback();
            return res.status(404).json({ error: "Reviewer not found" });
        }

        const [rows] = await connection.execute(
            `SELECT *
             FROM vocabulary_contribution
             WHERE contribution_id = ?
             FOR UPDATE`,
            [contributionID]
        );

        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "Contribution not found" });
        }
        if (Number(rows[0].submitter_user_id) === reviewerUserID) {
            await connection.rollback();
            return res.status(409).json({ error: "Cannot review your own contribution" });
        }
        if (rows[0].status !== "pending") {
            await connection.rollback();
            return res.status(409).json({ error: "Contribution already reviewed" });
        }

        await connection.execute(
            `INSERT INTO vocabulary_contribution_review
             (contribution_id, reviewer_user_id, reviewer_user_name, decision, note)
             VALUES (?, ?, ?, ?, ?)`,
            [contributionID, reviewerUserID, reviewerUserName, decision, note]
        );

        let vocabularyWordID = null;
        if (decision === "approved") {
            vocabularyWordID = await applyApprovedContributionToVocabulary(connection, rows[0]);
        }

        await connection.execute(
            `UPDATE vocabulary_contribution
             SET status = ?, reviewed_at = CURRENT_TIMESTAMP
             WHERE contribution_id = ?`,
            [decision, contributionID]
        );

        await connection.commit();
        return res.json({
            success: true,
            contributionID,
            status: decision,
            vocabularyWordID
        });
    } catch (error) {
        console.error("Vocabulary contribution review error:", error);
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Vocabulary review rollback error:", rollbackError);
            }
        }
        return res.status(500).json({ error: "Server Error" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};
