Module.register('MMM-DebugInfo', {
  defaults: {
    displayName: 'Display',
    fullyDeviceId: null,
    mode: 'debug',
    connectivityCheckInterval: 10 * 1000,
    connectivityCheckTimeout: 5 * 1000,
  },

  getStyles() {
    return ['MMM-DebugInfo.css'];
  },

  start() {
    this.isConnected = null;

    if (this.config.mode === 'connectivity-warning') {
      this.handleOnline = () => this.checkConnectivity();
      this.handleOffline = () => this.setConnectivity(false);
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      this.checkConnectivity();
      this.connectivityTimer = setInterval(
        () => this.checkConnectivity(),
        this.config.connectivityCheckInterval
      );
      return;
    }

    this.clientIp = 'Detecting...';
    this.configFile = '';
    this.getClientIp();
    this.sendSocketNotification('GET_CONFIG_FILE');
  },

  socketNotificationReceived(notification, payload) {
    if (notification === 'CONFIG_FILE') {
      this.configFile = payload;
      this.updateDom();
    }
  },

  getClientIp() {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('');
    pc.createOffer().then(offer => pc.setLocalDescription(offer));

    pc.onicecandidate = (ice) => {
      if (ice?.candidate) {
        const ipMatch = ice.candidate.candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
        if (ipMatch) {
          this.clientIp = ipMatch[1];
          this.updateDom();
          pc.close();
        }
      }
    };
  },

  setConnectivity(isConnected) {
    if (this.isConnected !== isConnected) {
      this.isConnected = isConnected;
      this.updateDom();
    }
  },

  async checkConnectivity() {
    if (!navigator.onLine) {
      this.setConnectivity(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.connectivityCheckTimeout
    );

    try {
      const basePath = config.basePath || '/';
      const response = await fetch(`${basePath}version`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      this.setConnectivity(response.ok);
    } catch {
      this.setConnectivity(false);
    } finally {
      clearTimeout(timeout);
    }
  },

  getDom() {
    const wrapper = document.createElement('div');

    if (this.config.mode === 'connectivity-warning') {
      if (this.isConnected === false) {
        const warning = document.createElement('div');
        warning.className = 'offline-warning';

        const title = document.createElement('div');
        title.className = 'offline-warning-title';
        title.textContent = '⚠ NETWORK OFFLINE';
        warning.append(title);

        const message = document.createElement('div');
        message.className = 'offline-warning-message';
        message.textContent = 'Please escalate to the system administrator (Daddy) 😊';
        warning.append(message);

        wrapper.append(warning);
      }
      return wrapper;
    }

    wrapper.className = 'dimmed xxsmall';
    const parts = [this.config.displayName, this.clientIp, this.configFile];
    if (this.config.fullyDeviceId) parts.push(this.config.fullyDeviceId);
    wrapper.append(document.createTextNode(parts.join(' | ')));
    return wrapper;
  }
});
