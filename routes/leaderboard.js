const express = require("express");
const router = express.Router();
const controller = require("../controllers/leaderboardController");

router.get("/competitive", controller.getCompetitiveLeaderboard);

module.exports = router;
