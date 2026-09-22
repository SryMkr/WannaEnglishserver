const crypto = require("crypto");
const db = require("../config/db");

const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

async function withConnection(work) {
    const connection = await db.getConnection();
    try {
        return await work(connection);
    } finally {
        connection.release();
    }
}

function isClaimFresh(claimedAt) {
    const claimedAtMs = claimedAt instanceof Date
        ? claimedAt.getTime()
        : Date.parse(String(claimedAt || ""));

    return Number.isFinite(claimedAtMs) && Date.now() - claimedAtMs < CLAIM_TIMEOUT_MS;
}

function normalizeErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error || "unknown_error");
    return message.slice(0, 500);
}

module.exports = {
    async claimDailyReply(openId, replyDate) {
        const claimToken = crypto.randomUUID();

        return withConnection(async connection => {
            await connection.beginTransaction();

            try {
                const [insertResult] = await connection.query(
                    `INSERT IGNORE INTO wechat_customer_service_reply_log
                        (open_id, reply_date, status, claim_token, attempt_count, claimed_at)
                     VALUES (?, ?, 'sending', ?, 1, CURRENT_TIMESTAMP(3))`,
                    [openId, replyDate, claimToken]
                );

                if (insertResult.affectedRows === 1) {
                    await connection.commit();
                    return { claimed: true, claimToken };
                }

                const [rows] = await connection.query(
                    `SELECT reply_id, status, claim_token, claimed_at
                     FROM wechat_customer_service_reply_log
                     WHERE open_id = ? AND reply_date = ?
                     FOR UPDATE`,
                    [openId, replyDate]
                );
                const row = rows[0];

                if (!row) {
                    throw new Error("wechat_customer_service_claim_missing");
                }

                if (row.status === "sent" || (row.status === "sending" && isClaimFresh(row.claimed_at))) {
                    await connection.commit();
                    return { claimed: false, claimToken: null };
                }

                await connection.query(
                    `UPDATE wechat_customer_service_reply_log
                     SET status = 'sending',
                         claim_token = ?,
                         attempt_count = attempt_count + 1,
                         claimed_at = CURRENT_TIMESTAMP(3),
                         last_error = NULL,
                         updated_at = CURRENT_TIMESTAMP(3)
                     WHERE reply_id = ?`,
                    [claimToken, row.reply_id]
                );

                await connection.commit();
                return { claimed: true, claimToken };
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        });
    },

    async markReplySent(openId, replyDate, claimToken) {
        await db.query(
            `UPDATE wechat_customer_service_reply_log
             SET status = 'sent',
                 sent_at = CURRENT_TIMESTAMP(3),
                 updated_at = CURRENT_TIMESTAMP(3)
             WHERE open_id = ?
               AND reply_date = ?
               AND claim_token = ?
               AND status = 'sending'`,
            [openId, replyDate, claimToken]
        );
    },

    async markReplyFailed(openId, replyDate, claimToken, error) {
        await db.query(
            `UPDATE wechat_customer_service_reply_log
             SET status = 'failed',
                 last_error = ?,
                 updated_at = CURRENT_TIMESTAMP(3)
             WHERE open_id = ?
               AND reply_date = ?
               AND claim_token = ?
               AND status = 'sending'`,
            [normalizeErrorMessage(error), openId, replyDate, claimToken]
        );
    }
};
