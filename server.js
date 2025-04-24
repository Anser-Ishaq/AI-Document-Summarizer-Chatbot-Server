import dotenv from 'dotenv';
import express from 'express';
import { testConnection, handleTestConnection } from './Utils/dbCon.js';
import authRoutes from "./Routes/authRoutes.js"
import documentRoutes from "./Routes/documentRoutes.js"
import chatRoutes from "./Routes/chatRoutes.js"
import path from "path"
import cors from "cors"
dotenv.config();
const app = express();
app.use(cors())
app.use(express.json());

// Serve uploaded files statically (if needed)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Sample Route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Server' });
});

// Test connection route
app.get('/test-connection', handleTestConnection);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/chats', chatRoutes);

const PORT = process.env.PORT || 3000;

// Start the server and test the connection
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  // Test the database connection
  await testConnection();
});