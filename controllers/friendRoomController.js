const crypto = require("crypto");
const db = require("../config/db");
const {
    getWordBankLevelCode,
    normalizeWordBank
} = require("../services/wordBankService");

const ROOM_TTL_MINUTES = Math.max(5, Number(process.env.FRIEND_ROOM_TTL_MINUTES) || 30);

let roomSequence = 0;
let schemaInitializationPromise = null;

function normalizeUserId(value) {
    const userId = Number(value);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function buildInviteId() {
    return `invite_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function buildRoomId() {
    roomSequence += 1;
    return `room_${Date.now()}_${roomSequence}`;
}

function buildTicketId() {
    return `ticket_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

function buildRoomCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60 * 1000);
}

function toIsoString(value) {
    if (!value) {
        return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildPlayer(userId, nickname, avatarUrl, ready) {
    if (userId == null || Number(userId) <= 0) {
        return null;
    }

    return {
        user_id: Number(userId),
        nickname: nickname || `玩家${userId}`,
        avatar_url: avatarUrl || "",
        ready: Boolean(ready)
    };
}

function buildOpponent(row, currentUserId) {
    if (!row || !row.match_room_id) {
        return null;
    }

    const isHost = Number(row.host_user_id) === Number(currentUserId);
    const opponentUserId = isHost ? row.guest_user_id : row.host_user_id;
    const opponentNickname = isHost ? row.guest_nickname : row.host_nickname;

    return {
        user_id: Number(opponentUserId || 0),
        is_bot: false,
        nickname: opponentNickname || `玩家${opponentUserId}`
    };
}

function buildMatchResponse(row, currentUserId) {
    if (!row || !row.match_room_id) {
        return null;
    }

    const isHost = Number(row.host_user_id) === Number(currentUserId);
    return {
        success: true,
        status: "matched",
        ticket_id: isHost ? row.host_ticket_id : row.guest_ticket_id,
        room_id: row.match_room_id,
        opponent_type: "human",
        word: row.matched_word,
        matched_word_bank: row.word_bank,
        match_round_no: Number(row.match_round_no || 1),
        language_level_code: Number(row.language_level_code || 0),
        opponent: buildOpponent(row, currentUserId),
        fallback_at: null,
        wait_seconds: 0
    };
}

function buildRoomResponse(row, currentUserId, message = null) {
    const match = buildMatchResponse(row, currentUserId);
    return {
        success: true,
        message,
        invite_id: row.invite_id,
        room_code: row.room_code,
        status: row.status,
        word_bank: row.word_bank,
        language_level_code: Number(row.language_level_code || 0),
        expires_at: toIsoString(row.expires_at),
        host: buildPlayer(row.host_user_id, row.host_nickname, row.host_avatar_url, row.host_ready),
        guest: buildPlayer(row.guest_user_id, row.guest_nickname, row.guest_avatar_url, row.guest_ready),
        match
    };
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

async function initializeFriendRoomSchema() {
    if (schemaInitializationPromise != null) {
        return schemaInitializationPromise;
    }

    schemaInitializationPromise = (async () => {
        await db.execute(
            `CREATE TABLE IF NOT EXISTS friend_room (
                invite_id VARCHAR(64) PRIMARY KEY,
                room_code VARCHAR(8) NOT NULL,
                host_user_id BIGINT NOT NULL,
                guest_user_id BIGINT NULL,
                word_bank VARCHAR(32) NULL,
                language_level_code INT NOT NULL DEFAULT 0,
                host_ready TINYINT(1) NOT NULL DEFAULT 0,
                guest_ready TINYINT(1) NOT NULL DEFAULT 0,
                status VARCHAR(16) NOT NULL DEFAULT 'waiting',
                match_room_id VARCHAR(64) NULL,
                match_round_no INT NOT NULL DEFAULT 1,
                host_ticket_id VARCHAR(64) NULL,
                guest_ticket_id VARCHAR(64) NULL,
                matched_word VARCHAR(64) NULL,
                expires_at DATETIME(3) NOT NULL,
                created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                UNIQUE KEY uk_friend_room_code (room_code),
                KEY idx_friend_room_host_status (host_user_id, status, created_at),
                KEY idx_friend_room_guest_status (guest_user_id, status, created_at),
                KEY idx_friend_room_status_expires (status, expires_at),
                CONSTRAINT fk_friend_room_host FOREIGN KEY (host_user_id) REFERENCES user_profile(user_id),
                CONSTRAINT fk_friend_room_guest FOREIGN KEY (guest_user_id) REFERENCES user_profile(user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
        );

        await ensureColumn(db, "friend_room", "host_ticket_id", "host_ticket_id VARCHAR(64) NULL AFTER match_room_id");
        await ensureColumn(db, "friend_room", "match_round_no", "match_round_no INT NOT NULL DEFAULT 1 AFTER match_room_id");
        await ensureColumn(db, "friend_room", "guest_ticket_id", "guest_ticket_id VARCHAR(64) NULL AFTER host_ticket_id");
        await ensureColumn(db, "friend_room", "matched_word", "matched_word VARCHAR(64) NULL AFTER guest_ticket_id");
    })().catch(error => {
        schemaInitializationPromise = null;
        throw error;
    });

    return schemaInitializationPromise;
}

async function withConnection(work) {
    const connection = await db.getConnection();
    try {
        return await work(connection);
    } finally {
        connection.release();
    }
}

async function loadRoomByInviteOrCode(executor, { inviteId, roomCode }, lockRow = false) {
    const normalizedInviteId = typeof inviteId === "string" ? inviteId.trim() : "";
    const normalizedRoomCode = typeof roomCode === "string" ? roomCode.trim() : "";
    if (!normalizedInviteId && !normalizedRoomCode) {
        return null;
    }

    const lockClause = lockRow ? " FOR UPDATE" : "";
    const params = [];
    const clauses = [];
    if (normalizedInviteId) {
        clauses.push("fr.invite_id = ?");
        params.push(normalizedInviteId);
    }
    if (normalizedRoomCode) {
        clauses.push("fr.room_code = ?");
        params.push(normalizedRoomCode);
    }

    const [rows] = await executor.execute(
        `SELECT
             fr.*,
             hp.wechat_nickname AS host_nickname,
             hp.avatar_url AS host_avatar_url,
             gp.wechat_nickname AS guest_nickname,
             gp.avatar_url AS guest_avatar_url
         FROM friend_room fr
         LEFT JOIN user_profile hp ON hp.user_id = fr.host_user_id
         LEFT JOIN user_profile gp ON gp.user_id = fr.guest_user_id
         WHERE (${clauses.join(" OR ")})
         LIMIT 1${lockClause}`,
        params
    );

    return rows[0] || null;
}

async function expireRoomIfNeeded(executor, room) {
    if (!room || room.status === "matched" || room.status === "cancelled" || room.status === "expired") {
        return room;
    }

    const expiresAt = room.expires_at instanceof Date ? room.expires_at.getTime() : new Date(room.expires_at).getTime();
    if (expiresAt > Date.now()) {
        return room;
    }

    await executor.execute(
        "UPDATE friend_room SET status = 'expired' WHERE invite_id = ? AND status IN ('waiting', 'joined')",
        [room.invite_id]
    );
    return await loadRoomByInviteOrCode(executor, { inviteId: room.invite_id }, false);
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

    const [rows] = await executor.query(
        "SELECT word_form FROM vocabulary ORDER BY RAND() LIMIT 1"
    );
    return rows.length > 0 ? rows[0].word_form : null;
}

async function buildUniqueRoomCode(executor) {
    for (let attempt = 0; attempt < 20; attempt++) {
        const roomCode = buildRoomCode();
        const [rows] = await executor.execute(
            "SELECT 1 FROM friend_room WHERE room_code = ? AND status IN ('waiting', 'joined') LIMIT 1",
            [roomCode]
        );
        if (rows.length === 0) {
            return roomCode;
        }
    }

    throw new Error("Unable to allocate room code");
}

async function finalizeMatchIfReady(executor, room) {
    if (!room ||
        room.status === "matched" ||
        Number(room.host_ready) !== 1 ||
        Number(room.guest_ready) !== 1 ||
        Number(room.host_user_id) <= 0 ||
        Number(room.guest_user_id) <= 0) {
        return room;
    }

    const matchedWord = await pickWord(room.word_bank, executor);
    if (!matchedWord) {
        throw new Error("No match word available");
    }

    const roomId = buildRoomId();
    const hostTicketId = buildTicketId();
    const guestTicketId = buildTicketId();
    const matchedAt = new Date();
    const hostNickname = room.host_nickname || `玩家${room.host_user_id}`;
    const guestNickname = room.guest_nickname || `玩家${room.guest_user_id}`;

    await executor.execute(
        `INSERT INTO matchmaking_room
            (room_id, room_status, word_bank, matched_word, match_round_no, opponent_type, user1_id, user2_id,
             user1_last_seen_at, user2_last_seen_at, matched_at)
         VALUES (?, 'matched', ?, ?, 1, 'human', ?, ?, ?, ?, ?)`,
        [roomId, room.word_bank, matchedWord, room.host_user_id, room.guest_user_id, matchedAt, matchedAt, matchedAt]
    );

    await executor.execute(
        `INSERT INTO matchmaking_ticket
            (ticket_id, user_id, word_bank, matched_word_bank, allow_bot_fallback, status, fallback_at,
             room_id, opponent_type, opponent_user_id, opponent_nickname, matched_word, match_round_no, resolved_at)
         VALUES
            (?, ?, ?, ?, 0, 'matched', ?, ?, 'human', ?, ?, ?, 1, ?),
            (?, ?, ?, ?, 0, 'matched', ?, ?, 'human', ?, ?, ?, 1, ?)`,
        [
            hostTicketId, room.host_user_id, room.word_bank, room.word_bank, matchedAt, roomId, room.guest_user_id, guestNickname, matchedWord, matchedAt,
            guestTicketId, room.guest_user_id, room.word_bank, room.word_bank, matchedAt, roomId, room.host_user_id, hostNickname, matchedWord, matchedAt
        ]
    );

    await executor.execute(
        `UPDATE friend_room
             SET status = 'matched',
                 match_room_id = ?,
                 match_round_no = 1,
                 host_ticket_id = ?,
                 guest_ticket_id = ?,
                 matched_word = ?
         WHERE invite_id = ? AND status = 'joined'`,
        [roomId, hostTicketId, guestTicketId, matchedWord, room.invite_id]
    );

    return await loadRoomByInviteOrCode(executor, { inviteId: room.invite_id }, false);
}

async function create(req, res) {
    try {
        await initializeFriendRoomSchema();

        const hostUserId = normalizeUserId(req.body.user_id ?? req.body.userID);
        if (hostUserId == null) {
            return res.status(400).json({ success: false, message: "user_id is required" });
        }

        const wordBank = normalizeWordBank(req.body.word_bank || req.body.wordBank);
        const languageLevelCode = Number(req.body.language_level_code || getWordBankLevelCode(wordBank) || 0);
        const result = await withConnection(async connection => {
            const roomCode = await buildUniqueRoomCode(connection);
            const inviteId = buildInviteId();
            const now = new Date();

            await connection.execute(
                `INSERT INTO friend_room
                    (invite_id, room_code, host_user_id, word_bank, language_level_code, status, expires_at)
                 VALUES (?, ?, ?, ?, ?, 'waiting', ?)`,
                [inviteId, roomCode, hostUserId, wordBank, languageLevelCode, addMinutes(now, ROOM_TTL_MINUTES)]
            );

            return await loadRoomByInviteOrCode(connection, { inviteId }, false);
        });

        return res.json(buildRoomResponse(result, hostUserId));
    } catch (error) {
        console.error("friend room create error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
}

async function join(req, res) {
    try {
        await initializeFriendRoomSchema();

        const userId = normalizeUserId(req.body.user_id ?? req.body.userID);
        if (userId == null) {
            return res.status(400).json({ success: false, message: "user_id is required" });
        }

        const result = await withConnection(async connection => {
            await connection.beginTransaction();
            try {
                let room = await loadRoomByInviteOrCode(connection, {
                    inviteId: req.body.invite_id || req.body.inviteId,
                    roomCode: req.body.room_code || req.body.roomCode
                }, true);
                room = await expireRoomIfNeeded(connection, room);

                if (!room) {
                    await connection.rollback();
                    return { statusCode: 404, body: { success: false, message: "房间不存在" } };
                }

                if (room.status === "expired") {
                    await connection.rollback();
                    return { statusCode: 410, body: { success: false, message: "房间已过期" } };
                }

                if (room.status === "cancelled") {
                    await connection.rollback();
                    return { statusCode: 409, body: { success: false, message: "房间已取消" } };
                }

                if (Number(room.host_user_id) === userId) {
                    await connection.rollback();
                    return { statusCode: 409, body: { success: false, message: "不能加入自己创建的房间" } };
                }

                if (room.guest_user_id != null && Number(room.guest_user_id) !== userId) {
                    await connection.rollback();
                    return { statusCode: 409, body: { success: false, message: "房间已满" } };
                }

                if (room.status === "waiting" || room.guest_user_id == null) {
                    await connection.execute(
                        `UPDATE friend_room
                         SET guest_user_id = ?, status = 'joined', guest_ready = 0
                         WHERE invite_id = ? AND status = 'waiting'`,
                        [userId, room.invite_id]
                    );
                }

                room = await loadRoomByInviteOrCode(connection, { inviteId: room.invite_id }, false);
                await connection.commit();
                return { statusCode: 200, body: buildRoomResponse(room, userId) };
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        });

        return res.status(result.statusCode).json(result.body);
    } catch (error) {
        console.error("friend room join error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
}

async function status(req, res) {
    try {
        await initializeFriendRoomSchema();

        const userId = normalizeUserId(req.query.user_id ?? req.query.userID);
        if (userId == null) {
            return res.status(400).json({ success: false, message: "user_id is required" });
        }

        const row = await withConnection(async connection => {
            await connection.beginTransaction();
            try {
                let room = await loadRoomByInviteOrCode(connection, {
                    inviteId: req.query.invite_id || req.query.inviteId,
                    roomCode: req.query.room_code || req.query.roomCode
                }, true);
                room = await expireRoomIfNeeded(connection, room);
                await connection.commit();
                return room;
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        });

        if (!row) {
            return res.status(404).json({ success: false, message: "房间不存在" });
        }

        if (Number(row.host_user_id) !== userId && Number(row.guest_user_id || 0) !== userId) {
            return res.status(403).json({ success: false, message: "你不在这个房间中" });
        }

        return res.json(buildRoomResponse(row, userId));
    } catch (error) {
        console.error("friend room status error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
}

async function ready(req, res) {
    try {
        await initializeFriendRoomSchema();

        const userId = normalizeUserId(req.body.user_id ?? req.body.userID);
        if (userId == null) {
            return res.status(400).json({ success: false, message: "user_id is required" });
        }

        const result = await withConnection(async connection => {
            await connection.beginTransaction();
            try {
                let room = await loadRoomByInviteOrCode(connection, {
                    inviteId: req.body.invite_id || req.body.inviteId,
                    roomCode: req.body.room_code || req.body.roomCode
                }, true);
                room = await expireRoomIfNeeded(connection, room);

                if (!room) {
                    await connection.rollback();
                    return { statusCode: 404, body: { success: false, message: "房间不存在" } };
                }

                if (room.status === "expired") {
                    await connection.rollback();
                    return { statusCode: 410, body: { success: false, message: "房间已过期" } };
                }

                if (room.status === "cancelled") {
                    await connection.rollback();
                    return { statusCode: 409, body: { success: false, message: "房间已取消" } };
                }

                if (Number(room.host_user_id) === userId) {
                    await connection.execute("UPDATE friend_room SET host_ready = 1 WHERE invite_id = ?", [room.invite_id]);
                } else if (Number(room.guest_user_id || 0) === userId) {
                    await connection.execute("UPDATE friend_room SET guest_ready = 1 WHERE invite_id = ?", [room.invite_id]);
                } else {
                    await connection.rollback();
                    return { statusCode: 403, body: { success: false, message: "你不在这个房间中" } };
                }

                room = await loadRoomByInviteOrCode(connection, { inviteId: room.invite_id }, true);
                room = await finalizeMatchIfReady(connection, room);
                await connection.commit();
                return { statusCode: 200, body: buildRoomResponse(room, userId) };
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        });

        return res.status(result.statusCode).json(result.body);
    } catch (error) {
        console.error("friend room ready error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
}

async function leave(req, res) {
    try {
        await initializeFriendRoomSchema();

        const userId = normalizeUserId(req.body.user_id ?? req.body.userID);
        if (userId == null) {
            return res.status(400).json({ success: false, message: "user_id is required" });
        }

        const result = await withConnection(async connection => {
            await connection.beginTransaction();
            try {
                const room = await loadRoomByInviteOrCode(connection, {
                    inviteId: req.body.invite_id || req.body.inviteId,
                    roomCode: req.body.room_code || req.body.roomCode
                }, true);

                if (!room) {
                    await connection.rollback();
                    return { statusCode: 404, body: { success: false, message: "房间不存在" } };
                }

                if (room.status === "matched") {
                    await connection.commit();
                    return { statusCode: 200, body: buildRoomResponse(room, userId, "房间已进入对局") };
                }

                if (Number(room.host_user_id) === userId) {
                    await connection.execute(
                        "UPDATE friend_room SET status = 'cancelled' WHERE invite_id = ? AND status IN ('waiting', 'joined')",
                        [room.invite_id]
                    );
                } else if (Number(room.guest_user_id || 0) === userId) {
                    await connection.execute(
                        `UPDATE friend_room
                         SET guest_user_id = NULL, guest_ready = 0, host_ready = 0, status = 'waiting'
                         WHERE invite_id = ? AND status = 'joined'`,
                        [room.invite_id]
                    );
                } else {
                    await connection.rollback();
                    return { statusCode: 403, body: { success: false, message: "你不在这个房间中" } };
                }

                const updated = await loadRoomByInviteOrCode(connection, { inviteId: room.invite_id }, false);
                await connection.commit();
                return { statusCode: 200, body: buildRoomResponse(updated, userId) };
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        });

        return res.status(result.statusCode).json(result.body);
    } catch (error) {
        console.error("friend room leave error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
}

module.exports = {
    initializeFriendRoomSchema,
    create,
    join,
    status,
    ready,
    leave
};
