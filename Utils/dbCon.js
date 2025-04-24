import supabase from './supabaseClient.js';

// Function to test database connection
export const testConnection = async () => {
  try {
    // Test the Supabase connection using auth API
    const { data, error } = await supabase.auth.getSession();
    
    if (error) {
      console.error('❌ Failed to connect to Supabase:', error.message);
      return { success: false, error: error.message };
    } else {
      console.log('✅ Successfully connected to Supabase database');
      return { success: true };
    }
  } catch (error) {
    console.error('❌ Error testing database connection:', error.message);
    return { success: false, error: error.message };
  }
};

// Function to handle the test connection route
export const handleTestConnection = async (req, res) => {
  try {
    // Test the Supabase connection with auth API
    const { data, error } = await supabase.auth.getSession();
    
    if (error) {
      throw error;
    }
    
    res.json({ 
      success: true, 
      message: 'Connected to Supabase successfully'
    });
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to connect to Supabase',
      error: error.message
    });
  }
};