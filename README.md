# cloudscope 구동 방법


01) Raspberry Pi Imager 를 이용하여 raspbian OS 6.1 32bit 클린 설치
02) 타임존 (south korea) 및 언어설정 (영어), 사용자 계정 설정, wifi 연결
03) sudo apt-get update; sudo apt-get -y upgrade; sudo apt-get -y dist-upgrade; sudo apt-get -y autoremove
04) curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
05) sudo apt-get -y install nodejs
06) sudo npm install -g pm2
07) git clone https://github.com/invisionlab-kr/cloudscope-poc2; cd cloudscope-poc2
08) npm install
09) **** config.json 파일을 열고 deviceName 필드를 고유한 이름으로 수정 및 저장 ****
10) sudo pm2 start client.js --name=CLOUDSCOPE
11) sudo pm2 startup systemd -u root
12) sudo pm2 save
13) sudo node init.js

여기까지 수행 후 장치는 출하 준비 완료.
장치가 재부팅을 마치면 위 09단계에서 설정한 이름으로 SSID가 생성되며, 장치는 AP모드로 가동됩니다. (패스워드는 invisionlab4u)

사용자로 하여금 스마트폰이나 컴퓨터를 이용하여 장치에 WIFI 연결 후 http://10.10.10.1/ 로 접속하여 장치에 대한 설정을 마치도록 안내합니다.
