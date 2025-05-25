import dotenv from 'dotenv';
import express from 'express';
import { testConnection, handleTestConnection } from './Utils/dbCon.js';
import authRoutes from "./Routes/authRoutes.js"
import documentRoutes from "./Routes/documentRoutes.js"
import chatRoutes from "./Routes/chatRoutes.js"
import stripeRoutes from "./Routes/stripeRoutes.js"
import path from "path"
import cors from "cors"
dotenv.config();
const app = express();
app.use(cors())
// for stripe webhook
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// multer route for handling files in uploads folder
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Sample Route
app.get('/', (req, res) => {
  res.json({ message: 'Email Confirmed' });
});

// Test connection route
app.get('/test-connection', handleTestConnection);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/stripe', stripeRoutes);

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await testConnection();
});
server.setTimeout(60000);