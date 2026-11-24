import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = getFirestore();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

async function sendTelegram(chatId, text) {
  await fetch(`https://telegram.org{BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function askGemini(prompt) {
  const res = await fetch(
    `https://googleapis.com{GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );
  const data = await res.json();
const raw = data?.candidates?.at(0)?.content?.parts?.at(0)?.text || "{}";
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    const msg = req.body?.message;
    if (!msg || !msg.text) return res.status(200).send("OK");

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    // 한나님의 채팅방 ID 자동 저장 (선톡 알림용)
    await db.collection("bot_config").doc("owner").set({ chatId }, { merge: true });

    // 현재 저장된 할 일/메모 불러오기
    const snap = await db.collection("tasks").where("done", "==", false).get();
    const currentTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const nowKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

    const systemPrompt = `
너는 한나 공주님을 모시는 로맨스 판타지 세계관의 충직하고 유쾌한 전속 집사야.
항상 공주님("공주님")께 정중하면서도 다정하게 잔소리와 응원을 해줘.
현재 한국 시간: ${nowKST}

공주님의 6대 영역:
1. 세탁소 (신데렐라세탁 점주: 수거/배송/정산)
2. 건축사 (대상 건축사사무소 관리부: 매일 오전 11시 입찰공고 확인, 마케팅)
3. 교회 (신앙관리부 팀장: 화요일 12시 주일예배 복기, 금요일 12시 수요예배 복기, 구역 관리)
4. 과외 (주말 토/일 오전 7:30 김우진, 저녁 17:00 정도윤 수업)
5. 유튜브 ('깡순이의 깡촌생활' AI 캐릭터 영상 기획/제작/업로드)
6. 집안일 (남자친구와 동거 생활: 세탁기, 건조기 옮기기, 설거지, 장보기 등)

현재 미완료 목록: ${JSON.stringify(currentTasks)}

공주님의 메시지: "${text}"

위 메시지를 분석해서 아래 JSON 형식으로만 응답해:
{
  "action": "add" | "complete" | "list" | "chat",
  "items": [
    { "category": "세탁소|건축사|교회|과외|유튜브|집안일", "type": "todo|idea", "title": "정리된 내용", "due": "기한이나 시간(없으면 빈칸)" }
  ],
  "completeIds": ["완료 처리할 기존 항목의 id 배열"],
  "reply": "집사가 공주님께 보낼 실제 텔레그램 답장 메시지 (이모지 포함, 읽기 편하게 줄바꿈)"
}
`;

    const result = await askGemini(systemPrompt);

    if (result.action === "add" && Array.isArray(result.items)) {
      for (const item of result.items) {
        await db.collection("tasks").add({
          category: item.category || "집안일",
          type: item.type || "todo",
          title: item.title,
          due: item.due || "",
          done: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }

    if (result.action === "complete" && Array.isArray(result.completeIds)) {
      for (const id of result.completeIds) {
        await db.collection("tasks").doc(id).update({ done: true });
      }
    }

    await sendTelegram(chatId, result.reply || "알겠습니다, 공주님! 잘 기록해 두었습니다.");
    return res.status(200).send("OK");
  } catch (e) {
    console.error(e);
    return res.status(200).send("OK");
  }
}
