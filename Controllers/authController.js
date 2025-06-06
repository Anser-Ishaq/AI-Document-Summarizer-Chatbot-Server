import AuthModel from '../Models/AuthModel.js';

const authController = {
  /**
   * Handle user registration
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async signup(req, res) {
    try {
      // Validate input
      const { email, password, userName, role } = req.body;
      const normalizedRole = role === 'admin' ? 'admin' : 'user';

      if (!email || !password || !userName) {
        return res.status(400).json({
          success: false,
          message: 'All Fields are required'
        });
      }

      // Register the user
      const userData = await AuthModel.signup({
        email,
        password,
        userName,
        role
      });

      res.status(201).json({
        success: true,
        message: 'Registration successful! Please check your email to verify your account.',
        data: {
          user: {
            id: userData.user.id,
            email: userData.user.email,
            userName: userData.user.username
          }
        }
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to register user',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  /**
   * Handle user login
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async login(req, res) {
    try {
      // Validate input
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required'
        });
      }

      // Login the user
      const userData = await AuthModel.login({ email, password });
      console.log("user data from login", userData)

      res.json({
        success: true,
        message: 'User logged in successfully',
        data: {
          user: {
            id: userData.user.id,
            email: userData.user.email,
            username: userData.user.username,
            status: userData.user.status,
            role: userData.user.role
          },
          session: userData.session
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(401).json({
        success: false,
        message: 'Invalid login credentials',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  /**
    * Get user profile by user_id
    */
  async getUserById(req, res) {
    try {
      const { userId } = req.params;

      const userProfile = await AuthModel.getUserById(userId);

      res.status(200).json({
        success: true,
        data: userProfile
      });
    } catch (error) {
      console.error('getUserById error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get user profile'
      });
    }
  },

  /**
 * Get all user profiles
 */
  async getAllUsers(req, res) {
    try {
      const users = await AuthModel.getAllUsers();

      res.status(200).json({
        success: true,
        data: users,
        count: users.length
      });
    } catch (error) {
      console.error('getAllUsers error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get user profiles'
      });
    }
  },

  /**
    * Update username by user_id
    */
  async changeUserNameByUserId(req, res) {
    try {
      const { userId } = req.params;
      const { newUserName } = req.body;

      if (!newUserName) {
        return res.status(400).json({
          success: false,
          message: 'New username is required'
        });
      }

      const updatedProfile = await AuthModel.changeUserNameByUserId(userId, newUserName);

      res.status(200).json({
        success: true,
        message: 'Username updated successfully',
        data: updatedProfile
      });
    } catch (error) {
      console.error('changeUserNameByUserId error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update username'
      });
    }
  },

  /**
   * Handle user logout
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async logout(req, res) {
    try {
      await AuthModel.logout();

      res.json({
        success: true,
        message: 'User logged out successfully'
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to logout',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  /**
  * Delete a user account
  * @param {Object} req - Express request object
  * @param {Object} res - Express response object
  */
  async deleteAccount(req, res) {
    try {
      const userId = req.params.userId;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required',
        });
      }

      await AuthModel.deleteAccount(userId);

      res.status(200).json({
        success: true,
        message: 'User account deleted successfully',
      });
    } catch (error) {
      console.error('Delete account error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to delete user account',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  }
};

export default authController;