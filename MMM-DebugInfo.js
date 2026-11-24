/* MMM-DebugInfo
 *
 * mode "debug" (default): a small bug badge next to the intercom's mic / camera badges.
 * Tapping it toggles a landscape frosted card (same style as MMM-AlarmKeypad) with live
 * diagnostics for this display: room, config, tablet (via Fully's JS interface), network
 * and the MagicMirror server. Nothing is shown on the mirror until the badge is tapped.
 * The card closes itself after `menuTimeout` seconds untouched.
 *
 * mode "connectivity-warning": a big red NETWORK OFFLINE banner whenever the server
 * can't be reached.
 */
Module.register('MMM-DebugInfo', {
  defaults: {
    displayName: 'Display',
    fullyDeviceId: null,
    mode: 'debug',
    menuTimeout: 120,               // seconds untouched before the card closes (0 = never)
    refreshInterval: 2000,          // live values while the card is open
    left: null,                     // badge position in CSS px (default: after the intercom's
    bottom: null,                   // mic / camera badges, bottom centre)
    connectivityCheckInterval: 10 * 1000,
    connectivityCheckTimeout: 5 * 1000,
  },

  getStyles() {
    return ['font-awesome.css', 'MMM-DebugInfo.css'];
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

    this.loadedAt = Date.now();
    this.clientIp = null;
    this.configFile = '';
    this.server = null;
    this.ping = null;
    this.mmVersion = null;
    this.visible = false;
    this.getClientIp();
    this.sendSocketNotification('GET_CONFIG_FILE');
  },

  socketNotificationReceived(notification, payload) {
    if (notification === 'CONFIG_FILE') {
      this.configFile = payload;
      if (this.isLegacy()) this.updateDom();
      this.renderData();
    } else if (notification === 'SERVER_INFO') {
      this.server = payload;
      this.renderData();
    }
  },

  getClientIp() {
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      pc.createOffer().then(offer => pc.setLocalDescription(offer));
      pc.onicecandidate = (ice) => {
        const m = ice?.candidate?.candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
        if (m) {
          this.clientIp = m[1];
          if (this.isLegacy()) this.updateDom();
          this.renderData();
          pc.close();
        }
      };
    } catch {
      // no WebRTC: fall back to Fully's IP below
    }
  },

  // ===== Connectivity-warning mode (unchanged behaviour) =====

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
    const timeout = setTimeout(() => controller.abort(), this.config.connectivityCheckTimeout);
    try {
      const basePath = config.basePath || '/';
      const response = await fetch(`${basePath}version`, { cache: 'no-store', signal: controller.signal });
      this.setConnectivity(response.ok);
    } catch {
      this.setConnectivity(false);
    } finally {
      clearTimeout(timeout);
    }
  },

  // ===== Debug card =====

  open() {
    this.visible = true;
    this.overlay.classList.add('visible');
    this.refresh(true);
    clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => this.refresh(false), this.config.refreshInterval);
    this.armMenuTimeout();
  },

  close() {
    this.visible = false;
    this.overlay.classList.remove('visible');
    clearInterval(this.refreshTimer);
    clearTimeout(this.menuTimer);
    this.refreshTimer = this.menuTimer = null;
  },

  armMenuTimeout() {
    clearTimeout(this.menuTimer);
    this.menuTimer = null;
    if (!(this.config.menuTimeout > 0)) return;
    this.menuTimer = setTimeout(() => this.close(), this.config.menuTimeout * 1000);
  },

  // Server info + ping every few seconds; local values every refresh.
  refresh(full) {
    this.tick = (this.tick || 0) + 1;
    if (full || this.tick % 3 === 0) {
      this.sendSocketNotification('GET_SERVER_INFO');
      this.measurePing();
    }
    this.renderData();
  },

  async measurePing() {
    const t0 = performance.now();
    try {
      const basePath = config.basePath || '/';
      const res = await fetch(`${basePath}version`, { cache: 'no-store' });
      const text = (await res.text()).trim();
      this.ping = res.ok ? Math.round(performance.now() - t0) : null;
      if (res.ok && text.length < 40) this.mmVersion = text;
    } catch {
      this.ping = null;
    }
    this.renderData();
  },

  // Fully Kiosk JS interface (present when "Enable JavaScript Interface" is on).
  fully(fn, ...args) {
    try {
      if (typeof fully !== 'undefined' && typeof fully[fn] === 'function') {
        const v = fully[fn](...args);
        return v === undefined || v === null || v === '' ? null : v;
      }
    } catch {
      // method missing on this Fully version
    }
    return null;
  },

  duration(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m ${s % 60}s`;
  },

  sections() {
    const dash = '—';
    const v = (x, suffix = '') => (x === null || x === undefined || x === '' ? dash : `${x}${suffix}`);
    const chrome = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1];
    const mem = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB` : null;
    const make = [this.fully('getDeviceManufacturer'), this.fully('getDeviceModel')].filter(Boolean).join(' ');
    const battery = this.fully('getBatteryLevel');
    const plugged = this.fully('isPlugged');
    const ssid = this.fully('getWifiSsid');
    const signal = this.fully('getWifiSignalLevel');
    const srv = this.server || {};

    return [
      { title: 'Display', icon: 'display', rows: [
        ['Room', v(this.config.displayName)],
        ['Config', v(this.configFile)],
        ['Device ID', v(this.config.fullyDeviceId)],
        ['Screen', `${innerWidth}×${innerHeight} @ ${devicePixelRatio.toFixed(2)}x`],
        ['Page up', this.duration(Date.now() - this.loadedAt)],
        ['JS heap', v(mem)],
      ] },
      { title: 'Tablet', icon: 'tablet-screen-button', rows: [
        ['Model', v(make || null)],
        ['Android', v(this.fully('getAndroidVersion'))],
        ['Fully', v(this.fully('getFullyVersion'))],
        ['Browser', chrome ? `Chrome ${chrome.split('.')[0]}` : dash],
        ['Battery', battery === null ? dash : `${battery}%${plugged ? ' · charging' : ''}`],
        ['Volume', v(this.fully('getAudioVolume', 3), '%')],
      ] },
      { title: 'Network', icon: 'wifi', rows: [
        ['Tablet IP', v(this.clientIp || this.fully('getIp4Address'))],
        ['Wi-Fi', v(ssid && String(ssid).replace(/^"|"$/g, ''))],
        ['Signal', v(signal, signal !== null && Number(signal) <= 0 ? ' dBm' : '')],
        ['Server', location.host],
        ['Ping', this.ping === null ? dash : `${this.ping} ms`],
        ['Status', navigator.onLine ? 'Online' : 'Offline'],
      ] },
      { title: 'Server', icon: 'server', rows: [
        ['Host', v(srv.hostname)],
        ['MagicMirror', v(this.mmVersion || srv.mmVersion)],
        ['Node', v(srv.node)],
        ['Process up', srv.uptime ? this.duration(srv.uptime * 1000) : dash],
        ['Memory', srv.rss ? `${Math.round(srv.rss / 1048576)} MB` : dash],
        ['Load', v(srv.load)],
      ] },
    ];
  },

  renderData() {
    if (!this.body || !this.visible) return;
    const data = this.sections();
    if (!this.cells) {
      // Build once; later refreshes only change text.
      this.cells = [];
      this.body.textContent = '';
      data.forEach((sec) => {
        const el = document.createElement('div');
        el.className = 'dbg-sec';
        const h = document.createElement('div');
        h.className = 'dbg-sec-title';
        h.innerHTML = `<i class="fa-solid fa-${sec.icon}"></i>`;
        h.append(sec.title);
        el.append(h);
        sec.rows.forEach(([label]) => {
          const row = document.createElement('div');
          row.className = 'dbg-row';
          const k = document.createElement('span');
          k.className = 'dbg-k';
          k.textContent = label;
          const val = document.createElement('span');
          val.className = 'dbg-v';
          row.append(k, val);
          el.append(row);
          this.cells.push(val);
        });
        this.body.append(el);
      });
    }
    let i = 0;
    data.forEach((sec) => sec.rows.forEach(([, value]) => {
      const cell = this.cells[i++];
      const text = String(value);
      if (cell.textContent !== text) {
        cell.textContent = text;
        cell.title = text;
      }
    }));
    this.subtitle.textContent = `${this.config.displayName} · ${new Date().toLocaleTimeString([], { hour12: false })}`;
  },

  buildDebugDom() {
    const root = document.createElement('div');
    root.className = 'dbg-root';
    if (this.config.left !== null) root.style.setProperty('--dbg-left', `${this.config.left}px`);
    if (this.config.bottom !== null) root.style.setProperty('--dbg-bottom', `${this.config.bottom}px`);
    root.innerHTML = `
      <div class="dbg-badge" role="button" aria-label="Debug"><i class="fa-solid fa-bug"></i></div>
      <div class="dbg-overlay">
        <div class="dbg-card">
          <div class="dbg-head">
            <div class="dbg-head-icon"><i class="fa-solid fa-bug"></i></div>
            <div>
              <div class="dbg-title">Debug</div>
              <div class="dbg-subtitle"></div>
            </div>
          </div>
          <button class="dbg-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
          <div class="dbg-body"></div>
        </div>
      </div>`;
    this.overlay = root.querySelector('.dbg-overlay');
    this.body = root.querySelector('.dbg-body');
    this.subtitle = root.querySelector('.dbg-subtitle');

    root.querySelector('.dbg-badge').addEventListener('click', () => (this.visible ? this.close() : this.open()));
    root.querySelector('.dbg-close').addEventListener('click', () => this.close());
    // Tap outside the card closes; "click" so the tap can't fall through once hidden.
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.overlay.addEventListener('pointerdown', () => {
      if (this.visible) this.armMenuTimeout();
    }, true);
    return root;
  },

  notificationReceived(notification) {
    // #debug opens the card (for remote screenshots).
    if (notification === 'DOM_OBJECTS_CREATED' && this.config.mode !== 'connectivity-warning' && location.hash === '#debug') {
      setTimeout(() => this.open(), 3000);
    }
  },

  // Placed in a normal region (old configs): keep the original one-line footer.
  isLegacy() {
    return !String(this.data.position || '').startsWith('fullscreen');
  },

  getDom() {
    if (this.config.mode !== 'connectivity-warning' && this.isLegacy()) {
      const line = document.createElement('div');
      line.className = 'dimmed xxsmall';
      const parts = [this.config.displayName, this.clientIp || 'Detecting...', this.configFile];
      if (this.config.fullyDeviceId) parts.push(this.config.fullyDeviceId);
      line.textContent = parts.join(' | ');
      return line;
    }
    if (this.config.mode !== 'connectivity-warning') {
      if (!this.debugRoot) this.debugRoot = this.buildDebugDom();
      return this.debugRoot;
    }

    const wrapper = document.createElement('div');
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
});
