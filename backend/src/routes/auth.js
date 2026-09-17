const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth");
const authMiddleware = require("../middleware/auth");
const { validateGoogleAuth } = require("../middleware/validation");

// Public routes

// Only Google OAuth endpoints and username check
router.post("/google", validateGoogleAuth, authController.googleLogin);
router.get("/check-username/:username", authController.checkUsername);
router.post("/refresh-token", authController.refreshToken);

// Protected routes
router.post("/logout", authMiddleware, authController.logout);
router.get("/verify", authMiddleware, authController.verifyToken);

module.exports = router;
