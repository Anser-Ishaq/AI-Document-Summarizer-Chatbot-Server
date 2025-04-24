// Routes/authRoutes.js
import express from 'express';
import authController from '../Controllers/authController.js';

const router = express.Router();

// Authentication routes
router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/logout', authController.logout);

export default router;