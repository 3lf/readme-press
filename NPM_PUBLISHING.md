<div dir="rtl">

# راهنمای انتشار README Press در npm

این راهنما مسیر انتشار بسته `readme-press` رو از بررسی محلی تا انتشار نسخه پایدار توضیح می‌ده. هیچ توکن یا کد یک‌بارمصرفی نباید داخل ریپو، فایل تنظیمات یا GitHub Secret ذخیره بشه.

## وضعیت فعلی

نسخه آماده آزمایش `0.1.3-beta.1` است. نام `readme-press` هنوز در رجیستری npm ثبت نشده و اولین انتشار باید به‌صورت مستقیم انجام بشه. قابلیت Staged Publishing فقط برای بسته‌ای کار می‌کنه که حداقل یک نسخه از قبل در npm داشته باشه.

برای همین مسیر پیشنهادی دو مرحله داره:

۱. نسخه `0.1.3-beta.1` با تگ `beta` و تأیید دومرحله‌ای منتشر می‌شه.

۲. بعد از ساخته‌شدن صفحه بسته، ارتباط امن GitHub Actions و npm تنظیم می‌شه تا نسخه پایدار از طریق پایپلاین دستی وارد محیط بررسی npm بشه و فقط بعد از تأیید صاحب بسته منتشر بشه.

## فایل‌ها و قرارداد بسته

فایل `package.json` نام، نسخه، CLI، exportها، نسخه Node.js و فهرست فایل‌های مجاز رو مشخص می‌کنه. دستور `npm pack` فقط این بخش‌ها رو داخل tarball می‌ذاره:

- فایل‌های مجوز و معرفی شامل `LICENSE`، `README.md` و `README.fa.md`
- فایل اجرایی `bin/readme-press.mjs`
- کد موتور داخل `src/`
- قالب‌ها و فونت‌های دارای مجوز داخل `themes/`
- تصویرهای لازم برای README داخل `docs/assets/`
- فایل `action.yml`
- فایل قفل انتشار `npm-shrinkwrap.json`

تست‌ها، workflowها، راهنمای نگهداری و خروجی‌های تولیدشده داخل بسته npm قرار نمی‌گیرن.

## بررسی قبل از اولین انتشار

این کار باید بعد از mergeشدن تغییرها روی `main` و داخل یه working tree تمیز انجام بشه:

```bash
cd /Users/a/Projects/readme-press
git switch main
git pull --ff-only origin main
git status --short
node --version
npx --yes npm@11.18.0 --version
npm login
npm whoami
```

نسخه Node.js باید حداقل `22.14.0` باشه. خروجی `git status --short` باید خالی و خروجی `npm whoami` باید نام اکانت درست باشه.

بعد کل دروازه انتشار رو اجرا کن:

```bash
npm ci
npm run verify:publish
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/*.yml
npm pack --dry-run
```

دستور `verify:publish` این بررسی‌ها رو یکجا اجرا می‌کنه:

- بررسی syntax و تست‌های واحد
- اعتبارسنجی GitHub Action
- ساخت و QA کامل نمونه انگلیسی و فارسی
- ساخت tarball و نصبش داخل یه پروژه خالی
- ممیزی امنیتی وابستگی‌های خود ریپو و پروژه مصرف‌کننده
- ساخت و رندر کامل هر دو کیفیت PDF با CLI نصب‌شده

## اولین انتشار آزمایشی

چون بسته هنوز وجود نداره، برای اولین نسخه نباید از `npm stage publish` استفاده کرد. فرمان انتشار آزمایشی اینه:

```bash
npx --yes npm@11.18.0 publish --tag beta
```

فیلد `publishConfig` انتشار عمومی رو مشخص کرده و hook مربوط به `prepublishOnly` دوباره کل `verify:publish` رو قبل از ارسال اجرا می‌کنه. npm هنگام انتشار تأیید دومرحله‌ای رو درخواست می‌کنه.

بعد از انتشار، نتیجه رو در یه پوشه تازه بررسی کن:

```bash
npm view readme-press@beta version

temporary_project="$(mktemp -d)"
cd "$temporary_project"
npm init -y
npm install --save-dev readme-press@beta
npx readme-press version
npm audit --audit-level=low
```

## فعال‌کردن انتشار امن از GitHub

بعد از اینکه نسخه beta صفحه بسته رو در npm ساخت، وارد تنظیمات بسته شو و یه Trusted Publisher با این مشخصات بساز:

- مالک GitHub برابر `3lf`
- نام ریپو برابر `readme-press`
- نام workflow برابر `npm-stage.yml`
- مجوز فقط برای `npm stage publish`
- بدون GitHub Environment، مگر اینکه بعداً عمداً یه Environment محافظت‌شده بسازی

این تنظیم از OIDC استفاده می‌کنه و به توکن دائمی `NPM_TOKEN` نیاز نداره. workflow فقط دستی اجرا می‌شه، فقط روی `main` جلو می‌ره و قبل از ارسال نسخه همه تست‌ها رو دوباره اجرا می‌کنه.

## انتشار نسخه پایدار

بعد از تأیید نسخه beta، نسخه رو به `0.1.3` تغییر بده، تغییر رو روی `main` merge کن و workflow با نام `Stage npm package` رو دستی اجرا کن:

- مقدار `version` برابر `0.1.3`
- مقدار `tag` برابر `latest`

workflow بسته رو عمومی نمی‌کنه. فقط اون رو وارد محیط بررسی npm می‌کنه. بعدش tarball مرحله‌بندی‌شده رو در npm بررسی و دانلود کن و در نهایت با 2FA تأییدش کن. این جداسازی باعث می‌شه هیچ merge یا tag عادی به‌تنهایی بسته رو منتشر نکنه.

## نسخه‌بندی بعدی

- رفع باگ سازگار با نسخه قبلی: patch، مثل `0.1.4`
- قابلیت جدید سازگار: minor، مثل `0.2.0`
- تغییر ناسازگار قبل از نسخه ۱: minor جدید و توضیح روشن در Release Notes
- نسخه آزمایشی: پسوندی مثل `0.2.0-beta.1` همراه تگ `beta`

یه شماره نسخه منتشرشده در npm قابل استفاده دوباره نیست. برای هر اصلاح، حتی اگه خیلی کوچیک باشه، شماره تازه بساز.

## منابع رسمی

- راهنمای [انتشار بسته عمومی بدون scope](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)
- راهنمای [Staged Publishing](https://docs.npmjs.com/staged-publishing/)
- راهنمای [Trusted Publishing با OIDC](https://docs.npmjs.com/trusted-publishers/)

</div>
