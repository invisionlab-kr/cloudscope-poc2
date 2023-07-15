
const disk = require('diskusage');
const fs = require("fs");
const lib = require("./libs/client.js");
const log4js = require("log4js");
const logger = log4js.getLogger("client");
logger.level = "debug";
const express = require("express");
const Gpio = require('onoff').Gpio;
const cp = require("child_process");
const ws = require("ws");
let config = {ssid:"", wifi_password:"", deviceName:"", interval:0, password:""};

(async function main() {
  // 이전 실행에서 생성된 이미지 모두 삭제
  cp.execSync("rm -rf ./stills/*.jpg");
  logger.info( `Deleted old images` );

  // 카메라 장치 활성화 대기
  await lib.waitCamera();
  logger.info( `Camera found` );

  // 설정파일 확인 및 가능한 경우 WIFI 연결
  if(fs.existsSync("./config.json")) {
    config = JSON.parse(fs.readFileSync("./config.json").toString());
    if(config.ssid && config.wifi_password) lib.connectWifiWithPassword(config.ssid, config.wifi_password, logger);
    else if(config.ssid) lib.connectWifiWithoutPassword(config.ssid, logger);
    logger.info( `Trying to connect WIFI (${config.ssid} / ${config.wifi_password})` );
  }
  
  // led 컨트롤 준비
  let ledHigh = new Gpio(18, 'high');
  let ledLow = new Gpio(18, 'low');
  if(config.led && config.led=="HIGH") ledHigh.write(1);
  else ledLow.write(0);
  process.on('SIGINT', _ => {
    ledHigh.unexport();
    ledLow.unexport();
  });

  // 백엔드에 ws 연결
  loop();

  // ffmpeg 시작
  let ffmpegProcess = null;
  logger.info("starting ffmpeg...");
  ffmpegProcess = cp.exec("ffmpeg -y -f video4linux2 -pix_fmt yuv420p -video_size 1280x720 -i /dev/video0 -r 1 -f image2 ./stills/capture_%16d.jpg");
  ffmpegProcess.on("close", function(code) {
    logger.error(`FFMPEG process closed with exit code ${code}`);
    ffmpegProcess = null;
  });

  // 5분 간격으로 디스크에 남은 공간 모니터링
  setInterval(() => {
    disk.check("./stills")
    .then((info) => {
      if(info.available < 1024*1024*100)
        cp.execSync("rm -rf ./stills/*.jpg");
    })
    .catch((e) => {});
  }, 5*60*1000);
  
  // 자체 UI 준비
  let server = express();
  server.set("view engine", "ejs");
  server.set("views", "./templates");
  server.use(express.static("./statics"));
  server.use(express.urlencoded({extended:false}));
  server.use(express.json());
  server.get("/", function(req, res, next) {res.redirect("/stage1");});
  server.get("/stage1", function(req, res, next) {
    res.render("01_CloudScope_WIFI_Connection", {
      config
    });
  });
  server.post("/stage1", async function(req, res, next) {
    config.ssid = req.body.ssid;
    config.wifi_password = req.body.passwd;
    fs.writeFileSync("./config.json", Buffer.from(JSON.stringify(config)));
    res.json({result:true});
  });
  server.get("/stage2", function(req, res, next) {
    res.render("01_CloudScope_WIFI_Setting", {
      config
    });
  });
  server.post("/stage2", function(req, res, next) {
    config.password = req.body.passwd;
    fs.writeFileSync("./config.json", Buffer.from(JSON.stringify(config)));
    setTimeout(()=>{cp.execSync(`bash -c "sudo reboot"`)}, 3000);
    res.json({result:true});
  });
  server.get("/stage3", function(req, res, next) {
    res.render("01_CloudScope_WIFI_Success", {
      config
    });
  });
  server.get("/proc/ssid", function(req, res, next) {
    Promise.race([
      new Promise((resolve, reject) => {
        cp.exec("bash -c 'sudo iw dev wlan1 scan | grep 'SSID:''", function(err,stdout,stderr) {
          if(err) reject(stderr);
          else resolve(stdout);
        })
      }),
      new Promise((_,reject) => {
        setTimeout(() => {
          reject(null)
        }, 5000);
      })
    ])
    .then(function(buf) {
      let ssidArr = [];
      buf.toString().split("\n").forEach((line) => {
        if(line.replace("\t", "").replace("SSID: ",""))
          ssidArr.push({ssid:line.replace("\t", "").replace("SSID: ","")});
      });
      res.send(ssidArr);
    })
    .catch(function() {
    });
  });
  server.listen(80, function() {
    logger.info("web server ready.");
  });
  
})();




async function loop() {
  let watcher = null, timer = null;
  // 백엔드 서버에 연결 시도
  logger.info("Trying to connect server...");
  let socket = new ws.WebSocket('wss://cloudscope.invisionlab.xyz/sock');
  socket.on("error", function() {});
  socket.on("close", function() {
    if(watcher) watcher.close();
    if(timer) clearInterval(timer);
    logger.info("disconnected from server.");
    setTimeout(loop, 1000);
    return;
  });
  socket.on("message", function(msg) {
    socket.$buf = Buffer.concat([socket.$buf, msg]);
    if(socket.$buf.length<4) return;
    let length = socket.$buf.readUInt32BE(0);
    if(socket.$buf.length >= length) {
      let type = socket.$buf.readUInt8(4);
      let body = socket.$buf.subarray(5, length);
      if(type==lib.const.TYPE_LED_LOW) {
        logger.debug("LED_LOW RECVED!");
        config.led = "LOW";
        fs.writeFileSync("./config.json", Buffer.from(JSON.stringify(config)));
        ledHigh.write(0);
      }
      if(type==lib.const.TYPE_LED_HIGH) {
        logger.debug("LED_HIGH RECVED!");
        config.led = "HIGH";
        fs.writeFileSync("./config.json", Buffer.from(JSON.stringify(config)));
        ledLow.write(0);
      }
      if(type==lib.const.TYPE_GREETING) {
        config = JSON.parse(body.toString());
        fs.writeFileSync("./config.json", Buffer.from(JSON.stringify(config)));
      }
      socket.$buf = socket.$buf.subarray(length);
    }
  });
  socket.on("open", function() {
    socket.$buf = Buffer.alloc(0);
    logger.info("connected.");
    // greeting
    let cbuf = Buffer.from(JSON.stringify(config));
    let rbuf = Buffer.alloc(5);
    rbuf.writeUInt32BE(5+cbuf.length, 0);
    rbuf.writeUInt8(lib.const.TYPE_GREETING, 4);
    socket.send(rbuf);
    socket.send(cbuf);
    // heartbeat
    timer = setInterval(function() {
      let buf = Buffer.alloc(5);
      buf.writeUInt32BE(5, 0);
      buf.writeUInt8(lib.const.TYPE_PING, 4);
      socket.send(buf);
    }, 3000);
    // 스틸샷 생성 모니터링
    let lastNo = 0;
    watcher = fs.watch("./stills", function(ev, filename) {
      if(ev!="change") return;
      logger.info(`image generated (${ev}), filename=${filename}, lastNo=${lastNo}`);
      if(filename && filename.endsWith(".jpg") && socket && typeof socket == "object" && socket.readyState==1 && parseInt(filename.replace("capture_","").replace("\.jpg",""))>lastNo) {
        // 새로운 파일이 생성되었을 때, 와이파이에 연결된 상태이고 heartbeat에 성공한 상태라면, 서버로 전송한다.
        Promise.race([
          new Promise((resolve,_) => {
            fs.readFile(`./stills/${filename}`, (err, buf) => {
              if(err) _(err);
              else {
                logger.debug(`READ ${buf.length} bytes`);
                resolve(buf);
              }
            });
          })
          ,
          new Promise((resolve,_) => {
            setTimeout(() => {
              resolve(null)
            }, 1000);
          })
        ])
        .then((result) => {
          if(result) {
            if(result.length==0) return;
            lastNo = parseInt(filename.replace("capture_","").replace("\.jpg",""));
            let header = Buffer.alloc(5);
            header.writeUInt32BE(result.length+5, 0);
            header.writeUInt8(lib.const.TYPE_IMAGE, 4);
            socket.send(header);
            socket.send(result);
            logger.info(`sent image ${filename}, size=${result.length}`);
          } else {
            logger.debug("TIMED OUT");
          }
        })
        .catch((err) => {
          logger.error("Error while read file", err);
        })
      }
    });
  });
}
