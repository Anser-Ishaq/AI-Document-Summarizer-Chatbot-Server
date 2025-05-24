import DocumentModel from '../Models/DocumentModel.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'uploads');

        // Create uploads directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// Create multer upload instance
export const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
            'application/pdf',
            'text/plain',
            'application/msword', // .doc
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
        ];

        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF, TXT, DOC, and DOCX files are allowed'));
        }
    }
});

const documentController = {
    /**
     * Upload a new document
     */
    async uploadDocument(req, res) {
        try {
            const userId = req.user?.id || req.body.userId;
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No PDF file uploaded'
                });
            }

            const document = await DocumentModel.uploadDocument(
                userId,
                req.file,
                req.file.originalname,
                req.file.mimetype,
            );

            res.status(201).json({
                success: true,
                message: 'Document uploaded and processed successfully',
                data: document
            });
        } catch (error) {
            console.error('Error in document upload:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to upload document',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    /**
     * Get all documents for the user
     */
    async getUserDocuments(req, res) {
        try {
            const userId = req.user?.id || req.body.userId;
            const documents = await DocumentModel.getUserDocuments(userId);

            res.json({
                success: true,
                data: documents
            });
        } catch (error) {
            console.error('Error getting user documents:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve documents',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    /**
     * Get a specific document
     */
    async getDocument(req, res) {
        try {
            const document = await DocumentModel.getDocument(req.params.id, req.user.id);

            if (!document) {
                return res.status(404).json({
                    success: false,
                    message: 'Document not found'
                });
            }

            res.json({
                success: true,
                data: document
            });
        } catch (error) {
            console.error('Error getting document:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve document',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
};

export default documentController;