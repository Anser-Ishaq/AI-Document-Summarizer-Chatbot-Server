import supabase from '../Utils/supabaseClient.js';

const AuthModel = {
  /**
   * Register a new user
   * @param {Object} userData  
   * @param {string} userData.email  
   * @param {string} userData.password 
   * @param {string} userData.userName  
   * @returns {Promise}  
   */
  async signup({ email, password, userName }) {
    // Register the user with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password
    });

    if (authError) throw authError;

    if (authData.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          user_id: authData.user.id,
          email,
          username: userName,
          status: 'free'
        });

      if (profileError) throw profileError;
    }

    return authData;
  },

  /**
   * Log in an existing user
   * @param {Object} credentials  
   * @param {string} credentials.email  
   * @param {string} credentials.password  
   * @returns {Promise}  
   */
  async login({ email, password }) {
    // Step 1: Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    const user = data.user;
    const session = data.session;

    if (!user) throw new Error('User not found after login.');

    // Step 2: Fetch profile data (username, status)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('username, status')
      .eq('user_id', user.id)
      .single();

    if (profileError) throw profileError;

    // Step 3: Return merged data
    return {
      user: {
        id: user.id,
        email: user.email,
        username: profile.username,
        status: profile.status
      },
      session
    };
  },

  /**
 * Get User Details
 * @param {string} user-id
 * @returns {Promise}
 */
  async getUserById(user_id) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  },

    /**
 * Change Username
 * @param {string} user-id
 * @param {string} newUserName
 * @returns {Promise}
 */
  async changeUserNameByUserId(user_id, newUserName) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ username: newUserName })
      .eq('user_id', user_id)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

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