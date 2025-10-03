// frontend/web-app/src/pages/RideBookingPage.js
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocationStore } from '../store/locationStore';
import RideshareMap from '../components/Map';
import apiService from '../services/apiService';

const RideBookingPage = () => {
  const navigate = useNavigate();
  const { currentLocation, getCurrentLocation, isLocationLoading } = useLocationStore();
  
  const [pickupLocation, setPickupLocation] = useState(null);
  const [dropoffLocation, setDropoffLocation] = useState(null);
  const [rideType, setRideType] = useState('standard');
  const [estimatedFare, setEstimatedFare] = useState(null);
  const [nearbyDrivers, setNearbyDrivers] = useState([]);
  const [isBooking, setIsBooking] = useState(false);
  const [bookingStep, setBookingStep] = useState('pickup'); // pickup, dropoff, confirm, booking

  useEffect(() => {
    if (!currentLocation && !isLocationLoading) {
      getCurrentLocation();
    }
  }, [currentLocation, isLocationLoading, getCurrentLocation]);

  useEffect(() => {
    if (currentLocation && !pickupLocation) {
      setPickupLocation({
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        address: 'Current Location'
      });
    }
  }, [currentLocation, pickupLocation]);

  useEffect(() => {
    if (pickupLocation && dropoffLocation) {
      calculateEstimatedFare();
      loadNearbyDrivers();
    }
  }, [pickupLocation, dropoffLocation, rideType]);

  const calculateEstimatedFare = () => {
    if (!pickupLocation || !dropoffLocation) return;

    // Simple distance calculation (would use proper routing in production)
    const distance = calculateDistance(
      pickupLocation.lat, pickupLocation.lng,
      dropoffLocation.lat, dropoffLocation.lng
    );

    const baseFare = 2.50;
    const perKmRate = {
      'standard': 1.20,
      'premium': 2.00,
      'pool': 0.80
    };

    const fare = baseFare + (distance * perKmRate[rideType]);
    setEstimatedFare(fare);
  };

  const loadNearbyDrivers = async () => {
    if (!pickupLocation) return;

    try {
      const response = await apiService.getNearbyDrivers(
        pickupLocation.lat, 
        pickupLocation.lng, 
        10
      );
      setNearbyDrivers(response.drivers || []);
    } catch (error) {
      console.error('Error loading nearby drivers:', error);
    }
  };

  const handleMapClick = (latlng) => {
    if (bookingStep === 'pickup') {
      setPickupLocation({
        lat: latlng.lat,
        lng: latlng.lng,
        address: `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`
      });
    } else if (bookingStep === 'dropoff') {
      setDropoffLocation({
        lat: latlng.lat,
        lng: latlng.lng,
        address: `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`
      });
    }
  };

  const handleConfirmRide = async () => {
    if (!pickupLocation || !dropoffLocation) return;

    setIsBooking(true);
    try {
      const rideData = {
        pickupLocation,
        dropoffLocation,
        rideType
      };

      const response = await apiService.requestRide(rideData);
      
      // Navigate to ride tracking page
      navigate(`/track-ride/${response.ride.rideId}`);
    } catch (error) {
      console.error('Error booking ride:', error);
      alert('Failed to book ride. Please try again.');
    } finally {
      setIsBooking(false);
    }
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ 
        padding: '16px', 
        backgroundColor: '#f8f9fa', 
        borderBottom: '1px solid #e9ecef' 
      }}>
        <h2>Book a Ride</h2>
        <div style={{ fontSize: '14px', color: '#6c757d' }}>
          Step {bookingStep === 'pickup' ? '1' : bookingStep === 'dropoff' ? '2' : '3'} of 3
        </div>
      </div>

      {/* Map */}
      <div style={{ flex: 1 }}>
        <RideshareMap
          center={currentLocation}
          pickupLocation={pickupLocation}
          dropoffLocation={dropoffLocation}
          markers={nearbyDrivers.map(driver => ({
            id: driver.driverId,
            lat: driver.location.lat,
            lng: driver.location.lng,
            title: `Driver - Rating: ${driver.rating}`,
            description: `${driver.vehicleInfo.make} ${driver.vehicleInfo.model}`,
            distance: driver.distance
          }))}
          showRoute={bookingStep === 'confirm'}
          onMapClick={handleMapClick}
          height="100%"
        />
      </div>

      {/* Bottom Panel */}
      <div style={{ 
        padding: '16px', 
        backgroundColor: 'white', 
        borderTop: '1px solid #e9ecef',
        boxShadow: '0 -2px 10px rgba(0,0,0,0.1)'
      }}>
        {bookingStep === 'pickup' && (
          <div>
            <h4>Select Pickup Location</h4>
            <p>Tap on the map to set your pickup location</p>
            {pickupLocation && (
              <div>
                <p><strong>Pickup:</strong> {pickupLocation.address}</p>
                <button 
                  onClick={() => setBookingStep('dropoff')}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    width: '100%'
                  }}
                >
                  Confirm Pickup Location
                </button>
              </div>
            )}
          </div>
        )}

        {bookingStep === 'dropoff' && (
          <div>
            <h4>Select Dropoff Location</h4>
            <p>Tap on the map to set your destination</p>
            {dropoffLocation && (
              <div>
                <p><strong>Destination:</strong> {dropoffLocation.address}</p>
                <button 
                  onClick={() => setBookingStep('confirm')}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    width: '100%'
                  }}
                >
                  Confirm Destination
                </button>
              </div>
            )}
          </div>
        )}

        {bookingStep === 'confirm' && (
          <div>
            <h4>Confirm Your Ride</h4>
            
            <div style={{ marginBottom: '16px' }}>
              <div><strong>From:</strong> {pickupLocation?.address}</div>
              <div><strong>To:</strong> {dropoffLocation?.address}</div>
            </div>

            {/* Ride Type Selection */}
            <div style={{ marginBottom: '16px' }}>
              <label><strong>Ride Type:</strong></label>
              <select 
                value={rideType} 
                onChange={(e) => setRideType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  marginTop: '4px',
                  borderRadius: '4px',
                  border: '1px solid #ccc'
                }}
              >
                <option value="standard">Standard - $1.20/km</option>
                <option value="premium">Premium - $2.00/km</option>
                <option value="pool">Pool - $0.80/km (Shared)</option>
              </select>
            </div>

            {/* Estimated Fare */}
            {estimatedFare && (
              <div style={{ 
                padding: '12px', 
                backgroundColor: '#f8f9fa', 
                borderRadius: '6px',
                marginBottom: '16px'
              }}>
                <strong>Estimated Fare: ${estimatedFare.toFixed(2)}</strong>
              </div>
            )}

            {/* Available Drivers */}
            {nearbyDrivers.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <strong>Available Drivers: {nearbyDrivers.length}</strong>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={() => setBookingStep('dropoff')}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Back
              </button>
              <button 
                onClick={handleConfirmRide}
                disabled={isBooking || !nearbyDrivers.length}
                style={{
                  flex: 2,
                  padding: '12px',
                  backgroundColor: isBooking || !nearbyDrivers.length ? '#ccc' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: isBooking || !nearbyDrivers.length ? 'not-allowed' : 'pointer'
                }}
              >
                {isBooking ? 'Booking...' : 'Book Ride'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RideBookingPage;
