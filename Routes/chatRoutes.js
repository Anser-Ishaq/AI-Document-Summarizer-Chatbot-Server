// Routes/chatRoutes.js
import express from 'express';
import chatController from '../Controllers/chatController.js';

const router = express.Router();

// Create a new chat
router.post('/', chatController.createChat);

// Get all chats for the user
router.get('/', chatController.getUserChats);

// Delete a specific chat
router.delete("/delete/:id", chatController.deleteChat)

// Get a specific chat with its messages
router.get('/:id', chatController.getChat);

// Send a message in a chat
router.post('/:id/messages', chatController.sendMessage);

export default router;