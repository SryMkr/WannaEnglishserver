const db = require("../config/db");
const { getWordId } = require("../services/lookupCache");
const { normalizeWordBank } = require("../services/wordBankService");
const { pickRandomStudyWord } = require("../services/wordSelectionService");
const { addDaysToDateString, formatChinaDate } = require("../services/timeService");

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

function normalizeUserId(value) {
    const userId = Number(value);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function requestError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function normalizePositiveInteger(value, fallback = 1) {
    if (value == null || value === "") {
        return fallback;
    }

    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

async function ensureUsersExist(userIds, executor = db) {
    const uniqueUserIds = [...new Set(userIds.filter(userId => Number.isInteger(userId) && userId > 0))];
    if (uniqueUserIds.length === 0) {
        return false;
    }

    const placeholders = uniqueUserIds.map(() => "?").join(", ");
    const [rows] = await executor.execute(
        `SELECT user_id
         FROM user_profile
         WHERE user_id IN (${placeholders})`,
        uniqueUserIds
    );
    return rows.length === uniqueUserIds.length;
}

async function validateHumanMatchReferences({
    user1Id,
    user2Id,
    matchTicketId,
    matchRoomId,
    matchRoundNo
}) {
    if (!matchTicketId || !matchRoomId) {
        throw requestError("真人对局缺少匹配票据或房间");
    }

    const [rows] = await db.execute(
        `SELECT
             t.ticket_id,
             t.user_id AS ticket_user_id,
             t.status AS ticket_status,
             t.room_id AS ticket_room_id,
             t.opponent_type AS ticket_opponent_type,
             t.opponent_user_id AS ticket_opponent_user_id,
             t.match_round_no AS ticket_round_no,
             r.room_id,
             r.room_status,
             r.opponent_type AS room_opponent_type,
             r.user1_id AS room_user1_id,
             r.user2_id AS room_user2_id,
             r.match_round_no AS room_round_no
         FROM matchmaking_ticket t
         INNER JOIN matchmaking_room r ON r.room_id = t.room_id
         WHERE t.ticket_id = ?
           AND r.room_id = ?
         LIMIT 1`,
        [matchTicketId, matchRoomId]
    );
    const row = rows[0];

    if (!row ||
        row.ticket_status !== "matched" ||
        String(row.ticket_room_id) !== String(matchRoomId) ||
        row.room_status !== "matched" ||
        Number(row.ticket_user_id) !== Number(user1Id) ||
        row.ticket_opponent_type !== "human" ||
        row.room_opponent_type !== "human" ||
        Number(row.ticket_opponent_user_id) !== Number(user2Id) ||
        ![Number(row.room_user1_id), Number(row.room_user2_id)].includes(Number(user1Id)) ||
        ![Number(row.room_user1_id), Number(row.room_user2_id)].includes(Number(user2Id)) ||
        Number(row.room_user1_id) === Number(row.room_user2_id) ||
        Number(row.ticket_round_no || 1) !== Number(matchRoundNo) ||
        Number(row.room_round_no || 1) !== Number(matchRoundNo)) {
        throw requestError("真人对局的房间、票据或对手不一致");
    }

    const [ticketRows] = await db.execute(
        `SELECT user_id, opponent_user_id, opponent_type, match_round_no
         FROM matchmaking_ticket
         WHERE room_id = ?
           AND status = 'matched'
           AND user_id IN (?, ?)
         ORDER BY user_id ASC`,
        [matchRoomId, user1Id, user2Id]
    );
    const ticketsByUserId = new Map(ticketRows.map(ticket => [Number(ticket.user_id), ticket]));
    const user1Ticket = ticketsByUserId.get(Number(user1Id));
    const user2Ticket = ticketsByUserId.get(Number(user2Id));
    if (ticketRows.length !== 2 ||
        !user1Ticket ||
        !user2Ticket ||
        user1Ticket.opponent_type !== "human" ||
        user2Ticket.opponent_type !== "human" ||
        Number(user1Ticket.opponent_user_id) !== Number(user2Id) ||
        Number(user2Ticket.opponent_user_id) !== Number(user1Id) ||
        Number(user1Ticket.match_round_no || 1) !== Number(matchRoundNo) ||
        Number(user2Ticket.match_round_no || 1) !== Number(matchRoundNo)) {
        throw requestError("真人对局匹配票据不完整");
    }
}

function formatStudyDate(date) {
    return formatChinaDate(date);
}

function buildStudyDateSet(rows) {
    const dates = new Set();
    for (const row of rows) {
        if (row == null || row.study_date == null) {
            continue;
        }

        if (row.study_date instanceof Date) {
            dates.add(formatStudyDate(row.study_date));
        } else {
            dates.add(String(row.study_date).slice(0, 10));
        }
    }

    return dates;
}

function calculateStreakDays(rows) {
    const dateSet = buildStudyDateSet(rows);
    let cursor = formatChinaDate();
    let streak = 0;

    while (cursor && dateSet.has(cursor)) {
        streak += 1;
        cursor = addDaysToDateString(cursor, -1);
    }

    return streak;
}

async function getWordBase(word, wordBank) {
    if (word) {
        const [rows] = await db.execute(
            `SELECT word_id, word_form, phonetic, detail, origin, word_type, structure
             FROM vocabulary
             WHERE LOWER(word_form) = ?
             LIMIT 1`,
            [word.trim().toLowerCase()]
        );
        return rows[0] || null;
    }

    return await pickRandomStudyWord(wordBank);
}

function collectStructureRefIds(structure, role) {
    const ids = [];
    for (const item of structure || []) {
        if (!item || normalizeText(item.role).toLowerCase() !== role || item.refID == null) {
            continue;
        }

        const id = Number(item.refID);
        if (Number.isInteger(id) && id > 0 && !ids.includes(id)) {
            ids.push(id);
        }
    }
    return ids;
}

async function queryRowsByIds(table, idColumn, selectSql, ids) {
    if (!ids || ids.length === 0) {
        return [];
    }

    const placeholders = ids.map(() => "?").join(", ");
    const [rows] = await db.execute(
        `${selectSql} FROM ${table} WHERE ${idColumn} IN (${placeholders})`,
        ids
    );

    const order = new Map(ids.map((id, index) => [id, index]));
    return rows.sort((left, right) => order.get(left.id) - order.get(right.id));
}

async function getWordMorphology(structure) {
    const prefixIds = collectStructureRefIds(structure, "prefix");
    const rootIds = collectStructureRefIds(structure, "root");
    const suffixIds = collectStructureRefIds(structure, "suffix");

    const [prefixRows, rootRows, suffixRows] = await Promise.all([
        queryRowsByIds(
            "prefix_code",
            "prefix_code",
            `SELECT prefix_code AS id,
                    prefix_form AS prefix,
                    prefix_cn_mean AS prefixCNMeaning,
                    prefix_en_mean AS prefixENMeaning`,
            prefixIds
        ),
        queryRowsByIds(
            "root_code",
            "root_code",
            `SELECT root_code AS id,
                    root_form AS root,
                    root_cn_mean AS rootCNMeaning,
                    root_en_mean AS rootENMeaning,
                    root_origin AS source`,
            rootIds
        ),
        queryRowsByIds(
            "suffix_code",
            "suffix_code",
            `SELECT suffix_code AS id,
                    suffix_form AS suffix,
                    suffix_cn_mean AS suffixCNMeaning,
                    suffix_en_mean AS suffixENMeaning,
                    suffix_func AS suffixFunction`,
            suffixIds
        )
    ]);

    return {
        prefixes: prefixRows,
        roots: rootRows,
        suffixes: suffixRows.map(row => ({ ...row, function: row.suffixFunction }))
    };
}

function buildMorphologyLookup(morphology) {
    const lookup = {
        prefixById: new Map(),
        prefixByForm: new Map(),
        rootById: new Map(),
        rootByForm: new Map(),
        suffixById: new Map(),
        suffixByForm: new Map()
    };

    const register = (items, byId, byForm, idKey, formKey, meaningKey) => {
        for (const item of items || []) {
            const id = item?.[idKey];
            const form = normalizeText(item?.[formKey]).toLowerCase();
            const meaning = normalizeText(item?.[meaningKey]);
            if (id != null && meaning)
                byId.set(Number(id), meaning);
            if (form && meaning)
                byForm.set(form, meaning);
        }
    };

    register(morphology.prefixes, lookup.prefixById, lookup.prefixByForm, "id", "prefix", "prefixCNMeaning");
    register(morphology.roots, lookup.rootById, lookup.rootByForm, "id", "root", "rootCNMeaning");
    register(morphology.suffixes, lookup.suffixById, lookup.suffixByForm, "id", "suffix", "suffixCNMeaning");
    return lookup;
}

function resolveStructureStandardMeaning(item, lookup) {
    if (!item || !lookup)
        return "";

    const role = normalizeText(item.role).toLowerCase();
    const part = normalizeText(item.part).toLowerCase();
    const refId = item.refID == null || item.refID === "" ? null : Number(item.refID);

    if (role === "prefix") {
        return (refId != null && lookup.prefixById.get(refId)) || lookup.prefixByForm.get(part) || "";
    }

    if (role === "root") {
        return (refId != null && lookup.rootById.get(refId)) || lookup.rootByForm.get(part) || "";
    }

    if (role === "suffix") {
        return (refId != null && lookup.suffixById.get(refId)) || lookup.suffixByForm.get(part) || "";
    }

    return "";
}

function normalizeStructureEntries(structure, morphology) {
    const lookup = buildMorphologyLookup(morphology);

    return (structure || []).map(item => {
        const displayMeaning = normalizeText(item?.meaning);
        const standardMeaning = resolveStructureStandardMeaning(item, lookup);
        const resolvedMeaning = displayMeaning || standardMeaning;
        const numericRefId = item?.refID == null || item?.refID === "" || Number.isNaN(Number(item?.refID))
            ? 0
            : Number(item.refID);

        return {
            ...item,
            refID: numericRefId,
            meaning: resolvedMeaning,
            displayMeaning: resolvedMeaning,
            standardMeaning
        };
    });
}

function buildStudyWordPayload(baseRow, morphology) {
    const phonetic = parseJsonField(baseRow.phonetic, {});
    const rawStructure = parseJsonField(baseRow.structure, []);
    const structure = normalizeStructureEntries(rawStructure, morphology);
    return {
        word: baseRow.word_form,
        ipa: phonetic && typeof phonetic === "object" ? (phonetic.ipa || "") : "",
        meanings: parseJsonField(baseRow.detail, []),
        etymology: baseRow.origin || "",
        wordType: baseRow.word_type || "independent",
        structure,
        prefixes: morphology.prefixes,
        roots: morphology.roots,
        suffixes: morphology.suffixes
    };
}

function buildSearchWordPayload(baseRow) {
    const phonetic = parseJsonField(baseRow.phonetic, {});
    const meanings = parseJsonField(baseRow.detail, []);
    const primary = Array.isArray(meanings)
        ? meanings.find(item => item && (normalizeText(item.chinese) || normalizeText(item.cn))) || meanings[0]
        : null;

    return {
        word_id: Number(baseRow.word_id),
        word: baseRow.word_form,
        ipa: phonetic && typeof phonetic === "object" ? normalizeText(phonetic.ipa) : "",
        wordType: normalizeText(primary?.type) || normalizeText(primary?.pos) || baseRow.word_type || "",
        primaryMeaning: normalizeText(primary?.chinese) || normalizeText(primary?.cn),
        wordBank: baseRow.word_bank || null,
        language_level_code: baseRow.language_level_code == null ? 0 : Number(baseRow.language_level_code)
    };
}

// === 创建 Study Session（返回 session_id） ===
exports.createStudySession = async (req, res) => {
    try {
        const {
            user1_id,
            user2_id,
            word,
            play_mode,
            match_ticket_id,
            match_room_id,
            match_round_no,
            matchmaking_opponent_user_id,
            matchmaking_opponent_type,
            matchmaking_opponent_name,
            actual_word_bank
        } = req.body;

        const normalizedUser1Id = normalizeUserId(user1_id);
        const opponentType = typeof matchmaking_opponent_type === "string"
            ? matchmaking_opponent_type.trim().toLowerCase()
            : "";
        const isBotMatch = opponentType === "bot" || play_mode === "match_bot";
        const isHumanMatch = opponentType === "human" ||
            play_mode === "match_human" ||
            match_ticket_id != null ||
            match_room_id != null;
        const normalizedUser2Id = isBotMatch ? null : normalizeUserId(user2_id);
        const normalizedOpponentUserId = isBotMatch
            ? null
            : normalizeUserId(matchmaking_opponent_user_id ?? user2_id);

        if (normalizedUser1Id == null ||
            (opponentType && !["human", "bot"].includes(opponentType)) ||
            (!isBotMatch && normalizedUser2Id == null) ||
            (!isBotMatch && normalizedUser2Id === normalizedUser1Id) ||
            !word) {
            return res.status(400).json({ message: "Missing parameters" });
        }

        if (!await ensureUsersExist(
            isBotMatch ? [normalizedUser1Id] : [normalizedUser1Id, normalizedUser2Id]
        )) {
            return res.status(400).json({ message: "Unknown user" });
        }

        const word_id = await getWordId(word);
        if (!word_id) {
            return res.status(400).json({ error: "Unknown word: " + word });
        }

        const normalizedMatchRoundNo = normalizePositiveInteger(match_round_no);
        if (normalizedMatchRoundNo == null) {
            return res.status(400).json({ message: "Invalid match_round_no" });
        }

        if (isHumanMatch) {
            if (isBotMatch || opponentType !== "human") {
                return res.status(400).json({ message: "真人对局 opponent_type 无效" });
            }

            if (normalizedOpponentUserId !== normalizedUser2Id) {
                return res.status(400).json({ message: "真人对局对手用户不一致" });
            }

            await validateHumanMatchReferences({
                user1Id: normalizedUser1Id,
                user2Id: normalizedUser2Id,
                matchTicketId: typeof match_ticket_id === "string" ? match_ticket_id.trim() : "",
                matchRoomId: typeof match_room_id === "string" ? match_room_id.trim() : "",
                matchRoundNo: normalizedMatchRoundNo
            });
        }

        const [result] = await db.query(
            `INSERT INTO user_study_session_summary 
                (user1_id, user2_id, word_id, play_mode, match_ticket_id, match_room_id,
                 match_round_no, matchmaking_opponent_user_id, matchmaking_opponent_type, matchmaking_opponent_name, actual_word_bank)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                normalizedUser1Id,
                normalizedUser2Id,
                word_id,
                play_mode ?? null,
                match_ticket_id ?? null,
                match_room_id ?? null,
                normalizedMatchRoundNo,
                isBotMatch ? null : normalizedOpponentUserId,
                opponentType || null,
                matchmaking_opponent_name ?? null,
                normalizeWordBank(actual_word_bank)
            ]
        );


        return res.json({
            success: true,
            session_id: result.insertId
        });

    } catch (err) {
        console.error("createStudySession Error:", err);

        if (err.statusCode) {
            return res.status(err.statusCode).json({ message: err.message });
        }

        if (err.code === "ER_NO_REFERENCED_ROW_2") {
            return res.status(400).json({ message: "Unknown user or word" });
        }

        res.status(500).json({ message: "Server error" });
    }
};

exports.getStudyWord = async (req, res) => {
    try {
        const requestedWord = typeof req.query.word === "string" ? req.query.word.trim() : "";
        const requestedWordBank = typeof req.query.wordBank === "string" ? req.query.wordBank.trim() : "";

        const baseRow = await getWordBase(requestedWord || null, requestedWordBank || null);
        if (!baseRow) {
            return res.status(404).json({
                success: false,
                message: requestedWord
                    ? `未找到单词：${requestedWord}`
                    : "当前词库下暂无可用单词"
            });
        }

        const morphology = await getWordMorphology(parseJsonField(baseRow.structure, []));
        return res.json({
            success: true,
            word: buildStudyWordPayload(baseRow, morphology)
        });
    } catch (err) {
        console.error("getStudyWord Error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.searchStudyWord = async (req, res) => {
    try {
        const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
        if (!/^[A-Za-z][A-Za-z'-]{1,31}$/.test(query)) {
            return res.json({ success: false, message: "请输入完整英文单词" });
        }

        const [rows] = await db.execute(
            `SELECT
                 v.word_id,
                 v.word_form,
                 v.phonetic,
                 v.detail,
                 v.word_type,
                 ll.language_level_name AS word_bank,
                 CAST(JSON_UNQUOTE(JSON_EXTRACT(vlr.language_level_codes, '$[0]')) AS UNSIGNED) AS language_level_code
             FROM vocabulary v
             LEFT JOIN vocabulary_level_relation vlr ON vlr.word_id = v.word_id
             LEFT JOIN language_level_code ll
                 ON ll.language_level_code = CAST(JSON_UNQUOTE(JSON_EXTRACT(vlr.language_level_codes, '$[0]')) AS UNSIGNED)
             WHERE LOWER(v.word_form) = LOWER(?)
             LIMIT 1`,
            [query]
        );

        if (rows.length === 0) {
            return res.json({ success: false, message: "暂未收录这个单词。" });
        }

        return res.json({ success: true, word: buildSearchWordPayload(rows[0]) });
    } catch (err) {
        console.error("searchStudyWord Error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

async function loadStudyStatsOverview(userId) {
    const [studyDayRows] = await db.execute(
        `SELECT DATE(played_at) AS study_date
         FROM user_study_session_summary
         WHERE game_status = 1
           AND (user1_id = ? OR user2_id = ?)
         GROUP BY DATE(played_at)
         ORDER BY study_date DESC`,
        [userId, userId]
    );

    const [wordRows] = await db.execute(
        `SELECT
             COUNT(*) AS total_learned_words
         FROM user_word_progress
         WHERE user_id = ?`,
        [userId]
    );

    const wordStats = wordRows[0] || {};
    return {
        totalStudyDays: studyDayRows.length,
        streakDays: calculateStreakDays(studyDayRows),
        totalLearnedWords: Number(wordStats.total_learned_words || 0)
    };
}

exports.loadStudyStatsOverview = loadStudyStatsOverview;

exports.getStudyStatsOverview = async (req, res) => {
    try {
        const userId = normalizeUserId(req.query.userID || req.query.user_id);
        if (userId == null) {
            return res.status(400).json({ success: false, message: "userID is required" });
        }

        const stats = await loadStudyStatsOverview(userId);
        return res.json({
            success: true,
            ...stats
        });
    } catch (err) {
        console.error("getStudyStatsOverview Error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// === 完成 Study Session（更新整局信息） ===
exports.finishStudySession = async (req, res) => {
    try {
        const {
            session_id,
            player1_card,
            player2_card,
            first_player,
            winner_user_id,
            duration,
            game_status
        } = req.body;

        const numericSessionId = Number(session_id);
        if (!Number.isInteger(numericSessionId) || numericSessionId <= 0) {
            return res.status(400).json({ message: "Missing session_id" });
        }

        const numericFirstPlayer = first_player == null ? null : Number(first_player);
        const numericWinnerUserId = winner_user_id == null || winner_user_id === 0 ? null : Number(winner_user_id);
        const numericDuration = duration == null ? null : Number(duration);
        const numericGameStatus = game_status == null ? null : Number(game_status);

        if (numericFirstPlayer != null && (!Number.isInteger(numericFirstPlayer) || numericFirstPlayer <= 0)) {
            return res.status(400).json({ message: "Invalid first_player" });
        }

        if (numericDuration != null && (!Number.isInteger(numericDuration) || numericDuration < 0)) {
            return res.status(400).json({ message: "Invalid duration" });
        }

        if (numericWinnerUserId != null && (!Number.isInteger(numericWinnerUserId) || numericWinnerUserId <= 0)) {
            return res.status(400).json({ message: "Invalid winner_user_id" });
        }

        if (numericGameStatus != null && ![0, 1].includes(numericGameStatus)) {
            return res.status(400).json({ message: "Invalid game_status" });
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const [sessionRows] = await connection.execute(
                `SELECT session_id, user1_id, user2_id, player1_card, player2_card,
                        first_player, winner_user_id, duration, game_status
                 FROM user_study_session_summary
                 WHERE session_id = ?
                 FOR UPDATE`,
                [numericSessionId]
            );
            const session = sessionRows[0];
            if (!session) {
                await connection.rollback();
                return res.status(404).json({ message: "Session not found" });
            }

            const participantIds = [Number(session.user1_id)];
            if (session.user2_id != null) {
                participantIds.push(Number(session.user2_id));
            }

            if (numericFirstPlayer != null && !participantIds.includes(numericFirstPlayer)) {
                await connection.rollback();
                return res.status(400).json({ message: "Invalid first_player" });
            }

            if (numericWinnerUserId != null && !participantIds.includes(numericWinnerUserId)) {
                await connection.rollback();
                return res.status(400).json({ message: "Invalid winner_user_id" });
            }

            const incoming = {
                player1_card: Object.prototype.hasOwnProperty.call(req.body, "player1_card")
                    ? player1_card ?? null
                    : session.player1_card,
                player2_card: Object.prototype.hasOwnProperty.call(req.body, "player2_card")
                    ? player2_card ?? null
                    : session.player2_card,
                first_player: Object.prototype.hasOwnProperty.call(req.body, "first_player")
                    ? numericFirstPlayer
                    : session.first_player,
                winner_user_id: Object.prototype.hasOwnProperty.call(req.body, "winner_user_id")
                    ? numericWinnerUserId
                    : session.winner_user_id,
                duration: Object.prototype.hasOwnProperty.call(req.body, "duration")
                    ? numericDuration
                    : session.duration,
                game_status: Object.prototype.hasOwnProperty.call(req.body, "game_status")
                    ? numericGameStatus
                    : session.game_status
            };

            const resultFields = Object.keys(incoming);
            const hasConflict = resultFields.some(field => {
                const storedValue = session[field];
                const incomingValue = incoming[field];
                return storedValue != null &&
                    (incomingValue == null || String(storedValue) !== String(incomingValue));
            });
            if (hasConflict) {
                await connection.rollback();
                return res.status(409).json({ message: "Session result already recorded differently" });
            }

            await connection.execute(
                `UPDATE user_study_session_summary SET
                    player1_card = ?,
                    player2_card = ?,
                    first_player = ?,
                    winner_user_id = ?,
                    duration = ?,
                    game_status = ?
                 WHERE session_id = ?`,
                [
                    incoming.player1_card,
                    incoming.player2_card,
                    incoming.first_player,
                    incoming.winner_user_id,
                    incoming.duration,
                    incoming.game_status,
                    numericSessionId
                ]
            );

            await connection.commit();
            return res.json({ success: true });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (err) {
        console.error("finishStudySession Error:", err);
        res.status(500).json({ message: "Server error" });
    }
};
