import ChatModel from '../Models/ChatModel.js';
import supabase from '../Utils/supabaseClient.js';
// const PDFDocument = require('pdfkit');
import { Readable } from 'stream';
import PDFDocument from 'pdfkit';
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
     * Delete all chats for the user
     */
    async deleteUserChats(req, res) {
        try {
            // Get userId from route params, request user object, or query parameters
            const userId = req.params.id || req.user?.id || req.query.userId;

            // Validate userId
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            // Call the model method to delete all chats for the user
            const result = await ChatModel.deleteUserChats(userId);

            // Return success response with deletion count
            res.json({
                success: true,
                message: 'All chats deleted successfully',
                data: {
                    deletedCount: result.count || 0
                }
            });
        } catch (error) {
            // Log the error and return appropriate error response
            console.error('Error deleting user chats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete chats',
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
     * Export chats for a user (as a PDF with readable format)
     */
    async exportChats(req, res) {
        try {
            const userId = req.query.userId;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing userId in query parameters',
                });
            }

            const chats = await ChatModel.getUserChats(userId);

            if (!chats || chats.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No chats found to export.',
                });
            }

            const doc = new PDFDocument({ margin: 50 });
            const filename = `chats-${userId}.pdf`;

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

            doc.pipe(res);

            doc.fontSize(18).text('User Chats Export', { underline: true });
            doc.moveDown();

            chats.forEach((chat, index) => {
                doc.fontSize(14).text(`Chat #${index + 1}: ${chat.title || 'Untitled'}`, { bold: true });
                doc.fontSize(12).text(`Document: ${chat.documents?.filename || 'N/A'}`);
                doc.text(`Created: ${new Date(chat.created_at).toLocaleString()}`);
                doc.moveDown(0.5);

                if (Array.isArray(chat.messages) && chat.messages.length > 0) {
                    chat.messages.forEach((msg, idx) => {
                        const roleLabel = msg.role === 'user' ? 'User' : 'AI';
                        doc
                            .fontSize(10)
                            .text(`${roleLabel} [${new Date(msg.created_at).toLocaleString()}]:`, {
                                continued: true,
                            })
                            .font('Helvetica-Oblique')
                            .text(` ${msg.content}`);
                        doc.moveDown(0.5);
                    });
                } else {
                    doc.fontSize(10).text('No messages found for this chat.');
                }

                if (index < chats.length - 1) doc.addPage();
            });

            doc.end();
        } catch (error) {
            console.error('Error exporting chats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to export chats',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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