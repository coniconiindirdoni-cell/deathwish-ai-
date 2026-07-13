// ╔══════════════════════════════════════════════════════════════╗
// ║              AI Soru-Cevap Botu — TEK DOSYA                 ║
// ║  Bot @ etiketlenince sorulan soruya Groq ile cevap verir.   ║
// ║  12 saatte kullanıcı başına 50 soru hakkı                   ║
// ║  Kullanım verileri GitHub'a yedeklenir                      ║
// ╚══════════════════════════════════════════════════════════════╝

require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const Groq                          = require('groq-sdk');
const http                          = require('http');

// ──────────────────────────────────────────────────────────────
//  AYARLAR
// ──────────────────────────────────────────────────────────────
const DISCORD_TOKEN    = process.env.DISCORD_TOKEN || '';
const GROQ_API_KEY     = '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';
const GITHUB_TOKEN     = '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';
const GITHUB_REPO      = 'coniconiindirdoni-cell/ai-backup';
const GITHUB_FILE      = 'kullanim.json';
const KANAL_ID         = '1526015242365042721';
const LIMIT            = 50;          // 12 saatte kaç soru
const LIMIT_MS         = 12 * 60 * 60 * 1000; // 12 saat (ms)
const AI_SYSTEM_PROMPT = 'Sen yardımcı bir Discord botusun. Türkçe konuş, kısa ve net cevaplar ver.';

if (!DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN bulunamadı!');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────
//  GITHUB YEDEK — yükle / kaydet
// ──────────────────────────────────────────────────────────────
// Map<userId, { baslangic: timestamp, sayi: number }>
let kullanimMap = new Map();
let sonYedekJson = null; // bot kapanınca boşsa bunu kullanırız

async function githubDosyaOku() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const icerik = Buffer.from(data.content, 'base64').toString('utf8').trim();
    return { icerik, sha: data.sha };
  } catch (e) {
    console.log('[GitHub] Okuma hatası:', e.message);
    return null;
  }
}

async function githubYukle() {
  const sonuc = await githubDosyaOku();
  if (!sonuc) {
    console.log('[GitHub] Dosya bulunamadı veya hata — boş harita ile başlıyorum.');
    return;
  }
  try {
    const obj = JSON.parse(sonuc.icerik);
    if (obj && typeof obj === 'object' && Object.keys(obj).length > 0) {
      kullanimMap = new Map(Object.entries(obj));
      sonYedekJson = sonuc.icerik;
      console.log(`[GitHub] Veri yüklendi: ${kullanimMap.size} kullanıcı`);
    } else if (sonYedekJson) {
      // Dosya boş — son yedeği kullan
      kullanimMap = new Map(Object.entries(JSON.parse(sonYedekJson)));
      console.log('[GitHub] Dosya boştu, son yedek kullanıldı.');
    }
  } catch (e) {
    console.log('[GitHub] JSON parse hatası:', e.message);
  }
}

async function githubKaydet() {
  try {
    const obj = Object.fromEntries(kullanimMap);
    const yeniJson = JSON.stringify(obj, null, 2);

    // sha almak için önce oku
    const mevcut = await githubDosyaOku();
    const body = {
      message: `Kullanım güncellendi — ${new Date().toISOString()}`,
      content: Buffer.from(yeniJson).toString('base64'),
    };
    if (mevcut?.sha) body.sha = mevcut.sha;

    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (res.ok) {
      sonYedekJson = yeniJson;
      console.log('[GitHub] Veri kaydedildi.');
    } else {
      const err = await res.json();
      console.log('[GitHub] Kayıt hatası:', err.message);
    }
  } catch (e) {
    console.log('[GitHub] Kayıt exception:', e.message);
  }
}

// Her 5 dakikada bir otomatik kaydet
setInterval(githubKaydet, 5 * 60 * 1000);

// ──────────────────────────────────────────────────────────────
//  12 SAATLİK LİMİT
// ──────────────────────────────────────────────────────────────
function hakKontrol(userId) {
  const simdi = Date.now();
  const kayit = kullanimMap.get(userId);

  if (!kayit || (simdi - kayit.baslangic) >= LIMIT_MS) {
    // Süresi dolmuş veya ilk kez
    return { kalan: LIMIT, bitti: false, yeni: true };
  }

  const kalan = LIMIT - kayit.sayi;
  const kalanMs = LIMIT_MS - (simdi - kayit.baslangic);
  const kalanDak = Math.ceil(kalanMs / 60000);
  return { kalan, bitti: kalan <= 0, kalanDak, yeni: false };
}

function hakKullan(userId) {
  const simdi = Date.now();
  const kayit = kullanimMap.get(userId);

  if (!kayit || (simdi - kayit.baslangic) >= LIMIT_MS) {
    kullanimMap.set(userId, { baslangic: simdi, sayi: 1 });
  } else {
    kayit.sayi += 1;
    kullanimMap.set(userId, kayit);
  }
}

// ──────────────────────────────────────────────────────────────
//  GROQ
// ──────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: GROQ_API_KEY });

async function askGroq(soru) {
  try {
    const res = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user',   content: soru },
      ],
      max_tokens: 1000,
    });
    return res.choices[0].message.content.trim();
  } catch (e) {
    console.log('[Groq] Hata:', e.message);
    return '❌ Şu an AI servisine ulaşılamıyor. Biraz sonra tekrar dene!';
  }
}

// ──────────────────────────────────────────────────────────────
//  DISCORD
// ──────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', async () => {
  console.log(`✅ Bot hazır: ${client.user.tag}`);
  await githubYukle();
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== KANAL_ID) return;
  if (!message.mentions.has(client.user)) return;

  const soru = message.content.replace(/<@!?[\d]+>/g, '').trim();

  if (!soru) {
    return message.reply('Merhaba! Sormak istediğin şeyi @ ile birlikte yaz. 😊');
  }

  const { kalan, bitti, kalanDak } = hakKontrol(message.author.id);

  if (bitti) {
    const saat = Math.floor(kalanDak / 60);
    const dak  = kalanDak % 60;
    const sure = saat > 0 ? `${saat} saat ${dak} dakika` : `${dak} dakika`;
    return message.reply(`⛔ 12 saatlik ${LIMIT} soru hakkını doldurdun. **${sure}** sonra tekrar kullanabilirsin!`);
  }

  hakKullan(message.author.id);
  const kalanSonra = kalan - 1;

  await message.channel.sendTyping().catch(() => {});

  const cevap = await askGroq(soru);

  const footer = `\n\n-# 📊 Kalan hakkın: ${kalanSonra}/${LIMIT} (12 saatlik)`;
  const tamCevap = cevap + footer;

  if (tamCevap.length <= 2000) {
    await message.reply(tamCevap);
  } else {
    const parcalar = cevap.match(/[\s\S]{1,1990}/g) || [];
    await message.reply(parcalar[0]);
    for (let i = 1; i < parcalar.length; i++) {
      await message.channel.send(parcalar[i]);
    }
    await message.channel.send(footer.trim());
  }
});

client.login(DISCORD_TOKEN);

// Render port kontrolü
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Bot çalışıyor!')).listen(PORT, () => {
  console.log(`🌐 HTTP sunucusu ${PORT} portunda açık`);
});
