Module.register('MMM-DebugInfo', {
  defaults: {
    displayName: 'Display',
  },

  start() {
    this.clientIp = 'Detecting...';
    this.getClientIp();
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

  getDom() {
    const wrapper = document.createElement('div');
    wrapper.className = 'dimmed xxsmall';
    wrapper.innerHTML = `Device: ${this.config.displayName} | IP: ${this.clientIp}`;
    return wrapper;
  }
});
