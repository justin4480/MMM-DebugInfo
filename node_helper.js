const os = require('os');
const path = require('path');
const NodeHelper = require('node_helper');

module.exports = NodeHelper.create({
  socketNotificationReceived(notification) {
    if (notification === 'GET_CONFIG_FILE') {
      const configFile = global.configuration_file || 'config/config.js';
      this.sendSocketNotification('CONFIG_FILE', path.basename(configFile));
    } else if (notification === 'GET_SERVER_INFO') {
      let mmVersion = null;
      try {
        mmVersion = require(path.join(global.root_path || path.resolve(__dirname, '../..'), 'package.json')).version;
      } catch {
        // not fatal
      }
      this.sendSocketNotification('SERVER_INFO', {
        hostname: os.hostname(),
        node: process.version,
        mmVersion,
        uptime: Math.round(process.uptime()),
        rss: process.memoryUsage().rss,
        load: os.loadavg().map((l) => l.toFixed(2)).join(' '),
      });
    }
  }
});
