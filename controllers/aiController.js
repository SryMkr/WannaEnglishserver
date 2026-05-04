const axios = require("axios");

const DEFAULT_MODEL = process.env.QWEN_MODEL || "qwen-plus";
const DEFAULT_ENDPOINT = process.env.QWEN_ENDPOINT || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = Number(process.env.QWEN_TIMEOUT_MS) || 12000;

exports.generateQuestion = async (req, res) => {
    try {
        const apiKey = process.env.QWEN_API_KEY;
        if (!apiKey) {
            return res.status(500).json({
                success: false,
                message: "Qwen API key 未配置"
            });
        }

        const { messages, model } = req.body ?? {};
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                success: false,
                message: "messages 不能为空"
            });
        }

        const response = await axios.post(
            DEFAULT_ENDPOINT,
            {
                model: typeof model === "string" && model.trim() ? model.trim() : DEFAULT_MODEL,
                messages
            },
            {
                timeout: DEFAULT_TIMEOUT_MS,
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const content = response.data?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
            return res.status(502).json({
                success: false,
                message: "题目服务返回为空"
            });
        }

        return res.json({
            success: true,
            content
        });
    } catch (error) {
        const providerStatus = error.response?.status;
        const providerMessage = error.response?.data?.message || error.response?.data?.error || error.message;

        console.error("generateQuestion error:", providerStatus || "NO_STATUS", providerMessage);

        return res.status(providerStatus && providerStatus >= 400 && providerStatus < 600 ? providerStatus : 502).json({
            success: false,
            message: "题目生成失败"
        });
    }
};
