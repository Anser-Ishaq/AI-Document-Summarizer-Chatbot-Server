import StripeModel from '../Models/StripeModel.js';

const StripeController = {
  /**
   * Create a Stripe subscription
   */
  async createSubscription(req, res) {
    try {
      const { userId, email } = req.body;
      console.log("user id and email", userId, email);

      if (!userId || !email) {
        return res.status(400).json({
          success: false,
          message: 'User ID and email are required'
        });
      }

      const result = await StripeModel.createSubscription({ userId, email });
      console.log("subscription result", result);

      res.status(200).json({
        success: true,
        message: 'Subscription initialized',
        data: result
      });
    } catch (error) {
      console.error('Create Subscription Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create subscription',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  /**
   * Create subscription after setup intent
   */
  async createSubscriptionAfterSetup(req, res) {
    try {
      const { customerId, paymentMethodId } = req.body;

      if (!customerId || !paymentMethodId) {
        return res.status(400).json({
          success: false,
          message: 'Customer ID and payment method ID are required'
        });
      }

      const result = await StripeModel.createSubscriptionAfterSetup({ 
        customerId, 
        paymentMethodId 
      });

      res.status(200).json({
        success: true,
        message: 'Subscription created successfully',
        data: result
      });
    } catch (error) {
      console.error('Create Subscription After Setup Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create subscription',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  /**
   * Stripe webhook to handle subscription events
   */
  async handleWebhook(req, res) {
    try {
      await StripeModel.handleWebhook(req, res);
    } catch (error) {
      console.error('Webhook Error:', error);
      res.status(400).send(`Webhook Error: ${error.message}`);
    }
  }
};

export default StripeController;