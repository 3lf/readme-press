<div dir="rtl">

<p align="center">
  <a href="./README.md">English</a> · <strong>فارسی</strong>
</p>

# معرفی README Press 📚

ابزار README Press یه فایل Markdown بلند رو به کتاب PDF حرفه‌ای و آماده انتشار تبدیل می‌کنه.

این موتور برای پروژه‌هایی ساخته شده که `README.md` منبع اصلی محتواشونه. ساختار چاپ، تایپوگرافی، کاور، کیفیت تصاویر و بررسی‌های انتشار توی فایل تنظیمات می‌مونن؛ بنابراین لازم نیست متن اصلی رو با جزئیات مخصوص PDF شلوغ کنی.

اولین پیاده‌سازی واقعی README Press برای یه کتاب فارسی و راست‌به‌چپ ساخته شد. به همین خاطر پشتیبانی از متن‌های دوجهته، فونت‌های محلی و QA تصویری از روز اول جزو هسته موتور بودن. حالا موتور عمومیه و می‌تونه کتاب‌های چپ‌به‌راست، راست‌به‌چپ یا ترکیبی رو از پروژه‌های Markdown سازگار بسازه.

## چه چیزهایی تحویل می‌گیری؟ ✨

- **پردازش Markdown گیت‌هاب:** همراه با مقصدهای پایدار و سازگار با انکرهای GitHub
- **ساختار قابل تنظیم:** برای مقدمه، بخش‌ها، فصل‌ها و عمق دلخواه فهرست مطالب
- **پشتیبانی درست از RTL:** برای فارسی و بقیه زبان‌های راست‌به‌چپ، حتی وقتی متن فارسی و لاتین کنار هم میان
- **رندر کامل محتوا:** شامل کد با Shiki، نمودار Mermaid، ایموجی محلی، جدول، callout و تصویر
- **خروجی قابل جستجو:** با بدنه تگ‌شده Vivliostyle و کاور امن برای چاپ با کیفیت ۳۰۰ DPI
- **ناوبری کامل:** شامل bookmark، مقصد داخلی، لینک ریپو، QR code و فوتر قابل ردیابی
- **دو کیفیت خروجی:** نسخه عادی با تصاویر JPEG بهینه و نسخه باکیفیت با PNG بدون افت
- **بررسی عمومی PDF:** برای ابعاد، فونت، لینک، مقصد داخلی، کیفیت تصویر، رندر همه صفحه‌ها و برابری دو نسخه
- **فایل‌های انتشار تکرارپذیر:** شامل manifest، هش SHA-256 و متن آماده Release

قالب آماده موتور `lapis-rtl` نام داره. هر پروژه می‌تونه به‌جاش stylesheet، کاور، فونت، تنظیمات Mermaid و بررسی‌های مخصوص خودش رو معرفی کنه.

## پیش‌نیازها 🧰

- **نسخه Node.js:** نسخه ۲۲ یا جدیدتر
- **ابزار qpdf:** برای ساخت PDF بهینه و linearized
- **ابزارهای Poppler:** شامل `pdfinfo`، `pdffonts`، `pdftotext`، `pdfimages` و `pdftoppm`

روی Ubuntu این ابزارها رو با فرمان زیر نصب کن:

```bash
sudo apt-get update
sudo apt-get install -y poppler-utils qpdf
```

روی macOS هم این فرمان کافیه:

```bash
brew install poppler qpdf
```

## استفاده در GitHub Actions 🚀

برای خروجی قابل تکرار، همیشه نسخه مشخصی از Action رو pin کن:

```yaml
jobs:
  book:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7

      - name: Build and fully verify both PDF qualities
        uses: 3lf/readme-press@v0.1.1
        with:
          command: pipeline
          config: book/readme-press.config.mjs
          release-version: v1.0.0
          source-commit: ${{ github.sha }}
          render-all: true
```

این Action وابستگی‌های قفل‌شده خودش رو نصب می‌کنه، هر دو کیفیت رو می‌سازه، همه صفحه‌ها رو رندر می‌کنه، QA عمومی و بررسی‌های مخصوص پروژه رو اجرا می‌کنه و در پایان checksum و متن Release تحویل می‌ده.

## اجرای محلی 🛠️

همون tagی رو clone کن که توی CI استفاده می‌شه تا وابستگی‌ها و نتیجه ساخت محلی با سرور یکی بمونه:

```bash
git clone --branch v0.1.1 --depth 1 https://github.com/3lf/readme-press.git .readme-press
npm ci --prefix .readme-press
node .readme-press/bin/readme-press.mjs version
```

بعد از داخل ریپوی کتاب، CLI رو با فایل تنظیمات پروژه اجرا کن:

```bash
node .readme-press/bin/readme-press.mjs build \
  --config book/readme-press.config.mjs \
  --quality all
```

نسخه‌های `v0.1.x` به شکل GitHub Action و سورس قفل‌شده منتشر می‌شن. انتشار توی npm فعلاً عقب افتاده تا زنجیره ابزار PDF بتونه همون گراف وابستگی بررسی‌شده رو توی نصب‌های پایین‌دستی هم حفظ کنه.

## کمترین تنظیمات لازم ⚙️

کنار README اصلی یه فایل `readme-press.config.mjs` بساز:

```javascript
export default {
  source: "README.md",
  outputDir: "dist",
  metadata: {
    title: "My Book",
    subtitle: "A practical guide",
    author: "Example Author",
    edition: "First edition · 2026",
    language: "en",
    direction: "ltr"
  },
  repository: {
    url: "https://github.com/example/my-book"
  },
  structure: {
    introHeading: "Introduction",
    githubTocHeading: "Contents",
    parts: [
      { title: "Foundations", startHeading: "First chapter" }
    ]
  },
  outputs: {
    normal: "my-book.pdf",
    high: "my-book-high-quality.pdf"
  }
};
```

قرارداد ساختار متن عمداً کوچیک نگه داشته شده:

- **مقدمه:** یک تیتر سطح یک برای شروع کتاب
- **فهرست وب:** یک تیتر سطح یک برای فهرست دست‌نویس GitHub
- **فصل‌ها:** تیترهای سطح یک بعد از فهرست
- **بخش‌ها:** یک تیتر فصل تنظیم‌شده برای شروع هر بخش

## ساخت کتاب 🏗️

برای ساخت نسخه عادی، باکیفیت یا هر دو نسخه از این فرمان‌ها استفاده کن:

```bash
node .readme-press/bin/readme-press.mjs build --config readme-press.config.mjs --quality normal
node .readme-press/bin/readme-press.mjs build --config readme-press.config.mjs --quality high
node .readme-press/bin/readme-press.mjs build --config readme-press.config.mjs --quality all
```

برای ساخت یه کاندید انتشار دقیق، شماره نسخه رو هم بده:

```bash
node .readme-press/bin/readme-press.mjs build \
  --config readme-press.config.mjs \
  --quality all \
  --release-version v1.0.0
```

شماره نسخه داخل شناسنامه کتاب، metadata فایل PDF و `manifest.json` ثبت می‌شه.

اگه می‌خوای ساخت، QA کامل و آماده‌سازی فایل‌های انتشار با یک فرمان انجام بشه، پایپلاین رو اجرا کن:

```bash
node .readme-press/bin/readme-press.mjs pipeline \
  --config book/readme-press.config.mjs \
  --release-version v1.0.0 \
  --commit FULL_GIT_COMMIT \
  --render-all
```

## بررسی خروجی ✅

برای بررسی هر دو کیفیت و رندر تک‌تک صفحه‌ها این فرمان رو اجرا کن:

```bash
node .readme-press/bin/readme-press.mjs qa \
  --config readme-press.config.mjs \
  --quality all \
  --release-version v1.0.0 \
  --render-all
```

گزینه `render-all` از Poppler می‌خواد همه صفحه‌های همه نسخه‌های انتخاب‌شده رو به تصویر تبدیل کنه. اگه رندر صفحه، تطابق تصویر بدون افت، ساختار PDF، برابری دو کیفیت، لینک‌ها، فونت‌ها یا قواعد پروژه ایراد داشته باشن، QA شکست می‌خوره.

هر پروژه می‌تونه بدون fork کردن موتور، بررسی‌های مخصوص خودش رو اضافه کنه:

```javascript
export default defineConfig({
  // ...
  qa: {
    script: "book/qa.mjs",
    minPages: 100,
    maxPages: 400,
    fontFamilies: ["Estedad", "Vazirmatn", "JetBrainsMono"],
    extractablePhrases: ["A phrase that must remain searchable"]
  }
});
```

ماژول QA باید یه تابع پیش‌فرض با ورودی `{ config, manifest, check }` export کنه. از این بخش برای قواعد ویرایشی، واژه‌ها، تعداد دقیق فصل‌ها یا بررسی‌های صفحه‌بندی مخصوص پروژه استفاده کن. بررسی ساختار PDF و رندر عمومی باید داخل خود README Press بمونه.

## آماده‌سازی فایل‌های انتشار 📦

```bash
node .readme-press/bin/readme-press.mjs release validate v1.0.0
node .readme-press/bin/readme-press.mjs release prepare \
  --config readme-press.config.mjs \
  --version v1.0.0 \
  --commit FULL_GIT_COMMIT
```

این مرحله هر دو خروجی رو با manifest تطبیق می‌ده و فایل‌های زیر رو می‌سازه:

- **فایل checksum:** فایل `SHA256SUMS.txt`
- **متن انتشار:** فایل `release-notes.md`

اگه شماره نسخه معتبر نباشه، commit منبع فرق کنه، فایلی گم شده باشه، هش عوض شده باشه یا تعداد صفحه‌های دو کیفیت یکی نباشه، آماده‌سازی Release متوقف می‌شه.

## قرارداد قالب سفارشی 🎨

برای انتخاب قالب خودت، مسیر stylesheet و کاور رو توی تنظیمات بده:

```javascript
theme: {
  directory: "book/theme",
  stylesheet: "book.css"
},
cover: {
  file: "book/theme/cover.html"
}
```

پوشه قالب می‌تونه `fonts/`، فایل `mermaid.config.json` و فایل `puppeteer-ci.json` داشته باشه. کاور باید یه عنصر با کلاس `.cover` ارائه بده. فیلدهای اختیاری `data-readme-press` هم اجازه می‌دن موتور اطلاعات زیر رو تزریق کنه:

- **نام مجموعه:** فیلد `series`
- **پیشوند عنوان:** فیلد `title-prefix`
- **عنوان اصلی:** فیلد `title`
- **شعار کوتاه:** فیلد `tagline`
- **نام نویسنده:** فیلد `author`
- **تاریخ محلی:** فیلد `date-local`
- **تاریخ لاتین:** فیلد `date-latin`
- **یادداشت ریپو:** فیلد `repository-note`
- **نشانی ریپو:** فیلد `repository`

## مجوز فونت‌ها 🔤

قالب داخلی `lapis-rtl` فونت‌های Estedad، Vazirmatn و JetBrains Mono رو همراه خودش داره. متن مجوز SIL Open Font License هر فونت داخل `themes/lapis-rtl/licenses/` نگهداری می‌شه. خود README Press هم با مجوز MIT منتشر شده.

## توسعه موتور 🧪

قبل از فرستادن تغییر، همه بررسی‌های محلی رو اجرا کن:

```bash
npm ci
npm test
npm run test:syntax
npm run test:action
npm run test:integration
npm run pack:check
npm audit --audit-level=low
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/ci.yml .github/workflows/release.yml
```

فیکسچر یکپارچه (Integration Fixture) هر دو کیفیت رو می‌سازه، metadata انتشار رو بررسی می‌کنه، تصاویر بدون افت رو پیکسل‌به‌پیکسل مقایسه می‌کنه، همه صفحه‌ها رو با Poppler رندر می‌کنه و ساختار نهایی PDF رو می‌سنجه.

</div>
