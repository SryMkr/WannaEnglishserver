const express = require("express");
const router = express.Router();
const controller = require("../controllers/vocabularyContributionController");

router.post("/submit", controller.submitContribution);
router.get("/mine", controller.listMine);
router.get("/review-queue", controller.listReviewQueue);
router.get("/search-word", controller.searchWords);
router.post("/:id/review", controller.reviewContribution);

module.exports = router;
