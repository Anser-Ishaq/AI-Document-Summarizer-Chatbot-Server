import supabase from '../Utils/supabaseClient.js';
import { OpenAI } from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ChatModel = {
  /**
   * Create a new chat session
   */
  async createChat(userId, documentId, title = 'New Chat') {
    const { data, error } = await supabase
      .from('chats')
      .insert({
        user_id: userId,
        document_id: documentId,
        title
      })
      .select()
      .single();
      
    if (error) throw error;
    return data;
  },

  /**
   * Get chats for a user
   */
  async getUserChats(userId) {
    const { data, error } = await supabase
      .from('chats')
      .select(`
        *,
        documents (filename)
      `)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
      
    if (error) throw error;
    return data;
  },

  /**
   * Get a specific chat with its messages
   */
  async getChat(chatId, userId) {
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select(`
        *,
        documents (id,filename, content)
      `)
      .eq('id', chatId)
      .eq('user_id', userId)
      .single();
      
    if (chatError) throw chatError;
    
    const { data: messages, error: messagesError } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
      
    if (messagesError) throw messagesError;
    
    return { ...chat, messages };
  },

  /**
   * Add a message to a chat
   */
  async addMessage(chatId, role, content) {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        chat_id: chatId,
        role,
        content
      })
      .select()
      .single();
      
    if (error) throw error;
    
    // Update the chat's updated_at timestamp
    await supabase
      .from('chats')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', chatId);
      
    return data;
  },

  /**
   * Process a user message and generate an AI response
   */
  async processMessage(chatId, userId, userMessage) {
    try {
      // 1. Save the user message
      const savedUserMessage = await this.addMessage(chatId, 'user', userMessage);
      
      // 2. Get chat and document information
      const { documents, messages } = await this.getChat(chatId, userId);
      console.log("documents from getchats", documents)
      const documentId = documents?.id;
      
      // 3. Get relevant context from document embeddings
      let context = '';
      if (documentId) {
        context = await this.getRelevantContext(documentId, userMessage);
      }
      console.log("context from document", context)
      
      // 4. Format previous messages for the conversation
      const previousMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      
      // 5. Create a system message with context
      const systemMessage = {
        role: 'system',
        content: `You are a helpful assistant answering questions about a document. 
                  Use the following information from the document to inform your answer:
                  ${context}
                  
                  If the answer cannot be found in the document, say so clearly.`
      };
      
      // 6. Generate AI response
      const completion = await openai.chat.completions.create({
        model: "gpt-4o", // or your preferred model
        messages: [
          systemMessage,
          ...previousMessages,
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7,
      });
      
      const aiResponse = completion.choices[0].message.content;
      
      // 7. Save the AI response
      const savedAiMessage = await this.addMessage(chatId, 'assistant', aiResponse);
      
      return {
        userMessage: savedUserMessage,
        aiMessage: savedAiMessage
      };
    } catch (error) {
      console.error('Error processing message:', error);
      throw error;
    }
  },

  /**
   * Get relevant context from document embeddings based on the user query
   */
  async getRelevantContext(documentId, query) {
    try {
      // 1. Get embedding for the query
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: query,
      });
      
      const queryEmbedding = embeddingResponse.data[0].embedding;
      
      // 2. Find similar document chunks using vector similarity
      const { data, error } = await supabase.rpc('match_document_embeddings', {
        query_embedding: queryEmbedding,
        document_id: documentId,
        match_threshold: 0.7,
        match_count: 5
      });
      
      if (error) throw error;
      
      // 3. Combine relevant chunks into context
      const context = data.map(item => item.content).join('\n\n');
      
      return context;
    } catch (error) {
      console.error('Error getting relevant context:', error);
      return ''; // Return empty context if there's an error
    }
  }
};

export default ChatModel;