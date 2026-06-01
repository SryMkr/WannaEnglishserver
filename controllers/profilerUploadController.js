const profilerUploadService = require("../services/profilerUploadService");

exports.uploadProfilerData = async (req, res) => {
    try {
        const result = await profilerUploadService.saveProfilerUpload({
            body: req.body,
            headers: req.headers,
            query: req.query,
            ip: req.ip
        });

        return res.json(result);
    } catch (err) {
        console.error("profiler upload error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};
