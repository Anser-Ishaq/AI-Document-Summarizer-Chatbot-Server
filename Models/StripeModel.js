import Stripe from 'stripe';
import supabase from '../Utils/supabaseClient.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PRICE_ID = process.env.STRIPE_PRICE_ID;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const StripeModel = {
    /**
     * Create a new Stripe subscription using Setup Intent approach
     */
    async createSubscription({ userId, email }) {
        try {
            // Create customer first
            const customer = await stripe.customers.create({
                email,
                metadata: { userId },
            });

            // Create a Setup Intent to collect payment method
            const setupIntent = await stripe.setupIntents.create({
                customer: customer.id,
                payment_method_types: ['card'],
                usage: 'off_session',
                metadata: {
                    userId,
                    priceId: 'price_1RSEbvRf72IVJJINNES56Sod'
                }
            });

            return {
                clientSecret: setupIntent.client_secret,
                customerId: customer.id,
                type: 'setup_intent'
            };

        } catch (error) {
            console.error('Stripe subscription creation error:', error);
            throw error;
        }
    },

    /**
     * Create subscription after setup intent is confirmed
     */
    async createSubscriptionAfterSetup({ customerId, paymentMethodId }) {
        try {
            // Get customer to retrieve userId
            const customer = await stripe.customers.retrieve(customerId);
            const userId = customer.metadata.userId;

            // Attach payment method to customer
            await stripe.paymentMethods.attach(paymentMethodId, {
                customer: customerId,
            });

            // Set as default payment method
            await stripe.customers.update(customerId, {
                invoice_settings: {
                    default_payment_method: paymentMethodId,
                },
            });

            // Create subscription
            const subscription = await stripe.subscriptions.create({
                customer: customerId,
                items: [
                    { price: 'price_1RSEbvRf72IVJJINNES56Sod' }
                ],
                default_payment_method: paymentMethodId,
            });

            // Update user status to 'pro' immediately after successful subscription creation
            if (subscription.status === 'active' || subscription.status === 'trialing') {
                await supabase
                    .from('profiles')
                    .update({ status: 'pro' })
                    .eq('user_id', userId);

                console.log(`✅ User ${userId} status updated to 'pro' after subscription creation`);
            }

            return {
                subscriptionId: subscription.id,
                status: subscription.status,
                customerId: customerId,
                userStatus: 'pro'
            };

        } catch (error) {
            console.error('Stripe subscription after setup error:', error);
            throw error;
        }
    },

    /**
     * Alternative method: Create subscription after payment method is attached
     */
    async createSubscriptionWithPaymentMethod({ userId, email, paymentMethodId }) {
        try {
            // Create or retrieve customer
            const customer = await stripe.customers.create({
                email,
                metadata: { userId },
                payment_method: paymentMethodId,
                invoice_settings: {
                    default_payment_method: paymentMethodId,
                },
            });

            // Create subscription
            const subscription = await stripe.subscriptions.create({
                customer: customer.id,
                items: [
                    { price: 'price_1RSEbvRf72IVJJINNES56Sod' }
                ],
                expand: ['latest_invoice.payment_intent'],
            });

            return {
                subscriptionId: subscription.id,
                clientSecret: subscription.latest_invoice?.payment_intent?.client_secret,
                status: subscription.status
            };

        } catch (error) {
            console.error('Stripe subscription with payment method error:', error);
            throw error;
        }
    },

    /**
     * Create a new plan with Stripe product and price
     */
    async createPlan({ name, description, price, interval, userId }) {
        try {
            // Validate required fields
            if (!name || !description || !price || !interval || !userId) {
                throw new Error('All fields are required: name, description, price, interval, userId');
            }

            // Validate interval
            const validIntervals = ['day', 'week', 'month', 'year'];
            if (!validIntervals.includes(interval)) {
                throw new Error(`Invalid interval. Must be one of: ${validIntervals.join(', ')}`);
            }

            // Validate price
            if (price <= 0) {
                throw new Error('Price must be greater than 0');
            }

            // Check if user is admin (optional - adjust based on your auth system)
            const { data: userProfile, error: userError } = await supabase
                .from('profiles')
                .select('role')
                .eq('user_id', userId)
                .single();

            if (userError) {
                throw new Error('Failed to verify user permissions');
            }

            // Uncomment this if you have admin role checking
            // if (userProfile.role !== 'admin') {
            //     throw new Error('Only admin users can create plans');
            // }

            // Create Stripe product
            const product = await stripe.products.create({
                name: name,
                description: description,
                metadata: {
                    created_by: userId,
                    created_at: new Date().toISOString()
                }
            });

            // Create Stripe price
            const stripePrice = await stripe.prices.create({
                product: product.id,
                unit_amount: Math.round(price * 100), // Convert to cents
                currency: 'usd', // You can make this configurable
                recurring: {
                    interval: interval
                },
                metadata: {
                    created_by: userId,
                    created_at: new Date().toISOString()
                }
            });

            // Save plan to Supabase
            const { data: planData, error: planError } = await supabase
                .from('plans')
                .insert([
                    {
                        name: name,
                        description: description,
                        price: price,
                        interval: interval,
                        stripe_product_id: product.id,
                        stripe_price_id: stripePrice.id,
                        created_by: userId,
                        is_active: true
                    }
                ])
                .select()
                .single();

            if (planError) {
                // If database save fails, clean up Stripe resources
                try {
                    await stripe.products.update(product.id, { active: false });
                    await stripe.prices.update(stripePrice.id, { active: false });
                } catch (cleanupError) {
                    console.error('Failed to cleanup Stripe resources:', cleanupError);
                }
                throw new Error(`Failed to save plan to database: ${planError.message}`);
            }

            return {
                id: planData.id,
                name: planData.name,
                description: planData.description,
                price: planData.price,
                interval: planData.interval,
                stripeProductId: planData.stripe_product_id,
                stripePriceId: planData.stripe_price_id,
                isActive: planData.is_active,
                createdAt: planData.created_at
            };

        } catch (error) {
            console.error('Create plan error:', error);
            throw error;
        }
    },

    /**
     * Get all active plans
     */
    async getActivePlans() {
        try {
            const { data, error } = await supabase
                .from('plans')
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: false });

            if (error) {
                throw new Error(`Failed to fetch plans: ${error.message}`);
            }

            return data.map(plan => ({
                id: plan.id,
                name: plan.name,
                description: plan.description,
                price: plan.price,
                interval: plan.interval,
                stripeProductId: plan.stripe_product_id,
                stripePriceId: plan.stripe_price_id,
                isActive: plan.is_active,
                createdAt: plan.created_at
            }));

        } catch (error) {
            console.error('Get active plans error:', error);
            throw error;
        }
    },

    /**
     * Update plan status (activate/deactivate)
     */
    async updatePlanStatus({ planId, isActive, userId }) {
        try {
            // Get plan details
            const { data: planData, error: planError } = await supabase
                .from('plans')
                .select('*')
                .eq('id', planId)
                .single();

            if (planError) {
                throw new Error(`Plan not found: ${planError.message}`);
            }

            // Update Stripe product status
            await stripe.products.update(planData.stripe_product_id, {
                active: isActive
            });

            // Update Stripe price status
            await stripe.prices.update(planData.stripe_price_id, {
                active: isActive
            });

            // Update plan in database
            const { data: updatedPlan, error: updateError } = await supabase
                .from('plans')
                .update({ is_active: isActive })
                .eq('id', planId)
                .select()
                .single();

            if (updateError) {
                throw new Error(`Failed to update plan: ${updateError.message}`);
            }

            return {
                id: updatedPlan.id,
                name: updatedPlan.name,
                isActive: updatedPlan.is_active,
                updatedAt: updatedPlan.updated_at
            };

        } catch (error) {
            console.error('Update plan status error:', error);
            throw error;
        }
    },

    /**
     * Handle Stripe webhooks
     */
    async handleWebhook(req, res) {
        try {
            const sig = req.headers['stripe-signature'];
            const event = stripe.webhooks.constructEvent(req.rawBody, sig, WEBHOOK_SECRET);

            switch (event.type) {
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                    await this.handleSubscriptionUpdate(event.data.object);
                    break;

                case 'customer.subscription.deleted':
                    await this.handleSubscriptionCanceled(event.data.object);
                    break;

                case 'invoice.payment_succeeded':
                    await this.handlePaymentSucceeded(event.data.object);
                    break;

                case 'invoice.payment_failed':
                    await this.handlePaymentFailed(event.data.object);
                    break;

                default:
                    console.log(`Unhandled event type: ${event.type}`);
            }

            res.status(200).json({ received: true });

        } catch (error) {
            console.error('Webhook error:', error);
            throw error;
        }
    },

    // Helper methods for webhook handling
    async handleSubscriptionUpdate(subscription) {
        try {
            const customer = await stripe.customers.retrieve(subscription.customer);
            const userId = customer.metadata.userId;

            if (subscription.status === 'active' || subscription.status === 'trialing') {
                await supabase
                    .from('profiles')
                    .update({ status: 'pro' })
                    .eq('user_id', userId);
            }
        } catch (error) {
            console.error('Handle subscription update error:', error);
        }
    },

    async handleSubscriptionCanceled(subscription) {
        try {
            const customer = await stripe.customers.retrieve(subscription.customer);
            const userId = customer.metadata.userId;

            await supabase
                .from('profiles')
                .update({ status: 'free' })
                .eq('user_id', userId);
        } catch (error) {
            console.error('Handle subscription canceled error:', error);
        }
    },

    async handlePaymentSucceeded(invoice) {
        try {
            const customer = await stripe.customers.retrieve(invoice.customer);
            const userId = customer.metadata.userId;

            console.log(`✅ Payment succeeded for user ${userId}`);
        } catch (error) {
            console.error('Handle payment succeeded error:', error);
        }
    },

    async handlePaymentFailed(invoice) {
        try {
            const customer = await stripe.customers.retrieve(invoice.customer);
            const userId = customer.metadata.userId;

            console.log(`❌ Payment failed for user ${userId}`);
        } catch (error) {
            console.error('Handle payment failed error:', error);
        }
    },
    /**
     * Create a new coupon with Stripe integration
     */
    async createCoupon({ code, name, description, discountType, discountValue, maxRedemptions, expiresAt, userId }) {
        try {
            // Check if coupon code already exists
            const { data: existingCoupon } = await supabase
                .from('coupons')
                .select('id')
                .eq('code', code)
                .single();

            if (existingCoupon) {
                throw new Error('Coupon code already exists');
            }

            // Create Stripe coupon
            const stripeCouponData = {
                id: code,
                name: name,
                metadata: {
                    created_by: userId,
                    created_at: new Date().toISOString()
                }
            };

            // Set discount amount based on type
            if (discountType === 'percentage') {
                stripeCouponData.percent_off = discountValue;
            } else {
                stripeCouponData.amount_off = Math.round(discountValue * 100); // Convert to cents
                stripeCouponData.currency = 'usd';
            }

            // Set expiry date if provided
            if (expiresAt) {
                stripeCouponData.redeem_by = Math.floor(expiresAt.getTime() / 1000);
            }

            // Set max redemptions if provided
            if (maxRedemptions) {
                stripeCouponData.max_redemptions = maxRedemptions;
            }

            const stripeCoupon = await stripe.coupons.create(stripeCouponData);

            // Save coupon to database
            const { data: couponData, error: couponError } = await supabase
                .from('coupons')
                .insert([
                    {
                        code: code,
                        name: name,
                        description: description,
                        discount_type: discountType,
                        discount_value: discountValue,
                        max_redemptions: maxRedemptions,
                        expires_at: expiresAt,
                        stripe_coupon_id: stripeCoupon.id,
                        created_by: userId,
                        is_active: true
                    }
                ])
                .select()
                .single();

            if (couponError) {
                // If database save fails, clean up Stripe coupon
                try {
                    await stripe.coupons.del(stripeCoupon.id);
                } catch (cleanupError) {
                    console.error('Failed to cleanup Stripe coupon:', cleanupError);
                }
                throw new Error(`Failed to save coupon to database: ${couponError.message}`);
            }

            return {
                id: couponData.id,
                code: couponData.code,
                name: couponData.name,
                description: couponData.description,
                discountType: couponData.discount_type,
                discountValue: couponData.discount_value,
                maxRedemptions: couponData.max_redemptions,
                currentRedemptions: couponData.current_redemptions,
                expiresAt: couponData.expires_at,
                stripeCouponId: couponData.stripe_coupon_id,
                isActive: couponData.is_active,
                createdAt: couponData.created_at
            };

        } catch (error) {
            console.error('Create coupon error:', error);
            throw error;
        }
    },

    /**
     * Get coupons with optional filters
     */
    async getCoupons({ isActive = null, includeExpired = false } = {}) {
        try {
            let query = supabase
                .from('coupons')
                .select('*')
                .order('created_at', { ascending: false });

            // Filter by active status if specified
            if (isActive !== null) {
                query = query.eq('is_active', isActive);
            }

            // Filter out expired coupons unless specifically requested
            if (!includeExpired) {
                query = query.or('expires_at.is.null,expires_at.gt.' + new Date().toISOString());
            }

            const { data, error } = await query;

            if (error) {
                throw new Error(`Failed to fetch coupons: ${error.message}`);
            }

            return data.map(coupon => ({
                id: coupon.id,
                code: coupon.code,
                name: coupon.name,
                description: coupon.description,
                discountType: coupon.discount_type,
                discountValue: coupon.discount_value,
                maxRedemptions: coupon.max_redemptions,
                currentRedemptions: coupon.current_redemptions,
                expiresAt: coupon.expires_at,
                stripeCouponId: coupon.stripe_coupon_id,
                isActive: coupon.is_active,
                createdAt: coupon.created_at,
                isExpired: coupon.expires_at ? new Date(coupon.expires_at) < new Date() : false
            }));

        } catch (error) {
            console.error('Get coupons error:', error);
            throw error;
        }
    },

    /**
     * Get only active, non-expired coupons
     */
    async getActiveCoupons() {
        try {
            const { data, error } = await supabase
                .from('coupons')
                .select('*')
                .eq('is_active', true)
                .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
                .order('created_at', { ascending: false });

            if (error) {
                throw new Error(`Failed to fetch active coupons: ${error.message}`);
            }

            return data.map(coupon => ({
                id: coupon.id,
                code: coupon.code,
                name: coupon.name,
                description: coupon.description,
                discountType: coupon.discount_type,
                discountValue: coupon.discount_value,
                maxRedemptions: coupon.max_redemptions,
                currentRedemptions: coupon.current_redemptions,
                expiresAt: coupon.expires_at,
                stripeCouponId: coupon.stripe_coupon_id,
                isActive: coupon.is_active,
                createdAt: coupon.created_at
            }));

        } catch (error) {
            console.error('Get active coupons error:', error);
            throw error;
        }
    },

    /**
     * Validate a coupon code
     */
    async validateCoupon(code) {
        try {
            const { data: coupon, error } = await supabase
                .from('coupons')
                .select('*')
                .eq('code', code)
                .single();

            if (error || !coupon) {
                throw new Error('Coupon not found');
            }

            // Check if coupon is active
            if (!coupon.is_active) {
                throw new Error('Coupon is not active');
            }

            // Check if coupon has expired
            if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
                throw new Error('Coupon has expired');
            }

            // Check if coupon has reached max redemptions
            if (coupon.max_redemptions && coupon.current_redemptions >= coupon.max_redemptions) {
                throw new Error('Coupon has reached maximum redemptions');
            }

            return {
                id: coupon.id,
                code: coupon.code,
                name: coupon.name,
                description: coupon.description,
                discountType: coupon.discount_type,
                discountValue: coupon.discount_value,
                maxRedemptions: coupon.max_redemptions,
                currentRedemptions: coupon.current_redemptions,
                expiresAt: coupon.expires_at,
                stripeCouponId: coupon.stripe_coupon_id,
                isActive: coupon.is_active,
                createdAt: coupon.created_at
            };

        } catch (error) {
            console.error('Validate coupon error:', error);
            throw error;
        }
    },

    /**
     * Update coupon status
     */
    async updateCouponStatus({ couponId, isActive, userId }) {
        try {
            // Get coupon details
            const { data: couponData, error: couponError } = await supabase
                .from('coupons')
                .select('*')
                .eq('id', couponId)
                .single();

            if (couponError) {
                throw new Error(`Coupon not found: ${couponError.message}`);
            }

            // Update Stripe coupon status by setting it as deleted (Stripe doesn't allow reactivation)
            if (!isActive) {
                try {
                    await stripe.coupons.del(couponData.stripe_coupon_id);
                } catch (stripeError) {
                    console.warn('Stripe coupon deletion failed:', stripeError.message);
                }
            }

            // Update coupon in database
            const { data: updatedCoupon, error: updateError } = await supabase
                .from('coupons')
                .update({ is_active: isActive })
                .eq('id', couponId)
                .select()
                .single();

            if (updateError) {
                throw new Error(`Failed to update coupon: ${updateError.message}`);
            }

            return {
                id: updatedCoupon.id,
                code: updatedCoupon.code,
                name: updatedCoupon.name,
                isActive: updatedCoupon.is_active,
                updatedAt: updatedCoupon.updated_at
            };

        } catch (error) {
            console.error('Update coupon status error:', error);
            throw error;
        }
    },

    /**
     * Delete a coupon
     */
    async deleteCoupon({ couponId, userId }) {
        try {
            // Get coupon details
            const { data: couponData, error: couponError } = await supabase
                .from('coupons')
                .select('*')
                .eq('id', couponId)
                .single();

            if (couponError) {
                throw new Error(`Coupon not found: ${couponError.message}`);
            }

            // Delete from Stripe
            try {
                await stripe.coupons.del(couponData.stripe_coupon_id);
            } catch (stripeError) {
                console.warn('Stripe coupon deletion failed:', stripeError.message);
            }

            // Delete from database
            const { error: deleteError } = await supabase
                .from('coupons')
                .delete()
                .eq('id', couponId);

            if (deleteError) {
                throw new Error(`Failed to delete coupon: ${deleteError.message}`);
            }

            return {
                id: couponId,
                message: 'Coupon deleted successfully'
            };

        } catch (error) {
            console.error('Delete coupon error:', error);
            throw error;
        }
    },

    /**
     * Record coupon usage
     */
    async recordCouponUsage({ couponId, userId, subscriptionId, discountAmount }) {
        try {
            // Insert usage record
            const { data: usageData, error: usageError } = await supabase
                .from('coupon_usage')
                .insert([
                    {
                        coupon_id: couponId,
                        user_id: userId,
                        subscription_id: subscriptionId,
                        discount_amount: discountAmount
                    }
                ])
                .select()
                .single();

            if (usageError) {
                throw new Error(`Failed to record coupon usage: ${usageError.message}`);
            }

            // Update current redemptions count
            const { error: updateError } = await supabase
                .from('coupons')
                .update({
                    current_redemptions: supabase.raw('current_redemptions + 1')
                })
                .eq('id', couponId);

            if (updateError) {
                console.error('Failed to update redemption count:', updateError);
            }

            return usageData;

        } catch (error) {
            console.error('Record coupon usage error:', error);
            throw error;
        }
    },

    /**
     * Get coupon usage statistics
     */
    async getCouponUsage(couponId) {
        try {
            const { data: usage, error } = await supabase
                .from('coupon_usage')
                .select(`
                    *,
                    coupons (
                        code,
                        name,
                        discount_type,
                        discount_value,
                        max_redemptions,
                        current_redemptions
                    )
                `)
                .eq('coupon_id', couponId)
                .order('used_at', { ascending: false });

            if (error) {
                throw new Error(`Failed to fetch coupon usage: ${error.message}`);
            }

            return {
                couponId,
                totalUsage: usage.length,
                usageHistory: usage.map(u => ({
                    id: u.id,
                    userId: u.user_id,
                    subscriptionId: u.subscription_id,
                    discountAmount: u.discount_amount,
                    usedAt: u.used_at
                })),
                couponDetails: usage.length > 0 ? usage[0].coupons : null
            };

        } catch (error) {
            console.error('Get coupon usage error:', error);
            throw error;
        }
    },

    /**
     * Calculate discount amount based on coupon type
     */
    calculateDiscountAmount(coupon, originalPrice) {
        if (coupon.discountType === 'percentage') {
            return (originalPrice * coupon.discountValue) / 100;
        } else {
            return Math.min(coupon.discountValue, originalPrice);
        }
    },

};

export default StripeModel;