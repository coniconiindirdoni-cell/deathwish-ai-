// ╔══════════════════════════════════════════════════════════════╗
// ║              AI Soru-Cevap Botu — TEK DOSYA                 ║
// ║  Bot @ etiketlenince sorulan soruya AI ile cevap verir.     ║
// ║  Sırasıyla dener: ChatGPT → Gemini → Groq                   ║
// ╠══════════════════════════════════════════════════════════════╣
// ║  Gerekli paketler (npm install):                             ║
// ║    discord.js  openai  @google/generative-ai  groq-sdk  dotenv ║
// ╠══════════════════════════════════════════════════════════════╣
// ║  .env dosyasına eklenecekler:                                ║
// ║    DISCORD_TOKEN   = Discord bot token                       ║
// ║    OPENAI_API_KEY  = ChatGPT API anahtarı   (opsiyonel)      ║
// ║    GEMINI_API_KEY  = Gemini API anahtarı    (opsiyonel)      ║
// ║    GROQ_API_KEY    = Groq API anahtarı      (opsiyonel)      ║
// ║    AI_SYSTEM_PROMPT= Botun kişiliği         (opsiyonel)      ║
// ║  En az 1 AI anahtarı olması yeterli.                         ║
// ╚══════════════════════════════════════════════════════════════╝

require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const { OpenAI }                    = require('openai');
const { GoogleGenerativeAI }        = require('@google/generative-ai');
const Groq                          = require('groq-sdk');

// ──────────────────────────────────────────────────────────────
//  AYARLAR
// ──────────────────────────────────────────────────────────────
const DISCORD_TOKEN    = process.env.DISCORD_TOKEN    || '';
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY   || '';
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY   || '';
const GROQ_API_KEY     = process.env.GROQ_API_KEY     || '';
const AI_SYSTEM_PROMPT = process.env.AI_SYSTEM_PROMPT ||
  'Sen yardımcı bir Discord botusun. Türkçe konuş, kısa ve net cevaplar ver.';

if (!DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN bulunamadı! .env dosyasını kontrol et.');
  process.exit(1);
}

if (!OPENAI_API_KEY && !GEMINI_API_KEY && !GROQ_API_KEY) {
  console.warn('⚠️  Hiçbir AI API anahtarı bulunamadı. Bot çalışır ama cevap veremez.');
}

// ──────────────────────────────────────────────────────────────
//  AI FALLBACK: ChatGPT → Gemini → Groq
// ──────────────────────────────────────────────────────────────
async function askAI(soru) {
  const messages = [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    { role: 'user',   content: soru },
  ];

  // 1️⃣  ChatGPT
  if (OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
      const res = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages,
        max_tokens: 1000,
      });
      return res.choices[0].message.content.trim();
    } catch (e) {
      console.log(`[AI] ChatGPT hata (${e?.status ?? e?.message}) → Gemini deneniyor...`);
    }
  }

  // 2️⃣  Gemini
  if (GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        systemInstruction: AI_SYSTEM_PROMPT,
      });
      const result = await model.generateContent(soru);
      return result.response.text().trim();
    } catch (e) {
      console.log(`[AI] Gemini hata (${e?.message}) → Groq deneniyor...`);
    }
  }

  // 3️⃣  Groq
  if (GROQ_API_KEY) {
    try {
      const groq = new Groq({ apiKey: GROQ_API_KEY });
      const res = await groq.chat.completions.create({
        model: 'llama3-8b-8192',
        messages,
        max_tokens: 1000,
      });
      return res.choices[0].message.content.trim();
    } catch (e) {
      console.log(`[AI] Groq hata (${e?.message})`);
    }
  }

  return '❌ Şu an tüm AI servisleri meşgul veya API anahtarı eksik. Biraz sonra tekrar dene!';
}

// ──────────────────────────────────────────────────────────────
//  DISCORD İSTEMCİSİ
// ──────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`✅ Bot hazır: ${client.user.tag}`);
  console.log(`📌 Aktif AI'lar: ${[
    OPENAI_API_KEY  ? 'ChatGPT' : null,
    GEMINI_API_KEY  ? 'Gemini'  : null,
    GROQ_API_KEY    ? 'Groq'    : null,
  ].filter(Boolean).join(' → ') || 'YOK'}`);
});

// ──────────────────────────────────────────────────────────────
//  GÜNLÜK LİMİT — kullanıcı başına günde 30 hak
// ──────────────────────────────────────────────────────────────
const GUNLUK_LIMIT = 30;
// Map<userId, { tarih: 'YYYY-MM-DD', sayi: number }>
const kullanimMap = new Map();

function bugun() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function hakKontrol(userId) {
  const bugunTarih = bugun();
  const kayit = kullanimMap.get(userId);

  // Yeni gün veya hiç kayıt yoksa sıfırla
  if (!kayit || kayit.tarih !== bugunTarih) {
    kullanimMap.set(userId, { tarih: bugunTarih, sayi: 0 });
    return { kalan: GUNLUK_LIMIT, bitti: false };
  }

  const kalan = GUNLUK_LIMIT - kayit.sayi;
  return { kalan, bitti: kalan <= 0 };
}

function hakKullan(userId) {
  const bugunTarih = bugun();
  const kayit = kullanimMap.get(userId) || { tarih: bugunTarih, sayi: 0 };
  kayit.sayi += 1;
  kullanimMap.set(userId, kayit);
}

// ──────────────────────────────────────────────────────────────
//  @ ETİKETİ ALGILAMA
// ──────────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  // Botlardan gelen mesajları yoksay
  if (message.author.bot) return;

  // Sadece bot @ etiketlenince çalış
  if (!message.mentions.has(client.user)) return;

  // @ etiketini temizle, asıl soruyu al
  const soru = message.content
    .replace(/<@!?[\d]+>/g, '')
    .trim();

  // Soru yoksa yönlendir
  if (!soru) {
    return message.reply('Merhaba! Bana bir şey sormak için @ etiketle birlikte soruyu yaz. 😊');
  }

  // Günlük limit kontrolü
  const { kalan, bitti } = hakKontrol(message.author.id);
  if (bitti) {
    return message.reply(`⛔ Bugünlük ${GUNLUK_LIMIT} soru hakkını doldurdun. Yarın tekrar kullanabilirsin!`);
  }

  // Hakkı kullan
  hakKullan(message.author.id);

  // "Yazıyor..." göster
  await message.channel.sendTyping().catch(() => {});

  // AI'dan cevap al
  const cevap = await askAI(soru);

  // Cevap 2000 karakterden uzunsa parçalara böl (Discord limiti)
  if (cevap.length <= 2000) {
    await message.reply(cevap);
  } else {
    const parcalar = cevap.match(/[\s\S]{1,1990}/g) || [];
    await message.reply(parcalar[0]);
    for (let i = 1; i < parcalar.length; i++) {
      await message.channel.send(parcalar[i]);
    }
  }
});

client.login(DISCORD_TOKEN);
