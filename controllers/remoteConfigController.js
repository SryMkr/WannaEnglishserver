const remoteConfigService = require("../services/remoteConfigService");

exports.resolveResourceBadge = async (req, res) => {
    try {
        const result = await remoteConfigService.resolveResourceBadge(req.body || {});
        return res.json(result);
    } catch (err) {
        console.error("remote config resolve error:", err);
        return res.json(remoteConfigService.buildFallbackResponse("server_error"));
    }
};

exports.recordRemoteConfigEvent = async (req, res) => {
    try {
        const result = await remoteConfigService.recordRemoteConfigEvent(req.body || {});
        return res.json(result);
    } catch (err) {
        console.error("remote config event error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};
