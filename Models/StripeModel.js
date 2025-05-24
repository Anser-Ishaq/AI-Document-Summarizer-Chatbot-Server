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
     * Handle Stripe webhooks
     */
    async handleWebhook(req, res) {
        try {
            const sig = req.headers['stripe-signature'];
            const event = stripe.webhooks.constructEvent(req.rawBody, sig, WEBHOOK_SECRET);

            switch (event.type) {
                case 'setup_intent.succeeded': {
                    const setupIntent = event.data.object;
                    const { userId, priceId } = setupIntent.metadata;
                    
                    if (userId && priceId) {
                        // Create subscription after setup intent succeeds
                        await this.createSubscriptionAfterSetup({
                            customerId: setupIntent.customer,
                            paymentMethodId: setupIntent.payment_method
                        });
                        
                        // Also update user status immediately since setup succeeded
                        await supabase
                            .from('profiles')
                            .update({ status: 'pro' })
                            .eq('user_id', userId);
                        
                        console.log(`Setup intent succeeded and status updated to pro for user ${userId}`);
                    }
                    break;
                }

                case 'invoice.payment_succeeded': {
                    const invoice = event.data.object;
                    const customer = await stripe.customers.retrieve(invoice.customer);
                    const userId = customer.metadata.userId;

                    await supabase
                        .from('profiles')
                        .update({ status: 'pro' })
                        .eq('user_id', userId);
                    
                    console.log(`Payment succeeded for user ${userId}`);
                    break;
                }

                case 'invoice.payment_failed': {
                    const invoice = event.data.object;
                    const customer = await stripe.customers.retrieve(invoice.customer);
                    const userId = customer.metadata.userId;

                    console.log(`Payment failed for user ${userId}`);
                    // Optionally handle failed payments
                    break;
                }

                case 'customer.subscription.created': {
                    const subscription = event.data.object;
                    const customer = await stripe.customers.retrieve(subscription.customer);
                    const userId = customer.metadata.userId;

                    // Update status to pro when subscription is created
                    if (subscription.status === 'active' || subscription.status === 'trialing') {
                        await supabase
                            .from('profiles')
                            .update({ status: 'pro' })
                            .eq('user_id', userId);
                    }

                    console.log(`Subscription created for user ${userId}, status: ${subscription.status}`);
                    break;
                }

                case 'customer.subscription.updated': {
                    const subscription = event.data.object;
                    const customer = await stripe.customers.retrieve(subscription.customer);
                    const userId = customer.metadata.userId;

                    // Handle subscription status changes
                    if (subscription.status === 'active') {
                        await supabase
                            .from('profiles')
                            .update({ status: 'pro' })
                            .eq('user_id', userId);
                    } else if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
                        await supabase
                            .from('profiles')
                            .update({ status: 'free' })
                            .eq('user_id', userId);
                    }
                    
                    console.log(`Subscription updated for user ${userId}, status: ${subscription.status}`);
                    break;
                }

                case 'customer.subscription.deleted': {
                    const subscription = event.data.object;
                    const customer = await stripe.customers.retrieve(subscription.customer);
                    const userId = customer.metadata.userId;

                    await supabase
                        .from('profiles')
                        .update({ status: 'free' })
                        .eq('user_id', userId);
                    
                    console.log(`Subscription deleted for user ${userId}`);
                    break;
                }

                default:
                    console.log(`Unhandled event type: ${event.type}`);
                    break;
            }

            res.status(200).send();
        } catch (error) {
            console.error('Webhook Error:', error);
            throw error;
        }
    }
};

export default StripeModel;