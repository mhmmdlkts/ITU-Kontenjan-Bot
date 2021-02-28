/* eslint-disable */
process.env.NTBA_FIX_319 = 1;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const TelegramBot = require('node-telegram-bot-api')
const rp = require('request-promise');
const http = require('http');

const token = functions.config().telegram.token
const adminChatId = functions.config().telegram.admin_chat_id

const TIME_ZONE = 'Turkey';
const LU = "LU";
const LS = "LS";

admin.initializeApp(functions.config().firebase);
const db = admin.database();

const bot = new TelegramBot(token, { polling: true })
bot.on("polling_error", r => {
  try {
    console.log(JSON.stringify(r));
  } catch (e) {
    console.log(r)
  }
});

bot.onText(/\/start/, (msg, match) => {
  const chatId = msg.chat.id

  const obj = {
    chatId: chatId + "",
    first_name: msg.from.first_name==undefined?null:msg.from.first_name,
    username: msg.from.username==undefined?null:msg.from.username,
    lang: msg.from.language_code==undefined?null:msg.from.language_code,
    date: msg.date.language_code==undefined?null:msg.from.date,
  };

  db.ref("users").child(obj.chatId).update(obj);
  bot.sendMessage(chatId, `This bot is developed by *mhmmdlkts* for İTÜ students. Do not hesitate to write to me when you have a suggestion or find a mistake.`, {parse_mode: 'Markdown'})
  bot.sendMessage(chatId, `Type "/subscribe <CODE> <CRN> <LU (optional)>" for subscribing a course`)
  bot.sendMessage(adminChatId, `New User\nchatid: *${obj.chatId}*\nname: *${obj.first_name}*\nusername: *${obj.username}*`,{parse_mode: 'Markdown'})
});

bot.onText(/\/test/, (msg, match) => {
  const chatId = msg.chat.id

  bot.sendMessage(chatId, `I'm alive`,{parse_mode: 'Markdown'})
});

bot.onText(/\/status/, (msg, match) => {
  const chatId = msg.chat.id
  db.ref("users").child(chatId).child("subscribes").once("value").then(subscribes => {
    subscribes = subscribes.toJSON();
    const buttons = [];
    const message = ["*Courses you subscribed to:*"];
    for(const sub in subscribes) {
      let val = subscribes[sub].split("-")
      message.push(val.join(" "))
      buttons.push(["/unsubscribe " + val[1] + " " + val[2] + " " + val[0]]);
    }

    const opts = {
      reply_markup:{
        keyboard: buttons
      },
      parse_mode: 'Markdown'
    };
    bot.sendMessage(chatId, message.length==1?"You are not subscribed to any courses":message.join("\n"), opts);
  });
});

bot.onText(/\/send (.+)/, (msg, match) => {

  const chatId = msg.chat.id
  let to = adminChatId;
  let message = chatId + ": " + match[1];

  if (chatId == adminChatId) {
    to = match[1].split(" ")[0];
    message = match[1].split(to+" ")[1];
  }
  if (message == "" || message == undefined || message == null)
    message = "empty"

  const opt = {parse_mode: 'Markdown'}
  if (to == "*") {
    db.ref("users").once("value").then(r => {
      r.forEach(snap => {
        bot.sendMessage(snap.key, message,opt)
      })
    })
  } else {
    bot.sendMessage(to, message,opt)
  }
  if (to != adminChatId) {
    bot.sendMessage(adminChatId, `You send to *${to}*\n\n${message}`,opt)
  }
});

bot.onText(/\/subscribe (.+)/, (msg, match) => {

  const chatId = msg.chat.id
  const splitted = match[1].split(" ");

  const subj = splitted[0].toUpperCase();
  const crn = splitted[1];
  const isBsc = splitted.length > 2 ? (splitted[2].toUpperCase() != LU):LS;

  let wasListening = false;

  db.ref("listeners").child(isBsc?LS:LU).child(subj).child(crn).transaction(val => {
    if (val === null) {
      return [chatId];
    } else {
      for (let i = 0; i < val.length; i++) {
        if (val[i] == chatId) {
          wasListening = true;
          return val;
        }
      }
      val.push(chatId);
      return val;
    }
  }, r => {
    if (wasListening) {
      bot.sendMessage(chatId, "You are already subscribed " + subj + " " + crn)
    } else {
      const child = (isBsc?LS:LU) + "-" + subj + "-" + crn;
      db.ref("users").child(chatId).child("subscribes").transaction(val => {
        if (val === null)
          return [child];
        val.push(child);
        return val;
      });
      bot.sendMessage(chatId, subj + " " + crn + " is successfully subscribed ")
    }
  });
})

bot.onText(/\/unsubscribe (.+)/, (msg, match) => {

  const chatId = msg.chat.id
  const splitted = match[1].split(" ");

  const subj = splitted[0].toUpperCase();
  const crn = splitted[1];
  const isBsc = splitted.length > 2 ? (splitted[2].toUpperCase() != LU):LS;

  let wasListened = false;

  db.ref("listeners").child(isBsc?LS:LU).child(subj).child(crn).transaction(val => {
    if (val === null) {
      return [];
    } else {

      const index = val.indexOf(chatId);
      if (index > -1) {
        wasListened = true;
        val.splice(index, 1);
      }

      return val;
    }
  },r => {
    const opts = {
      reply_markup: {
        remove_keyboard: true
      }
    };
    if (wasListened) {
      bot.sendMessage(chatId, "You are now not subscribing " + subj + " " + crn, opts)
      const child = (isBsc?LS:LU) + "-" + subj + "-" + crn;
      db.ref("users").child(chatId).child("subscribes").transaction(val => {
        if (val === null) {
          return [];
        } else {

          const index = val.indexOf(child);
          if (index > -1)
            val.splice(index, 1);

          return val;
        }
      });
    } else {
      bot.sendMessage(chatId, "You were not already subscribing " + subj + " " + crn, opts)
    }
  });
})



exports.checkKontenjan = functions.region('europe-west1').pubsub.schedule('1,16,31,46 * * * *').timeZone(TIME_ZONE).onRun( (context) => {

  db.ref("listeners").once("value").then(listeners => {
    listeners = listeners.toJSON();

    [LS, LU].forEach(LSU => {
      for(const subj in listeners[LSU]) {
        for(const crn in listeners[LSU][subj]) {
          const options = getOptions(subj, LSU);
          try {
            rp(options).then(html => {
              try {
                if (html == undefined) return
                html = html.split(LSU==LS?"<td>Class Rest.</td>":"<td><i>Enrolled</i></td>")[1];
                if (html == undefined) return
                html = html.trim().substring(10);
                if (html == undefined) return
                html = html.split("<div class=\"footer\">")[0];
                if (html == undefined) return
                html = html.split("<tr>");
                if (html == undefined) return

                function tdToCapacityEnrolled(body) {
                  body = body.split("<td>").join("");
                  const splitted = body.split("</td>")
                  return {
                    crn: splitted[0],
                    course_code: LSU==LS?splitted[1].split("\">")[1].split("</a>")[0]:splitted[1],
                    capacity: splitted[8],
                    enrolled: splitted[9]
                  }
                }
                const obj = {};
                html.forEach(e => {
                  const subObj = tdToCapacityEnrolled(e);
                  obj[subObj.crn] = subObj;
                })

                const totalSent = Object.keys(listeners[LSU][subj][crn]).length;


                const emptyPlaces = obj[crn].capacity - obj[crn].enrolled;

                if (emptyPlaces > 0) {
                  for (const chatIdKey in listeners[LSU][subj][crn]) {
                    const chatId = listeners[LSU][subj][crn][chatIdKey];
                    const opts = {
                      reply_markup: {
                        keyboard: [
                          [`/unsubscribe ${subj} ${crn} ${LSU}`]
                        ]
                      },
                      parse_mode: 'Markdown'
                    };

                    bot.sendMessage(chatId, `*${subj} ${crn}*
` + `*${emptyPlaces}* place available
` + (totalSent == 1 ? `This message was *just* sent to you` :
                        `This message was sent to *${totalSent}* students.`), opts)
                  }
                }

              } catch (e) {
                console.log("Hata a: " + crn)
                console.log(e)
                console.log(options.url)
              }
            })

          } catch (e) {
            console.log("Hata b: " + crn)
            console.log(e)
            console.log(options.url)
          }
        }
      }
    })
  });
  return null;
});

function getOptions(subj, level) {
  if (level != LU && level != LS)
    level = LU;
  const url = "http://www.sis.itu.edu.tr/TR/ogrenci/ders-programi/ders-programi.php?seviye=" + level + "&derskodu="+subj;
  const keepAliveAgent = new http.Agent({ keepAlive: true });

  return {
    agent: keepAliveAgent,
    url: url,
    method: 'GET',
    headers: {
      Connection: 'keep-alive',
      'Accept': 'application/json',
      'User-Agent': 'my-reddit-client'
    }
  };
}

/* eslint-disable */
