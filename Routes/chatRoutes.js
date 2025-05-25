import express from 'express';
import chatController from '../Controllers/chatController.js';

const router = express.Router();

// Create a new chat
router.post('/', chatController.createChat);

// Get all chats for the user
router.get('/', chatController.getUserChats);

// Delete a specific chat
router.delete("/delete/:id", chatController.deleteChat)

// Delete all chats for the user
router.delete("/delete/allchats/:id", chatController.deleteUserChats)

// export all chats
router.get("/export/allchats", chatController.exportChats)

// Get a specific chat with its messages
router.get('/:id', chatController.getChat);

// Send a message in a chat
router.post('/:id/messages', chatController.sendMessage);

export default router;