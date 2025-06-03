import StripeModel from '../Models/StripeModel.js';
import supabase from '../Utils/supabaseClient.js';

const StripeController = {
  /**
   * Create a Stripe subscription
   */
  async createSubscription(req, res) {
    try {
      const { userId, email, couponCode, planId } = req.body;

      console.log("Request body:", { userId, email, couponCode, planId });

      // Basic validation
      if (!userId || !email || !planId) {
        return res.status(400).json({
          success: false,
          message: 'User ID, email, and plan ID are required'
        });
      }

      // Call StripeModel with all necessary parameters
      const result = await StripeModel.createSubscription({
        userId,
        email,
        couponCode,
        planId
      });

      console.log("Subscription initialized:", result);

      res.status(200).json({
        success: true,
        message: 'Subscription initialized',
        data: result
      });

    } catch (error) {
      console.error('Create Subscription Error:', error.message || error);

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
      const { customerId, paymentMethodId, couponCode } = req.body;

      if (!customerId || !paymentMethodId) {
        return res.status(400).json({
          success: false,
          message: 'Customer ID and payment method ID are required'
        });
      }

      const result = await StripeModel.createSubscriptionAfterSetup({
        customerId,
        paymentMethodId,
        couponCode
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
   * Create a new plan (Admin only)
   */
  async createPlan(req, res) {
    try {
      const { name, description, price, interval, userId, features } = req.body;

      // Validate required fields
      if (!name || !description || !price || !interval || !userId) {
        return res.status(400).json({
          success: false,
          message: 'All fields are required: name, description, price, interval, userId'
        });
      }

      // Validate price format
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Price must be a valid number greater than 0'
        });
      }

      // Validate interval
      const validIntervals = ['day', 'week', 'month', 'year'];
      if (!validIntervals.includes(interval)) {
        return res.status(400).json({
          success: false,
          message: `Invalid interval. Must be one of: ${validIntervals.join(', ')}`
        });
      }

      // Validate description format (should contain bullet points)
      if (!description.includes('\n') && !description.includes('•') && !description.includes('-')) {
        return res.status(400).json({
          success: false,
          message: 'Description should contain bullet points or features list'
        });
      }

      // Validate features if provided
      const validFeatures = ['pdf', 'txt', 'docx', 'png', 'jpg'];
      if (features) {
        const invalidFeatures = features.filter(f => !validFeatures.includes(f));
        if (invalidFeatures.length > 0) {
          return res.status(400).json({
            success: false,
            message: `Invalid features: ${invalidFeatures.join(', ')}. Valid features are: ${validFeatures.join(', ')}`
          });
        }
      }

      const result = await StripeModel.createPlan({
        name: name.trim(),
        description: description.trim(),
        price: parsedPrice,
        interval,
        userId,
        features: features || []
      });

      console.log("Plan created successfully:", result);

      res.status(201).json({
        success: true,
        message: 'Plan created successfully',
        data: result
      });

    } catch (error) {
      console.error('Create Plan Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create plan',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  /**
   * Get all active plans
   */
  async getActivePlans(req, res) {
    try {
      const plans = await StripeModel.getActivePlans();

      res.status(200).json({
        success: true,
        message: 'Plans retrieved successfully',
        data: plans,
        count: plans.length
      });

    } catch (error) {
      console.error('Get Active Plans Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to retrieve plans',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  /**
   * Update plan status (activate/deactivate)
   */
  async updatePlanStatus(req, res) {
    try {
      const { planId } = req.params;
      const { isActive, userId } = req.body;

      if (!planId) {
        return res.status(400).json({
          success: false,
          message: 'Plan ID is required'
        });
      }

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'isActive must be a boolean value'
        });
      }

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      const result = await StripeModel.updatePlanStatus({
        planId,
        isActive,
        userId
      });

      res.status(200).json({
        success: true,
        message: `Plan ${isActive ? 'activated' : 'deactivated'} successfully`,
        data: result
      });

    } catch (error) {
      console.error('Update Plan Status Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update plan status',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  /**
   * Create a new coupon (Admin only)
   */
  async createCoupon(req, res) {
    try {
      const {
        code,
        name,
        description,
        discountType,
        discountValue,
        maxRedemptions,
        expiresAt,
        userId
      } = req.body;

      // Validate required fields
      if (!code || !name || !discountType || !discountValue || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Code, name, discountType, discountValue, and userId are required'
        });
      }

      // Validate discount type
      const validDiscountTypes = ['percentage', 'fixed'];
      if (!validDiscountTypes.includes(discountType)) {
        return res.status(400).json({
          success: false,
          message: `Invalid discount type. Must be one of: ${validDiscountTypes.join(', ')}`
        });
      }

      // Validate discount value
      const parsedDiscountValue = parseFloat(discountValue);
      if (isNaN(parsedDiscountValue) || parsedDiscountValue <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Discount value must be a valid number greater than 0'
        });
      }

      // Validate percentage range
      if (discountType === 'percentage' && parsedDiscountValue > 100) {
        return res.status(400).json({
          success: false,
          message: 'Percentage discount cannot exceed 100%'
        });
      }

      // Validate max redemptions
      let parsedMaxRedemptions = null;
      if (maxRedemptions) {
        parsedMaxRedemptions = parseInt(maxRedemptions);
        if (isNaN(parsedMaxRedemptions) || parsedMaxRedemptions <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Max redemptions must be a valid number greater than 0'
          });
        }
      }

      // Validate expiry date
      let parsedExpiresAt = null;
      if (expiresAt) {
        parsedExpiresAt = new Date(expiresAt);
        if (isNaN(parsedExpiresAt.getTime()) || parsedExpiresAt <= new Date()) {
          return res.status(400).json({
            success: false,
            message: 'Expiry date must be a valid future date'
          });
        }
      }

      const result = await StripeModel.createCoupon({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description?.trim(),
        discountType,
        discountValue: parsedDiscountValue,
        maxRedemptions: parsedMaxRedemptions,
        expiresAt: parsedExpiresAt,
        userId
      });

      console.log("Coupon created successfully:", result);

      res.status(201).json({
        success: true,
        message: 'Coupon created successfully',
        data: result
      });

    } catch (error) {
      console.error('Create Coupon Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create coupon',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  /**
   * Get all coupons with optional filters
   */
  async getCoupons(req, res) {
    try {
      const { isActive, includeExpired } = req.query;

      const coupons = await StripeModel.getCoupons({
        isActive: isActive === 'true',
        includeExpired: includeExpired === 'true'
      });

      res.status(200).json({
        success: true,
        message: 'Coupons retrieved successfully',
        data: coupons,
        count: coupons.length
      });

    } catch (error) {
      console.error('Get Coupons Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to retrieve coupons',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  async getAllCoupons(req, res) {
    try {
      const coupons = await StripeModel.getAllCoupons();

      res.status(200).json({
        success: true,
        message: 'All coupons retrieved successfully',
        data: coupons,
        count: coupons.length
      });

    } catch (error) {
      console.error('Get All Coupons Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to retrieve all coupons',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  /**
 * Get active coupons only
 */
  async getActiveCoupons(req, res) {
    try {
      const coupons = await StripeModel.getActiveCoupons();

      res.status(200).json({
        success: true,
        message: 'Active coupons retrieved successfully',
        data: coupons,
        count: coupons.length
      });

    } catch (error) {
      console.error('Get Active Coupons Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to retrieve active coupons',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  async getAllSubscriptions(req, res) {
    try {
      const subscriptions = await StripeModel.getAllSubscriptions();

      res.status(200).json({
        success: true,
        message: 'All subscriptions retrieved successfully',
        data: subscriptions,
        count: subscriptions.length
      });

    } catch (error) {
      console.error('Get All subscriptions Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to retrieve all subscriptions',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  // In your Node.js backend (subscription controller)
  async getActiveSubscription(req, res) {
    try {
      const { user_id } = req.query;

      if (!user_id) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      // Get the most recent active subscription
      const { data: subscription, error } = await supabase
        .from('subscriptions')
        .select(`
        *,
        plan:plan_id (*)
      `)
        .eq('user_id', user_id)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;

      if (!subscription) {
        return res.json(null); // No active subscription
      }

      res.json(subscription);
    } catch (error) {
      console.error('Error fetching subscription:', error);
      res.status(500).json({ error: 'Failed to fetch subscription' });
    }
  },


  /**
   * Validate a coupon code
   */
  async validateCoupon(req, res) {
    try {
      const { code } = req.params;

      if (!code) {
        return res.status(400).json({
          success: false,
          message: 'Coupon code is required'
        });
      }

      const coupon = await StripeModel.validateCoupon(code.toUpperCase());

      res.status(200).json({
        success: true,
        message: 'Coupon validated successfully',
        data: coupon
      });

    } catch (error) {
      console.error('Validate Coupon Error:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Invalid coupon code'
      });
    }
  },

  /**
   * Update coupon status (activate/deactivate)
   */
  async updateCouponStatus(req, res) {
    try {
      const { couponId } = req.params;
      const { isActive, userId } = req.body;

      if (!couponId) {
        return res.status(400).json({
          success: false,
          message: 'Coupon ID is required'
        });
      }

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'isActive must be a boolean value'
        });
      }

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      const result = await StripeModel.updateCouponStatus({
        couponId,
        isActive,
        userId
      });

      res.status(200).json({
        success: true,
        message: `Coupon ${isActive ? 'activated' : 'deactivated'} successfully`,
        data: result
      });

    } catch (error) {
      console.error('Update Coupon Status Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update coupon status',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  /**
   * Delete a coupon
   */
  async deleteCoupon(req, res) {
    try {
      const { couponId } = req.params;
      const { userId } = req.body;

      if (!couponId) {
        return res.status(400).json({
          success: false,
          message: 'Coupon ID is required'
        });
      }

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      const result = await StripeModel.deleteCoupon({ couponId, userId });

      res.status(200).json({
        success: true,
        message: 'Coupon deleted successfully',
        data: result
      });

    } catch (error) {
      console.error('Delete Coupon Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to delete coupon',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  },

  /**
   * Get coupon usage statistics
   */
  async getCouponUsage(req, res) {
    try {
      const { couponId } = req.params;

      if (!couponId) {
        return res.status(400).json({
          success: false,
          message: 'Coupon ID is required'
        });
      }

      const usage = await StripeModel.getCouponUsage(couponId);

      res.status(200).json({
        success: true,
        message: 'Coupon usage retrieved successfully',
        data: usage
      });

    } catch (error) {
      console.error('Get Coupon Usage Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to retrieve coupon usage',
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