const cp = require("child_process");
const fs = require("fs/promises");

(async function() {
  // 설정파일 읽기
  let config = await fs.readFile("./config.json");
  config = JSON.parse(config.toString());
  // 기존 설정파일을 삭제해서 원복
  cp.execSync("sudo rm -rf ./wpa_supplicant.conf");
  // 스트리밍에 필요한 패키지 설치
  console.log( "(1/2) Installing video tools (ffmpeg, v4l-utils) ..." );
  cp.execSync("bash -c 'sudo apt-get install -y ffmpeg v4l-utils'");
  // 라즈베리파이의 wlan0 인터페이스를 AP모드로 작동시킬 수 있는 패키지 설치
  console.log( "(2/2) Installing network tools (hostapd, dhcp-server) ..." );
  cp.execSync("bash -c 'sudo apt-get install -y hostapd isc-dhcp-server'");
  // hostapd 설정파일 생성
  let rand1 = (Math.random()*10000000)%256;
  let rand2 = (Math.random()*10000000)%256;
  let rand = ("0"+rand1.toString(16)).slice(-2)+("0"+rand2.toString(16)).slice(-2);
  await fs.writeFile("/etc/hostapd/hostapd.conf", Buffer.from(
`interface=wlan0
ssid=${config.deviceName}
ignore_broadcast_ssid=0
hw_mode=g
channel=11
wpa=2
wpa_passphrase=invisionlab4u
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP
wpa_ptk_rekey=600
macaddr_acl=0`));
  // hostapd 언마스크 & 활성화
  cp.execSync("sudo systemctl unmask hostapd");
  cp.execSync("sudo systemctl enable hostapd");
  // isc-dhcp-server 설정파일 생성
  await fs.writeFile("/etc/dhcp/dhcpd.conf", Buffer.from(
`subnet 10.10.10.0 netmask 255.255.255.0 {
  range 10.10.10.2 10.10.10.10;
  option subnet-mask 255.255.255.0;
  option routers 10.10.10.1;
  interface wlan0;
}
  `));
  // network interfaces 설정파일 생성
  await fs.writeFile("/etc/network/interfaces", Buffer.from(
`allow-hotplug wlan0
iface wlan0 inet static
    address 10.10.10.1
    netmask 255.255.255.0
    gateway 10.10.10.1
    network 10.10.10.0
    broadcast 10.10.10.255

source /etc/network/interfaces.d/*`));
  // wpa_supplicant 비활성화
  await fs.appendFile("/etc/dhcpcd.conf", Buffer.from(
`interface=wlan0
    static ip_address="10.10.10.1"
    nohook wpa_supplicant`
  ));
  // 설정완료 후 재부팅
  cp.execSync("bash -c 'sudo reboot'");
})();
