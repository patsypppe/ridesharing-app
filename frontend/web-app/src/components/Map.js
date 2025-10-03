// frontend/web-app/src/components/Map.js
import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default markers in react-leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Custom icons
const createCustomIcon = (color, type) => {
  return new L.Icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 41" width="25" height="41">
        <path fill="${color}" stroke="#fff" stroke-width="2" 
              d="M12.5 0C5.6 0 0 5.6 0 12.5c0 12.5 12.5 28.5 12.5 28.5s12.5-16 12.5-28.5C25 5.6 19.4 0 12.5 0z"/>
        <circle fill="#fff" cx="12.5" cy="12.5" r="6"/>
        <text x="12.5" y="17" text-anchor="middle" font-size="10" fill="${color}">
          ${type === 'pickup' ? 'P' : type === 'dropoff' ? 'D' : type === 'driver' ? 'C' : '?'}
        </text>
      </svg>
    `)}`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });
};

const pickupIcon = createCustomIcon('#22c55e', 'pickup');    // Green
const dropoffIcon = createCustomIcon('#ef4444', 'dropoff');  // Red
const driverIcon = createCustomIcon('#3b82f6', 'driver');    // Blue
const currentLocationIcon = createCustomIcon('#8b5cf6', 'current'); // Purple

// Map click handler component
function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      if (onMapClick) {
        onMapClick(e.latlng);
      }
    },
  });
  return null;
}

// Auto-center map component
function AutoCenter({ center, zoom = 13 }) {
  const map = useMap();
  
  useEffect(() => {
    if (center) {
      map.setView([center.lat, center.lng], zoom);
    }
  }, [center, zoom, map]);

  return null;
}

// Route display component (simplified - would use routing service in production)
function RouteDisplay({ start, end }) {
  const map = useMap();
  const routeRef = useRef(null);

  useEffect(() => {
    if (start && end) {
      // Remove existing route
      if (routeRef.current) {
        map.removeLayer(routeRef.current);
      }

      // Create simple straight line (in production, use routing service)
      const route = L.polyline([
        [start.lat, start.lng],
        [end.lat, end.lng]
      ], {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.7
      }).addTo(map);

      routeRef.current = route;

      // Fit map to show entire route
      const group = new L.FeatureGroup([
        L.marker([start.lat, start.lng]),
        L.marker([end.lat, end.lng])
      ]);
      map.fitBounds(group.getBounds().pad(0.1));
    }

    return () => {
      if (routeRef.current) {
        map.removeLayer(routeRef.current);
      }
    };
  }, [start, end, map]);

  return null;
}

// Main Map component
const RideshareMap = ({ 
  center,
  zoom = 13,
  markers = [],
  pickupLocation,
  dropoffLocation,
  showRoute = false,
  onMapClick,
  onLocationSelect,
  className = "map-container",
  height = "400px"
}) => {
  const [selectedPosition, setSelectedPosition] = useState(null);

  const handleMapClick = (latlng) => {
    if (onMapClick) {
      onMapClick(latlng);
      setSelectedPosition(latlng);
    }
  };

  const handleLocationConfirm = async (latlng) => {
    if (onLocationSelect) {
      // In production, use geocoding service to get address
      const mockAddress = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
      onLocationSelect({
        lat: latlng.lat,
        lng: latlng.lng,
        address: mockAddress
      });
    }
    setSelectedPosition(null);
  };

  return (
    <div className={className} style={{ height }}>
      <MapContainer
        center={center ? [center.lat, center.lng] : [37.7749, -122.4194]} // Default to SF
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        {/* OpenStreetMap tiles - completely free */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />

        {/* Auto center on location changes */}
        {center && <AutoCenter center={center} zoom={zoom} />}

        {/* Map click handler */}
        <MapClickHandler onMapClick={handleMapClick} />

        {/* Route display */}
        {showRoute && pickupLocation && dropoffLocation && (
          <RouteDisplay start={pickupLocation} end={dropoffLocation} />
        )}

        {/* Pickup location marker */}
        {pickupLocation && (
          <Marker position={[pickupLocation.lat, pickupLocation.lng]} icon={pickupIcon}>
            <Popup>
              <div>
                <strong>Pickup Location</strong>
                <br />
                {pickupLocation.address || `${pickupLocation.lat}, ${pickupLocation.lng}`}
              </div>
            </Popup>
          </Marker>
        )}

        {/* Dropoff location marker */}
        {dropoffLocation && (
          <Marker position={[dropoffLocation.lat, dropoffLocation.lng]} icon={dropoffIcon}>
            <Popup>
              <div>
                <strong>Dropoff Location</strong>
                <br />
                {dropoffLocation.address || `${dropoffLocation.lat}, ${dropoffLocation.lng}`}
              </div>
            </Popup>
          </Marker>
        )}

        {/* Current location marker */}
        {center && (
          <Marker position={[center.lat, center.lng]} icon={currentLocationIcon}>
            <Popup>Your current location</Popup>
          </Marker>
        )}

        {/* Other markers (e.g., nearby drivers) */}
        {markers.map((marker, index) => (
          <Marker
            key={marker.id || index}
            position={[marker.lat, marker.lng]}
            icon={marker.icon || driverIcon}
          >
            <Popup>
              <div>
                <strong>{marker.title || 'Marker'}</strong>
                {marker.description && (
                  <>
                    <br />
                    {marker.description}
                  </>
                )}
                {marker.distance && (
                  <>
                    <br />
                    Distance: {marker.distance.toFixed(1)} km
                  </>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Temporary selected position */}
        {selectedPosition && (
          <Marker position={[selectedPosition.lat, selectedPosition.lng]}>
            <Popup>
              <div>
                <strong>Selected Location</strong>
                <br />
                {selectedPosition.lat.toFixed(4)}, {selectedPosition.lng.toFixed(4)}
                <br />
                <button
                  onClick={() => handleLocationConfirm(selectedPosition)}
                  style={{
                    marginTop: '8px',
                    padding: '4px 8px',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Confirm Location
                </button>
                <button
                  onClick={() => setSelectedPosition(null)}
                  style={{
                    marginTop: '8px',
                    marginLeft: '8px',
                    padding: '4px 8px',
                    backgroundColor: '#6b7280',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
};

export default RideshareMap;
