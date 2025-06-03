import Stripe from 'stripe';
import supabase from '../Utils/supabaseClient.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PRICE_ID = process.env.STRIPE_PRICE_ID;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const StripeModel = {
    async createSubscription({ userId, email, couponCode = null, planId }) {
        try {
            if (!planId) throw new Error('Plan ID is required');

            // Validate plan from Supabase
            const { data: plan, error: planError } = await supabase
                .from('plans')
                .select('id, name, stripe_price_id')
                .eq('id', planId)
                .eq('is_active', true)
                .single();

            if (planError || !plan) {
                throw new Error('Invalid or inactive plan');
            }

            // Validate coupon if provided
            let coupon = null;
            if (couponCode) {
                try {
                    coupon = await stripe.coupons.retrieve(couponCode);
                    console.log('✅ Coupon retrieved from Stripe:', {
                        id: coupon.id,
                        name: coupon.name,
                        percent_off: coupon.percent_off,
                        amount_off: coupon.amount_off,
                        valid: coupon.valid
                    });
                } catch (error) {
                    console.error('❌ Coupon validation failed:', error.message);
                    throw new Error('Invalid coupon code');
                }
            }

            // Create Stripe customer
            const customer = await stripe.customers.create({
                email,
                metadata: { userId, planId }
            });

            // Create SetupIntent
            const setupIntent = await stripe.setupIntents.create({
                customer: customer.id,
                payment_method_types: ['card'],
                usage: 'off_session',
                metadata: {
                    userId,
                    planId,
                    ...(couponCode && { couponCode })
                }
            });

            return {
                clientSecret: setupIntent.client_secret,
                customerId: customer.id,
                type: 'setup_intent',
                planId: plan.id,
                couponValid: !!coupon,
                couponDetails: coupon ? {
                    id: coupon.id,
                    percentOff: coupon.percent_off,
                    amountOff: coupon.amount_off
                } : null
            };
        } catch (error) {
            console.error('createSubscription error:', error);
            throw error;
        }
    },

    async createSubscriptionAfterSetup({ customerId, paymentMethodId, couponCode }) {
        try {
            const customer = await stripe.customers.retrieve(customerId);
            const userId = customer.metadata.userId;
            const planId = customer.metadata.planId;

            if (!planId) throw new Error('Missing planId in customer metadata');

            // Fetch plan
            const { data: plan, error: planError } = await supabase
                .from('plans')
                .select('*')
                .eq('id', planId)
                .single();

            if (planError || !plan) throw new Error('Plan not found');

            const priceId = plan.stripe_price_id;
            console.log('📋 Plan details:', { planId, priceId, planPrice: plan.price });

            // Attach and set default payment method
            await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
            await stripe.customers.update(customerId, {
                invoice_settings: { default_payment_method: paymentMethodId }
            });

            // Create subscription with coupon
            const subscriptionParams = {
                customer: customerId,
                items: [{ price: priceId }],
                default_payment_method: paymentMethodId,
            };

            // Add coupon if provided using the new discounts parameter
            if (couponCode) {
                subscriptionParams.discounts = [{ coupon: couponCode }];
                console.log('🎟️ Adding coupon to subscription:', couponCode);
            }

            console.log('📝 Creating subscription with params:', subscriptionParams);
            const subscription = await stripe.subscriptions.create(subscriptionParams);
            console.log('✅ Subscription created:', {
                id: subscription.id,
                status: subscription.status,
                discount: subscription.discount
            });

            // Retrieve the invoice to get actual charged amount
            const invoice = subscription.latest_invoice && await stripe.invoices.retrieve(subscription.latest_invoice);

            // Debug invoice details
            if (invoice) {
                console.log('🧾 Invoice details:', {
                    id: invoice.id,
                    subtotal: invoice.subtotal,
                    total: invoice.total,
                    discount: invoice.discount,
                    discounts: invoice.discounts,
                    amount_due: invoice.amount_due,
                    amount_paid: invoice.amount_paid
                });
            } else {
                console.log('❌ No invoice found');
            }

            const paymentIntent = invoice?.payment_intent && await stripe.paymentIntents.retrieve(invoice.payment_intent);
            const paymentMethod = paymentIntent?.payment_method && typeof paymentIntent.payment_method === 'string'
                ? await stripe.paymentMethods.retrieve(paymentIntent.payment_method)
                : paymentIntent?.payment_method;

            const card = paymentMethod?.card || {};

            // Calculate amounts correctly
            const originalAmountCents = plan.price * 100; // Original amount in cents
            let finalAmountCents = originalAmountCents; // Default to original amount
            let discountAmountCents = 0;

            if (invoice) {
                // Use the invoice total as the final amount (this is what customer actually pays)
                finalAmountCents = invoice.total;

                // Calculate discount amount - check multiple ways
                if (invoice.discount || (invoice.discounts && invoice.discounts.length > 0)) {
                    discountAmountCents = invoice.subtotal - invoice.total;
                    console.log('💰 Discount calculation:', {
                        subtotal: invoice.subtotal,
                        total: invoice.total,
                        calculatedDiscount: discountAmountCents
                    });
                } else {
                    console.log('⚠️ No discount found on invoice');
                }
            }

            console.log('🧮 Final amount calculation:', {
                originalAmount: originalAmountCents / 100,
                finalAmount: finalAmountCents / 100,
                discountAmount: discountAmountCents / 100,
                couponCode: couponCode
            });

            // Save to subscriptions table with actual charged amount and planId
            const subscriptionData = {
                user_id: userId,
                plan_id: planId, // ✅ Added planId field
                status: subscription.status,
                amount: finalAmountCents, // The discounted amount (what customer actually pays)
                original_amount: originalAmountCents, // Original amount before discount
                stripe_subscription_id: subscription.id,
                stripe_customer_id: customerId,
                payment_method_id: paymentMethod?.id || null,
                card_brand: card.brand || null,
                card_last4: card.last4 || null,
                card_exp_month: card.exp_month || null,
                card_exp_year: card.exp_year || null,
                coupon_code: couponCode || null,
                discount_amount: discountAmountCents || null // Actual discount applied in cents
            };

            console.log('💾 Saving subscription data:', subscriptionData);

            // Insert subscription with planId
            const { data: insertedSubscription, error: insertError } = await supabase
                .from('subscriptions')
                .insert(subscriptionData)
                .select()
                .single();

            if (insertError) {
                console.error('❌ Failed to insert subscription:', insertError);
                throw new Error('Failed to save subscription to database');
            }

            console.log('✅ Subscription saved to database:', insertedSubscription);

            // Update user to pro
            if (subscription.status === 'active' || subscription.status === 'trialing') {
                const { error: updateError } = await supabase
                    .from('profiles')
                    .update({ status: 'pro' })
                    .eq('user_id', userId);

                if (updateError) {
                    console.error('❌ Failed to update user status:', updateError);
                }
            }

            return {
                subscriptionId: subscription.id,
                status: subscription.status,
                customerId: customerId,
                userStatus: 'pro',
                planId, // ✅ Return planId in response
                actualAmount: finalAmountCents / 100, // Return in dollars for frontend
                discountAmount: discountAmountCents / 100, // Return in dollars for frontend
                originalAmount: plan.price
            };
        } catch (error) {
            console.error('createSubscriptionAfterSetup error:', error);
            throw error;
        }
    },
    async createPlan({ name, description, price, interval, userId, features = [] }) {
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

            // Validate features
            const validFeatures = ['pdf', 'txt', 'docx', 'png', 'jpg'];
            const invalidFeatures = features.filter(f => !validFeatures.includes(f));
            if (invalidFeatures.length > 0) {
                throw new Error(`Invalid features: ${invalidFeatures.join(', ')}`);
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

            // Create Stripe product
            const product = await stripe.products.create({
                name: name,
                description: description,
                metadata: {
                    created_by: userId,
                    created_at: new Date().toISOString(),
                    features: features.join(',') // Optional: store features in Stripe metadata
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
                        is_active: true,
                        features: features // Add features array to the plan
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
                features: planData.features || [], // Return features array
                createdAt: planData.created_at
            };

        } catch (error) {
            console.error('Create plan error:', error);
            throw error;
        }
    },

    async updatePlan(planId, { name, description, price, interval, features, is_active }) {
        try {
            // Get the existing plan
            const { data: existingPlan, error: fetchError } = await supabase
                .from('plans')
                .select('*')
                .eq('id', planId)
                .single();

            if (fetchError || !existingPlan) {
                throw new Error('Plan not found');
            }

            // Prepare updates for Stripe
            const stripeUpdates = {};
            const supabaseUpdates = {};
            let newPriceId = existingPlan.stripe_price_id;

            // Update Stripe product if name or description changed
            if (name || description) {
                stripeUpdates.product = await stripe.products.update(existingPlan.stripe_product_id, {
                    name: name || existingPlan.name,
                    description: description || existingPlan.description,
                    metadata: {
                        ...existingPlan.metadata,
                        updated_at: new Date().toISOString(),
                        ...(features && { features: features.join(',') })
                    }
                });
            }

            // Create new Stripe price if price or interval changed
            if (price || interval) {
                const newPrice = await stripe.prices.create({
                    product: existingPlan.stripe_product_id,
                    unit_amount: Math.round((price || existingPlan.price) * 100),
                    currency: 'usd',
                    recurring: {
                        interval: interval || existingPlan.interval
                    },
                    metadata: {
                        created_by: existingPlan.created_by,
                        created_at: new Date().toISOString()
                    }
                });
                newPriceId = newPrice.id;

                // Archive the old price
                await stripe.prices.update(existingPlan.stripe_price_id, {
                    active: false
                });
            }

            // Prepare Supabase updates
            if (name) supabaseUpdates.name = name;
            if (description) supabaseUpdates.description = description;
            if (price) supabaseUpdates.price = price;
            if (interval) supabaseUpdates.interval = interval;
            if (features) supabaseUpdates.features = features;
            if (is_active !== undefined) supabaseUpdates.is_active = is_active;
            if (newPriceId !== existingPlan.stripe_price_id) supabaseUpdates.stripe_price_id = newPriceId;

            // Update plan in Supabase
            const { data: updatedPlan, error: updateError } = await supabase
                .from('plans')
                .update(supabaseUpdates)
                .eq('id', planId)
                .select()
                .single();

            if (updateError) {
                throw new Error(`Failed to update plan in database: ${updateError.message}`);
            }

            return {
                id: updatedPlan.id,
                name: updatedPlan.name,
                description: updatedPlan.description,
                price: updatedPlan.price,
                interval: updatedPlan.interval,
                stripeProductId: updatedPlan.stripe_product_id,
                stripePriceId: updatedPlan.stripe_price_id,
                isActive: updatedPlan.is_active,
                features: updatedPlan.features || [],
                createdAt: updatedPlan.created_at,
                updatedAt: updatedPlan.updated_at
            };

        } catch (error) {
            console.error('Update plan error:', error);
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
                features: plan.features,
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

    async archiveStripePlan(planId) {
        try {
            // Get the existing plan first
            const { data: existingPlan, error } = await supabase
                .from('plans')
                .select('stripe_product_id, stripe_price_id')
                .eq('id', planId)
                .single();

            if (error || !existingPlan) {
                throw new Error('Plan not found in database');
            }

            // Archive the price in Stripe
            await stripe.prices.update(existingPlan.stripe_price_id, {
                active: false
            });

            // Archive the product in Stripe (don't fully delete for record keeping)
            const archivedProduct = await stripe.products.update(
                existingPlan.stripe_product_id,
                { active: false }
            );

            return {
                productId: archivedProduct.id,
                priceId: existingPlan.stripe_price_id,
                status: 'archived'
            };

        } catch (error) {
            console.error('Archive Stripe Plan error:', error);
            throw new Error(`Failed to archive Stripe plan: ${error.message}`);
        }
    },


    async deletePlan(planId) {
        try {
            // First check if there are active subscriptions
            const { data: subscriptions, error: subError } = await supabase
                .from('subscriptions')
                .select('id')
                .eq('plan_id', planId)
                .eq('status', 'active');

            if (subError) throw subError;
            if (subscriptions.length > 0) {
                throw new Error('Cannot delete plan with active subscriptions');
            }

            // Soft delete (update is_active and set deleted_at)
            const { data, error } = await supabase
                .from('plans')
                .update({
                    is_active: false,
                    deleted_at: new Date().toISOString()
                })
                .eq('id', planId)
                .select();

            if (error) throw error;

            return {
                id: planId,
                status: 'deactivated',
                message: 'Plan deactivated (soft delete)'
            };
        } catch (error) {
            console.error('Delete Plan error:', error);
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
     * Get all coupons without any filters
     */
    async getAllCoupons() {
        try {
            const { data, error } = await supabase
                .from('coupons')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                throw new Error(`Failed to fetch all coupons: ${error.message}`);
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
            console.error('Get all coupons error:', error);
            throw error;
        }
    },

    /**
     * Get all subscriptions
     */
    async getAllSubscriptions() {
        try {
            // First get all subscriptions with plans
            const { data: subscriptions, error: subsError } = await supabase
                .from('subscriptions')
                .select(`
                    *,
                    plans (*)
                `)
                .order('created_at', { ascending: false });

            if (subsError) throw new Error(`Failed to fetch subscriptions: ${subsError.message}`);

            // Get all unique user IDs
            const userIds = [...new Set(subscriptions.map(s => s.user_id))];

            // Fetch user emails using the Auth Admin API
            const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers({
                page: 1,
                perPage: 1000, // Adjust based on your needs
            });

            if (usersError) throw new Error(`Failed to fetch users: ${usersError.message}`);

            // Filter to only the users we need and create a map
            const userMap = users
                .filter(user => userIds.includes(user.id))
                .reduce((acc, user) => {
                    acc[user.id] = user.email;
                    return acc;
                }, {});

            // Combine the data
            return subscriptions.map(subs => ({
                id: subs.id,
                userId: subs.user_id,
                userEmail: userMap[subs.user_id] || null,
                status: subs.status,
                customerId: subs.stripe_customer_id,
                amountPaid: subs.amount,
                couponUsed: subs.coupon_code,
                discountAmount: subs.discount_amount,
                originalAmount: subs.original_amount,
                planId: subs.plan_id,
                plan: subs.plans ? {
                    id: subs.plans.id,
                    name: subs.plans.name,
                    price: subs.plans.price,
                    interval: subs.plans.interval,
                } : null
            }));

        } catch (error) {
            console.error('Get all subscriptions error:', error);
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
  * Validate a coupon code (checks your Supabase table)
  */
    async validateCoupon(code) {
        try {
            const { data: coupon, error } = await supabase
                .from('coupons')
                .select('*')
                .eq('code', code.toUpperCase())
                .single();

            if (error || !coupon) throw new Error('Coupon not found');

            if (!coupon.is_active) throw new Error('Coupon is not active');
            if (coupon.expires_at && new Date(coupon.expires_at) < new Date())
                throw new Error('Coupon has expired');
            if (
                coupon.max_redemptions &&
                coupon.current_redemptions >= coupon.max_redemptions
            )
                throw new Error('Coupon has reached maximum redemptions');

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
            console.error('Validate coupon error:', error.message || error);
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