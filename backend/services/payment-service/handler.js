// backend/services/payment-service/handler.js
const { createResponse, validateToken, dbGet, dbPut, dbQuery, publishEvent } = require('/opt/utils');
const { v4: uuidv4 } = require('uuid');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Calculate ride fare
exports.calculateFare = async (event) => {
  try {
    const { rideId } = event.pathParameters;
    
    // Get ride details
    const ride = await dbGet({
      TableName: process.env.RIDES_TABLE,
      Key: { rideId }
    });

    if (!ride) {
      return createResponse(404, { error: 'Ride not found' });
    }

    // Fare calculation logic
    const baseFare = 2.50;
    const perKmRates = {
      'standard': 1.20,
      'premium': 2.00,
      'pool': 0.80
    };

    // Time-based surge pricing (simplified)
    const currentHour = new Date().getHours();
    const surgeMultiplier = (currentHour >= 17 && currentHour <= 20) || 
                           (currentHour >= 7 && currentHour <= 9) ? 1.5 : 1.0;

    const distance = ride.estimatedDistance || 0;
    const baseAmount = baseFare + (distance * perKmRates[ride.rideType]);
    const surgeAmount = baseAmount * surgeMultiplier;
    
    // Add platform fee (5%)
    const platformFee = surgeAmount * 0.05;
    const totalFare = surgeAmount + platformFee;

    // Tax calculation (simplified - would vary by location)
    const taxRate = 0.0875; // 8.75%
    const taxAmount = totalFare * taxRate;
    const finalAmount = totalFare + taxAmount;

    const fareBreakdown = {
      baseFare,
      distanceFare: distance * perKmRates[ride.rideType],
      surgeMultiplier,
      surgeAmount: surgeAmount - baseAmount,
      platformFee,
      taxAmount,
      totalAmount: parseFloat(finalAmount.toFixed(2))
    };

    return createResponse(200, { fareBreakdown });

  } catch (error) {
    console.error('Calculate fare error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Process payment (Stripe integration)
exports.processPayment = async (event) => {
  try {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    const decodedToken = validateToken(token);
    const userId = decodedToken.sub;

    const body = JSON.parse(event.body);
    const { rideId, paymentMethodId, savePaymentMethod = false } = body;

    // Get ride details
    const ride = await dbGet({
      TableName: process.env.RIDES_TABLE,
      Key: { rideId }
    });

    if (!ride) {
      return createResponse(404, { error: 'Ride not found' });
    }

    // Verify user owns this ride
    if (ride.userId !== userId) {
      return createResponse(403, { error: 'Unauthorized' });
    }

    if (ride.status !== 'completed') {
      return createResponse(400, { error: 'Ride must be completed before payment' });
    }

    // Check if payment already processed
    const existingPayment = await dbQuery({
      TableName: process.env.PAYMENTS_TABLE,
      IndexName: 'RidePaymentIndex',
      KeyConditionExpression: 'rideId = :rideId',
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':rideId': rideId,
        ':status': 'completed'
      }
    });

    if (existingPayment.Items && existingPayment.Items.length > 0) {
      return createResponse(409, { error: 'Payment already processed for this ride' });
    }

    // Calculate final fare
    const fareResponse = await exports.calculateFare({ pathParameters: { rideId } });
    const fareData = JSON.parse(fareResponse.body);
    const amount = Math.round(fareData.fareBreakdown.totalAmount * 100); // Convert to cents

    // Create payment record
    const paymentId = uuidv4();
    const payment = {
      paymentId,
      rideId,
      userId,
      amount: fareData.fareBreakdown.totalAmount,
      currency: 'usd',
      status: 'processing',
      paymentMethodId,
      fareBreakdown: fareData.fareBreakdown,
      createdAt: new Date().toISOString(),
      stripePaymentIntentId: null
    };

    await dbPut({
      TableName: process.env.PAYMENTS_TABLE,
      Item: payment
    });

    try {
      // Create Stripe PaymentIntent
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'usd',
        payment_method: paymentMethodId,
        confirmation_method: 'manual',
        confirm: true,
        description: `Rideshare payment for ride ${rideId}`,
        metadata: {
          rideId,
          userId,
          paymentId
        }
      });

      // Update payment record with Stripe details
      await dbUpdate({
        TableName: process.env.PAYMENTS_TABLE,
        Key: { paymentId },
        UpdateExpression: 'SET stripePaymentIntentId = :intentId, #status = :status, processedAt = :processedAt',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':intentId': paymentIntent.id,
          ':status': paymentIntent.status === 'succeeded' ? 'completed' : 'failed',
          ':processedAt': new Date().toISOString()
        }
      });

      if (paymentIntent.status === 'succeeded') {
        // Payment successful - publish event
        await publishEvent('Payment Completed', {
          paymentId,
          rideId,
          userId,
          amount: fareData.fareBreakdown.totalAmount
        });

        return createResponse(200, { 
          message: 'Payment processed successfully',
          paymentId,
          status: 'completed',
          amount: fareData.fareBreakdown.totalAmount
        });
      } else {
        return createResponse(400, { 
          error: 'Payment failed',
          status: paymentIntent.status 
        });
      }

    } catch (stripeError) {
      console.error('Stripe payment error:', stripeError);
      
      // Update payment status to failed
      await dbUpdate({
        TableName: process.env.PAYMENTS_TABLE,
        Key: { paymentId },
        UpdateExpression: 'SET #status = :status, errorMessage = :error, processedAt = :processedAt',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'failed',
          ':error': stripeError.message,
          ':processedAt': new Date().toISOString()
        }
      });

      return createResponse(400, { 
        error: 'Payment processing failed',
        details: stripeError.message 
      });
    }

  } catch (error) {
    console.error('Process payment error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Get payment history
exports.getPaymentHistory = async (event) => {
  try {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    const decodedToken = validateToken(token);
    const userId = decodedToken.sub;

    const { limit = 20, startKey } = event.queryStringParameters || {};

    const queryParams = {
      TableName: process.env.PAYMENTS_TABLE,
      IndexName: 'UserPaymentsIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      Limit: parseInt(limit),
      ScanIndexForward: false // Most recent first
    };

    if (startKey) {
      queryParams.ExclusiveStartKey = JSON.parse(decodeURIComponent(startKey));
    }

    const result = await dbQuery(queryParams);

    // Mask sensitive payment information
    const payments = result.Items.map(payment => ({
      ...payment,
      paymentMethodId: payment.paymentMethodId ? '**** **** **** ' + payment.paymentMethodId.slice(-4) : null
    }));

    return createResponse(200, { 
      payments,
      lastEvaluatedKey: result.LastEvaluatedKey ? 
        encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
    });

  } catch (error) {
    console.error('Get payment history error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Handle Stripe webhooks
exports.stripeWebhook = async (event) => {
  try {
    const sig = event.headers['stripe-signature'];
    let stripeEvent;

    try {
      stripeEvent = stripe.webhooks.constructEvent(
        event.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return createResponse(400, { error: 'Webhook signature verification failed' });
    }

    // Handle the event
    switch (stripeEvent.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(stripeEvent.data.object);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentFailed(stripeEvent.data.object);
        break;
      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }

    return createResponse(200, { received: true });

  } catch (error) {
    console.error('Stripe webhook error:', error);
    return createResponse(500, { error: 'Webhook processing failed' });
  }
};

// Handle successful payment
const handlePaymentSucceeded = async (paymentIntent) => {
  const { paymentId, rideId, userId } = paymentIntent.metadata;

  try {
    // Update payment status
    await dbUpdate({
      TableName: process.env.PAYMENTS_TABLE,
      Key: { paymentId },
      UpdateExpression: 'SET #status = :status, completedAt = :completedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'completed',
        ':completedAt': new Date().toISOString()
      }
    });

    // Publish payment completed event
    await publishEvent('Payment Completed', {
      paymentId,
      rideId,
      userId,
      amount: paymentIntent.amount / 100 // Convert back to dollars
    });

  } catch (error) {
    console.error('Error handling payment succeeded:', error);
  }
};

// Handle failed payment
const handlePaymentFailed = async (paymentIntent) => {
  const { paymentId, rideId, userId } = paymentIntent.metadata;

  try {
    // Update payment status
    await dbUpdate({
      TableName: process.env.PAYMENTS_TABLE,
      Key: { paymentId },
      UpdateExpression: 'SET #status = :status, errorMessage = :error, failedAt = :failedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'failed',
        ':error': paymentIntent.last_payment_error?.message || 'Payment failed',
        ':failedAt': new Date().toISOString()
      }
    });

    // Publish payment failed event
    await publishEvent('Payment Failed', {
      paymentId,
      rideId,
      userId,
      error: paymentIntent.last_payment_error?.message || 'Payment failed'
    });

  } catch (error) {
    console.error('Error handling payment failed:', error);
  }
};
