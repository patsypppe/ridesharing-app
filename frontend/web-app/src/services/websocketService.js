// frontend/web-app/src/services/websocketService.js
class WebSocketService {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.messageHandlers = new Map();
    this.pingInterval = null;
  }

  connect(userId, userType) {
    if (this.ws && this.isConnected) {
      console.log('WebSocket already connected');
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const wsUrl = `${process.env.REACT_APP_WEBSOCKET_URL}?userId=${userId}&userType=${userType}`;
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startPingInterval();
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket disconnected', event);
        this.isConnected = false;
        this.stopPingInterval();
        
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect(userId, userType);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      // Connection timeout
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);
    });
  }

  disconnect() {
    if (this.ws) {
      this.stopPingInterval();
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
      this.isConnected = false;
    }
  }

  sendMessage(action, data) {
    if (!this.isConnected || !this.ws) {
      console.error('WebSocket not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify({ action, data }));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }

  // Send location update
  sendLocationUpdate(userId, location, rideId) {
    return this.sendMessage('location_update', {
      userId,
      location,
      rideId,
      timestamp: new Date().toISOString()
    });
  }

  // Send ride status update
  sendRideStatusUpdate(rideId, status, message = '') {
    return this.sendMessage('ride_status_update', {
      rideId,
      status,
      message,
      timestamp: new Date().toISOString()
    });
  }

  // Register message handler
  on(messageType, handler) {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, []);
    }
    this.messageHandlers.get(messageType).push(handler);
  }

  // Unregister message handler
  off(messageType, handler) {
    const handlers = this.messageHandlers.get(messageType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  // Handle incoming messages
  handleMessage(message) {
    const { type } = message;
    const handlers = this.messageHandlers.get(type) || [];
    
    handlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    });
  }

  // Schedule reconnection
  scheduleReconnect(userId, userType) {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => {
      this.connect(userId, userType).catch(error => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  // Start ping interval to keep connection alive
  startPingInterval() {
    this.pingInterval = setInterval(() => {
      if (this.isConnected) {
        this.sendMessage('ping', {});
      }
    }, 30000); // Ping every 30 seconds
  }

  // Stop ping interval
  stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Get connection status
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      readyState: this.ws ? this.ws.readyState : WebSocket.CLOSED,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

// Export singleton instance
export default new WebSocketService();
