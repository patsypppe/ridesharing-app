// frontend/web-app/src/tests/e2e/user-journey.test.js
import { test, expect } from '@playwright/test';

const TEST_EMAIL = 'e2e-test@example.com';
const TEST_PASSWORD = 'TestPassword123!';

test.describe('Rideshare App E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('complete user journey - signup, login, request ride', async ({ page }) => {
    // Step 1: Sign up
    await page.click('text=Sign Up');
    await page.fill('[data-testid=firstName]', 'E2E');
    await page.fill('[data-testid=lastName]', 'Test');
    await page.fill('[data-testid=email]', TEST_EMAIL);
    await page.fill('[data-testid=password]', TEST_PASSWORD);
    await page.fill('[data-testid=confirmPassword]', TEST_PASSWORD);
    await page.click('[data-testid=signupButton]');

    // Wait for confirmation page
    await expect(page.locator('text=Check your email')).toBeVisible();

    // Step 2: Login (skip email verification in test)
    await page.goto('/login');
    await page.fill('[data-testid=email]', TEST_EMAIL);
    await page.fill('[data-testid=password]', TEST_PASSWORD);
    await page.click('[data-testid=loginButton]');

    // Should redirect to dashboard
    await expect(page.locator('text=Welcome')).toBeVisible();

    // Step 3: Request a ride
    await page.click('[data-testid=bookRideButton]');
    
    // Allow location access
    await page.context().grantPermissions(['geolocation']);
    
    // Set pickup location
    await page.waitForSelector('[data-testid=map]');
    await page.click('[data-testid=confirmPickupButton]');

    // Set dropoff location
    await page.click('[data-testid=map]', { position: { x: 300, y: 200 } });
    await page.click('[data-testid=confirmDropoffButton]');

    // Confirm ride details
    await expect(page.locator('text=Estimated Fare')).toBeVisible();
    await page.click('[data-testid=confirmRideButton]');

    // Should show ride tracking
    await expect(page.locator('text=Finding driver')).toBeVisible();
  });

  test('driver registration flow', async ({ page }) => {
    // Login as existing user
    await page.goto('/login');
    await page.fill('[data-testid=email]', TEST_EMAIL);
    await page.fill('[data-testid=password]', TEST_PASSWORD);
    await page.click('[data-testid=loginButton]');

    // Navigate to driver registration
    await page.click('[data-testid=profileButton]');
    await page.click('text=Become a Driver');

    // Fill driver information
    await page.fill('[data-testid=licenseNumber]', 'DL123456789');
    await page.fill('[data-testid=vehicleMake]', 'Toyota');
    await page.fill('[data-testid=vehicleModel]', 'Camry');
    await page.fill('[data-testid=vehicleYear]', '2020');
    await page.fill('[data-testid=licensePlate]', 'TEST123');
    await page.fill('[data-testid=vehicleColor]', 'Blue');
    
    await page.click('[data-testid=registerDriverButton]');

    // Should show success message
    await expect(page.locator('text=Driver registration submitted')).toBeVisible();
  });

  test('responsive design on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/login');
    
    // Check mobile-friendly layout
    await expect(page.locator('[data-testid=mobileNav]')).toBeVisible();
    
    // Test mobile navigation
    await page.fill('[data-testid=email]', TEST_EMAIL);
    await page.fill('[data-testid=password]', TEST_PASSWORD);
    await page.click('[data-testid=loginButton]');

    // Test mobile map interaction
    await page.click('[data-testid=bookRideButton]');
    await expect(page.locator('[data-testid=map]')).toBeVisible();
    
    // Map should be touch-friendly
    await page.tap('[data-testid=map]');
  });

  test('offline functionality', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid=email]', TEST_EMAIL);
    await page.fill('[data-testid=password]', TEST_PASSWORD);
    await page.click('[data-testid=loginButton]');

    // Go offline
    await page.context().setOffline(true);

    // Should show offline indicator
    await expect(page.locator('[data-testid=offlineIndicator]')).toBeVisible();

    // Should still show cached content
    await expect(page.locator('text=Dashboard')).toBeVisible();

    // Should queue actions when offline
    await page.click('[data-testid=bookRideButton]');
    await expect(page.locator('text=You are offline')).toBeVisible();
  });
});
