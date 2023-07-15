const log4js = require("log4js");
const logger = log4js.getLogger("server");
logger.level = "debug";
const express = require("express");
const enableWs = require('express-ws');
const fs = require("fs");
const lib = require("./libs/server.js");
const session = require("express-session");
const admZip = require("adm-zip");
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
  if(!req.session.device) { res.redirect("/"); return; }
  res.render("01_CloudScope_Live_Viewer", {
    config: devices.filter((d) => (d.config.deviceName==req.session.device))[0].config
  });
});
server.get("/latest", function(req, res, next) {
  if(!req.session.device) { res.status(500); return; }
  res.sendFile(`${__dirname}/storage/S${req.session.device}/latest.jpg`);
});
server.get("/download", function(req, res, next) {
  if(!req.session.device) { res.redirect("/"); return; }
  res.render("01_CloudScope_Download", {
    config: devices.filter((d) => (d.config.deviceName==req.session.device))[0].config
  });
});
server.post("/set/interval", function(req, res, next) {
  if(!req.session.device) { res.redirect("/"); return; }
  let d = devices.filter((d) => (d.config.deviceName==req.session.device))[0];
  d.config.interval = req.body.interval;
  let cbuf = Buffer.from(JSON.stringify(d.config));
  let rbuf = Buffer.alloc(5);
  rbuf.writeUInt32BE(5+cbuf.length, 0);
  rbuf.writeUInt8(lib.const.TYPE_GREETING, 4);
  d.send(rbuf);
  d.send(cbuf);
  res.send("OK");
});
server.post("/set/saved", function(req, res, next) {
  if(!req.session.device) { res.redirect("/"); return; }
  let d = devices.filter((d) => (d.config.deviceName==req.session.device))[0];
  let dir = fs.opendirSync(`./storage/S${d.config.deviceName}`);
  let count = 0;
  while( true ) {
    let dirent = dir.readSync();
    if(dirent==null) break;
    if(dirent.name.startsWith("SAVED")) count += 1;
  }
  dir.close();
  res.send(count.toString());
});
server.post("/set/delete", function(req, res, next) {
  if(!req.session.device) { res.redirect("/"); return; }
  let d = devices.filter((d) => (d.config.deviceName==req.session.device))[0];
  let dir = fs.opendirSync(`./storage/S${d.config.deviceName}`);
  while( true ) {
    let dirent = dir.readSync();
    if(dirent==null) break;
    fs.unlinkSync(`./storage/S${d.config.deviceName}/${dirent.name}`);
  }
  dir.close();
  res.send("OK");
});
server.get("/set/zip", function(req, res, next) {
  if(!req.session.device) { res.redirect("/"); return; }
  let d = devices.filter((d) => (d.config.deviceName==req.session.device))[0];
  let dir = fs.opendirSync(`./storage/S${d.config.deviceName}`);
  let zip = new admZip();
  while( true ) {
    let dirent = dir.readSync();
    if(dirent==null) break;
    if(dirent.name.startsWith("SAVED")) {
      zip.addLocalFile(`./storage/S${d.config.deviceName}/${dirent.name}`);
      fs.unlinkSync(`./storage/S${d.config.deviceName}/${dirent.name}`);
    }
  }
  dir.close();
  res.set("Content-Type", "application/zip");
  res.send(zip.toBuffer());
});
server.ws("/sock", function(conn,req) {
  logger.info(`client connected. (current total ${devices.length})`);
  conn.$buf = Buffer.alloc(0);
  conn.$saving = false;
  conn.$active = (new Date()).getTime();
  conn.$last = (new Date()).getTime();
  conn.on("message", function(msg) {
    conn.$buf = Buffer.concat([conn.$buf, msg]);
    let length, type;
    if(conn.$buf.length>=4) length = conn.$buf.readUInt32BE(0); else return;
    if(conn.$buf.length>=5) type = conn.$buf.readUInt8(4); else return;
    if(type==lib.const.TYPE_GREETING && conn.$buf.length>=length) {
      // 클라이언트 등록
      conn.config = JSON.parse(conn.$buf.subarray(5, length).toString());
      if(!conn.config.interval) conn.config.interval = 0;
      devices.push(conn);
      // 이미지 저장할 디렉토리 준비
      if(!fs.existsSync(`./storage/S${conn.config.deviceName}`)) fs.mkdirSync(`./storage/S${conn.config.deviceName}`);
      conn.$buf = conn.$buf.subarray(length);
    }
    else if(type==lib.const.TYPE_PING && conn.config) {
      // 이 클라이언트의 최근 활동시각 업데이트
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
      if(conn.config.interval && parseInt(conn.config.interval)>0 && (new Date()).getTime()<conn.$last+(conn.config.interval*1000*60)) {
        let now = new Date();
        conn.$last = now.getTime();
        let name = "SAVED "+conn.config.deviceName+" ("+now.getFullYear()+"-"+("0"+(parseInt(now.getMonth())+1)).slice(-2)+"-"+("0"+now.getDate()).slice(-2)+" "+("0"+now.getHours()).slice(-2)+":"+("0"+now.getMinutes()).slice(-2)+").jpg";
        fs.cpSync(
          `./storage/S${conn.config.deviceName}/latest.jpg`,
          `./storage/S${conn.config.deviceName}/${name}`,
          {
            force: true
          }
        )
      }
    }
  });
  conn.on("close", function(why, desc) {
    let idx = devices.indexOf(conn);
    if(idx!=-1) devices.splice(idx, 1);
    logger.info(`client disconnected. (current total ${devices.length})`);
  })
});




server.listen(3000, function() {
  logger.info("server ready.");
});