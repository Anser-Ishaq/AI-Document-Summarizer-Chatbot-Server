// Routes/documentRoutes.js
import express from 'express';
import documentController, { upload } from '../Controllers/documentController.js';

const router = express.Router();

// Upload a new document
router.post('/upload', upload.single('pdf'), documentController.uploadDocument);

// Get all documents for the user
router.get('/', documentController.getUserDocuments);

// Get a specific document
router.get('/:id', documentController.getDocument);

export default router;