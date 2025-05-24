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
      const { email, password, userName } = req.body;

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
        userName
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
      console.log("user data from login",userData)

      res.json({
        success: true,
        message: 'User logged in successfully',
        data: {
          user: {
            id: userData.user.id,
            email: userData.user.email,
            username: userData.user.username,
            status: userData.user.status
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