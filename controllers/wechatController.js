const axios = require("axios");
const userModel = require("../models/userModel");

const APPID = process.env.WECHAT_APPID || "wx23d6c390c37981e8";
const SECRET = process.env.WECHAT_SECRET || "3847430c53055e735a82584cd5296550";

function normalizeOptionalString(value, maxLength) {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

module.exports = {
    login: async (req, res) => {
        const { login_code } = req.body;

        if (!login_code) {
            return res.status(400).json({ error: "login_code missing" });
        }

        if (!APPID || !SECRET) {
            return res.status(500).json({ error: "wechat_config_missing" });
        }

        try {
            // 调用微信 code2Session
            const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${SECRET}&js_code=${login_code}&grant_type=authorization_code`;

            const wxRes = await axios.get(url, { timeout: 5000 });
            const { openid, session_key } = wxRes.data;

            if (!openid) {
                return res.status(400).json(wxRes.data);
            }

            const user = await userModel.upsertWechatUser(openid, session_key);

            // 返回内部 user_id
            res.json({
                user_id: user.user_id,
                is_new: user.is_new
            });

        } catch (err) {
            console.error("WeChat login error:", err);
            res.status(500).json({ error: "server_error" });
        }
    },

    saveProfile: async (req, res) => {
        const userId = Number(req.body.user_id);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ error: "invalid_user_id" });
        }

        const nickname = normalizeOptionalString(req.body.nickname, 64);
        const avatarUrl = normalizeOptionalString(req.body.avatar_url, 512);
        if (!nickname && !avatarUrl) {
            return res.status(400).json({ error: "profile_empty" });
        }

        try {
            const updated = await userModel.updateWechatProfile(userId, nickname, avatarUrl);
            if (!updated) {
                return res.status(404).json({ error: "user_not_found" });
            }

            res.json({ success: true });
        } catch (err) {
            console.error("WeChat profile save error:", err);
            res.status(500).json({ error: "server_error" });
        }
    }
};
