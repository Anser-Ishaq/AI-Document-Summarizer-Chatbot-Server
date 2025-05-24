// Models/DocumentModel.js
import supabase from '../Utils/supabaseClient.js';
import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { OpenAI } from 'openai';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { TextLoader } from "langchain/document_loaders/fs/text";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DocumentModel = {
  /**
   * Upload a PDF document and process it
   */
  async uploadDocument(userId, file, filename, mimetype) {
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

      if (this.isImageFile(mimetype)) {
        // For images, we'll get a description from OpenAI
        const imageDescription = await this.getImageDescription(file.path);

        // Update the document record with the image description
        const { error: updateError } = await supabase
          .from('documents')
          .update({ content: imageDescription })
          .eq('id', document.id);

        if (updateError) throw updateError;

        // Create embeddings for the image description
        await this.createEmbeddings(document.id, imageDescription);
      } else {
        // Existing text document processing
        const loader = this.getLoaderByMimeType(file.path, mimetype);
        const docs = await loader.load();
        const textContent = docs.map(doc => doc.pageContent).join('\n');

        const { error: updateError } = await supabase
          .from('documents')
          .update({ content: textContent })
          .eq('id', document.id);

        if (updateError) throw updateError;

        await this.createEmbeddings(document.id, textContent);
      }

      return document;
    } catch (error) {
      console.error('Error uploading document:', error);
      throw error;
    }
  },
  /**
   * Check if file is an image
   */
  isImageFile(mimetype) {
    const imageMimeTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    return imageMimeTypes.includes(mimetype);
  },

  /**
   * Get description of an image using OpenAI's Vision API
   */
  async getImageDescription(filePath) {
    try {
      // Read the image file and convert to base64
      const imageBuffer = fs.readFileSync(filePath);
      const base64Image = imageBuffer.toString('base64');

      const response = await openai.chat.completions.create({
        // model: "gpt-4-vision-preview",
        model: "gpt-4.1",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this image in detail, including any text, diagrams, tables, or visual elements. Be as thorough as possible to enable meaningful conversation about the image content."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 1000
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('Error getting image description:', error);
      throw error;
    }
  },

  /**
 * Upload documents of different Formats
 */
  getLoaderByMimeType(filePath, mimetype) {
    console.log("mimie type of files=========", mimetype)
    if (mimetype === 'application/pdf') {
      return new PDFLoader(filePath);
    } else if (mimetype === 'text/plain') {
      return new TextLoader(filePath);
    } else if (
      mimetype === 'application/msword' ||
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return new DocxLoader(filePath);
    } else if (this.isImageFile(mimetype)) {
      throw new Error('Image files should be handled by the image processing flow');
    }
    else {
      throw new Error(`Unsupported file type: ${mimetype}`);
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