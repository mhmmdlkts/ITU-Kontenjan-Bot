/* eslint-disable */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const TelegramBot = require('node-telegram-bot-api')
const rp = require('request-promise');

const token = functions.config().telegram.token
const bot = new TelegramBot(token, { polling: true })

const TIME_ZONE = 'Turkey';
const LU = "LU";
const LS = "LS";

admin.initializeApp(functions.config().firebase);
const db = admin.database();

bot.on("polling_error", console.log);

bot.onText(/\/start/, (msg, match) => {
  const chatId = msg.chat.id

  const obj = {
    chatId: chatId + "",
    first_name: msg.from.first_name,
    username: msg.from.username==undefined?null:msg.from.username,
    lang: msg.from.language_code,
    date: msg.date,
  };

  db.ref("users").child(obj.chatId).set(obj);
  bot.sendMessage(chatId, `This bot is developed by *mhmmdlkts* for İTÜ students. Do not hesitate to write to me when you have a suggestion or find a mistake.`, {parse_mode: 'Markdown'})
  bot.sendMessage(chatId, `Type "/subscribe <CODE> <CRN> <LU (optional)>" for subscribing a course`)
});

bot.onText(/\/subscribe (.+)/, (msg, match) => {

  const chatId = msg.chat.id
  const splitted = match[1].split(" ");

  const subj = splitted[0].toUpperCase();;
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
      bot.sendMessage(chatId, subj + " " + crn + " is successfully subscribed ")
    }
  });
})

bot.onText(/\/unsubscribe (.+)/, (msg, match) => {

  const chatId = msg.chat.id
  const splitted = match[1].split(" ");

  const subj = splitted[0].toUpperCase();;
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
    } else {
      bot.sendMessage(chatId, "You were not already subscribing " + subj + " " + crn, opts)
    }
  });
})

exports.helloWorld = functions.region('europe-west1').https.onRequest((request, response) => {
  response.send();
});

exports.checkKontenjan = functions.region('europe-west1').pubsub.schedule('1,16,31,46 * * * *').timeZone(TIME_ZONE).onRun( (context) => {
  db.ref("listeners").once("value").then(listeners => {
    listeners = listeners.toJSON();

    [LS, LU].forEach(LSU => {
      for(const subj in listeners[LSU]) {
        for(const crn in listeners[LSU][subj]) {
          const options = getOptions(subj, LSU);
          rp(options).then(html => {
            if (html == undefined) return
            html = html.split("<td>Class Rest.</td>")[1];
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
                course_code: splitted[1].split("\">")[1].split("</a>")[0],
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
              for(const chatIdKey in listeners[LSU][subj][crn]) {
                const chatId = listeners[LSU][subj][crn][chatIdKey];
                const opts = {
                  reply_markup:{
                    keyboard: [
                      [`/unsubscribe ${subj} ${crn} ${LSU}`]
                    ]
                  },
                  parse_mode: 'Markdown'
                };

                bot.sendMessage(chatId,
            `*${subj} ${crn}*
`               +`*${emptyPlaces}* place available
`               + (totalSent==1?`This message was *just* sent to you`:
                `This message was sent to *${totalSent}* students.`), opts)
              }
            }
          })
        }
      }
    })
  });
  return null;
});

function getOptions(subj, level) {
  if (level != LU && level != LS)
    level = LU;
  const url = "https://www.sis.itu.edu.tr/TR/ogrenci/ders-programi/ders-programi.php?seviye=" + level + "&derskodu="+subj;

  return {
    url: url,
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'my-reddit-client'
    }
  };
}

/* eslint-disable */
