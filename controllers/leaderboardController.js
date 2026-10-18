const db = require("../config/db");
const { normalizeWordBank } = require("../services/wordBankService");

const VALID_PERIODS = new Set(["weekly", "all"]);
const VALID_WORD_BANK_FILTERS = new Set(["all", "current"]);
const TOP_LIMIT = 50;

function normalizePeriod(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return VALID_PERIODS.has(normalized) ? normalized : "weekly";
}

function normalizeWordBankFilter(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return VALID_WORD_BANK_FILTERS.has(normalized) ? normalized : "all";
}

function resolveWordBankSelection(wordBankValue, currentWordBankValue) {
    const rawWordBank = typeof wordBankValue === "string" ? wordBankValue.trim() : "";
    const rawCurrentWordBank = typeof currentWordBankValue === "string" ? currentWordBankValue.trim() : "";
    const normalizedFilter = rawWordBank.toLowerCase();

    if (normalizedFilter === "all") {
        return { filter: "all", currentWordBank: null };
    }

    if (normalizedFilter === "current") {
        return { filter: "current", currentWordBank: rawCurrentWordBank };
    }

    const selectedWordBank = normalizeWordBank(rawWordBank);
    if (selectedWordBank) {
        return { filter: "current", currentWordBank: selectedWordBank };
    }

    return { filter: "all", currentWordBank: null };
}

function normalizeUserId(value) {
    const userId = Number(value);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function buildDisplayName(userId) {
    return `编${userId}`;
}

function buildWindowClause(period) {
    if (period !== "weekly") {
        return { sql: "", params: [] };
    }

    return {
        sql: "AND s.played_at >= CURRENT_DATE() - INTERVAL WEEKDAY(CURRENT_DATE()) DAY",
        params: []
    };
}

function buildWordBankClause(wordBankFilter, currentWordBank, tableAlias = "s") {
    if (wordBankFilter !== "current") {
        return { sql: "", params: [] };
    }

    const normalizedWordBank = normalizeWordBank(currentWordBank);
    if (!normalizedWordBank) {
        return { sql: "", params: [] };
    }

    return {
        sql: `AND COALESCE(
            ${tableAlias}.actual_word_bank,
            (
                SELECT mt.matched_word_bank
                FROM matchmaking_ticket mt
                WHERE mt.room_id = ${tableAlias}.match_room_id
                  AND mt.matched_word_bank IS NOT NULL
                ORDER BY mt.updated_at DESC, mt.ticket_id ASC
                LIMIT 1
            )
        ) = ?`,
        params: [normalizedWordBank]
    };
}

function buildBaseQuery(period, wordBankFilter, currentWordBank, tableAlias = "s") {
    const windowClause = buildWindowClause(period);
    const wordBankClause = buildWordBankClause(wordBankFilter, currentWordBank, tableAlias);

    return {
        whereSql: `
            ${tableAlias}.play_mode = 'match_human'
            AND COALESCE(${tableAlias}.matchmaking_opponent_type, 'human') = 'human'
            AND ${tableAlias}.game_status = 1
            AND ${tableAlias}.winner_user_id IS NOT NULL
            AND ${tableAlias}.user1_id > 0
            AND ${tableAlias}.user2_id > 0
            ${windowClause.sql.replaceAll("s.", `${tableAlias}.`)}
            ${wordBankClause.sql}
        `,
        params: [
            ...windowClause.params,
            ...wordBankClause.params
        ]
    };
}

function toLeaderboardRow(row) {
    const wins = Number(row.wins || 0);
    const matches = Number(row.matches || 0);
    const winRate = matches > 0 ? wins / matches : 0;

    return {
        rank: Number(row.rank_position || 0),
        user_id: Number(row.user_id || 0),
        display_name: row.display_name || buildDisplayName(row.user_id),
        avatar_url: row.avatar_url || "",
        wins,
        matches,
        win_rate: Number(winRate.toFixed(4)),
        avg_duration: row.avg_duration == null ? 0 : Number(Number(row.avg_duration).toFixed(1))
    };
}

async function queryLeaderboard(period, wordBankFilter, currentWordBank, userId) {
    const base = buildBaseQuery(period, wordBankFilter, currentWordBank);
    const representative = buildBaseQuery(period, wordBankFilter, currentWordBank, "s2");

    const sql = `
        SELECT
            s.session_id,
            COALESCE(s.match_room_id, CONCAT('session:', s.session_id)) AS match_key,
            s.user1_id,
            s.user2_id,
            s.winner_user_id,
            s.duration,
            s.played_at,
            up1.wechat_nickname AS user1_nickname,
            up1.avatar_url AS user1_avatar_url,
            up2.wechat_nickname AS user2_nickname,
            up2.avatar_url AS user2_avatar_url
        FROM user_study_session_summary s
        INNER JOIN user_profile up1 ON up1.user_id = s.user1_id
        INNER JOIN user_profile up2 ON up2.user_id = s.user2_id
        WHERE ${base.whereSql}
          AND NOT EXISTS (
              SELECT 1
              FROM user_study_session_summary s2
              WHERE COALESCE(s2.match_room_id, CONCAT('session:', s2.session_id))
                    = COALESCE(s.match_room_id, CONCAT('session:', s.session_id))
                AND (
                    s2.played_at < s.played_at
                    OR (
                        s2.played_at = s.played_at
                        AND s2.session_id < s.session_id
                    )
                )
                AND ${representative.whereSql}
          )
        ORDER BY s.played_at ASC, s.session_id ASC
    `;

    const [sessions] = await db.execute(sql, [...base.params, ...representative.params]);
    const statsByUserId = new Map();

    function ensureStats(participantUserId, displayName, avatarUrl) {
        const numericUserId = Number(participantUserId || 0);
        if (numericUserId <= 0) {
            return null;
        }

        if (!statsByUserId.has(numericUserId)) {
            statsByUserId.set(numericUserId, {
                user_id: numericUserId,
                display_name: displayName || buildDisplayName(numericUserId),
                avatar_url: avatarUrl || "",
                wins: 0,
                matches: 0,
                duration_total: 0,
                duration_count: 0
            });
        }

        return statsByUserId.get(numericUserId);
    }

    for (const session of sessions) {
        const participants = [
            { userId: session.user1_id, nickname: session.user1_nickname, avatarUrl: session.user1_avatar_url },
            { userId: session.user2_id, nickname: session.user2_nickname, avatarUrl: session.user2_avatar_url }
        ];

        for (const participant of participants) {
            const stats = ensureStats(participant.userId, participant.nickname, participant.avatarUrl);
            if (!stats) {
                continue;
            }

            stats.matches += 1;
            if (Number(participant.userId) === Number(session.winner_user_id)) {
                stats.wins += 1;
            }
            if (Number(session.duration || 0) > 0) {
                stats.duration_total += Number(session.duration);
                stats.duration_count += 1;
            }
        }
    }

    const rankedRows = Array.from(statsByUserId.values())
        .map(stats => ({
            rank_position: 0,
            user_id: stats.user_id,
            display_name: stats.display_name,
            avatar_url: stats.avatar_url,
            wins: stats.wins,
            matches: stats.matches,
            avg_duration: stats.duration_count > 0 ? stats.duration_total / stats.duration_count : null
        }))
        .sort((a, b) => {
            const winDiff = Number(b.wins) - Number(a.wins);
            if (winDiff !== 0) return winDiff;

            const aWinRate = Number(a.matches) > 0 ? Number(a.wins) / Number(a.matches) : 0;
            const bWinRate = Number(b.matches) > 0 ? Number(b.wins) / Number(b.matches) : 0;
            const winRateDiff = bWinRate - aWinRate;
            if (winRateDiff !== 0) return winRateDiff;

            const aDuration = a.avg_duration == null ? Number.MAX_SAFE_INTEGER : Number(a.avg_duration);
            const bDuration = b.avg_duration == null ? Number.MAX_SAFE_INTEGER : Number(b.avg_duration);
            const durationDiff = aDuration - bDuration;
            if (durationDiff !== 0) return durationDiff;

            return Number(a.user_id) - Number(b.user_id);
        });

    rankedRows.forEach((row, index) => {
        row.rank_position = index + 1;
    });

    return rankedRows.filter(row => row.rank_position <= TOP_LIMIT || (userId != null && Number(row.user_id) === userId));
}

exports.getCompetitiveLeaderboard = async (req, res) => {
    try {
        const period = normalizePeriod(req.query.period);
        const wordBankSelection = resolveWordBankSelection(
            req.query.wordBank,
            req.query.currentWordBank || req.query.wordBankName || req.query.current_word_bank
        );
        const wordBankFilter = normalizeWordBankFilter(wordBankSelection.filter);
        const currentWordBank = wordBankSelection.currentWordBank;
        const userId = normalizeUserId(req.query.userID || req.query.user_id);

        if (wordBankFilter === "current" && !normalizeWordBank(currentWordBank)) {
            return res.status(400).json({
                success: false,
                message: "currentWordBank is required when wordBank=current"
            });
        }

        const rows = await queryLeaderboard(period, wordBankFilter, currentWordBank, userId);
        const top = rows.filter(row => Number(row.rank_position) <= TOP_LIMIT).map(toLeaderboardRow);
        const meRow = userId == null
            ? null
            : rows.find(row => Number(row.user_id) === userId);

        return res.json({
            success: true,
            period,
            word_bank: wordBankFilter,
            current_word_bank: wordBankFilter === "current" ? normalizeWordBank(currentWordBank) : null,
            limit: TOP_LIMIT,
            entries: top,
            me: meRow ? toLeaderboardRow(meRow) : null
        });
    } catch (err) {
        console.error("competitive leaderboard error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};
