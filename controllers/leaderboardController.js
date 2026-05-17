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
        sql: "AND s.played_at >= UTC_DATE() - INTERVAL WEEKDAY(UTC_DATE()) DAY",
        params: []
    };
}

function buildWordBankClause(wordBankFilter, currentWordBank) {
    if (wordBankFilter !== "current") {
        return { sql: "", params: [] };
    }

    const normalizedWordBank = normalizeWordBank(currentWordBank);
    if (!normalizedWordBank) {
        return { sql: "", params: [] };
    }

    return {
        sql: "AND COALESCE(s.actual_word_bank, mt.matched_word_bank) = ?",
        params: [normalizedWordBank]
    };
}

function buildBaseQuery(period, wordBankFilter, currentWordBank) {
    const windowClause = buildWindowClause(period);
    const wordBankClause = buildWordBankClause(wordBankFilter, currentWordBank);

    return {
        whereSql: `
            s.play_mode = 'match_human'
            AND s.game_status = 1
            AND s.winner_user_id IS NOT NULL
            AND s.user1_id > 0
            AND s.user2_id > 0
            ${windowClause.sql}
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
        wins,
        matches,
        win_rate: Number(winRate.toFixed(4)),
        avg_duration: row.avg_duration == null ? 0 : Number(Number(row.avg_duration).toFixed(1))
    };
}

async function queryLeaderboard(period, wordBankFilter, currentWordBank, userId) {
    const base = buildBaseQuery(period, wordBankFilter, currentWordBank);

    const sql = `
        WITH filtered_sessions AS (
            SELECT
                s.session_id,
                COALESCE(s.match_room_id, CONCAT('session:', s.session_id)) AS match_key,
                s.user1_id,
                s.user2_id,
                s.winner_user_id,
                s.duration,
                s.played_at
            FROM user_study_session_summary s
            LEFT JOIN matchmaking_ticket mt ON mt.room_id = s.match_room_id
            WHERE ${base.whereSql}
        ),
        deduped_matches AS (
            SELECT *
            FROM (
                SELECT
                    filtered_sessions.*,
                    ROW_NUMBER() OVER (PARTITION BY match_key ORDER BY played_at ASC, session_id ASC) AS row_num
                FROM filtered_sessions
            ) ranked_sessions
            WHERE row_num = 1
        ),
        participants AS (
            SELECT
                user1_id AS user_id,
                winner_user_id,
                duration
            FROM deduped_matches
            UNION ALL
            SELECT
                user2_id AS user_id,
                winner_user_id,
                duration
            FROM deduped_matches
        ),
        user_stats AS (
            SELECT
                user_id,
                SUM(CASE WHEN user_id = winner_user_id THEN 1 ELSE 0 END) AS wins,
                COUNT(*) AS matches,
                AVG(NULLIF(duration, 0)) AS avg_duration
            FROM participants
            GROUP BY user_id
        ),
        ranked_stats AS (
            SELECT
                user_id,
                wins,
                matches,
                avg_duration,
                ROW_NUMBER() OVER (
                    ORDER BY wins DESC, (wins / NULLIF(matches, 0)) DESC, COALESCE(avg_duration, 999999) ASC, user_id ASC
                ) AS ranking
            FROM user_stats
        )
        SELECT
            ranking AS rank_position,
            ranked_stats.user_id,
            COALESCE(NULLIF(up.wechat_nickname, ''), CONCAT(?, ranking)) AS display_name,
            wins,
            matches,
            avg_duration
        FROM ranked_stats
        LEFT JOIN user_profile up ON up.user_id = ranked_stats.user_id
        WHERE ranking <= ?
           OR (? IS NOT NULL AND ranked_stats.user_id = ?)
        ORDER BY ranking ASC
    `;

    const params = [
        ...base.params,
        "编",
        TOP_LIMIT,
        userId,
        userId
    ];

    const [rows] = await db.execute(sql, params);
    return rows;
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
