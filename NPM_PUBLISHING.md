<div dir="rtl">

# راهنمای انتشار README Press در npm

این راهنما مسیر انتشار بسته `readme-press` رو از بررسی محلی تا انتشار نسخه پایدار توضیح می‌ده. هیچ توکن یا کد یک‌بارمصرفی نباید داخل ریپو، فایل تنظیمات یا GitHub Secret ذخیره بشه.

## وضعیت فعلی

بسته `readme-press` در رجیستری عمومی npm ثبت شده و نسخه `0.1.3-beta.1` با تگ `beta` در دسترسه. اولین انتشار مستقیم با تأیید دومرحله‌ای انجام شده؛ از نسخه بعدی، مسیر اصلی انتشار همون Staged Publishing و Trusted Publishing است.

نسخه آزمایشی بعدی `0.1.3-beta.2` است. هدف از این نسخه فقط بررسی کد نیست؛ باید کل مسیر امن انتشار از GitHub Actions تا مرحله بازبینی npm رو هم در عمل ثابت کنه.

در اولین انتشار، npm تگ `latest` رو هم به تنها نسخه موجود وصل کرد و حذف این تگ رو نپذیرفت. تا قبل از انتشار نسخه پایدار، فرمان‌های نصب باید صریحاً از `readme-press@beta` استفاده کنن. با انتشار `0.1.3`، تگ `latest` به نسخه پایدار منتقل می‌شه.

مسیر انتشار از اینجا به بعد سه لایه داره:

۱. تغییر نسخه و کد فقط از طریق PR و بعد از سبزشدن CI وارد `main` می‌شه.

۲. workflow دستی `Stage npm package` بسته رو با OIDC وارد محیط بازبینی npm می‌کنه.

۳. صاحب بسته tarball مرحله‌بندی‌شده رو بررسی می‌کنه و انتشار نهایی رو با 2FA تأیید می‌کنه.

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

## بررسی قبل از هر انتشار

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

## تنظیم ارتباط امن GitHub و npm

داخل تنظیمات بسته در npm یه Trusted Publisher با این مشخصات بساز:

- مالک GitHub برابر `3lf`
- نام ریپو برابر `readme-press`
- نام workflow برابر `npm-stage.yml`
- مجوز فقط برای `npm stage publish`
- بدون GitHub Environment، مگر اینکه بعداً عمداً یه Environment محافظت‌شده بسازی

این تنظیم از OIDC استفاده می‌کنه و به توکن دائمی `NPM_TOKEN` نیاز نداره. workflow فقط دستی اجرا می‌شه، فقط روی `main` جلو می‌ره و قبل از مرحله‌بندی نسخه همه تست‌ها رو دوباره اجرا می‌کنه.

## تمرین کامل با نسخه beta

برای آزمایش مسیر انتشار، نسخه `0.1.3-beta.2` باید روی `main` باشه. بعد workflow با نام `Stage npm package` رو دستی اجرا کن:

- مقدار `version` برابر `0.1.3-beta.2`
- مقدار `tag` برابر `beta`

workflow هنوز بسته رو عمومی نمی‌کنه. بعد از موفقیت workflow، نسخه مرحله‌بندی‌شده رو در npm بازبینی کن، tarball رو دانلود کن و در نهایت با 2FA تأییدش کن.

بعد از انتشار، نتیجه رو از خود رجیستری داخل یه پوشه تازه بررسی کن:

```bash
npm view readme-press@beta version

temporary_project="$(mktemp -d)"
cd "$temporary_project"
npm init -y
npm install --save-dev readme-press@beta
npx readme-press version
npm audit --audit-level=low
```

برای هماهنگ‌کردن GitHub با npm، workflow با نام `Release` رو هم با مقدار `v0.1.3-beta.2` اجرا کن. بعد از سبزشدن ساخت، Draft Release رو بازبینی کن و به‌صورت prerelease منتشرش کن.

## انتشار نسخه پایدار

بعد از تأیید نسخه beta، نسخه رو به `0.1.3` تغییر بده، تغییر رو روی `main` merge کن و workflow با نام `Stage npm package` رو دستی اجرا کن:

- مقدار `version` برابر `0.1.3`
- مقدار `tag` برابر `latest`

workflow بسته رو عمومی نمی‌کنه. فقط اون رو وارد محیط بررسی npm می‌کنه. بعدش tarball مرحله‌بندی‌شده رو در npm بررسی و دانلود کن و در نهایت با 2FA تأییدش کن. این جداسازی باعث می‌شه هیچ merge یا tag عادی به‌تنهایی بسته رو منتشر نکنه.

بعد از تأیید npm، workflow با نام `Release` رو با مقدار `v0.1.3` اجرا کن. Draft Release باید شامل archive قفل‌شده، نمونه PDF انگلیسی و فارسی در هر دو کیفیت و فایل هش‌ها باشه. فقط بعد از بازبینی این فایل‌ها، Release رو منتشر کن.

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
