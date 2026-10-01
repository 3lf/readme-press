<div dir="rtl">

# راهنمای انتشار README Press در npm

این راهنما مسیر انتشار بسته `readme-press` رو از بررسی محلی تا انتشار نسخه پایدار توضیح می‌ده. هیچ توکن یا کد یک‌بارمصرفی نباید داخل ریپو، فایل تنظیمات یا GitHub Secret ذخیره بشه.

## وضعیت فعلی

این checkout برای انتشار `0.4.0` آماده شده؛ این شماره به‌تنهایی به‌معنای انتشار نیست. وضعیت عمومی رو در [npm](https://www.npmjs.com/package/readme-press) و [GitHub Releases](https://github.com/3lf/readme-press/releases) بررسی کن. نسخه قبلی `0.3.0` از همین مسیر منتشر شده و ارتباط Trusted Publishing آن هنگام انتشار آزمایش شده؛ پیش از مرحله‌بندی نسخه تازه، وضعیت روز رجیستری و workflowها رو دوباره بررسی کن.

برای هر نسخه بعدی همین مسیر رو طی کن: PR، QA کامل، مرحله‌بندی با OIDC، بازبینی artifact و تأیید نهایی با 2FA. شماره نسخه جدید رو بر اساس نوع تغییر انتخاب کن؛ شماره `0.3.0` قابل استفاده دوباره نیست.

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
- مستندات API و مهاجرت مصرف‌کننده داخل `docs/`
- منبع، تنظیمات و workflow کتاب نمونه داخل `examples/starter/`
- فایل `action.yml`
- فایل قفل انتشار `npm-shrinkwrap.json`

تست‌ها، workflowهای خود ریپو داخل `.github/`، راهنمای نگهداری و خروجی‌های تولیدشده داخل بسته npm قرار نمی‌گیرن.

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
- ساخت و رندر کامل نسخه عادی، چاپی و باکیفیت PDF با CLI نصب‌شده

قبل از مرحله‌بندی نسخه بعدی، pin مربوط به `3lf/readme-press` رو در
`examples/starter/book.yml` و هر دو README به تگ همون نسخه تغییر بده. مطمئن
شو tarball تازه فایل‌های `examples/starter/` رو داره و مسیر «اولین PDF» با نصب
همون tarball در یک پوشه خالی کار می‌کنه. پیش از تأیید npm، مقدار کامل
`integrity` و فهرست فایل‌ها در خروجی JSON مرحله‌بندی رو با tarball بررسی‌شده
از commit نهایی `main` مقایسه کن؛ اگر برابر نیستن، انتشار رو متوقف کن.

## تنظیم ارتباط امن GitHub و npm

داخل تنظیمات بسته در npm یه Trusted Publisher با این مشخصات بساز:

- مالک GitHub برابر `3lf`
- نام ریپو برابر `readme-press`
- نام workflow برابر `npm-stage.yml`
- مجوز فقط برای `npm stage publish`
- بدون GitHub Environment، مگر اینکه بعداً عمداً یه Environment محافظت‌شده بسازی

این تنظیم از OIDC استفاده می‌کنه و به توکن دائمی `NPM_TOKEN` نیاز نداره. workflow فقط دستی اجرا می‌شه، فقط روی `main` جلو می‌ره و قبل از مرحله‌بندی نسخه همه تست‌ها رو دوباره اجرا می‌کنه.

## تمرین کامل با نسخه beta

برای آزمایش مسیر انتشار، یک نسخه آزمایشی منتشرنشده مثل `0.3.1-beta.1` باید روی `main` باشه. بعد workflow با نام `Stage npm package` رو دستی اجرا کن:

- مقدار `version` برابر همون نسخه آزمایشی، مثلاً `0.3.1-beta.1`
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

برای هماهنگ‌کردن GitHub با npm، workflow با نام `Release` رو هم با همون نسخه و پیشوند `v` اجرا کن. بعد از سبزشدن ساخت، Draft Release رو بازبینی کن و به‌صورت prerelease منتشرش کن.

## انتشار نسخه پایدار

پس از انتخاب شماره نسخه منتشرنشده و merge شدن تغییرش روی `main`، workflow با نام `Stage npm package` رو دستی اجرا کن:

- مقدار `version` برابر شماره دقیق `package.json`
- مقدار `tag` برابر `latest`

workflow بسته رو عمومی نمی‌کنه. فقط اون رو وارد محیط بررسی npm می‌کنه. بعدش tarball مرحله‌بندی‌شده رو در npm بررسی و دانلود کن و در نهایت با 2FA تأییدش کن. این جداسازی باعث می‌شه هیچ merge یا tag عادی به‌تنهایی بسته رو منتشر نکنه.

بعد از تأیید npm، workflow با نام `Release` رو با همون شماره و پیشوند `v` اجرا کن. Draft Release باید شامل archive قفل‌شده، نمونه PDF انگلیسی و فارسی در هر سه نسخه و فایل هش‌ها باشه. فقط بعد از بازبینی این فایل‌ها، Release رو منتشر کن.

## بازگشت امن بعد از انتشار معیوب

اگه ایراد قبل از تأیید نهایی npm یا انتشار Draft Release پیدا شد، همون‌جا فرایند رو متوقف کن و با شماره نسخه تازه اصلاحش کن. artifact مرحله‌بندی‌شده یا Draft Release نامعتبر نباید منتشر بشه.

اگه نسخه معیوب قبلاً در npm منتشر شده، شماره اون نسخه رو دوباره استفاده نکن و محتوای تاریخی GitHub Release رو هم جایگزین نکن:

```bash
npm dist-tag add readme-press@0.3.0 latest
npm view readme-press@latest version
```

این فرمان فقط وقتی مناسبه که `0.3.0` واقعاً نسخه سالمِ مورد تأیید برای بازگشت باشه؛ پیش از اجرا وضعیت فعلی npm رو بررسی کن. بعد پروژه مصرف‌کننده خالی بساز، نسخه `latest` رو نصب کن، `npx readme-press version` و پایپلاین کامل رو اجرا کن و نتیجه رو با manifest، checksum و رندر همه صفحه‌ها بررسی کن. اصلاح اصلی باید با شماره نسخه جدید وارد PR، CI، مرحله‌بندی npm و Draft Release تازه بشه. تغییر `latest` فقط راه بازگشت موقت مصرف‌کننده‌هاست و جای انتشار نسخه اصلاحی رو نمی‌گیره.

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
