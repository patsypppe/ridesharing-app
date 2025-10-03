// frontend/web-app/src/store/locationStore.js
import { create } from 'zustand';

export const useLocationStore = create((set, get) => ({
  currentLocation: null,
  isLocationLoading: false,
  locationPermission: null,
  watchId: null,

  requestLocationPermission: async () => {
    if (!navigator.geolocation) {
      set({ locationPermission: 'not_supported' });
      return;
    }

    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      set({ locationPermission: permission.state });
      
      if (permission.state === 'granted') {
        get().getCurrentLocation();
      }
    } catch (error) {
      console.error('Error checking location permission:', error);
    }
  },

  getCurrentLocation: () => {
    if (!navigator.geolocation) return;

    set({ isLocationLoading: true });

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        set({ 
          currentLocation: { lat: latitude, lng: longitude },
          isLocationLoading: false 
        });
      },
      (error) => {
        console.error('Error getting location:', error);
        set({ isLocationLoading: false });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  },

  startLocationTracking: () => {
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        set({ currentLocation: { lat: latitude, lng: longitude } });
      },
      (error) => {
        console.error('Location tracking error:', error);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
    );

    set({ watchId });
  },

  stopLocationTracking: () => {
    const { watchId } = get();
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      set({ watchId: null });
    }
  }
}));
