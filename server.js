import express from 'express';
import OpenAI, { toFile } from 'openai';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
app.use(express.json({ limit: '7mb' }));
app.use(express.static(__dirname));

const apiKey = process.env.OPENAI_API_KEY;
const textModel = process.env.OPENAI_TEXT_MODEL || 'gpt-6.2-sol';
const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare';
const openai = apiKey ? new OpenAI({ apiKey }) : null;

function requireAI(req, res, next) {
  if (!openai) return res.status(503).json({ error: 'لم يتم إعداد OPENAI_API_KEY في ملف .env على الخادم.' });
  next();
}
function validImage(data) {
  return typeof data === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(data) && data.length < 6_500_000;
}

app.post('/api/ai-edit', requireAI, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim().slice(0, 3000);
    if (!prompt) return res.status(400).json({ error: 'اكتب وصف التعديل أولاً.' });
    const content = [{ type: 'input_text', text: `طلب صاحب الموقع: ${prompt}\n\nحلل الطلب واقترح فقط تعديلات واجهة ضمن الحقول المسموحة. لا تقترح تنفيذ شيفرة أو HTML أو JavaScript. أعد JSON فقط بالشكل: {"explanation":"شرح عربي مختصر","changes":{"name":"اسم الموقع اختياري","accent":"لون HEX اختياري","heroTitle":"عنوان الصفحة اختياري","subtitle":"وصف قصير اختياري","theme":"light أو dark اختياري","access":"free أو paid اختياري"}}. لا تملأ حقلاً لم يطلبه المستخدم. لا تضع ألواناً إلا بصيغة #RRGGBB.` }];
    if (validImage(req.body?.referenceImage)) content.push({ type: 'input_image', image_url: req.body.referenceImage });
    const response = await openai.responses.create({
      model: textModel,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_object' } }
    });
    let parsed;
    try { parsed = JSON.parse(response.output_text || '{}'); }
    catch { return res.status(502).json({ error: 'لم أستطع قراءة اقتراحات الذكاء الاصطناعي. حاول بصياغة أوضح.' }); }
    const raw = parsed.changes || {};
    const changes = {};
    if (typeof raw.name === 'string') changes.name = raw.name.slice(0, 60);
    if (typeof raw.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accent)) changes.accent = raw.accent;
    if (typeof raw.heroTitle === 'string') changes.heroTitle = raw.heroTitle.slice(0, 100);
    if (typeof raw.subtitle === 'string') changes.subtitle = raw.subtitle.slice(0, 240);
    if (['light', 'dark'].includes(raw.theme)) changes.theme = raw.theme;
    if (['free', 'paid'].includes(raw.access)) changes.access = raw.access;
    res.json({ explanation: String(parsed.explanation || 'هذه معاينة للتغييرات المقترحة.').slice(0, 500), changes });
  } catch (err) {
    console.error('ai-edit:', err?.status || '', err?.code || '', err?.message || err);
    const status = Number(err?.status) >= 400 && Number(err?.status) < 600 ? Number(err.status) : 500;
    let message = 'حدث خطأ أثناء الاتصال بخدمة الذكاء الاصطناعي.';
    if (status === 401) message = 'مفتاح OpenAI API غير صحيح. راجع قيمة OPENAI_API_KEY في ملف .env.';
    else if (status === 403) message = 'مفتاح API لا يملك صلاحية استخدام النموذج المطلوب.';
    else if (status === 404) message = 'اسم نموذج الذكاء الاصطناعي غير متاح. راجع إعداد OPENAI_TEXT_MODEL.';
    else if (status === 429) message = 'تم بلوغ حد الاستخدام أو لا يوجد رصيد API كافٍ. تحقق من إعدادات الاستخدام والفوترة.';
    else if (status === 400) message = 'رفضت واجهة OpenAI الطلب. تحقق من النموذج والصورة المرفقة.';
    res.status(status).json({ error: message, detail: process.env.NODE_ENV === 'development' ? String(err?.message || '') : undefined });
  }
});

app.post('/api/ai-design', requireAI, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim().slice(0, 2000);
    if (!prompt) return res.status(400).json({ error: 'اكتب وصف التصميم المطلوب.' });
    const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare';
    const imageData = req.body?.referenceImage;
    let result;
    if (validImage(imageData)) {
      const match = imageData.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const buffer = Buffer.from(match[2], 'base64');
      const file = await toFile(buffer, `reference.${ext}`, { type: `image/${match[1]}` });
      result = await openai.images.edit({
        model,
        prompt: `عدّل الصورة المرجعية لتصبح تصميماً احترافياً لواجهة موقع استماع للقرآن الكريم. ${prompt}. حافظ على وضوح التصميم وتجنب النصوص الطويلة والشعارات المحمية.`,
        image: file,
        size: '1536x1024',
        quality: 'medium'
      });
    } else {
      result = await openai.images.generate({
        model,
        prompt: `أنشئ صورة مرجعية لتصميم واجهة موقع استماع للقرآن الكريم. ${prompt}. اجعل التصميم أنيقاً وواضحاً، دون نصوص طويلة أو شعارات محمية.`,
        size: '1536x1024',
        quality: 'medium'
      });
    }
    const image = result?.data?.[0]?.b64_json;
    if (!image) return res.status(502).json({ error: 'لم تُرجع خدمة الصور ملف صورة. تحقق من صلاحية النموذج.' });
    res.json({ image });
  } catch (err) {
    console.error('ai-design:', err?.status || '', err?.code || '', err?.message || err);
    const status = Number(err?.status) >= 400 && Number(err.status) < 600 ? Number(err.status) : 500;
    let message = 'تعذر إنشاء الصورة بالذكاء الاصطناعي.';
    if (status === 401) message = 'مفتاح OpenAI API غير صحيح.';
    else if (status === 403 || status === 404) message = 'نموذج الصور غير متاح لمفتاح API الحالي. راجع OPENAI_IMAGE_MODEL وصلاحيات الحساب.';
    else if (status === 429) message = 'لا يوجد رصيد أو تجاوزت حد استخدام توليد الصور.';
    else if (status === 400) message = 'تعذر قبول الصورة المرجعية أو إعدادات توليد الصورة.';
    res.status(status).json({ error: message, detail: process.env.NODE_ENV === 'development' ? String(err?.message || '') : undefined });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, configured: Boolean(openai), textModel, imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare' }));
app.listen(PORT, HOST, () => {
  console.log(`QURAN MP3 running at http://${HOST}:${PORT}`);
  if (!openai) console.log('Set OPENAI_API_KEY in .env to enable real AI features.');
});
