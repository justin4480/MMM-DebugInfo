/* MMM-DebugInfo
 *
 * mode "debug" (default): tapping the STATUS pill in the bottom row (drawn by MMM-Intercom,
 * with its mic / camera / bug badges) toggles a landscape frosted card (same style as MMM-AlarmKeypad) with live
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
    this.stopPrivacy();
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

  // ===== Mic & camera: shows what the intercom is capturing. Never opens the mic or camera
  // itself; outside a call there's no stream, so both read as off. =====
  intercomStream() {
    const ic = MM.getModules().find((m) => m.name === 'MMM-Intercom');
    const s = ic && typeof ic.localStream === 'function' ? ic.localStream() : null;
    return s && s.getTracks().some((t) => t.readyState === 'live') ? s : null;
  },

  renderPrivacy() {
    if (!this.camVideo || !this.visible) return;
    const stream = this.intercomStream();
    const audio = stream ? stream.getAudioTracks().filter((t) => t.readyState === 'live' && t.enabled) : [];
    const video = stream ? stream.getVideoTracks().filter((t) => t.readyState === 'live' && t.enabled) : [];

    // Camera preview
    const vKey = video.map((t) => t.id).join();
    if (vKey !== this.vKey) {
      this.vKey = vKey;
      this.camVideo.srcObject = video.length ? new MediaStream(video) : null;
    }
    this.camBox.classList.toggle('live', video.length > 0);

    // Mic level meter
    const aKey = audio.map((t) => t.id).join();
    if (aKey !== this.aKey) {
      this.aKey = aKey;
      this.stopMeter();
      if (audio.length) this.startMeter(new MediaStream(audio));
    }
    const micLive = audio.length > 0;
    this.micIcon.className = `dbg-av-icon dbg-mic-icon fa-solid fa-${micLive ? 'microphone live' : 'microphone-slash'}`;
    this.micVal.textContent = micLive ? 'Live' : 'Off';
    this.micVal.classList.toggle('live', micLive);
    this.renderVolume();
  },

  // ===== Speaker volume (tablet media / call volume via Fully's JS interface) =====
  hasVolume() {
    return typeof fully !== 'undefined' && typeof fully.getAudioVolume === 'function' && typeof fully.setAudioVolume === 'function';
  },

  bindVolume() {
    const apply = (final) => {
      const v = Number(this.volSlider.value);
      this.showVolume(v);
      clearTimeout(this.volTimer);
      this.volTimer = setTimeout(() => this.setVolume(v), final ? 0 : 120);
    };
    this.volSlider.addEventListener('input', () => {
      this.volDragging = true;
      this.armMenuTimeout();
      apply(false);
    });
    this.volSlider.addEventListener('change', () => {
      this.volDragging = false;
      apply(true);
    });
  },

  // Through MMM-Intercom when present, so its volume tracking stays in step (media + call streams).
  setVolume(v) {
    if (!this.hasVolume()) return;
    const ic = MM.getModules().find((m) => m.name === 'MMM-Intercom');
    try {
      if (ic && typeof ic.setSysVolume === 'function' && ic.hasSysVolume && ic.hasSysVolume()) ic.setSysVolume(v);
      else fully.setAudioVolume(v, 3);
    } catch {
      // not in Fully
    }
  },

  showVolume(v) {
    this.volSlider.style.setProperty('--fill', `${v}%`);
    this.spkVal.textContent = `${v}%`;
    const icon = v === 0 ? 'volume-xmark' : v < 50 ? 'volume-low' : 'volume-high';
    this.spkIcon.className = `dbg-av-icon dbg-spk-icon fa-solid fa-${icon}${v === 0 ? ' muted' : ''}`;
  },

  renderVolume() {
    if (!this.volSlider || this.volDragging) return;
    if (!this.hasVolume()) {
      this.volSlider.disabled = true;
      this.spkVal.textContent = '—';
      return;
    }
    let v;
    try {
      v = Number(fully.getAudioVolume(3));
    } catch {
      return;
    }
    if (!Number.isFinite(v)) return;
    this.volSlider.value = v;
    this.showVolume(v);
  },

  startMeter(stream) {
    try {
      this.actx = this.actx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.actx.state === 'suspended') this.actx.resume();
      this.meterSrc = this.actx.createMediaStreamSource(stream);
      const an = this.actx.createAnalyser();
      an.fftSize = 512;
      this.meterSrc.connect(an);   // analyser only: nothing is played
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        this.meterFill.style.width = `${Math.min(100, (peak / 128) * 160)}%`;
        this.meterRaf = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      // no Web Audio
    }
  },

  stopMeter() {
    cancelAnimationFrame(this.meterRaf);
    if (this.meterSrc) this.meterSrc.disconnect();
    this.meterSrc = null;
    if (this.meterFill) this.meterFill.style.width = '0%';
  },

  stopPrivacy() {
    this.stopMeter();
    this.aKey = this.vKey = undefined;
    if (this.camVideo) this.camVideo.srcObject = null;
  },

  renderData() {
    this.renderPrivacy();
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
    root.innerHTML = `
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
          <div class="dbg-priv">
            <div class="dbg-priv-left">
              <div class="dbg-sec-title"><i class="fa-solid fa-headset"></i>Mic, speaker &amp; camera</div>
              <div class="dbg-av-row">
                <i class="dbg-av-icon dbg-mic-icon fa-solid fa-microphone-slash"></i>
                <span class="dbg-av-label">Mic</span>
                <div class="dbg-meter"><div class="dbg-meter-fill"></div></div>
                <span class="dbg-av-val dbg-mic-val">Off</span>
              </div>
              <div class="dbg-av-row">
                <i class="dbg-av-icon dbg-spk-icon fa-solid fa-volume-high"></i>
                <span class="dbg-av-label">Speaker</span>
                <input class="dbg-vol" type="range" min="0" max="100" step="1">
                <span class="dbg-av-val dbg-spk-val">—</span>
              </div>
            </div>
            <div class="dbg-cam"><video muted playsinline autoplay></video><div class="dbg-cam-off"><i class="fa-solid fa-video-slash"></i>Camera off</div></div>
          </div>
        </div>
      </div>`;
    this.overlay = root.querySelector('.dbg-overlay');
    this.body = root.querySelector('.dbg-body');
    this.subtitle = root.querySelector('.dbg-subtitle');
    this.camVideo = root.querySelector('.dbg-cam video');
    this.camBox = root.querySelector('.dbg-cam');
    this.meterFill = root.querySelector('.dbg-meter-fill');
    this.micIcon = root.querySelector('.dbg-mic-icon');
    this.micVal = root.querySelector('.dbg-mic-val');
    this.spkIcon = root.querySelector('.dbg-spk-icon');
    this.spkVal = root.querySelector('.dbg-spk-val');
    this.volSlider = root.querySelector('.dbg-vol');
    this.bindVolume();

    // The intercom's STATUS pill (.ic-indicators) opens the card; delegated, so it survives re-renders.
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.ic-indicators')) (this.visible ? this.close() : this.open());
    });
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
