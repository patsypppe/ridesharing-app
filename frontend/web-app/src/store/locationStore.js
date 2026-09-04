// frontend/web-app/src/store/locationStore.js
import { create } from 'zustand';

// Used when the browser denies geolocation or it isn't available, so the map
// and booking flow stay usable instead of sitting empty.
export const FALLBACK_LOCATION = { lat: 37.7749, lng: -122.4194, isFallback: true };

export const useLocationStore = create((set, get) => ({
  currentLocation: null,
  isLocationLoading: false,
  locationPermission: null,
  locationError: null,
  hasRequestedLocation: false,
  watchId: null,

  requestLocationPermission: async () => {
    if (!navigator.geolocation) {
      set({
        locationPermission: 'not_supported',
        locationError: 'Geolocation is not supported by this browser.',
        currentLocation: FALLBACK_LOCATION,
        hasRequestedLocation: true,
      });
      return;
    }

    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      set({ locationPermission: permission.state });

      if (permission.state === 'granted') {
        get().getCurrentLocation();
      }
    } catch (error) {
      // Safari and older browsers don't implement the Permissions API for geolocation.
      console.warn('Permissions API unavailable, asking for position directly.');
      get().getCurrentLocation();
    }
  },

  getCurrentLocation: () => {
    const { isLocationLoading, hasRequestedLocation } = get();

    // Guard against the retry loop that fires when permission is denied:
    // one attempt per session unless explicitly retried.
    if (isLocationLoading || hasRequestedLocation) return;

    if (!navigator.geolocation) {
      set({ currentLocation: FALLBACK_LOCATION, hasRequestedLocation: true });
      return;
    }

    set({ isLocationLoading: true, hasRequestedLocation: true });

    // Some browsers never invoke either callback when the permission prompt is
    // dismissed or blocked by policy, which would leave the UI waiting forever.
    const watchdog = setTimeout(() => {
      if (get().isLocationLoading) {
        set({
          currentLocation: FALLBACK_LOCATION,
          isLocationLoading: false,
          locationError: 'Timed out waiting for your location',
        });
      }
    }, 5000);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(watchdog);
        const { latitude, longitude } = position.coords;
        set({
          currentLocation: { lat: latitude, lng: longitude },
          isLocationLoading: false,
          locationError: null,
        });
      },
      (error) => {
        clearTimeout(watchdog);
        console.warn('Location unavailable, using fallback:', error.message);
        set({
          currentLocation: FALLBACK_LOCATION,
          isLocationLoading: false,
          locationError: error.message,
        });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 }
    );
  },

  // Explicit user-initiated retry — clears the one-attempt guard.
  retryLocation: () => {
    set({ hasRequestedLocation: false, locationError: null });
    get().getCurrentLocation();
  },

  startLocationTracking: () => {
    if (!navigator.geolocation || get().watchId !== null) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        set({ currentLocation: { lat: latitude, lng: longitude } });
      },
      (error) => {
        console.warn('Location tracking error:', error.message);
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
  },
}));
