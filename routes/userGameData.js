const express = require("express");
const router = express.Router();
const controller = require("../controllers/gameDataController");

router.get("/get", controller.getGameData);
router.post("/save", controller.saveGameData);

module.exports = router;
