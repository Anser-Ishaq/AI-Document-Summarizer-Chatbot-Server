import supabase from '../Utils/supabaseClient.js';

const AuthModel = {
  /**
   * Register a new user
   * @param {Object} userData - User registration data
   * @param {string} userData.email - User email
   * @param {string} userData.password - User password
   * @param {string} userData.userName - User password
   * @returns {Promise} - Promise resolving to registration result
   */
  async signup({ email, password, userName, ...additionalData }) {
    // Register the user with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      userName
    });

    if (authError) throw authError;

    // If we have additional profile data, store it in a profiles table
    if (Object.keys(additionalData).length > 0 && authData.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          user_id: authData.user.id,
          email,
          ...additionalData
        });

      if (profileError) throw profileError;
    }

    return authData;
  },

  /**
   * Log in an existing user
   * @param {Object} credentials - User login credentials
   * @param {string} credentials.email - User email
   * @param {string} credentials.password - User password
   * @returns {Promise} - Promise resolving to login result
   */
  async login({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    return data;
  },

  /**
   * Log out the current user
   * @returns {Promise} - Promise resolving to logout result
   */
  async logout() {
    const { error } = await supabase.auth.signOut();

    if (error) throw error;

    return { success: true };
  },

  /**
  * Delete a user account by ID
  * @param {string} userId - The ID of the user to delete
  * @returns {Promise<void>}
  */
  async deleteAccount(userId) {
    // Step 1: Delete from Supabase Auth (admin operation)
    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(userId);

    if (deleteAuthError) throw deleteAuthError;

    // Step 2: Optionally delete related profile data
    const { error: deleteProfileError } = await supabase
      .from('profiles')
      .delete()
      .eq('user_id', userId);

    if (deleteProfileError) throw deleteProfileError;

    return;
  }
};

export default AuthModel;