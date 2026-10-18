const crypto = require("crypto");
const db = require("../config/db");
const {
    normalizeWordBank,
    resolveSharedWordBank
} = require("../services/wordBankService");
const {
    abandonMatchedRoom
} = require("../services/matchRoomLifecycleService");
const { pickRandomWordForm } = require("../services/wordSelectionService");
const { formatChinaIsoDateTime } = require("../services/timeService");

const DEFAULT_MATCH_TIMEOUT_MS = Math.max(1000, Number(process.env.MATCH_TIMEOUT_MS) || 5000);
const ROOM_PRESENCE_TIMEOUT_SECONDS = Math.max(5, Number(process.env.MATCH_ROOM_PRESENCE_TIMEOUT_SECONDS) || 12);
const ROOM_RESUME_GRACE_SECONDS = Math.max(
    ROOM_PRESENCE_TIMEOUT_SECONDS,
    Number(process.env.MATCH_ROOM_RESUME_GRACE_SECONDS) || 60
);
const REMATCH_WAIT_TIMEOUT_SECONDS = Math.max(5, Number(process.env.MATCH_REMATCH_WAIT_TIMEOUT_SECONDS) || 20);

let schemaInitializationPromise = null;

function buildTicketId() {
    return `ticket_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

function buildRoomId() {
    return `room_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
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
    return Number.isNaN(date.getTime()) ? null : formatChinaIsoDateTime(date, 3);
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

function buildRematchWaitingResponse(room, slot) {
    return {
        success: true,
        status: "waiting",
        ticket_id: null,
        room_id: room.room_id,
        opponent_type: room.opponent_type,
        word: null,
        matched_word_bank: room.word_bank,
        match_round_no: Number(room.match_round_no || 1),
        opponent: {
            user_id: slot != null ? Number(slot.opponentUserId || 0) : 0,
            is_bot: false,
            nickname: slot != null && slot.opponentUserId > 0 ? `玩家${slot.opponentUserId}` : "对手"
        },
        fallback_at: null,
        wait_seconds: REMATCH_WAIT_TIMEOUT_SECONDS,
        message: "等待对方确认再来一局"
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
        match_round_no: Number(row.match_round_no || 1),
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

function isRetryableTransactionError(error) {
    return error?.code === "ER_LOCK_DEADLOCK" ||
        error?.code === "ER_LOCK_WAIT_TIMEOUT" ||
        error?.errno === 1213 ||
        error?.errno === 1205;
}

async function withTransactionRetry(work, maxAttempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await withConnection(async connection => {
                await connection.beginTransaction();
                try {
                    const result = await work(connection);
                    await connection.commit();
                    return result;
                } catch (error) {
                    await connection.rollback();
                    throw error;
                }
            });
        } catch (error) {
            lastError = error;
            if (!isRetryableTransactionError(error) || attempt >= maxAttempts) {
                throw error;
            }

            await new Promise(resolve => setTimeout(resolve, 25 * attempt));
        }
    }

    throw lastError;
}

async function initializeMatchmakingSchema() {
    if (schemaInitializationPromise != null) {
        return schemaInitializationPromise;
    }

    schemaInitializationPromise = (async () => {
        const requiredColumns = {
            matchmaking_room: [
                "room_id", "room_status", "word_bank", "matched_word", "match_round_no",
                "opponent_type", "user1_id", "user2_id", "user1_last_seen_at",
                "user2_last_seen_at", "user1_rematch_round_no", "user2_rematch_round_no",
                "rematch_requested_at"
            ],
            matchmaking_ticket: [
                "ticket_id", "user_id", "word_bank", "matched_word_bank",
                "allow_bot_fallback", "status", "fallback_at", "room_id",
                "opponent_type", "opponent_user_id", "opponent_nickname", "matched_word",
                "match_round_no"
            ],
            user_study_session_summary: [
                "session_id", "user1_id", "user2_id", "word_id", "play_mode",
                "match_ticket_id", "match_room_id", "match_round_no",
                "matchmaking_opponent_user_id", "matchmaking_opponent_type",
                "matchmaking_opponent_name", "actual_word_bank", "first_player",
                "winner_user_id", "game_status"
            ]
        };
        for (const [tableName, columns] of Object.entries(requiredColumns)) {
            const [tableRows] = await db.execute(
                `SELECT 1
                 FROM INFORMATION_SCHEMA.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                 LIMIT 1`,
                [tableName]
            );
            if (tableRows.length === 0) {
                throw new Error(`Database migration required: missing table ${tableName}`);
            }

            const [columnRows] = await db.query(
                `SELECT COLUMN_NAME
                 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ?
                   AND COLUMN_NAME IN (${columns.map(() => "?").join(", ")})`,
                [tableName, ...columns]
            );
            const present = new Set(columnRows.map(row => row.COLUMN_NAME));
            const missing = columns.filter(column => !present.has(column));
            if (missing.length > 0) {
                throw new Error(`Database migration required: ${tableName} missing columns ${missing.join(", ")}`);
            }
        }

        const [sessionUser2Column] = await db.execute(
            `SELECT IS_NULLABLE
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'user_study_session_summary'
               AND COLUMN_NAME = 'user2_id'
             LIMIT 1`
        );
        if (sessionUser2Column[0]?.IS_NULLABLE !== "YES") {
            throw new Error("Database migration required: user_study_session_summary.user2_id must allow NULL");
        }

    })().catch(error => {
        schemaInitializationPromise = null;
        throw error;
    });

    return schemaInitializationPromise;
}

async function pickWord(wordBank, executor = db) {
    return await pickRandomWordForm(wordBank, executor);
}

async function loadTicket(executor, ticketId, lockRow = false) {
    const lockClause = lockRow ? " FOR UPDATE" : "";
    const [rows] = await executor.execute(
        `SELECT ticket_id, user_id, word_bank, status, fallback_at, room_id, opponent_type,
                opponent_user_id, opponent_nickname, matched_word, match_round_no, matched_word_bank, allow_bot_fallback, created_at, updated_at,
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
                opponent_user_id, opponent_nickname, matched_word, match_round_no, matched_word_bank, allow_bot_fallback, created_at, updated_at,
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
                opponent_user_id, opponent_nickname, matched_word, match_round_no, matched_word_bank, allow_bot_fallback, created_at, updated_at,
         resolved_at, cancelled_at
         FROM matchmaking_ticket
         WHERE status = 'waiting'
           AND user_id <> ?
         ORDER BY created_at ASC, ticket_id ASC
         LIMIT ${safeLimit}
         FOR UPDATE`,
        [requesterUserId]
    );

    return rows;
}

async function insertRoom(executor, roomId, roomStatus, wordBank, matchedWord, opponentType, user1Id, user2Id, matchedAt) {
    const timestampSql = matchedAt === "CURRENT_TIMESTAMP(3)" ? "CURRENT_TIMESTAMP(3)" : "?";
    const params = [roomId, roomStatus, wordBank, matchedWord, opponentType, user1Id, user2Id];
    if (timestampSql !== "CURRENT_TIMESTAMP(3)") {
        params.push(matchedAt, matchedAt, matchedAt);
    }

    await executor.execute(
        `INSERT INTO matchmaking_room
            (room_id, room_status, word_bank, matched_word, opponent_type, user1_id, user2_id,
             user1_last_seen_at, user2_last_seen_at, matched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ${timestampSql}, ${timestampSql}, ${timestampSql})`,
        params
    );
}

async function loadRoomById(executor, roomId, lockRow = false) {
    const lockClause = lockRow ? " FOR UPDATE" : "";
    const [rows] = await executor.execute(
        `SELECT room_id, room_status, word_bank, matched_word, match_round_no,
                opponent_type, user1_id, user2_id, user1_last_seen_at, user2_last_seen_at,
                TIMESTAMPDIFF(SECOND, user1_last_seen_at, CURRENT_TIMESTAMP(3)) AS user1_last_seen_age_seconds,
                TIMESTAMPDIFF(SECOND, user2_last_seen_at, CURRENT_TIMESTAMP(3)) AS user2_last_seen_age_seconds,
                user1_rematch_round_no, user2_rematch_round_no, rematch_requested_at, matched_at
         FROM matchmaking_room
         WHERE room_id = ?${lockClause}`,
        [roomId]
    );

    return rows[0] || null;
}

function resolveRoomUserSlot(room, userId) {
    if (!room) {
        return null;
    }

    if (Number(room.user1_id) === Number(userId)) {
        return {
            selfColumn: "user1_last_seen_at",
            opponentColumn: "user2_last_seen_at",
            selfAgeColumn: "user1_last_seen_age_seconds",
            opponentAgeColumn: "user2_last_seen_age_seconds",
            selfRematchColumn: "user1_rematch_round_no",
            opponentRematchColumn: "user2_rematch_round_no",
            opponentUserId: Number(room.user2_id || 0)
        };
    }

    if (Number(room.user2_id) === Number(userId)) {
        return {
            selfColumn: "user2_last_seen_at",
            opponentColumn: "user1_last_seen_at",
            selfAgeColumn: "user2_last_seen_age_seconds",
            opponentAgeColumn: "user1_last_seen_age_seconds",
            selfRematchColumn: "user2_rematch_round_no",
            opponentRematchColumn: "user1_rematch_round_no",
            opponentUserId: Number(room.user1_id || 0)
        };
    }

    return null;
}

function isPresenceAgeFresh(ageSeconds, timeoutSeconds = ROOM_PRESENCE_TIMEOUT_SECONDS) {
    const age = Number(ageSeconds);
    return Number.isFinite(age) && age >= 0 && age <= timeoutSeconds;
}

function buildPresenceResponse(room, slot) {
    const opponentAgeSeconds = slot != null ? room?.[slot.opponentAgeColumn] : null;
    const opponentOnline = isPresenceAgeFresh(opponentAgeSeconds);
    return {
        success: true,
        status: room.room_status,
        room_id: room.room_id,
        room_active: room.room_status === "matched",
        opponent_online: opponentOnline,
        opponent_user_id: slot != null ? slot.opponentUserId : 0,
        match_round_no: Number(room.match_round_no || 1),
        word: room.matched_word || null,
        matched_word_bank: room.word_bank || null,
        timeout_seconds: ROOM_PRESENCE_TIMEOUT_SECONDS
    };
}

async function loadMatchedTicketByRoomAndUser(executor, roomId, userId) {
    const [rows] = await executor.execute(
        `SELECT ticket_id, user_id, word_bank, status, fallback_at, room_id, opponent_type,
                opponent_user_id, opponent_nickname, matched_word, match_round_no, matched_word_bank, allow_bot_fallback, created_at, updated_at,
                resolved_at, cancelled_at
         FROM matchmaking_ticket
         WHERE room_id = ? AND user_id = ? AND status = 'matched'
         ORDER BY resolved_at DESC, updated_at DESC
         LIMIT 1`,
        [roomId, userId]
    );

    return rows[0] || null;
}

async function refreshWaitingTicket(executor, ticketRow, timeoutMs = DEFAULT_MATCH_TIMEOUT_MS) {
    if (!ticketRow || ticketRow.status !== "waiting") {
        return ticketRow;
    }

    const timeoutMicroseconds = Math.max(1000, Math.round(timeoutMs * 1000));
    await executor.execute(
        `UPDATE matchmaking_ticket
         SET fallback_at = CURRENT_TIMESTAMP(3) + INTERVAL ? MICROSECOND,
             allow_bot_fallback = 0
         WHERE ticket_id = ? AND status = 'waiting'`,
        [timeoutMicroseconds, ticketRow.ticket_id]
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

    return await createHumanMatch(executor, {
        requesterUserId,
        requesterWordBank: wordBank,
        requesterTicketId: null,
        candidate,
        matchedWordBank
    });
}

async function createHumanMatch(executor, {
    requesterUserId,
    requesterWordBank,
    requesterTicketId = null,
    candidate,
    matchedWordBank
}) {
    const matchedWord = await pickWord(matchedWordBank, executor);
    if (!matchedWord) {
        throw new Error("No match word available");
    }

    const roomId = buildRoomId();
    const finalRequesterTicketId = requesterTicketId || buildTicketId();
    const matchedAt = "CURRENT_TIMESTAMP(3)";
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
             resolved_at = CURRENT_TIMESTAMP(3)
         WHERE ticket_id = ?`,
        [roomId, requesterUserId, requesterNickname, matchedWord, matchedWordBank, candidate.ticket_id]
    );

    if (requesterTicketId) {
        await executor.execute(
            `UPDATE matchmaking_ticket
             SET status = 'matched',
                 room_id = ?,
                 opponent_type = 'human',
                 opponent_user_id = ?,
                 opponent_nickname = ?,
                 matched_word = ?,
                 matched_word_bank = ?,
                 resolved_at = CURRENT_TIMESTAMP(3),
                 allow_bot_fallback = 0
             WHERE ticket_id = ? AND status = 'waiting'`,
            [roomId, candidate.user_id, candidateNickname, matchedWord, matchedWordBank, finalRequesterTicketId]
        );
    } else {
        await executor.execute(
            `INSERT INTO matchmaking_ticket
                (ticket_id, user_id, word_bank, matched_word_bank, allow_bot_fallback, status, fallback_at, room_id, opponent_type,
                 opponent_user_id, opponent_nickname, matched_word, resolved_at)
             VALUES (?, ?, ?, ?, 0, 'matched', CURRENT_TIMESTAMP(3), ?, 'human', ?, ?, ?, CURRENT_TIMESTAMP(3))`,
            [finalRequesterTicketId, requesterUserId, requesterWordBank, matchedWordBank, roomId, candidate.user_id, candidateNickname, matchedWord]
        );
    }

    return await loadTicket(executor, finalRequesterTicketId, false);
}

async function matchExistingWaitingWithHuman(executor, waitingTicket, timeoutMs) {
    if (!waitingTicket || waitingTicket.status !== "waiting") {
        return waitingTicket;
    }

    const refreshedTicket = await refreshWaitingTicket(executor, waitingTicket, timeoutMs);
    const candidates = await loadCandidateTickets(executor, refreshedTicket.user_id);
    if (!candidates || candidates.length === 0) {
        return refreshedTicket;
    }

    for (const candidate of candidates) {
        const sharedWordBank = resolveSharedWordBank(refreshedTicket.word_bank, candidate.word_bank);
        if (!sharedWordBank.compatible) {
            continue;
        }

        return await createHumanMatch(executor, {
            requesterUserId: refreshedTicket.user_id,
            requesterWordBank: refreshedTicket.word_bank,
            requesterTicketId: refreshedTicket.ticket_id,
            candidate,
            matchedWordBank: sharedWordBank.matchedWordBank
        });
    }

    return refreshedTicket;
}

async function createWaitingTicket(executor, userId, wordBank, timeoutMs) {
    const ticketId = buildTicketId();
    const timeoutMicroseconds = Math.max(1000, Math.round(timeoutMs * 1000));

    await executor.execute(
        `INSERT INTO matchmaking_ticket
            (ticket_id, user_id, word_bank, allow_bot_fallback, status, fallback_at)
         VALUES (?, ?, ?, ?, 'waiting', CURRENT_TIMESTAMP(3) + INTERVAL ? MICROSECOND)`,
        [ticketId, userId, wordBank, 0, timeoutMicroseconds]
    );

    return await loadTicket(executor, ticketId, false);
}

async function refreshTicketIfExpired(ticketId, timeoutMs = DEFAULT_MATCH_TIMEOUT_MS) {
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

            const [expiryRows] = await connection.execute(
                `SELECT CASE WHEN fallback_at <= CURRENT_TIMESTAMP(3) THEN 1 ELSE 0 END AS expired
                 FROM matchmaking_ticket
                 WHERE ticket_id = ?
                 LIMIT 1`,
                [ticketId]
            );
            if (Number(expiryRows[0]?.expired || 0) !== 1) {
                await connection.commit();
                return ticket;
            }

            const resolved = await refreshWaitingTicket(connection, ticket, timeoutMs);
            await connection.commit();
            return resolved;
        } catch (error) {
            await connection.rollback();
            throw error;
        }
    });
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

        const ticket = await withTransactionRetry(async connection => {
            // Serialize enqueue requests for the same user so concurrent taps
            // cannot create multiple active waiting tickets.
            const [userRows] = await connection.execute(
                "SELECT user_id FROM user_profile WHERE user_id = ? FOR UPDATE",
                [userId]
            );
            if (userRows.length === 0) {
                return null;
            }

            let existingWaiting = await loadWaitingTicketByUser(connection, userId, true);
            if (existingWaiting) {
                return await matchExistingWaitingWithHuman(connection, existingWaiting, timeoutMs);
            }

            const matchedTicket = await matchWithHuman(connection, userId, wordBank);
            if (matchedTicket) {
                return matchedTicket;
            }

            return await createWaitingTicket(connection, userId, wordBank, timeoutMs);
        });

        if (!ticket) {
            return res.status(404).json({ success: false, message: "用户不存在" });
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
            ticket = await refreshTicketIfExpired(ticketId);
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
                    if (!ticket.room_id || ticket.opponent_type !== "human") {
                        await connection.commit();
                        return { statusCode: 409, body: { success: false, message: "该匹配已出结果，不能取消" } };
                    }

                    const room = await loadRoomById(connection, ticket.room_id, true);
                    if (!room) {
                        await connection.commit();
                        return { statusCode: 404, body: { success: false, message: "房间不存在" } };
                    }

                    const slot = resolveRoomUserSlot(room, userId);
                    if (!slot) {
                        await connection.commit();
                        return { statusCode: 403, body: { success: false, message: "你不在这个房间中" } };
                    }

                    await abandonMatchedRoom(connection, ticket.room_id, slot.selfColumn);
                    await connection.commit();
                    return { statusCode: 200, body: { success: true, status: "cancelled", ticket_id: ticketId, room_id: ticket.room_id } };
                }

                if (ticket.status !== "waiting") {
                    await connection.commit();
                    return { statusCode: 409, body: { success: false, message: "当前匹配票据不可取消" } };
                }

                await connection.execute(
                    `UPDATE matchmaking_ticket
                     SET status = 'cancelled',
                         cancelled_at = CURRENT_TIMESTAMP(3)
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

exports.rematch = async (req, res) => {
    try {
        await initializeMatchmakingSchema();

        const userId = Number(req.body.user_id);
        const roomId = typeof req.body.room_id === "string" ? req.body.room_id.trim() : "";
        const previousRoundNo = Math.max(1, Number(req.body.previous_match_round_no || req.body.match_round_no) || 1);

        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ success: false, message: "user_id 无效" });
        }

        if (!roomId) {
            return res.status(400).json({ success: false, message: "room_id 不能为空" });
        }

        const outcome = await withConnection(async connection => {
            await connection.beginTransaction();
            try {
                const room = await loadRoomById(connection, roomId, true);
                if (!room) {
                    await connection.rollback();
                    return { statusCode: 404, body: { success: false, message: "房间不存在" } };
                }

                if (room.room_status !== "matched" || room.opponent_type !== "human") {
                    await connection.rollback();
                    return { statusCode: 409, body: { success: false, message: "当前房间不能再来一局" } };
                }

                if (Number(room.user1_id) !== userId && Number(room.user2_id) !== userId) {
                    await connection.rollback();
                    return { statusCode: 403, body: { success: false, message: "你不在这个房间中" } };
                }

                const slot = resolveRoomUserSlot(room, userId);
                if (!slot) {
                    await connection.rollback();
                    return { statusCode: 403, body: { success: false, message: "你不在这个房间中" } };
                }

                const currentRoundNo = Math.max(1, Number(room.match_round_no || 1));
                if (previousRoundNo < currentRoundNo) {
                    const ticket = await loadMatchedTicketByRoomAndUser(connection, roomId, userId);
                    if (!ticket) {
                        await connection.rollback();
                        return { statusCode: 404, body: { success: false, message: "房间匹配票据不存在" } };
                    }

                    await connection.commit();
                    return { statusCode: 200, body: buildMatchedResponse(ticket) };
                }

                await connection.execute(
                    `UPDATE matchmaking_room
                     SET ${slot.selfRematchColumn} = ?,
                         ${slot.selfColumn} = CURRENT_TIMESTAMP(3),
                         rematch_requested_at = COALESCE(rematch_requested_at, CURRENT_TIMESTAMP(3))
                     WHERE room_id = ?`,
                    [previousRoundNo, roomId]
                );

                const updatedRoom = await loadRoomById(connection, roomId, true);
                const selfReadyRoundNo = Math.max(0, Number(updatedRoom[slot.selfRematchColumn] || 0));
                const opponentReadyRoundNo = Math.max(0, Number(updatedRoom[slot.opponentRematchColumn] || 0));

                if (selfReadyRoundNo >= previousRoundNo && opponentReadyRoundNo >= previousRoundNo) {
                    const nextRoundNo = previousRoundNo + 1;
                    const matchedWord = await pickWord(updatedRoom.word_bank, connection);
                    if (!matchedWord) {
                        throw new Error("No match word available");
                    }

                    await connection.execute(
                        `UPDATE matchmaking_room
                         SET matched_word = ?,
                             match_round_no = ?,
                             user1_rematch_round_no = 0,
                             user2_rematch_round_no = 0,
                             rematch_requested_at = NULL,
                             matched_at = CURRENT_TIMESTAMP(3)
                         WHERE room_id = ?`,
                        [matchedWord, nextRoundNo, roomId]
                    );

                    await connection.execute(
                        `UPDATE matchmaking_ticket
                         SET matched_word = ?,
                             matched_word_bank = ?,
                             match_round_no = ?,
                             updated_at = CURRENT_TIMESTAMP(3),
                             resolved_at = CURRENT_TIMESTAMP(3)
                         WHERE room_id = ? AND status = 'matched'`,
                        [matchedWord, updatedRoom.word_bank, nextRoundNo, roomId]
                    );

                    const ticket = await loadMatchedTicketByRoomAndUser(connection, roomId, userId);
                    if (!ticket) {
                        await connection.rollback();
                        return { statusCode: 404, body: { success: false, message: "房间匹配票据不存在" } };
                    }

                    await connection.commit();
                    return { statusCode: 200, body: buildMatchedResponse(ticket) };
                }

                const [timeoutRows] = await connection.execute(
                    `SELECT TIMESTAMPDIFF(SECOND, rematch_requested_at, CURRENT_TIMESTAMP(3)) AS wait_seconds
                     FROM matchmaking_room
                     WHERE room_id = ?
                       AND rematch_requested_at IS NOT NULL
                     LIMIT 1`,
                    [roomId]
                );
                const waitedSeconds = Number(timeoutRows[0]?.wait_seconds || 0);
                if (waitedSeconds > REMATCH_WAIT_TIMEOUT_SECONDS) {
                    await connection.execute(
                        `UPDATE matchmaking_room
                         SET user1_rematch_round_no = 0,
                             user2_rematch_round_no = 0,
                             rematch_requested_at = NULL
                         WHERE room_id = ?`,
                        [roomId]
                    );
                }

                await connection.commit();
                return { statusCode: 200, body: buildRematchWaitingResponse(updatedRoom, slot) };
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        });

        return res.status(outcome.statusCode).json(outcome.body);
    } catch (err) {
        console.error("matchmaking rematch error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.heartbeat = async (req, res) => {
    try {
        await initializeMatchmakingSchema();

        const userId = Number(req.body.user_id);
        const roomId = typeof req.body.room_id === "string" ? req.body.room_id.trim() : "";

        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ success: false, message: "user_id 无效" });
        }

        if (!roomId) {
            return res.status(400).json({ success: false, message: "room_id 不能为空" });
        }

        const outcome = await withConnection(async connection => {
            await connection.beginTransaction();
            try {
                const room = await loadRoomById(connection, roomId, true);
                if (!room) {
                    await connection.rollback();
                    return { statusCode: 404, body: { success: false, message: "房间不存在" } };
                }

                const slot = resolveRoomUserSlot(room, userId);
                if (!slot) {
                    await connection.rollback();
                    return { statusCode: 403, body: { success: false, message: "你不在这个房间中" } };
                }

                await connection.execute(
                    `UPDATE matchmaking_room
                     SET ${slot.selfColumn} = CURRENT_TIMESTAMP(3)
                     WHERE room_id = ?`,
                    [roomId]
                );

                const updatedRoom = await loadRoomById(connection, roomId, false);
                await connection.commit();
                return { statusCode: 200, body: buildPresenceResponse(updatedRoom, slot) };
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        });

        return res.status(outcome.statusCode).json(outcome.body);
    } catch (err) {
        console.error("matchmaking heartbeat error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.resume = async (req, res) => {
    try {
        await initializeMatchmakingSchema();

        const userId = Number(req.body.user_id);
        const roomId = typeof req.body.room_id === "string" ? req.body.room_id.trim() : "";

        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ success: false, message: "user_id 无效" });
        }

        if (!roomId) {
            return res.status(400).json({ success: false, message: "room_id 不能为空" });
        }

        const outcome = await withConnection(async connection => {
            await connection.beginTransaction();
            try {
                const room = await loadRoomById(connection, roomId, true);
                if (!room) {
                    await connection.rollback();
                    return { statusCode: 404, body: { success: false, message: "房间不存在" } };
                }

                const slot = resolveRoomUserSlot(room, userId);
                if (!slot) {
                    await connection.rollback();
                    return { statusCode: 403, body: { success: false, message: "你不在这个房间中" } };
                }

                if (room.room_status !== "matched") {
                    await connection.rollback();
                    return { statusCode: 409, body: { success: false, message: "房间已失效", status: room.room_status } };
                }

                if (!isPresenceAgeFresh(room[slot.opponentAgeColumn], ROOM_RESUME_GRACE_SECONDS)) {
                    await abandonMatchedRoom(connection, roomId, slot.selfColumn);
                    await connection.commit();
                    return { statusCode: 409, body: { success: false, message: "对方已不在房间中，房间已失效", status: "abandoned" } };
                }

                await connection.execute(
                    `UPDATE matchmaking_room
                     SET ${slot.selfColumn} = CURRENT_TIMESTAMP(3)
                     WHERE room_id = ?`,
                    [roomId]
                );

                const ticket = await loadMatchedTicketByRoomAndUser(connection, roomId, userId);
                if (!ticket) {
                    await connection.rollback();
                    return { statusCode: 404, body: { success: false, message: "房间匹配票据不存在" } };
                }

                await connection.commit();
                return { statusCode: 200, body: buildMatchedResponse(ticket) };
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        });

        return res.status(outcome.statusCode).json(outcome.body);
    } catch (err) {
        console.error("matchmaking resume error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.leave = async (req, res) => {
    try {
        await initializeMatchmakingSchema();

        const userId = Number(req.body.user_id);
        const roomId = typeof req.body.room_id === "string" ? req.body.room_id.trim() : "";

        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ success: false, message: "user_id 无效" });
        }

        if (!roomId) {
            return res.status(400).json({ success: false, message: "room_id 不能为空" });
        }

        const outcome = await withConnection(async connection => {
            await connection.beginTransaction();
            try {
                const room = await loadRoomById(connection, roomId, true);
                if (!room) {
                    await connection.rollback();
                    return { statusCode: 404, body: { success: false, message: "房间不存在" } };
                }

                const slot = resolveRoomUserSlot(room, userId);
                if (!slot) {
                    await connection.rollback();
                    return { statusCode: 403, body: { success: false, message: "你不在这个房间中" } };
                }

                if (room.room_status === "matched") {
                    await abandonMatchedRoom(connection, roomId, slot.selfColumn);
                }

                await connection.commit();
                return {
                    statusCode: 200,
                    body: {
                        success: true,
                        status: room.room_status === "matched" ? "abandoned" : room.room_status,
                        room_id: roomId
                    }
                };
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        });

        return res.status(outcome.statusCode).json(outcome.body);
    } catch (err) {
        console.error("matchmaking leave error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};
