const log4js = require("log4js");
const logger = log4js.getLogger("server");
logger.level = "debug";
const express = require("express");
const enableWs = require('express-ws');
const fs = require("fs");
const lib = require("./libs/server.js");
const session = require("express-session");
const devices = [];

let server = express();
enableWs(server);
server.set("view engine", "ejs");
server.set("views", "./templates");
server.set('trust proxy', 1) // trust first proxy
server.use(session({
  secret: 'my name is khan',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: true }
}));
server.use(express.static("./statics"));
server.use(express.urlencoded({extended:true}));
server.use(express.json());
server.get("/", function(req, res, next) {
  res.render("01_CloudScope_Login", {err:"", ...req.query});
});
server.post("/login", function(req, res, next) {
  let list = devices.filter((d) => (d.config.deviceName==req.body.deviceName&&d.config.password==req.body.passwd));
  if(list.length==1) {
    req.session.device = list[0].config.deviceName;
    req.session.interval = list[0].config.interval;
    res.redirect("/live");
  } else {
    res.redirect("/?err=ERR_LOGIN");
  }
});
server.get("/logout", function(req, res, next) {
  req.session.destroy();
  res.redirect("/");
});
server.get("/live", function(req, res, next) {
  res.render("01_CloudScope_Live_Viewer");
});
server.get("/download", function(req, res, next) {
  res.render("01_CloudScope_Download");
});
server.ws("/sock", function(conn,req) {
  logger.info("client connected.");
  conn.$buf = Buffer.alloc(0);
  conn.$saving = false;
  conn.$active = (new Date()).getTime();
  conn.on("message", function(msg) {
    conn.$buf = Buffer.concat([conn.$buf, msg]);
    logger.debug(`RECV typeof msg = ${typeof msg}, length=${msg.length}, bufsize=${conn.$buf.length}`)
    let length, type;
    if(conn.$buf.length>=4) length = conn.$buf.readUInt32BE(0); else return;
    if(conn.$buf.length>=5) type = conn.$buf.readUInt8(4); else return;
    if(type==lib.const.TYPE_GREETING && conn.$buf.length>=length) {
      // 클라이언트 등록
      conn.config = JSON.parse(conn.$buf.subarray(5, length).toString());
      devices.push(conn);
      // 이미지 저장할 디렉토리 준비
      if(!fs.existsSync(`./storage/S${conn.config.deviceName}`)) fs.mkdirSync(`./storage/S${conn.config.deviceName}`);
      logger.info("greeting done")
      conn.$buf = conn.$buf.subarray(length);
    }
    else if(type==lib.const.TYPE_PING && conn.config) {
      // 이 클라이언트의 최근 활동시각 업데이트
      logger.info("pong!");
      conn.$active = (new Date()).getTime();
      conn.$buf = conn.$buf.subarray(length);
    }
    else if(type==lib.const.TYPE_IMAGE && conn.$buf.length>=length && conn.config) {
      // 이 클라이언트에서 수신된 이미지 저장
      conn.$saving = true;
      fs.writeFileSync(`./storage/S${conn.config.deviceName}/latest.jpg`, conn.$buf.subarray(5, length));
      conn.$saving = false;
      conn.$active = (new Date()).getTime();
      conn.$buf = conn.$buf.subarray(length);
      logger.info(`saved image ${length-5} bytes, bufsize=${conn.$buf.length}`);
    }
    else {
      logger.error(`recv wrong type ${type}, length=${length}, bufsize=${conn.$buf.length}`);
    }
  });
  conn.on("close", function(why, desc) {
    let idx = devices.indexOf(conn);
    if(idx!=-1) devices.splice(idx, 1);
    logger.info(`client disconnected. (${why}: ${desc})`);
  })
});




server.listen(3000, function() {
  logger.info("server ready.");
});