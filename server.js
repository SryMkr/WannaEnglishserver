require('dotenv').config();

const express = require('express');
const cors = require('cors');
const util = require('util');
const path = require('path');
const matchmakingController = require("./controllers/matchmakingController");

const app = express();
const port = Number(process.env.PORT) || 3000;
const requestJsonLimit = process.env.REQUEST_JSON_LIMIT || "256kb";
const enableVerboseRequestLogs =
    process.env.ENABLE_VERBOSE_REQUEST_LOGS === "true" ||
    process.env.NODE_ENV !== "production";

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: requestJsonLimit }));
app.use(express.urlencoded({ extended: true, limit: requestJsonLimit }));

const audioRoot = path.join(__dirname, "audio");
app.use(
    "/audio",
    express.static(audioRoot, {
        fallthrough: false,
        immutable: true,
        maxAge: "30d"
    })
);

function summarizePayload(payload) {
    if (payload == null) {
        return "null";
    }

    const inspected = util.inspect(payload, {
        depth: enableVerboseRequestLogs ? 4 : 2,
        breakLength: 120,
        maxArrayLength: enableVerboseRequestLogs ? 50 : 10
    });

    if (enableVerboseRequestLogs || inspected.length <= 500) {
        return inspected;
    }

    return `${inspected.slice(0, 500)}...<truncated>`;
}

app.use((req, res, next) => {
    const startTime = Date.now();
    const payload = req.method === "GET" ? req.query : req.body;

    console.log(
        `[${new Date().toISOString()}] -> ${req.method} ${req.originalUrl} payload=${summarizePayload(payload)}`
    );

    res.on("finish", () => {
        const duration = Date.now() - startTime;
        console.log(
            `[${new Date().toISOString()}] <- ${req.method} ${req.originalUrl} status=${res.statusCode} duration=${duration}ms`
        );
    });

    next();
});

app.use("/basicUserInfo", require("./routes/basicUserInfo"));

// 绑定问卷路由
app.use('/questionnaire', require('./routes/questionnaire'));
// 用户游戏数据路由
app.use("/userGameData", require("./routes/userGameData"));
// 设备信息路由
app.use("/device", require("./routes/device"));

app.use("/dailySummary", require("./routes/summary"));
app.use("/testSummary", require("./routes/testSummary"));
app.use("/progress", require("./routes/progress"));
app.use("/matchmaking", require("./routes/matchmaking"));
app.use("/ai", require("./routes/ai"));

// 绑定学习会话路由
app.use("/study-session", require("./routes/studySessionRoutes"));
app.use("/action-log", require("./routes/actionLogRoutes"));
// 绑定微信路由
app.use('/weChat', require('./routes/wechatRoutes'));

app.use((err, req, res, next) => {
    console.error(
        `[${new Date().toISOString()}] !! ${req.method} ${req.originalUrl} unhandled error:`,
        err
    );

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({ error: "Internal Server Error" });
});

async function startServer() {
    await matchmakingController.initializeMatchmakingSchema();

    app.listen(port, "0.0.0.0", () => {
        console.log(`Server running at http://0.0.0.0:${port}`);
    });
}

startServer().catch(error => {
    console.error("Server startup failed:", error);
    process.exit(1);
});
