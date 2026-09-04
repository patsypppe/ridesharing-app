// frontend/web-app/src/store/authStore.js
import { create } from 'zustand';
import auth from '../services/authProvider';

export const useAuthStore = create((set) => ({
  user: null,
  isLoading: true,
  error: null,

  clearError: () => set({ error: null }),

  checkAuthState: async () => {
    try {
      const user = await auth.currentAuthenticatedUser();
      set({ user, isLoading: false });
    } catch (error) {
      set({ user: null, isLoading: false });
    }
  },

  signIn: async (email, password) => {
    try {
      set({ isLoading: true, error: null });
      const user = await auth.signIn(email, password);
      set({ user, isLoading: false });
      return user;
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  signUp: async (email, password, attributes) => {
    try {
      set({ isLoading: true, error: null });
      const result = await auth.signUp({
        username: email,
        password,
        attributes: { email, ...attributes },
      });
      set({ isLoading: false });
      return result;
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  confirmSignUp: async (email, confirmationCode) => {
    try {
      set({ isLoading: true, error: null });
      await auth.confirmSignUp(email, confirmationCode);
      set({ isLoading: false });
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  signOut: async () => {
    try {
      set({ isLoading: true });
      await auth.signOut();
      set({ user: null, isLoading: false });
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  getIdToken: async () => {
    try {
      const session = await auth.currentSession();
      return session.getIdToken().getJwtToken();
    } catch (error) {
      console.error('Error getting token:', error);
      return null;
    }
  },
}));
