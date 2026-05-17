const db = require('../config/db');

module.exports = {
    async findByOpenId(openid) {
        const [rows] = await db.query(
            "SELECT user_id, open_id FROM user_profile WHERE open_id = ? LIMIT 1",
            [openid]
        );
        return rows[0] || null;
    },

    async createUser(openid, sessionKey) {
        const [result] = await db.query(
            "INSERT INTO user_profile (open_id, session_key) VALUES (?, ?)",
            [openid, sessionKey]
        );
        return { user_id: result.insertId };
    },

    async upsertWechatUser(openid, sessionKey) {
        const [result] = await db.query(
            `INSERT INTO user_profile (open_id, session_key)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE
                 user_id = LAST_INSERT_ID(user_id),
                 session_key = VALUES(session_key)`,
            [openid, sessionKey]
        );

        return {
            user_id: result.insertId,
            is_new: result.affectedRows === 1
        };
    },

    async updateSessionKey(userId, sessionKey) {
        await db.query(
            "UPDATE user_profile SET session_key = ? WHERE user_id = ?",
            [sessionKey, userId]
        );
    },

    async updateWechatProfile(userId, nickname, avatarUrl) {
        const [result] = await db.query(
            `UPDATE user_profile
             SET wechat_nickname = COALESCE(?, wechat_nickname),
                 avatar_url = COALESCE(?, avatar_url)
             WHERE user_id = ?`,
            [nickname || null, avatarUrl || null, userId]
        );

        return result.affectedRows > 0;
    }
};
