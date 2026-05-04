// controllers/deviceController.js

const db = require("../config/db");

function normalizeOptionalText(value) {
    if (value == null) {
        return null;
    }

    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
}

exports.uploadDeviceInfo = async (req, res) => {
    try {
        const {
            user_id,
            device_model,
            device_brand,
            os_version,
            sdk_version,
            latitude,
            longitude
        } = req.body;

        const model = normalizeOptionalText(device_model);
        if (user_id == null || !model) {
            return res.status(400).json({ error: "Missing parameters" });
        }

        const parsedLatitude = latitude == null ? null : Number(latitude);
        const parsedLongitude = longitude == null ? null : Number(longitude);

        if (parsedLatitude != null && (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90)) {
            return res.status(400).json({ error: "Invalid latitude" });
        }

        if (parsedLongitude != null && (!Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180)) {
            return res.status(400).json({ error: "Invalid longitude" });
        }

        await db.execute(
            `INSERT INTO user_device_info 
                (user_id, model, brand, os_version, sdk_version, latitude, longitude)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                brand = VALUES(brand),
                os_version = VALUES(os_version),
                sdk_version = VALUES(sdk_version),
                latitude = VALUES(latitude),
                longitude = VALUES(longitude),
                collected_at = UTC_TIMESTAMP()`,
            [
                user_id,
                model,
                normalizeOptionalText(device_brand),
                normalizeOptionalText(os_version),
                normalizeOptionalText(sdk_version),
                parsedLatitude,
                parsedLongitude
            ]
        );

        return res.json({ success: true });

    } catch (err) {
        console.error("Device upload error:", err);

        if (err.code === "ER_NO_REFERENCED_ROW_2") {
            return res.status(400).json({ error: "Unknown user_id" });
        }

        if (err.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
            return res.status(400).json({ error: "Invalid latitude or longitude" });
        }

        res.status(500).json({ error: "Server Error" });
    }
};
