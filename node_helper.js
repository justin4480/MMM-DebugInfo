const path = require('path');
const NodeHelper = require('node_helper');

module.exports = NodeHelper.create({
  socketNotificationReceived(notification) {
    if (notification === 'GET_CONFIG_FILE') {
      const configFile = global.configuration_file || 'config/config.js';
      this.sendSocketNotification('CONFIG_FILE', path.basename(configFile));
    }
  }
});
