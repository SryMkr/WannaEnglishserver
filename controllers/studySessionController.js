const db = require("../config/db");
const { getWordId } = require("../services/lookupCache");
const { getWordBankLevelCode, normalizeWordBank } = require("../services/wordBankService");

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

async function getWordBase(word, wordBank) {
    if (word) {
        const [rows] = await db.execute(
            `SELECT word_id, word_form, phonetic, detail, origin, word_type, structure
             FROM vocabulary
             WHERE word_form = ?
             LIMIT 1`,
            [word]
        );
        return rows[0] || null;
    }

    const normalizedWordBank = normalizeWordBank(wordBank);
    const levelCode = getWordBankLevelCode(normalizedWordBank);
    if (levelCode != null) {
        const [countRows] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM vocabulary v
             INNER JOIN vocabulary_level_relation vlr ON vlr.word_id = v.word_id
             WHERE JSON_CONTAINS(vlr.language_level_codes, ?, '$')`,
            [String(levelCode)]
        );

        const total = Number(countRows[0]?.total || 0);
        if (total <= 0) {
            return null;
        }

        const offset = Math.max(0, Math.floor(Math.random() * total));
        const [rows] = await db.query(
            `SELECT v.word_id, v.word_form, v.phonetic, v.detail, v.origin, v.word_type, v.structure
             FROM vocabulary v
             INNER JOIN vocabulary_level_relation vlr ON vlr.word_id = v.word_id
             WHERE JSON_CONTAINS(vlr.language_level_codes, ?, '$')
             ORDER BY v.word_id
             LIMIT 1 OFFSET ${offset}`,
            [String(levelCode)]
        );

        return rows[0] || null;
    }

    const [countRows] = await db.execute(
        "SELECT COUNT(*) AS total FROM vocabulary"
    );

    const total = Number(countRows[0]?.total || 0);
    if (total <= 0) {
        return null;
    }

    const offset = Math.max(0, Math.floor(Math.random() * total));
    const [rows] = await db.query(
        `SELECT word_id, word_form, phonetic, detail, origin, word_type, structure
         FROM vocabulary
         ORDER BY word_id
         LIMIT 1 OFFSET ${offset}`
    );

    return rows[0] || null;
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
            matchmaking_opponent_user_id,
            matchmaking_opponent_type,
            matchmaking_opponent_name,
            actual_word_bank
        } = req.body;

        if (user1_id == null || user2_id == null || !word) {
            return res.status(400).json({ message: "Missing parameters" });
        }

        const word_id = await getWordId(word);
        if (!word_id) {
            return res.status(400).json({ error: "Unknown word: " + word });
        }

        const [result] = await db.query(
            `INSERT INTO user_study_session_summary 
                (user1_id, user2_id, word_id, play_mode, match_ticket_id, match_room_id,
                 matchmaking_opponent_user_id, matchmaking_opponent_type, matchmaking_opponent_name, actual_word_bank)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                user1_id,
                user2_id,
                word_id,
                play_mode ?? null,
                match_ticket_id ?? null,
                match_room_id ?? null,
                matchmaking_opponent_user_id ?? null,
                matchmaking_opponent_type ?? null,
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

        if (session_id == null) {
            return res.status(400).json({ message: "Missing session_id" });
        }

        const numericFirstPlayer = first_player == null ? null : Number(first_player);
        const numericWinnerUserId = winner_user_id == null || winner_user_id === 0 ? null : Number(winner_user_id);
        const numericDuration = duration == null ? null : Number(duration);
        const numericGameStatus = game_status == null ? null : Number(game_status);

        if (numericFirstPlayer != null && !Number.isInteger(numericFirstPlayer)) {
            return res.status(400).json({ message: "Invalid first_player" });
        }

        if (numericDuration != null && (!Number.isInteger(numericDuration) || numericDuration < 0)) {
            return res.status(400).json({ message: "Invalid duration" });
        }

        if (numericWinnerUserId != null && (!Number.isInteger(numericWinnerUserId) || numericWinnerUserId <= 0)) {
            return res.status(400).json({ message: "Invalid winner_user_id" });
        }

        if (numericGameStatus != null && !Number.isInteger(numericGameStatus)) {
            return res.status(400).json({ message: "Invalid game_status" });
        }

        const [result] = await db.query(
            `UPDATE user_study_session_summary SET
                player1_card = ?, 
                player2_card = ?, 
                first_player = ?, 
                winner_user_id = ?,
                duration = ?, 
                game_status = ?
            WHERE session_id = ?`,
            [
                player1_card ?? null,
                player2_card ?? null,
                numericFirstPlayer,
                numericWinnerUserId,
                numericDuration,
                numericGameStatus,
                session_id
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Session not found" });
        }

        return res.json({ success: true });

    } catch (err) {
        console.error("finishStudySession Error:", err);
        res.status(500).json({ message: "Server error" });
    }
};
