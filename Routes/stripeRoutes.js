import express from 'express';
import StripeController from '../Controllers/stripeController.js';

const router = express.Router();


router.post('/create-subscription', StripeController.createSubscription);
router.post('/create-subscription-after-setup', StripeController.createSubscriptionAfterSetup);

router.post('/plans', StripeController.createPlan);
router.get('/plans', StripeController.getActivePlans);
router.patch('/plans/:planId/status', StripeController.updatePlanStatus);

router.post('/coupons', StripeController.createCoupon);
// this api expects params in query string
router.get('/coupons', StripeController.getCoupons);
router.get('/coupons/all', StripeController.getAllCoupons);
router.get('/subscriptions/all', StripeController.getAllSubscriptions);
router.get('/coupons/active', StripeController.getActiveCoupons);
router.get('/coupons/validate/:code', StripeController.validateCoupon);
router.patch('/coupons/:couponId/status', StripeController.updateCouponStatus);
router.delete('/coupons/:couponId', StripeController.deleteCoupon);
router.get('/coupons/:couponId/usage', StripeController.getCouponUsage);

// Raw body for Stripe webhook
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  StripeController.handleWebhook
);

export default router;