const fs = require("fs");
const cp = require("child_process");

module.exports = {
  _reroute: null,

  const: {
    TYPE_IMAGE: 1,
    TYPE_PING: 100,
    TYPE_LED_LOW: 50,
    TYPE_LED_HIGH: 51,
    TYPE_GREETING: 8
  },

  waitCamera: function() {
    return new Promise((resolve) => {
      let timer = setInterval(() => {
        if(fs.existsSync("/dev/video0")) {
          clearInterval(timer);
          resolve(true);
        }
      }, 500)
    });
  },




  connectWifiWithPassword: function(ssid, passwd, logger) {
    try { cp.execSync("bash -c 'sudo wpa_cli disconnect -i wlan1 >/dev/null 2>/dev/null'"); } catch(e) { }
    try { cp.execSync("bash -c 'sudo killall -9 wpa_supplicant >/dev/null 2>/dev/null'"); } catch(e) { }
    try { cp.execSync("bash -c 'sudo ip link set wlan1 up >/dev/null 2>/dev/null'"); } catch(e) { }
    try {
      cp.execSync(`bash -c 'sudo wpa_passphrase "${ssid}" > ./wpa_supplicant.conf'`, {
        input: Buffer.from(passwd+"\n")
      });
    } catch(e) { logger.error(`Error while connect secured WIFI: stage 4`); }
    try { cp.execSync("bash -c 'sudo wpa_supplicant -B -i wlan1 -c ./wpa_supplicant.conf >/dev/null 2>/dev/null'"); } catch(e) { }
    try { cp.execSync("bash -c 'sudo dhclient wlan1 >/dev/null 2>/dev/null'"); } catch(e) { }
    if(!this._reroute) this._reroute = setInterval(function() {
      try { cp.execSync("bash -c 'sudo ip route del default dev wlan0 >/dev/null 2>/dev/null'"); } catch(e) {}
    }, 1000);
  },




  connectWifiWithoutPassword: function(ssid, logger) {
    try { cp.execSync("bash -c 'sudo wpa_cli disconnect -i wlan1 >/dev/null 2>/dev/null'"); } catch(e) { }
    try { cp.execSync("bash -c 'killall -9 wpa_supplicant >/dev/null 2>/dev/null'"); } catch(e) { }
    try { cp.execSync("bash -c 'sudo ip link set wlan1 up >/dev/null 2>/dev/null'"); } catch(e) { }
    try { cp.execSync(`bash -c 'sudo iw dev wlan1 connect ${ssid} >/dev/null 2>/dev/null'`); } catch(e) { }
    try { cp.execSync("bash -c 'sudo dhclient wlan1 >/dev/null 2>/dev/null'"); } catch(e) { }
    if(!this._reroute) this._reroute = setInterval(function() {
      try { cp.execSync("bash -c 'sudo ip route del default dev wlan0 >/dev/null 2>/dev/null'"); } catch(e) { }
    }, 1000);
  },



  getNetInfo: function() {
    let netinfo = null;
    let netList = os.networkInterfaces();
    for(let netName in netList) {
      netList[netName].forEach(network => {
        if(network.family!="IPv4" || network.internal) return;
        netinfo = network;
      });
    }
    return netinfo;
  }
}