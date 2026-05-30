require("dotenv").config();

const db = require("../../config/db");

const days = Math.max(1, Number(process.argv[2]) || 7);

async function main() {
    const [rows] = await db.execute(
        `SELECT
             resource_badge,
             COUNT(*) AS events,
             COUNT(DISTINCT user_id) AS users,
             SUM(event_name = 'remote_config_fetch_success') AS fetch_success,
             SUM(event_name = 'remote_config_fetch_failed') AS fetch_failed,
             SUM(fallback = 1) AS fallback_count,
             ROUND(AVG(duration_ms), 1) AS avg_duration_ms,
             ROUND(MAX(duration_ms), 1) AS max_duration_ms
         FROM remote_config_event
         WHERE created_at >= DATE_SUB(NOW(6), INTERVAL ? DAY)
         GROUP BY resource_badge
         ORDER BY events DESC`,
        [days]
    );

    console.table(rows);
    await db.end();
}

main().catch(async (err) => {
    console.error(err);
    await db.end();
    process.exit(1);
});
