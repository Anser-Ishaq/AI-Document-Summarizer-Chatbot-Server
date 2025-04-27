import ChatModel from '../Models/ChatModel.js';
import supabase from '../Utils/supabaseClient.js';

const chatController = {
    /**
     * Create a new chat
     */
    async createChat(req, res) {
        try {
            const userId = req.user?.id || req.body.userId;
            const { documentId, title } = req?.body;

            if (!documentId) {
                return res.status(400).json({
                    success: false,
                    message: 'Document ID is required'
                });
            }

            const chat = await ChatModel.createChat(userId, documentId, title);

            res.status(201).json({
                success: true,
                message: 'Chat created successfully',
                data: chat
            });
        } catch (error) {
            console.error('Error creating chat:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create chat',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    /**
     * Get all chats for the user
     */
    async getUserChats(req, res) {
        try {
            const userId = req.user?.id || req.query.userId;
            const chats = await ChatModel.getUserChats(userId);

            res.json({
                success: true,
                data: chats
            });
        } catch (error) {
            console.error('Error getting user chats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve chats',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    /**
 * Delete a chat by ID
 */
    async deleteChat(req, res) {
        try {
            const chatId = req.params.id;
            const userId = req.user?.id || req.query.userId;

            console.log('Deleting chat with:', { chatId, userId });

            if (!chatId || !userId) {
                return res.status(400).json({ success: false, message: 'Chat ID and User ID are required' });
            }

            const chat = await ChatModel.getChat(chatId, userId);
            if (!chat) {
                return res.status(403).json({ success: false, message: 'Unauthorized or chat not found' });
            }

            const { error } = await supabase
                .from('chats')
                .delete()
                .eq('id', chatId)
                .eq('user_id', userId);

            if (error) throw error;

            res.json({
                success: true,
                message: 'Chat deleted successfully',
                chatId,
            });
        } catch (error) {
            console.error('Error deleting chat:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete chat',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },



    /**
     * Get a specific chat with its messages
     */
    async getChat(req, res) {
        try {
            const userId = req.user?.id || req.query.userId;
            const chat = await ChatModel.getChat(req.params.id, userId);

            if (!chat) {
                return res.status(404).json({
                    success: false,
                    message: 'Chat not found'
                });
            }

            res.json({
                success: true,
                data: chat
            });
        } catch (error) {
            console.error('Error getting chat:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve chat',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    /**
     * Send a message in a chat and get AI response
     */
    async sendMessage(req, res) {
        try {
            const userId = req.user?.id || req.body.userId;
            const { message } = req.body;

            if (!message) {
                return res.status(400).json({
                    success: false,
                    message: 'Message content is required'
                });
            }

            const result = await ChatModel.processMessage(
                req.params.id,
                userId,
                message
            );

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Error sending message:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to process message',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
};

export default chatController;