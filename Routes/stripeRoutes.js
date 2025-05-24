import express from 'express';
import StripeController from '../Controllers/stripeController.js';

const router = express.Router();

// JSON body for normal routes
router.post('/create-subscription', StripeController.createSubscription);
router.post('/create-subscription-after-setup', StripeController.createSubscriptionAfterSetup);

// Raw body for Stripe webhook
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  StripeController.handleWebhook
);

export default router;