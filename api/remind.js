import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = getFirestore();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function sendTelegram(chatId, text) {
  await fetch(`https://telegram.org{BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export default async function handler(req, res) {
  try {
    const ownerDoc = await db.collection("bot_config").doc("owner").get();
    const chatId = ownerDoc.data()?.chatId;
    if (!chatId) return res.status(200).send("No owner yet");

    // 한국 시간(KST) 계산
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const day = kst.getUTCDay(); // 0:일, 1:월, 2:화, 3:수, 4:목, 5:금, 6:토
    const hour = kst.getUTCHours();
    const min = kst.getUTCMinutes();
    const dateKey = kst.toISOString().slice(0, 10);

    const isWeekend = day === 0 || day === 6;
    const isWeekday = !isWeekend;

    let slot = "";
    let message = "";

    // 1. 주말 오전 07:00~07:09 -> 김우진 과외 (07:30 수업)
    if (isWeekend && hour === 7 && min < 10) {
      slot = "weekend_morning";
      message = "🌅 좋은 아침입니다, 공주님!\n잠시 후 오전 7시 30분부터 [📚 김우진 학생 과외]가 시작됩니다. 교재와 수업 준비물을 확인해 주세요!";
    }
    // 2. 주말 오후 16:20~16:29 -> 정도윤 과외 (17:00 수업)
    else if (isWeekend && hour === 16 && min >= 20 && min < 30) {
      slot = "weekend_evening";
      message = "🌇 공주님, 저녁 수업 안내드립니다!\n오후 5시(17:00)부터 [📚 정도윤 학생 과외]가 예정되어 있습니다. 파이팅입니다!";
    }
    // 3. 평일 오전 10:40~10:49 -> 건축사 입찰공고 확인 (11:00)
    else if (isWeekday && hour === 10 && min >= 40 && min < 50) {
      slot = "weekday_bid";
      const churchNote =
        day === 2
          ? "\n\n⛪ [긴급] 오늘 화요일 낮 12시 전까지 교관님께 주일예배 복기 보고를 올리셔야 합니다!"
          : day === 5
          ? "\n\n⛪ [긴급] 오늘 금요일 낮 12시 전까지 교관님께 수요예배 복기 보고를 올리셔야 합니다!"
          : "";
      message = `🏢 공주님, 오전 브리핑입니다!\n잠시 후 오전 11시는 [대상 건축사 입찰공고 확인] 시간입니다. 놓치지 말고 확인해 주세요!${churchNote}`;
    }
    // 4. 매일 저녁 21:00~21:09 -> 집안일 & 미완료 할 일 브리핑
    else if (hour === 21 && min < 10) {
      slot = "daily_night";
      const snap = await db.collection("tasks").where("done", "==", false).get();
      const todos = snap.docs.map((d) => `• [${d.data().category}] ${d.data().title}`).join("\n");
      message = `🌙 공주님, 하루를 마무리할 시간입니다!\n\n🏠 [침소 점검] 세탁기 돌리기, 건조기 옮기기, 설거지는 마무리되셨나요?\n🎬 [유튜브] 깡순이의 깡촌생활 새 아이디어가 있다면 지금 톡으로 던져주세요!\n\n📋 현재 남은 기록:\n${todos || "모두 완료하셨습니다! 훌륭합니다 공주님 👑"}`;
    }

    if (!slot) return res.status(200).send("No schedule now");

    // 중복 발송 방지 체크
    const logId = `${dateKey}_${slot}`;
    const logRef = db.collection("remind_logs").doc(logId);
    const logSnap = await logRef.get();
    if (logSnap.exists) return res.status(200).send("Already sent");

    await sendTelegram(chatId, message);
    await logRef.set({ sentAt: new Date() });

    return res.status(200).send("Sent!");
  } catch (e) {
    console.error(e);
    return res.status(200).send("Error");
  }
}
