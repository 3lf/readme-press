<div dir="rtl">

<p align="center"><img src="docs/assets/readme-press-hero.png" alt="تبدیل یک منبع Markdown به نسخه‌های بررسی‌شده PDF" width="100%"></p>

<h1 align="center">README Press</h1>

<p align="center"><strong>یک منبع Markdown با ساختار کتاب رو به نسخه‌های تکرارپذیر و بررسی‌شده PDF تبدیل کن.</strong></p>

<p align="center"><a href="./README.md">English</a> · <strong>فارسی</strong></p>

README Press برای نویسنده‌ایه که یک راهنمای بلند و فصل‌بندی‌شده رو در README یا یک فایل Markdown نگه می‌داره. ابزار از همون منبع، PDF عادی، چاپی و باکیفیت با کاور، فهرست ساخته‌شده، bookmark، لینک داخلی، فونت محلی و بررسی QA می‌سازه. محتوای اصلی همچنان همون فایل Markdown می‌مونه.

## آیا README تو ساختار کتاب داره؟

قبل از نصب این سه مورد رو بررسی کن:

- اول یک تیتر سطح یک برای مقدمه، بعد یک تیتر سطح یک برای فهرست دستی GitHub و بعد تیترهای سطح یک برای فصل‌ها داری.
- نام مقدمه، فهرست و فصل آغازین هر بخش رو می‌تونی دقیقاً در فایل تنظیمات بنویسی. نام‌ها باید با تیترهای منبع یکی باشن.
- متن واقعاً یک راهنما یا کتاب فصل‌دار است. README کوتاهی که فقط نصب پروژه رو توضیح می‌ده، فعلاً با قرارداد منبع ابزار سازگار نیست.

```text
# Introduction          <- structure.introHeading
# Contents              <- structure.githubTocHeading
# The first chapter     <- structure.parts[0].startHeading
## A section
# The second chapter
```

[منبع کامل نمونه](./examples/starter/README.md) همین ساختار رو نشون می‌ده. فهرست دستی آن برای GitHub است و README Press فهرست PDF رو از همون تیترها می‌سازه. برای هر بخش جدید، `startHeading` جداگانه‌ای بذار که با تیتر یک فصل برابر باشه.

## یک صفحه واقعی

<p align="center"><img src="docs/assets/starter-page.png" alt="صفحه خوانای متن و جدول از PDF نمونه" width="88%"></p>

این تصویر یک صفحه واقعی از PDF نمونه است. [آخرین انتشار](https://github.com/3lf/readme-press/releases/latest) هم نمونه‌های انگلیسی و فارسی قابل دانلود در هر سه نسخه داره.

## اولین PDF را بساز

> فایل‌های نمونه از نسخه `readme-press@0.4.0` در بسته قرار دارن. وضعیت انتشار رو در [صفحه بسته npm](https://www.npmjs.com/package/readme-press) ببین. هنگام آماده‌سازی این نسخه، با `npm pack` بسته بساز و tarball اون رو برای آزمایش محلی نصب کن.

این تمرین رو در پوشه‌ای خالی انجام بده تا README موجودت جایگزین نشه. به Node.js نسخه ۲۲ یا ۲۴، Python 3، `qpdf` و Poppler نیاز داری. در macOS فرمان `brew install python poppler qpdf` و در Ubuntu فرمان `sudo apt-get install -y python3 poppler-utils qpdf` ابزارهای بیرونی رو نصب می‌کنه. npm مرورگر رندر و Mermaid رو همراه README Press نصب می‌کنه.

```bash
mkdir starter-book && cd starter-book
npm init -y
npm install --save-dev readme-press
cp node_modules/readme-press/examples/starter/README.md ./README.md
cp node_modules/readme-press/examples/starter/readme-press.config.mjs ./readme-press.config.mjs
npx readme-press build --config readme-press.config.mjs --quality all
```

خروجی‌ها `dist/starter-book.pdf`، `dist/starter-book-print.pdf` و `dist/starter-book-high-quality.pdf` هستن. اول فایل عادی رو باز کن. نشانی `repository.url` در تنظیمات نمونه به مخزن README Press اشاره می‌کنه؛ پیش از اشتراک‌گذاری PDF، اون رو با نشانی مخزن کتاب خودت جایگزین کن. در پروژه خودت، منبع و `readme-press.config.mjs` رو کنار هم نگه دار.

بعد از ساخت، همه نسخه‌ها و صفحه‌ها رو بررسی کن:

```bash
npx readme-press qa --config readme-press.config.mjs --quality all --render-all
```

QA ساختار PDF، فونت‌ها، لینک‌ها، مقصدها، ابعاد، هش منبع، کیفیت تصویر، برابری نسخه‌ها و رندر صفحه‌ها رو بررسی می‌کنه. قبل از اشتراک‌گذاری کتاب، صفحه‌ها رو خودت هم ببین. [راهبرد تست](./docs/testing.md) گیت تصویری کتاب واقعی رو توضیح می‌ده.

## کدام نسخه را بردارم؟

| نسخه | استفاده | تصویر و حجم |
| --- | --- | --- |
| **عادی** (`starter-book.pdf`) | مطالعه، دانلود و اشتراک آنلاین | تصویرهای مناسب را به JPEG بهینه می‌کند؛ در کتاب‌های پُرتصویر می‌تواند حجم را کم کند. |
| **چاپی** (`starter-book-print.pdf`) | بررسی یا چاپ روی کاغذ سفید | پس‌زمینه سفید و تصویرهای رنگی بدون افت دارد. اول یک نمونه را با چاپگر خودت امتحان کن. |
| **باکیفیت** (`starter-book-high-quality.pdf`) | نمایش محلی یا حفظ جزئیات تصویر منبع | طرح تمام‌رنگی و تصویرهای منبع بدون افت دارد؛ کتاب‌های پُرتصویر می‌توانند حجیم‌تر باشن. |

حجم واقعی به تصویرهای منبع و پس‌زمینه صفحه بستگی داره؛ نمونه کم‌تصویر ترتیب ثابتِ حجم نداره. محتوا، صفحه‌بندی، لینک‌ها و bookmarkهای سه نسخه برابرن. در تنظیمات دلخواه می‌تونی `outputs.print` رو حذف کنی. نسخه چاپی به‌معنای تأیید استانداردهای یک چاپخانه مشخص نیست.

## ساخت در GitHub Actions و دریافت فایل

`README.md` و `readme-press.config.mjs` رو در مخزن خودت commit کن و [فایل workflow نمونه](./examples/starter/book.yml) رو به‌نام `.github/workflows/book.yml` اضافه کن. اگر از دستورهای نمونه بالا استفاده کردی، `package.json` و `package-lock.json` رو هم commit کن یا آگاهانه در `.gitignore` بذار. آماده‌سازی انتشار فایل‌های ثبت‌نشده رو بررسی می‌کنه؛ `node_modules/` و `dist/` می‌تونن بدون commit بمونن. این workflow از مسیر `readme-press.config.mjs` استفاده می‌کنه، `pipeline` رو اجرا می‌کنه و با `actions/upload-artifact` سه PDF، manifest، هش‌ها و یادداشت‌های نامزد انتشار رو نگه می‌داره.

این workflow به Action نسخه `v0.4.0` اشاره می‌کنه که اصلاحات انگلیسی رو هم داره. بعد از ظاهرشدن این تگ در [GitHub Releases](https://github.com/3lf/readme-press/releases) اجراش کن. هر وقت خواستی ابزار رو ارتقا بدی، pin مخزن خودت رو آگاهانه عوض کن.

در مخزنت به **Actions > Build book > Run workflow** برو. بعد از پایان اجرا، صفحه همون run رو باز کن و **starter-book-pdfs** رو از بخش **Artifacts** دانلود کن. ZIP شامل فایل‌های PDF است. نسخه Action در workflow روی `v0.4.0` pin شده.

`build` فقط PDF می‌سازه. `qa` خروجی موجود رو بررسی می‌کنه. `pipeline` همه نسخه‌های تنظیم‌شده رو می‌سازه، QA رو اجرا می‌کنه و هش و یادداشت محلی برای نامزد انتشار آماده می‌کنه. نسخه `v0.0.0-preview.1` در نمونه فقط یک برچسب نامزد است. آپلود artifact امکان دانلود فایل از run رو می‌ده؛ README Press و این workflow هیچ انتشار GitHub یا npm برای پروژه تو انجام نمی‌دن.

## اگر اجرای اول شکست خورد

| پیام یا نشانه | بررسی |
| --- | --- |
| `README Press config not found` | از پوشه حاوی `readme-press.config.mjs` اجرا کن یا مسیر واقعی رو به `--config` بده. مسیر منبع و خروجی نسبت به همین فایل سنجیده می‌شن. |
| `intro chapter not found`، `GitHub TOC heading not found` یا `part starts not found` | نام و ترتیب تیترهای سطح یک رو با `introHeading`، `githubTocHeading` و `startHeading` یکسان کن. |
| نبود `qpdf` یا یکی از فرمان‌های Poppler | ابزارها رو نصب و وجودشون در `PATH` رو بررسی کن. QA به Python 3 هم نیاز داره. |
| `Chromium for Puppeteer was not found` | در پروژه `npx puppeteer browsers install chrome` رو اجرا کن. اگر npm اجرای script نصب رو مسدود کرده، script مربوط به Puppeteer رو تأیید کن. |
| `Mermaid CLI was not found` | وابستگی‌های npm پروژه رو دوباره نصب کن. |
| خطای هش منبع یا فایل خروجی در QA | پس از تغییر منبع یا ورودی‌های رندر دوباره `build` و بعد `qa` رو اجرا کن. |

## محدوده و اطلاعات بیشتر

قالب داخلی `lapis-rtl` کتاب‌های انگلیسی چپ‌به‌راست، فارسی راست‌به‌چپ و متن ترکیبی رو پشتیبانی می‌کنه. می‌تونی CSS، کاور، فونت و تنظیمات Mermaid محلی و بررسی QA مخصوص پروژه رو در تنظیمات مشخص کنی. تصویرهای محلی باید حتی پس از resolve شدن symlink داخل `projectRoot` بمونن؛ پیش‌فرض آن پوشه منبعه. برای جزئیات، [API برنامه‌نویسی](./docs/programmatic-api.md)، [راهنمای مهاجرت ۰٫۳](./docs/migration-0.3.md)، [راهبرد تست](./docs/testing.md)، [سیاست امنیت](./SECURITY.md) و [راهنمای مشارکت](./CONTRIBUTING.md) رو ببین.

کاور به‌شکل تصویر رندر می‌شه: عنوان دیده می‌شه و در metadata و صفحه‌های بدنه هم هست، ولی استخراج متن عادی اون رو از خود صفحه کاور برنمی‌گردونه. پروژه ادعای انطباق با PDF/UA یا سازگاری تأییدشده با screen reader نداره. تبدیل هر README کوتاه، انتشار خودکار نسخه برای مصرف‌کننده و تأیید چاپخانه هم جزو قابلیت‌های فعلی نیست.

فونت‌های داخلی Estedad، Vazirmatn و JetBrains Mono با SIL Open Font License ارائه می‌شن و خود README Press با [مجوز MIT](./LICENSE) منتشر شده.

</div>
