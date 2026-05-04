const db = require("../config/db");
const {
    getWordBankLevelCode,
    normalizeWordBank,
    resolveSharedWordBank
} = require("../services/wordBankService");

const DEFAULT_MATCH_TIMEOUT_MS = Math.max(1000, Number(process.env.MATCH_TIMEOUT_MS) || 5000);
const BOT_USER_ID = Number(process.env.MATCH_BOT_USER_ID) || 1002;
const BOT_OPEN_ID = process.env.MATCH_BOT_OPEN_ID || `system-bot-${BOT_USER_ID}`;

let ticketSequence = 0;
let roomSequence = 0;
let schemaInitializationPromise = null;

function buildTicketId() {
    ticketSequence += 1;
    return `ticket_${Date.now()}_${ticketSequence}`;
}

function buildRoomId() {
    roomSequence += 1;
    return `room_${Date.now()}_${roomSequence}`;
}

function normalizeTimeoutMs(timeoutSeconds) {
    if (timeoutSeconds == null || timeoutSeconds === "") {
        return DEFAULT_MATCH_TIMEOUT_MS;
    }

    const numericTimeoutSeconds = Number(timeoutSeconds);
    if (!Number.isFinite(numericTimeoutSeconds) || numericTimeoutSeconds <= 0) {
        return DEFAULT_MATCH_TIMEOUT_MS;
    }

    return Math.max(1000, Math.round(numericTimeoutSeconds * 1000));
}

function toIsoString(value) {
    if (!value) {
        return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addMilliseconds(date, milliseconds) {
    return new Date(date.getTime() + milliseconds);
}

function buildOpponent(row) {
    if (!row || !row.opponent_type) {
        return null;
    }

    const isBot = row.opponent_type === "bot";
    const fallbackNickname = isBot
        ? "机器人"
        : row.opponent_user_id != null
            ? `玩家${row.opponent_user_id}`
            : "对手";

    return {
        user_id: row.opponent_user_id == null ? 0 : Number(row.opponent_user_id),
        is_bot: isBot,
        nickname: row.opponent_nickname || fallbackNickname
    };
}

function buildWaitingResponse(row, now = Date.now()) {
    const fallbackAt = row.fallback_at instanceof Date ? row.fallback_at.getTime() : new Date(row.fallback_at).getTime();
    return {
        success: true,
        status: "waiting",
        ticket_id: row.ticket_id,
        room_id: null,
        opponent_type: null,
        word: null,
        matched_word_bank: null,
        opponent: null,
        fallback_at: toIsoString(row.fallback_at),
        wait_seconds: Math.max(0, Math.ceil((fallbackAt - now) / 1000))
    };
}

function buildMatchedResponse(row) {
    return {
        success: true,
        status: "matched",
        ticket_id: row.ticket_id,
        room_id: row.room_id,
        opponent_type: row.opponent_type,
        word: row.matched_word,
        matched_word_bank: row.matched_word_bank,
        opponent: buildOpponent(row),
        fallback_at: null,
        wait_seconds: 0
    };
}

async function withConnection(work) {
    const connection = await db.getConnection();
    try {
        return await work(connection);
    } finally {
        connection.release();
    }
}

async function ensureBotUserProfile(executor = db) {
    await executor.execute(
        `INSERT INTO user_profile (user_id, open_id, session_key)
         VALUES (?, ?, NULL)
         ON DUPLICATE KEY UPDATE user_id = user_id`,
        [BOT_USER_ID, BOT_OPEN_ID]
    );
}

async function hasColumn(executor, tableName, columnName) {
    const [rows] = await executor.execute(
        `SELECT 1
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
         LIMIT 1`,
        [tableName, columnName]
    );

    return rows.length > 0;
}

async function ensureColumn(executor, tableName, columnName, definitionSql) {
    if (await hasColumn(executor, tableName, columnName)) {
        return;
    }

    await executor.execute(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
}

async function initializeMatchmakingSchema() {
    if (schemaInitializationPromise != null) {
        return schemaInitializationPromise;
    }

    schemaInitializationPromise = (async () => {
        await db.execute(
            `CREATE TABLE IF NOT EXISTS matchmaking_room (
                room_id VARCHAR(64) PRIMARY KEY,
                room_status VARCHAR(16) NOT NULL DEFAULT 'matched',
                word_bank VARCHAR(32) NULL,
                matched_word VARCHAR(64) NOT NULL,
                opponent_type VARCHAR(16) NOT NULL,
                user1_id BIGINT NOT NULL,
                user2_id BIGINT NULL,
                created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                matched_at DATETIME(3) NOT NULL,
                finished_at DATETIME(3) NULL,
                KEY idx_matchmaking_room_status_time (room_status, matched_at),
                KEY idx_matchmaking_room_user1_time (user1_id, matched_at),
                KEY idx_matchmaking_room_user2_time (user2_id, matched_at),
                CONSTRAINT fk_matchmaking_room_user1 FOREIGN KEY (user1_id) REFERENCES user_profile(user_id),
                CONSTRAINT fk_matchmaking_room_user2 FOREIGN KEY (user2_id) REFERENCES user_profile(user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
        );

        await db.execute(
            `CREATE TABLE IF NOT EXISTS matchmaking_ticket (
                ticket_id VARCHAR(64) PRIMARY KEY,
                user_id BIGINT NOT NULL,
                word_bank VARCHAR(32) NULL,
                matched_word_bank VARCHAR(32) NULL,
                status VARCHAR(16) NOT NULL,
                fallback_at DATETIME(3) NOT NULL,
                room_id VARCHAR(64) NULL,
                opponent_type VARCHAR(16) NULL,
                opponent_user_id BIGINT NULL,
                opponent_nickname VARCHAR(64) NULL,
                matched_word VARCHAR(64) NULL,
                created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                resolved_at DATETIME(3) NULL,
                cancelled_at DATETIME(3) NULL,
                KEY idx_matchmaking_ticket_user_status (user_id, status, created_at),
                KEY idx_matchmaking_ticket_status_time (status, fallback_at, created_at),
                KEY idx_matchmaking_ticket_room (room_id),
                CONSTRAINT fk_matchmaking_ticket_user FOREIGN KEY (user_id) REFERENCES user_profile(user_id),
                CONSTRAINT fk_matchmaking_ticket_opponent_user FOREIGN KEY (opponent_user_id) REFERENCES user_profile(user_id),
                CONSTRAINT fk_matchmaking_ticket_room FOREIGN KEY (room_id) REFERENCES matchmaking_room(room_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
        );

        await ensureColumn(
            db,
            "matchmaking_ticket",
            "matched_word_bank",
            "matched_word_bank VARCHAR(32) NULL AFTER word_bank"
        );
        await ensureColumn(
            db,
            "user_study_session_summary",
            "play_mode",
            "play_mode VARCHAR(32) NULL AFTER word_id"
        );
        await ensureColumn(
            db,
            "user_study_session_summary",
            "match_ticket_id",
            "match_ticket_id VARCHAR(64) NULL AFTER play_mode"
        );
        await ensureColumn(
            db,
            "user_study_session_summary",
            "match_room_id",
            "match_room_id VARCHAR(64) NULL AFTER match_ticket_id"
        );
        await ensureColumn(
            db,
            "user_study_session_summary",
            "matchmaking_opponent_user_id",
            "matchmaking_opponent_user_id BIGINT NULL AFTER match_room_id"
        );
        await ensureColumn(
            db,
            "user_study_session_summary",
            "matchmaking_opponent_type",
            "matchmaking_opponent_type VARCHAR(16) NULL AFTER matchmaking_opponent_user_id"
        );
        await ensureColumn(
            db,
            "user_study_session_summary",
            "matchmaking_opponent_name",
            "matchmaking_opponent_name VARCHAR(64) NULL AFTER matchmaking_opponent_type"
        );
        await ensureColumn(
            db,
            "user_study_session_summary",
            "actual_word_bank",
            "actual_word_bank VARCHAR(32) NULL AFTER matchmaking_opponent_name"
        );
        await ensureColumn(
            db,
            "user_study_session_summary",
            "winner_user_id",
            "winner_user_id BIGINT NULL AFTER first_player"
        );

        await ensureBotUserProfile(db);
    })().catch(error => {
        schemaInitializationPromise = null;
        throw error;
    });

    return schemaInitializationPromise;
}

async function pickWord(wordBank, executor = db) {
    const normalizedWordBank = normalizeWordBank(wordBank);
    const levelCode = getWordBankLevelCode(normalizedWordBank);

    if (levelCode != null) {
        const [countRows] = await executor.execute(
            `SELECT COUNT(*) AS total
             FROM vocabulary v
             INNER JOIN vocabulary_level_relation vlr ON vlr.word_id = v.word_id
             WHERE JSON_CONTAINS(vlr.language_level_codes, ?, '$')`,
            [String(levelCode)]
        );

        const total = Number(countRows[0]?.total || 0);
        if (total > 0) {
            const offset = Math.max(0, Math.floor(Math.random() * total));
            const [rows] = await executor.query(
                `SELECT v.word_form
                 FROM vocabulary v
                 INNER JOIN vocabulary_level_relation vlr ON vlr.word_id = v.word_id
                 WHERE JSON_CONTAINS(vlr.language_level_codes, ?, '$')
                 ORDER BY v.word_id
                 LIMIT 1 OFFSET ${offset}`,
                [String(levelCode)]
            );

            if (rows.length > 0) {
                return rows[0].word_form;
            }
        }
    }

    const [countRows] = await executor.execute(
        "SELECT COUNT(*) AS total FROM vocabulary"
    );

    const total = Number(countRows[0]?.total || 0);
    if (total <= 0) {
        return null;
    }

    const offset = Math.max(0, Math.floor(Math.random() * total));
    const [rows] = await executor.query(
        `SELECT word_form
         FROM vocabulary
         ORDER BY word_id
         LIMIT 1 OFFSET ${offset}`
    );

    return rows.length > 0 ? rows[0].word_form : null;
}

async function loadTicket(executor, ticketId, lockRow = false) {
    const lockClause = lockRow ? " FOR UPDATE" : "";
    const [rows] = await executor.execute(
        `SELECT ticket_id, user_id, word_bank, status, fallback_at, room_id, opponent_type,
                opponent_user_id, opponent_nickname, matched_word, matched_word_bank, created_at, updated_at,
                resolved_at, cancelled_at
         FROM matchmaking_ticket
         WHERE ticket_id = ?${lockClause}`,
        [ticketId]
    );

    return rows[0] || null;
}

async function loadWaitingTicketByUser(executor, userId, lockRow = false) {
    const lockClause = lockRow ? " FOR UPDATE" : "";
    const [rows] = await executor.execute(
        `SELECT ticket_id, user_id, word_bank, status, fallback_at, room_id, opponent_type,
                opponent_user_id, opponent_nickname, matched_word, matched_word_bank, created_at, updated_at,
                resolved_at, cancelled_at
         FROM matchmaking_ticket
         WHERE user_id = ? AND status = 'waiting'
         ORDER BY created_at DESC
         LIMIT 1${lockClause}`,
        [userId]
    );

    return rows[0] || null;
}

async function loadCandidateTickets(executor, requesterUserId, limit = 20) {
    const safeLimit = Number.isInteger(limit) && limit > 0
        ? Math.min(limit, 100)
        : 20;

    const [rows] = await executor.execute(
        `SELECT ticket_id, user_id, word_bank, status, fallback_at, room_id, opponent_type,
                opponent_user_id, opponent_nickname, matched_word, matched_word_bank, created_at, updated_at,
         resolved_at, cancelled_at
         FROM matchmaking_ticket
         WHERE status = 'waiting'
           AND user_id <> ?
           AND fallback_at > UTC_TIMESTAMP(3)
         ORDER BY created_at ASC
         LIMIT ${safeLimit}
         FOR UPDATE`,
        [requesterUserId]
    );

    return rows;
}

async function insertRoom(executor, roomId, roomStatus, wordBank, matchedWord, opponentType, user1Id, user2Id, matchedAt) {
    await executor.execute(
        `INSERT INTO matchmaking_room
            (room_id, room_status, word_bank, matched_word, opponent_type, user1_id, user2_id, matched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [roomId, roomStatus, wordBank, matchedWord, opponentType, user1Id, user2Id, matchedAt]
    );
}

async function resolveWaitingTicketToBot(executor, ticketRow) {
    if (!ticketRow || ticketRow.status !== "waiting") {
        return ticketRow;
    }

    await ensureBotUserProfile(executor);

    const matchedWord = await pickWord(ticketRow.word_bank, executor);
    if (!matchedWord) {
        throw new Error("No match word available");
    }

    const roomId = buildRoomId();
    const matchedAt = new Date();

    await insertRoom(
        executor,
        roomId,
        "matched",
        ticketRow.word_bank,
        matchedWord,
        "bot",
        ticketRow.user_id,
        BOT_USER_ID,
        matchedAt
    );

    await executor.execute(
        `UPDATE matchmaking_ticket
         SET status = 'matched',
             room_id = ?,
             opponent_type = 'bot',
             opponent_user_id = ?,
             opponent_nickname = ?,
             matched_word = ?,
             matched_word_bank = ?,
             resolved_at = ?
         WHERE ticket_id = ?`,
        [roomId, BOT_USER_ID, "机器人", matchedWord, ticketRow.word_bank, matchedAt, ticketRow.ticket_id]
    );

    return await loadTicket(executor, ticketRow.ticket_id, false);
}

async function matchWithHuman(executor, requesterUserId, wordBank) {
    const candidates = await loadCandidateTickets(executor, requesterUserId);
    if (!candidates || candidates.length === 0) {
        return null;
    }

    let candidate = null;
    let matchedWordBank = null;

    for (const currentCandidate of candidates) {
        const sharedWordBank = resolveSharedWordBank(wordBank, currentCandidate.word_bank);
        if (!sharedWordBank.compatible) {
            continue;
        }

        candidate = currentCandidate;
        matchedWordBank = sharedWordBank.matchedWordBank;
        break;
    }

    if (!candidate) {
        return null;
    }

    const matchedWord = await pickWord(matchedWordBank, executor);
    if (!matchedWord) {
        throw new Error("No match word available");
    }

    const roomId = buildRoomId();
    const requesterTicketId = buildTicketId();
    const matchedAt = new Date();
    const requesterNickname = `玩家${requesterUserId}`;
    const candidateNickname = `玩家${candidate.user_id}`;

    await insertRoom(
        executor,
        roomId,
        "matched",
        matchedWordBank,
        matchedWord,
        "human",
        candidate.user_id,
        requesterUserId,
        matchedAt
    );

    await executor.execute(
        `UPDATE matchmaking_ticket
         SET status = 'matched',
             room_id = ?,
             opponent_type = 'human',
             opponent_user_id = ?,
             opponent_nickname = ?,
             matched_word = ?,
             matched_word_bank = ?,
             resolved_at = ?
         WHERE ticket_id = ?`,
        [roomId, requesterUserId, requesterNickname, matchedWord, matchedWordBank, matchedAt, candidate.ticket_id]
    );

    await executor.execute(
        `INSERT INTO matchmaking_ticket
            (ticket_id, user_id, word_bank, matched_word_bank, status, fallback_at, room_id, opponent_type,
             opponent_user_id, opponent_nickname, matched_word, resolved_at)
         VALUES (?, ?, ?, ?, 'matched', ?, ?, 'human', ?, ?, ?, ?)`,
        [requesterTicketId, requesterUserId, wordBank, matchedWordBank, matchedAt, roomId, candidate.user_id, candidateNickname, matchedWord, matchedAt]
    );

    return await loadTicket(executor, requesterTicketId, false);
}

async function createWaitingTicket(executor, userId, wordBank, timeoutMs) {
    const now = new Date();
    const fallbackAt = addMilliseconds(now, timeoutMs);
    const ticketId = buildTicketId();

    await executor.execute(
        `INSERT INTO matchmaking_ticket
            (ticket_id, user_id, word_bank, status, fallback_at)
         VALUES (?, ?, ?, 'waiting', ?)`,
        [ticketId, userId, wordBank, fallbackAt]
    );

    return await loadTicket(executor, ticketId, false);
}

async function resolveTicketIfExpired(ticketId) {
    return withConnection(async connection => {
        await connection.beginTransaction();
        try {
            const ticket = await loadTicket(connection, ticketId, true);
            if (!ticket) {
                await connection.commit();
                return null;
            }

            if (ticket.status !== "waiting") {
                await connection.commit();
                return ticket;
            }

            const fallbackAt = ticket.fallback_at instanceof Date ? ticket.fallback_at.getTime() : new Date(ticket.fallback_at).getTime();
            if (fallbackAt > Date.now()) {
                await connection.commit();
                return ticket;
            }

            const resolved = await resolveWaitingTicketToBot(connection, ticket);
            await connection.commit();
            return resolved;
        } catch (error) {
            await connection.rollback();
            throw error;
        }
    });
}

async function sweepExpiredWaitingTickets() {
    await initializeMatchmakingSchema();

    const [rows] = await db.execute(
        `SELECT ticket_id
         FROM matchmaking_ticket
         WHERE status = 'waiting'
           AND fallback_at <= UTC_TIMESTAMP(3)
         ORDER BY fallback_at ASC
         LIMIT 20`
    );

    for (const row of rows) {
        try {
            await resolveTicketIfExpired(row.ticket_id);
        } catch (error) {
            console.error("matchmaking sweep resolve error:", error);
        }
    }
}

exports.initializeMatchmakingSchema = initializeMatchmakingSchema;

exports.enqueue = async (req, res) => {
    try {
        await initializeMatchmakingSchema();

        const userId = Number(req.body.user_id);
        const wordBank = normalizeWordBank(req.body.word_bank);
        const timeoutMs = normalizeTimeoutMs(req.body.timeout_seconds);

        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ success: false, message: "user_id 无效" });
        }

        const ticket = await withConnection(async connection => {
            await connection.beginTransaction();
            try {
                let existingWaiting = await loadWaitingTicketByUser(connection, userId, true);
                if (existingWaiting) {
                    const fallbackAt = existingWaiting.fallback_at instanceof Date
                        ? existingWaiting.fallback_at.getTime()
                        : new Date(existingWaiting.fallback_at).getTime();

                    if (fallbackAt <= Date.now()) {
                        existingWaiting = await resolveWaitingTicketToBot(connection, existingWaiting);
                    }

                    await connection.commit();
                    return existingWaiting;
                }

                const matchedTicket = await matchWithHuman(connection, userId, wordBank);
                if (matchedTicket) {
                    await connection.commit();
                    return matchedTicket;
                }

                const waitingTicket = await createWaitingTicket(connection, userId, wordBank, timeoutMs);
                await connection.commit();
                return waitingTicket;
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        });

        if (!ticket) {
            return res.status(500).json({ success: false, message: "创建匹配失败" });
        }

        return res.json(ticket.status === "matched" ? buildMatchedResponse(ticket) : buildWaitingResponse(ticket));
    } catch (err) {
        console.error("matchmaking enqueue error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.getStatus = async (req, res) => {
    try {
        await initializeMatchmakingSchema();

        const ticketId = typeof req.query.ticket_id === "string" ? req.query.ticket_id.trim() : "";
        if (!ticketId) {
            return res.status(400).json({ success: false, message: "ticket_id 不能为空" });
        }

        let ticket = await loadTicket(db, ticketId, false);
        if (!ticket) {
            return res.status(404).json({ success: false, message: "匹配票据不存在或已失效" });
        }

        if (ticket.status === "waiting") {
            ticket = await resolveTicketIfExpired(ticketId);
            if (!ticket) {
                return res.status(404).json({ success: false, message: "匹配票据不存在或已失效" });
            }
        }

        if (ticket.status === "matched") {
            return res.json(buildMatchedResponse(ticket));
        }

        if (ticket.status === "waiting") {
            return res.json(buildWaitingResponse(ticket));
        }

        return res.status(409).json({ success: false, message: "当前匹配票据不可用", status: ticket.status });
    } catch (err) {
        console.error("matchmaking status error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.cancel = async (req, res) => {
    try {
        await initializeMatchmakingSchema();

        const ticketId = typeof req.body.ticket_id === "string" ? req.body.ticket_id.trim() : "";
        const userId = Number(req.body.user_id);

        if (!ticketId) {
            return res.status(400).json({ success: false, message: "ticket_id 不能为空" });
        }

        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ success: false, message: "user_id 无效" });
        }

        const outcome = await withConnection(async connection => {
            await connection.beginTransaction();
            try {
                const ticket = await loadTicket(connection, ticketId, true);
                if (!ticket) {
                    await connection.commit();
                    return { statusCode: 404, body: { success: false, message: "匹配票据不存在" } };
                }

                if (Number(ticket.user_id) !== userId) {
                    await connection.commit();
                    return { statusCode: 403, body: { success: false, message: "无权取消该匹配票据" } };
                }

                if (ticket.status === "matched") {
                    await connection.commit();
                    return { statusCode: 409, body: { success: false, message: "该匹配已出结果，不能取消" } };
                }

                if (ticket.status !== "waiting") {
                    await connection.commit();
                    return { statusCode: 409, body: { success: false, message: "当前匹配票据不可取消" } };
                }

                await connection.execute(
                    `UPDATE matchmaking_ticket
                     SET status = 'cancelled',
                         cancelled_at = UTC_TIMESTAMP(3)
                     WHERE ticket_id = ?`,
                    [ticketId]
                );

                await connection.commit();
                return { statusCode: 200, body: { success: true, status: "cancelled", ticket_id: ticketId } };
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        });

        return res.status(outcome.statusCode).json(outcome.body);
    } catch (err) {
        console.error("matchmaking cancel error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

setInterval(() => {
    sweepExpiredWaitingTickets().catch(error => {
        console.error("matchmaking sweep error:", error);
    });
}, Math.min(DEFAULT_MATCH_TIMEOUT_MS, 5000)).unref();
