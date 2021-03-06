/* eslint-disable */
process.env.NTBA_FIX_319 = 1;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const TelegramBot = require('node-telegram-bot-api')
const rp = require('request-promise');
const http = require('http');

const token = functions.config().telegram.token
const adminChatId = functions.config().telegram.admin_chat_id
const admin2ChatId = 1386098548

const URL = "http://www.sis.itu.edu.tr/TR/ogrenci/ders-programi/ders-programi.php";
const TIME_ZONE = 'Turkey';
const LU = "LU";
const LS = "LS";

const runtimeOpts = {
  timeoutSeconds: 300,
  memory: '2GB',
  region: 'europe-west1'
}

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

bot.onText(/\/count/, async (msg, match) => {
  const chatId = msg.chat.id

  if (chatId != adminChatId && chatId != admin2ChatId)
    return;

  const count = (await db.ref("statistics").child("users").once("value")).val();

  sendMessage(chatId, `There are *${count}* users registered`, {parse_mode: 'Markdown'})
});

bot.onText(/\/countagain/, async (msg, match) => {
  const chatId = msg.chat.id

  if (chatId != adminChatId && chatId != admin2ChatId)
    return;

  let counter = 0;
  await db.ref("users").once("value").then(r => {
    r.forEach(u => {
      counter++;
    })
  })
  await db.ref("statistics").child("users").set(counter);

  sendMessage(chatId, `There are *${counter}* users counted`, {parse_mode: 'Markdown'})
});


bot.onText(/\/stopuser (.+)/, async (msg, match) => {
  const chatId = msg.chat.id
  const messageIdFromUser = parseInt(match[1]);

  if (chatId != adminChatId)
    return;


  stopUser(messageIdFromUser);
});

bot.onText(/\/userinfo (.+)/, async (msg, match) => {
  const chatId = msg.chat.id
  const messageIdFromUser = match[1];

  if (chatId != adminChatId && chatId != admin2ChatId)
    return;
  try {
    const user = (await db.ref("users").child(messageIdFromUser).once("value")).val()

    if (user == null) {
      sendMessage(chatId, `No records found for chatId: ${messageIdFromUser}`, {parse_mode: 'Markdown'})
    } else {
      let message = `chatid: *${user.chatId}*\nname: *${user.first_name}*\nusername: *${user.username}*`;
      if (user.subscribes != undefined) {
        const separator = "\n\t"
        message += separator + user.subscribes.join(separator);
      }
      sendMessage(adminChatId, message,{parse_mode: 'Markdown'})
    }
  } catch (e) {
    console.log("/userinfo " + messageIdFromUser)
    console.log("typeof " + (typeof messageIdFromUser))
    console.log(e)
  }
});

bot.onText(/\/start/, async (msg, match) => {
  const chatId = msg.chat.id

  const obj = {
    chatId: chatId + "",
    first_name: msg.from.first_name==undefined?null:msg.from.first_name,
    username: msg.from.username==undefined?null:msg.from.username,
    lang: msg.from.language_code==undefined?null:msg.from.language_code,
    date: msg.date.language_code==undefined?null:msg.from.date,
  };

  const user = (await db.ref("users").child(obj.chatId).once("value")).val()

  db.ref("users").child(obj.chatId).update(obj);

  sendMessage(chatId, `This bot is developed by *mhmmdlkts* for İTÜ students. Do not hesitate to write to me when you have a suggestion or find a mistake.`, {parse_mode: 'Markdown'})
  sendMessage(chatId, `Type "/subscribe <CODE> <CRN> <LU (optional)>" for subscribing a course`)

  if (user == null) {
    let userCount = 1;
    await db.ref("statistics").child("users").transaction(val => {
      if (val === null) {
        return userCount;
      } else {
        userCount = val + 1;
        return userCount;
      }
    });
    sendMessage(adminChatId, `*${userCount}.* User\n\nchatid: *${obj.chatId}*\nname: *${obj.first_name}*\nusername: *${obj.username}*`,{parse_mode: 'Markdown'})
  }

});

bot.onText(/\/test/, (msg, match) => {
  const chatId = msg.chat.id

  sendMessage(chatId, `I'm alive`,{parse_mode: 'Markdown'})
});

bot.onText(/\/status/, (msg, match) => {
  const chatId = msg.chat.id
  db.ref("users").child(chatId).child("subscribes").once("value").then(subscribes => {
    subscribes = subscribes.toJSON();
    const buttons = [];
    const message = ["*Courses you subscribed to:*"];
    for(const sub in subscribes) {
      const val = subscribes[sub].split("-")
      message.push(val.join(" "))
      buttons.push(["/unsubscribe " + val[1] + " " + val[2] + " " + val[0]]);
    }

    const opts = {
      reply_markup:{
        keyboard: buttons
      },
      parse_mode: 'Markdown'
    };
    sendMessage(chatId, message.length==1?"You are not subscribed to any courses":message.join("\n"), opts);
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

  if (to == "me")
    to = chatId;

  if (message == "" || message == undefined || message == null)
    message = "empty"

  if (to == "*") {
    db.ref("users").once("value").then(r => {
      r.forEach(snap => {
        sendMessage(snap.key, message)
      })
    })
  } else {
    sendMessage(to, message)
  }
  if (to != adminChatId) {
    sendMessage(adminChatId, `You send to ${to}:\n\n${message}`)
  }
});

async function sendMessage(to, text, options) {
  let success = true;
  await bot.sendMessage(to, text,options).then(r => {
    console.log(`Successfully sended to user ${to} the following message: ${text}`)
  }).catch(e => {
    console.log("Can't send message: " + text)
    console.log(e)
    success = false;
    stopUser(to);
  })
  return success
}

// dont send message to the user in this methode
async function stopUser (chatId, force) {
  if  (force == undefined)
    force = true;
  const user = (await db.ref("users").child(chatId).once("value")).val();
  const subscribes = user.subscribes;

  if (user == null || subscribes == null) return;
  for(const sub in subscribes) {
    const val = subscribes[sub].split("-")
    unsubscribe(chatId, val[1], val[2], val[0] == LS, force);
  }
  sendMessage(adminChatId, `*${chatId}*'s *${subscribes.length}* subscriptions are canceled, force: ${force}`, {parse_mode: 'Markdown'});
}

bot.onText(/\/course (.+)/, async(msg, match) => {

  const chatId = msg.chat.id

  const splitted = match[1].split(" ");

  if (chatId != adminChatId)
    return;

  const subj = splitted[0].toUpperCase();
  const crn = splitted[1];

  if (splitted.length <= 1 || subj.length != 3 || crn.length != 5 || /[^A-Z]/.test(subj) || /[^0-9]/.test(crn)) {
    sendMessage(chatId, "Please type in this format /course <CODE> <CRN> <LU (optional)>")
    return
  }

  const isBsc = splitted.length > 2 ? (splitted[2].toUpperCase() != LU) : LS;

  const LSU = isBsc ? LS : LU;

  let counter = 0;
  let message = "";

  const userIds = (await db.ref("listeners").child(LSU).child(subj).child(crn).once("value")).val();
  if (userIds == null || userIds == undefined)
    return;
  userIds.forEach(userId => {
    counter++;
    message += `\n${JSON.stringify(userId)}`
  })

  message = `The *${subj} ${crn}* course is followed by the following *${counter}* users:\n` + message;

  sendMessage(chatId, message, {parse_mode: 'Markdown'})
});

bot.onText(/\/subscribe (.+)/, async(msg, match) => {

  const chatId = msg.chat.id
  const splitted = match[1].split(" ");

  const subj = splitted[0].toUpperCase();
  const crn = splitted[1];

  if (splitted.length <= 1 || subj.length != 3 || crn.length != 5 || /[^A-Z]/.test(subj) || /[^0-9]/.test(crn)) {
    sendMessage(chatId, "Please type in this format /subscribe <CODE> <CRN> <LU (optional)>")
    return
  }

  const isBsc = splitted.length > 2 ? (splitted[2].toUpperCase() != LU):LS;

  const LSU = isBsc?LS:LU;
  const options = getOptions(subj, LSU);
  const obj = await fetchUrl(options, subj, LSU);
  if (obj == undefined) {
    sendMessage(chatId, `A course named *${subj}* could not be found. Please see ${URL}`, {parse_mode: 'Markdown'})
    return
  }
  if (obj[crn] == undefined ||obj[crn].course_code == undefined || obj[crn].capacity == undefined|| obj[crn].enrolled == undefined) {
    sendMessage(chatId, `No registration for *${subj} ${crn}* Please check the required values from ${options.url}`, {parse_mode: 'Markdown'})
    return
  }

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
      sendMessage(chatId, "You are already subscribed " + subj + " " + crn)
    } else {
      const child = (isBsc?LS:LU) + "-" + subj + "-" + crn;
      db.ref("users").child(chatId).child("subscribes").transaction(val => {
        if (val === null)
          return [child];
        val.push(child);
        return val;
      });

      sendMessage(chatId, `Successfully subscribed to *${obj[crn].course_code} ${crn}*.\nQuota status: *${obj[crn].enrolled}/${obj[crn].capacity}*`,{parse_mode: 'Markdown'})
    }
  });
})

bot.onText(/\/unsubscribe (.+)/, (msg, match) => {

  const chatId = msg.chat.id
  const splitted = match[1].split(" ");

  const subj = splitted[0].toUpperCase();

  if (subj == '*') {
    stopUser(chatId, false).then(r => {
      sendMessage(chatId, "You have successfully unsubscribe from all courses")
    });
    return;
  }

  const crn = splitted[1];
  const isBsc = splitted.length > 2 ? (splitted[2].toUpperCase() != LU):true;

  if (splitted.length <= 1 || subj.length != 3 || crn.length != 5 || /[^A-Z]/.test(subj) || /[^0-9]/.test(crn)) {
    sendMessage(chatId, "Please type in this format /unsubscribe <CODE> <CRN> <LU (optional)>")
    return
  }

  unsubscribe(chatId, subj, crn, isBsc, false)
})

function unsubscribe(chatId, subj, crn, isBsc, silent) {
  if (silent == undefined)
    silent = false;
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
      },
      parse_mode: 'Markdown'
    };
    if (wasListened) {
      if (silent) {
        sendMessage(adminChatId, `*${subj} ${crn}* subscription was removed due to failure to send a message to *${chatId}*`, opts)
      } else {
        sendMessage(chatId, "You are now not subscribing *" + subj + " " + crn + "*", opts)
      }
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
      if (!silent) {
        sendMessage(chatId, "You were not already subscribing " + subj + " " + crn, opts)
      }
    }
  });
}

async function fetchUrl(options, subj, LSU) {
  console.log("Launched: " + options.url);
  let html = await rp(options);

  const obj = {};
  try {
    if (html == undefined) return
    html = html.toString();
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
    html.forEach(e => {
      const subObj = tdToCapacityEnrolled(e);
      obj[subObj.crn] = subObj;
    })
  } catch (e) {
    console.log("Hata a: " + obj.crn)
    console.log(e)
    console.log(options.url)
  }

  return obj;
}

exports.checkKontenjan = functions.region('europe-west1').runWith(runtimeOpts).pubsub.schedule('5,20,35,50 * * * *').timeZone(TIME_ZONE).onRun( async (context) => {
  return;
  const listeners = (await db.ref("listeners").once("value")).val()
  let adminMessage = "";
  const startDate = new Date();
  let totalTotalSent = 0;
  let totalSubscriptions = 0;
  let totalDifferentSubscriptions = 0;
  for (const LSU of [LS, LU]) {

    for(const subj in listeners[LSU]) {

      const options = getOptions(subj, LSU);
      const obj = await fetchUrl(options, subj, LSU);
      for(const crn in listeners[LSU][subj]) {

      try {
        const totalSent = Object.keys(listeners[LSU][subj][crn]).length;
        totalSubscriptions += totalSent;
        totalDifferentSubscriptions++;
        const emptyPlaces = obj[crn].capacity - obj[crn].enrolled;

        if (emptyPlaces > 0) {
          totalTotalSent += totalSent;
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

            await sendMessage(chatId, `*${subj} ${crn}*
` + `*${emptyPlaces}* place available
` + (totalSent == 1 ? `This message was *just* sent to you` :
                `This message was sent to *${totalSent}* students.`), opts). then(r => {
                  if (!r) {
                    unsubscribe(chatId, subj, crn, LSU == LS, true)
                  }
              });
            }

            if (totalSent != 0) {
              const emptyPlacesString = emptyPlaces >= 10? emptyPlaces:" "+emptyPlaces;
              adminMessage += `\n*${totalSent}* people were texted *${emptyPlacesString}* places are free in *${subj} ${crn}*`;
            }
          }
        } catch (e) {
          console.log("Hata b")
          console.log(options.url)
          console.log(e)
        }
      }
    }
  }
  adminMessage = `This calculation took *${new Date() - startDate}* milliseconds\n` +
      `There are *${totalSubscriptions}* subscriptions in total and *${totalDifferentSubscriptions}* uniq\n` +
      `*${totalTotalSent}* people in total were informed\n` +
      adminMessage;
  sendMessage(adminChatId, adminMessage.trim(), {parse_mode: 'Markdown', disable_notification: true})
  return null;
});

function getOptions(subj, level) {
  if (level != LU && level != LS)
    level = LU;
  const url = URL + "?seviye=" + level + "&derskodu="+subj;
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
