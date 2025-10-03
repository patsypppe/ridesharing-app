// backend/services/notification-service/handler.js
const { createResponse, validateToken, dbPut, dbGet, sns, publishEvent } = require('/opt/utils');
const AWS = require('aws-sdk');
const ses = new AWS.SES({ region: process.env.AWS_REGION });

// Send notification
exports.sendNotification = async (event) => {
  try {
    // This function is triggered by EventBridge events
    const eventDetail = event.detail;
    const eventType = event['detail-type'];

    console.log(`Processing notification for event: ${eventType}`);

    switch (eventType) {
      case 'Ride Requested':
        await handleRideRequestedNotification(eventDetail);
        break;
      case 'Ride Matched':
        await handleRideMatchedNotification(eventDetail);
        break;
      case 'Ride Status Changed':
        await handleRideStatusNotification(eventDetail);
        break;
      case 'Payment Completed':
        await handlePaymentCompletedNotification(eventDetail);
        break;
      case 'Driver Registered':
        await handleDriverRegisteredNotification(eventDetail);
        break;
      default:
        console.log(`Unknown event type: ${eventType}`);
    }

    return createResponse(200, { message: 'Notification processed' });

  } catch (error) {
    console.error('Send notification error:', error);
    return createResponse(500, { error: 'Failed to send notification' });
  }
};

// Handle ride requested notifications
const handleRideRequestedNotification = async (eventDetail) => {
  const { rideId, userId, pickupLocation, estimatedFare } = eventDetail;

  try {
    // Get user details
    const user = await dbGet({
      TableName: process.env.USERS_TABLE,
      Key: { userId }
    });

    if (!user) {
      console.error(`User not found: ${userId}`);
      return;
    }

    // Send confirmation email to rider
    await sendEmail({
      to: user.email,
      subject: 'Ride Request Confirmation',
      template: 'ride_requested',
      data: {
        firstName: user.firstName,
        rideId: rideId.substring(0, 8),
        pickupAddress: pickupLocation.address,
        estimatedFare: `$${estimatedFare.toFixed(2)}`
      }
    });

    // Send SMS notification if phone number available
    if (user.phoneNumber) {
      await sendSMS({
        phoneNumber: user.phoneNumber,
        message: `Your ride has been requested! Pickup: ${pickupLocation.address}. Estimated fare: $${estimatedFare.toFixed(2)}. Ride ID: ${rideId.substring(0, 8)}`
      });
    }

    // Log notification
    await logNotification({
      userId,
      type: 'ride_requested',
      channel: ['email', user.phoneNumber ? 'sms' : null].filter(Boolean),
      status: 'sent',
      eventData: eventDetail
    });

  } catch (error) {
    console.error('Error handling ride requested notification:', error);
  }
};

// Handle ride matched notifications
const handleRideMatchedNotification = async (eventDetail) => {
  const { rideId, driverId, userId } = eventDetail;

  try {
    // Get user and driver details
    const [user, driver] = await Promise.all([
      dbGet({
        TableName: process.env.USERS_TABLE,
        Key: { userId }
      }),
      dbGet({
        TableName: process.env.DRIVERS_TABLE,
        Key: { driverId }
      })
    ]);

    if (!user || !driver) {
      console.error('User or driver not found');
      return;
    }

    // Notify rider about driver match
    await sendEmail({
      to: user.email,
      subject: 'Driver Found - Your Ride is Confirmed!',
      template: 'ride_matched_rider',
      data: {
        firstName: user.firstName,
        rideId: rideId.substring(0, 8),
        driverName: driver.firstName || 'Your driver',
        vehicleInfo: `${driver.vehicleInfo.color} ${driver.vehicleInfo.make} ${driver.vehicleInfo.model}`,
        licensePlate: driver.vehicleInfo.licensePlate,
        driverRating: driver.rating.toFixed(1)
      }
    });

    // Notify driver about ride assignment  
    const driverUser = await dbGet({
      TableName: process.env.USERS_TABLE,
      Key: { userId: driverId }
    });

    if (driverUser) {
      await sendEmail({
        to: driverUser.email,
        subject: 'New Ride Assignment',
        template: 'ride_matched_driver',
        data: {
          firstName: driverUser.firstName,
          rideId: rideId.substring(0, 8),
          passengerName: user.firstName
        }
      });
    }

    // Send SMS notifications
    if (user.phoneNumber) {
      await sendSMS({
        phoneNumber: user.phoneNumber,
        message: `Driver found! ${driver.vehicleInfo.color} ${driver.vehicleInfo.make} (${driver.vehicleInfo.licensePlate}) is on the way. Ride ID: ${rideId.substring(0, 8)}`
      });
    }

  } catch (error) {
    console.error('Error handling ride matched notification:', error);
  }
};

// Handle ride status change notifications
const handleRideStatusNotification = async (eventDetail) => {
  const { rideId, status, userId, driverId } = eventDetail;

  try {
    const statusMessages = {
      'en-route': 'Your driver is on the way to pick you up',
      'arrived': 'Your driver has arrived at the pickup location',
      'in-progress': 'Your ride has started',
      'completed': 'Your ride has been completed',
      'cancelled': 'Your ride has been cancelled'
    };

    const message = statusMessages[status];
    if (!message) return;

    // Get user details
    const user = await dbGet({
      TableName: process.env.USERS_TABLE,
      Key: { userId }
    });

    if (!user) return;

    // Send status update notification
    await sendEmail({
      to: user.email,
      subject: `Ride Update - ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      template: 'ride_status_update',
      data: {
        firstName: user.firstName,
        rideId: rideId.substring(0, 8),
        status: status.replace('-', ' '),
        message
      }
    });

    if (user.phoneNumber) {
      await sendSMS({
        phoneNumber: user.phoneNumber,
        message: `${message}. Ride ID: ${rideId.substring(0, 8)}`
      });
    }

  } catch (error) {
    console.error('Error handling ride status notification:', error);
  }
};

// Handle payment completed notifications
const handlePaymentCompletedNotification = async (eventDetail) => {
  const { paymentId, rideId, userId, amount } = eventDetail;

  try {
    const user = await dbGet({
      TableName: process.env.USERS_TABLE,
      Key: { userId }
    });

    if (!user) return;

    await sendEmail({
      to: user.email,
      subject: 'Payment Receipt - Ride Completed',
      template: 'payment_receipt',
      data: {
        firstName: user.firstName,
        rideId: rideId.substring(0, 8),
        paymentId: paymentId.substring(0, 8),
        amount: `$${amount.toFixed(2)}`,
        date: new Date().toLocaleDateString()
      }
    });

  } catch (error) {
    console.error('Error handling payment notification:', error);
  }
};

// Handle driver registration notifications
const handleDriverRegisteredNotification = async (eventDetail) => {
  const { driverId, userId } = eventDetail;

  try {
    const user = await dbGet({
      TableName: process.env.USERS_TABLE,
      Key: { userId }
    });

    if (!user) return;

    await sendEmail({
      to: user.email,
      subject: 'Driver Registration Received',
      template: 'driver_registration',
      data: {
        firstName: user.firstName,
        driverId: driverId.substring(0, 8)
      }
    });

  } catch (error) {
    console.error('Error handling driver registration notification:', error);
  }
};

// Send email using SES
const sendEmail = async ({ to, subject, template, data }) => {
  try {
    const htmlBody = generateEmailTemplate(template, data);
    const textBody = generateTextTemplate(template, data);

    const params = {
      Source: process.env.FROM_EMAIL,
      Destination: {
        ToAddresses: [to]
      },
      Message: {
        Subject: {
          Data: subject
        },
        Body: {
          Html: {
            Data: htmlBody
          },
          Text: {
            Data: textBody
          }
        }
      }
    };

    const result = await ses.sendEmail(params).promise();
    console.log(`Email sent successfully: ${result.MessageId}`);
    return result;

  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

// Send SMS using SNS
const sendSMS = async ({ phoneNumber, message }) => {
  try {
    const params = {
      PhoneNumber: phoneNumber,
      Message: message,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional'
        }
      }
    };

    const result = await sns.publish(params).promise();
    console.log(`SMS sent successfully: ${result.MessageId}`);
    return result;

  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
};

// Generate email templates
const generateEmailTemplate = (template, data) => {
  const templates = {
    ride_requested: `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #007bff;">Ride Request Confirmed</h2>
            <p>Hi ${data.firstName},</p>
            <p>Your ride has been requested successfully!</p>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Ride ID:</strong> ${data.rideId}</p>
              <p><strong>Pickup Location:</strong> ${data.pickupAddress}</p>
              <p><strong>Estimated Fare:</strong> ${data.estimatedFare}</p>
            </div>
            <p>We're finding a driver for you. You'll receive another notification once a driver accepts your ride.</p>
            <p>Thank you for choosing our rideshare service!</p>
          </div>
        </body>
      </html>
    `,
    ride_matched_rider: `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #28a745;">Driver Found!</h2>
            <p>Hi ${data.firstName},</p>
            <p>Great news! A driver has accepted your ride request.</p>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Ride ID:</strong> ${data.rideId}</p>
              <p><strong>Driver:</strong> ${data.driverName}</p>
              <p><strong>Vehicle:</strong> ${data.vehicleInfo}</p>
              <p><strong>License Plate:</strong> ${data.licensePlate}</p>
              <p><strong>Driver Rating:</strong> ${data.driverRating} ⭐</p>
            </div>
            <p>Your driver is on the way to pick you up. Track your ride in the app!</p>
          </div>
        </body>
      </html>
    `
  };

  return templates[template] || `<p>Template not found: ${template}</p>`;
};

// Generate text templates
const generateTextTemplate = (template, data) => {
  const templates = {
    ride_requested: `
      Hi ${data.firstName},
      
      Your ride has been requested successfully!
      
      Ride ID: ${data.rideId}
      Pickup Location: ${data.pickupAddress}
      Estimated Fare: ${data.estimatedFare}
      
      We're finding a driver for you. You'll receive another notification once a driver accepts your ride.
      
      Thank you for choosing our rideshare service!
    `,
    ride_matched_rider: `
      Hi ${data.firstName},
      
      Great news! A driver has accepted your ride request.
      
      Ride ID: ${data.rideId}
      Driver: ${data.driverName}
      Vehicle: ${data.vehicleInfo}
      License Plate: ${data.licensePlate}
      Driver Rating: ${data.driverRating}
      
      Your driver is on the way to pick you up. Track your ride in the app!
    `
  };

  return templates[template] || `Template not found: ${template}`;
};

// Log notification for audit trail
const logNotification = async (notificationData) => {
  try {
    const notification = {
      notificationId: require('uuid').v4(),
      ...notificationData,
      timestamp: new Date().toISOString()
    };

    await dbPut({
      TableName: process.env.NOTIFICATIONS_TABLE,
      Item: notification
    });

  } catch (error) {
    console.error('Error logging notification:', error);
  }
};
