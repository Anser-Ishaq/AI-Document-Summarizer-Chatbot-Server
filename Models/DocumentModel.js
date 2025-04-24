// Models/DocumentModel.js
import supabase from '../Utils/supabaseClient.js';
import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { OpenAI } from 'openai';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DocumentModel = {
  /**
   * Upload a PDF document and process it
   */
  async uploadDocument(userId, file, filename) {
    try {
      // 1. Store file metadata in database
      const { data: document, error: documentError } = await supabase
        .from('documents')
        .insert({
          user_id: userId,
          filename: filename,
          file_path: file.path,
          file_size: file.size
        })
        .select()
        .single();

      if (documentError) throw documentError;
      
      // 2. Process the PDF to extract text
      const loader = new PDFLoader(file.path);
      const docs = await loader.load();
      const textContent = docs.map(doc => doc.pageContent).join('\n');
      
      // 3. Update the document record with the extracted text
      const { error: updateError } = await supabase
        .from('documents')
        .update({ content: textContent })
        .eq('id', document.id);
        
      if (updateError) throw updateError;
      
      // 4. Create embeddings for the document content
      await this.createEmbeddings(document.id, textContent);

      return document;
    } catch (error) {
      console.error('Error uploading document:', error);
      throw error;
    }
  },

  /**
   * Create embeddings for document text
   */
  async createEmbeddings(documentId, text) {
    try {
      // Split the text into chunks (simple approach)
      const chunks = this.splitTextIntoChunks(text, 1000);
      
      for (const chunk of chunks) {
        // Get embedding from OpenAI
        const embeddingResponse = await openai.embeddings.create({
          model: "text-embedding-ada-002",
          input: chunk,
        });
        
        const [{ embedding }] = embeddingResponse.data;
        
        // Store embedding in the database
        const { error } = await supabase
          .from('document_embeddings')
          .insert({
            document_id: documentId,
            content: chunk,
            embedding
          });
          
        if (error) throw error;
      }
    } catch (error) {
      console.error('Error creating embeddings:', error);
      throw error;
    }
  },

  /**
   * Split text into chunks of roughly equal size
   */
  splitTextIntoChunks(text, chunkSize) {
    const chunks = [];
    let currentChunk = '';
    
    // Simple split by sentences/paragraphs
    const sentences = text.split(/(?<=[.!?])\s+/);
    
    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length <= chunkSize) {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        currentChunk = sentence;
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  },

  /**
   * Get documents for a user
   */
  async getUserDocuments(userId) {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    return data;
  },

  /**
   * Get a specific document
   */
  async getDocument(documentId, userId) {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('user_id', userId)
      .single();
      
    if (error) throw error;
    return data;
  }
};

export default DocumentModel;