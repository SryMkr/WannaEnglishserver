const axios = require("axios");
const crypto = require("crypto");
const userModel = require("../models/userModel");
const customerServiceModel = require("../models/customerServiceModel");
const studySessionController = require("./studySessionController");
const { formatChinaDate } = require("../services/timeService");

const APPID = process.env.WECHAT_APPID || "wx23d6c390c37981e8";
const SECRET = process.env.WECHAT_SECRET || "3847430c53055e735a82584cd5296550";
const MESSAGE_TOKEN = process.env.WECHAT_MESSAGE_TOKEN || process.env.WECHAT_TOKEN || "";
const H5_HOME_URL = (process.env.H5_HOME_URL || "https://app.lyzlearn.com/").trim();

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

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

function isValidWechatSignature(signature, timestamp, nonce) {
    if (!MESSAGE_TOKEN || !signature || !timestamp || !nonce) {
        return false;
    }

    const expected = crypto
        .createHash("sha1")
        .update([MESSAGE_TOKEN, timestamp, nonce].sort().join(""))
        .digest("hex");

    return expected === signature;
}

function parseXmlValue(xml, tagName) {
    if (typeof xml !== "string" || !tagName) {
        return "";
    }

    const pattern = new RegExp(`<${tagName}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tagName}>`);
    const match = xml.match(pattern);
    return match ? match[1].trim() : "";
}

function isCustomerServiceEntryEvent(message) {
    return message.msgType === "event" && message.event === "user_enter_tempsession";
}

function buildH5HomeUrl(user) {
    if (!user?.user_id) {
        throw new Error("wechat_user_not_found");
    }

    const url = new URL(H5_HOME_URL);
    url.searchParams.set("userID", String(user.user_id));

    return url.toString();
}

async function getWechatAccessToken() {
    const now = Date.now();
    if (cachedAccessToken && cachedAccessTokenExpiresAt - now > 60 * 1000) {
        return cachedAccessToken;
    }

    const url = "https://api.weixin.qq.com/cgi-bin/token";
    const response = await axios.get(url, {
        params: {
            grant_type: "client_credential",
            appid: APPID,
            secret: SECRET
        },
        timeout: 5000
    });

    if (!response.data?.access_token) {
        throw new Error(`wechat_access_token_failed:${JSON.stringify(response.data)}`);
    }

    cachedAccessToken = response.data.access_token;
    cachedAccessTokenExpiresAt = now + Number(response.data.expires_in || 7200) * 1000;
    return cachedAccessToken;
}

async function sendCustomerServiceText(openid) {
    if (!openid) {
        return;
    }

    const user = await userModel.findByOpenId(openid);
    const h5HomeUrl = buildH5HomeUrl(user);
    const accessToken = await getWechatAccessToken();
    const messageUrl = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`;
    const content = [
        "WannaEnglish 玩家中心",
        "",
        "这里可以：",
        "- 填写问卷调查，反馈使用体验和遇到的问题",
        "- 参与词库共享，提交、修改、补充英语词条",
        "",
        "进入下面的链接后，可选择对应功能：",
        h5HomeUrl
    ].join("\n");

    const response = await axios.post(
        messageUrl,
        {
            touser: openid,
            msgtype: "text",
            text: { content }
        },
        { timeout: 5000 }
    );

    if (response.data?.errcode) {
        throw new Error(`wechat_customer_service_send_failed:${JSON.stringify(response.data)}`);
    }
}

async function sendCustomerServiceTextOncePerChinaDay(openid) {
    const replyDate = formatChinaDate();
    const claim = await customerServiceModel.claimDailyReply(openid, replyDate);

    if (!claim.claimed) {
        return { sent: false, skipped: true };
    }

    try {
        await sendCustomerServiceText(openid);
        await customerServiceModel.markReplySent(openid, replyDate, claim.claimToken);
        return { sent: true, skipped: false };
    } catch (error) {
        try {
            await customerServiceModel.markReplyFailed(
                openid,
                replyDate,
                claim.claimToken,
                error
            );
        } catch (recordError) {
            console.error("WeChat customer service failure record error:", recordError);
        }

        throw error;
    }
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
    },

    getBackgroundFetchStudyStats: async (req, res) => {
        const appid = normalizeOptionalString(req.query.appid, 128);
        const code = normalizeOptionalString(req.query.code || req.query.js_code, 512);
        const timestamp = Number(req.query.timestamp);

        if (!appid || appid !== APPID) {
            return res.status(400).json({ error: "invalid_appid" });
        }

        if (!code) {
            return res.status(400).json({ error: "code_missing" });
        }

        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return res.status(400).json({ error: "invalid_timestamp" });
        }

        try {
            const wxRes = await axios.get(
                "https://api.weixin.qq.com/sns/jscode2session",
                {
                    params: {
                        appid: APPID,
                        secret: SECRET,
                        js_code: code,
                        grant_type: "authorization_code"
                    },
                    timeout: 5000
                }
            );

            const { openid, session_key: sessionKey } = wxRes.data || {};
            if (!openid || !sessionKey) {
                console.error("WeChat background fetch code2Session failed:", wxRes.data);
                return res.status(401).json({ error: "wechat_identity_failed" });
            }

            const user = await userModel.upsertWechatUser(openid, sessionKey);
            const stats = await studySessionController.loadStudyStatsOverview(user.user_id);

            return res.json({
                schemaVersion: 1,
                user_id: user.user_id,
                ...stats,
                generatedAt: Date.now()
            });
        } catch (err) {
            console.error("WeChat background fetch study stats error:", err);
            return res.status(500).json({ error: "server_error" });
        }
    },

    verifyCustomerServiceWebhook: (req, res) => {
        const { signature, timestamp, nonce, echostr } = req.query;

        if (!isValidWechatSignature(signature, timestamp, nonce)) {
            return res.status(403).send("invalid signature");
        }

        return res.send(echostr || "");
    },

    handleCustomerServiceMessage: async (req, res) => {
        const { signature, timestamp, nonce } = req.query;
        if (!isValidWechatSignature(signature, timestamp, nonce)) {
            return res.status(403).send("invalid signature");
        }

        const xml = typeof req.body === "string" ? req.body : "";
        const message = {
            toUserName: parseXmlValue(xml, "ToUserName"),
            fromUserName: parseXmlValue(xml, "FromUserName"),
            msgType: parseXmlValue(xml, "MsgType"),
            event: parseXmlValue(xml, "Event"),
            sessionFrom: parseXmlValue(xml, "SessionFrom")
        };

        console.log("WeChat customer service webhook received:", {
            openid: message.fromUserName,
            msgType: message.msgType,
            event: message.event,
            sessionFrom: message.sessionFrom
        });

        res.send("success");

        if (!isCustomerServiceEntryEvent(message)) {
            return;
        }

        try {
            const result = await sendCustomerServiceTextOncePerChinaDay(message.fromUserName);
            console.log("WeChat customer service auto reply handled:", {
                openid: message.fromUserName,
                sessionFrom: message.sessionFrom,
                sent: result.sent,
                skipped: result.skipped
            });
        } catch (err) {
            console.error("WeChat customer service auto reply error:", err);
        }
    }
};
