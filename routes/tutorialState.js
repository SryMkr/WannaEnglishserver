const express = require("express");
const router = express.Router();
const controller = require("../controllers/tutorialStateController");

router.get("/", controller.getTutorialState);
router.put("/", controller.saveTutorialState);
router.post("/", controller.saveTutorialState);

module.exports = router;
