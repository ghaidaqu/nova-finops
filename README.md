# NOVA

> اعرف أين ذهب مالك، قبل أن يصبح الفرق مشكلة.

نموذج أولي تفاعلي (بالعربية، RTL) لمنصة العمليات والذكاء والأتمتة المالية للأعمال السعودية: ربط أنظمة البيع والدفع والمحاسبة، مطابقة حركة الأموال، وتنبيه صاحب العمل بما يحتاج انتباهه.

## الصفحات

| المسار | الشاشة |
| --- | --- |
| `/` | الصفحة التسويقية |
| `/login` · `/signup` · `/forgot-password` | الدخول والتسجيل |
| `/onboarding` | التهيئة الأولى |
| `/app` | الرئيسية |
| `/app/money-flow` | تدفق الأموال |
| `/app/reconciliation` | مطابقة تطبيقات التوصيل |
| `/app/analytics` | التحليلات |
| `/app/customers` · `/app/branches` | العملاء والفروع |
| `/app/rules` · `/app/alerts` | القواعد والتنبيهات |
| `/app/connections` | الربط |
| `/app/reports` · `/app/settings` | التقارير والإعدادات |

## البنية

- `components/prototype.tsx`: كل الشاشات والتوجيه (من جهة المتصفح)
- `app/globals.css`: التصميم
- `src/config/brand.ts`: اسم العلامة والشعار النصي
- `docs/`: أبحاث السوق والمنتج، و`sites-starter.md` (توثيق القالب التقني الأصلي)

## التشغيل

يتطلب Node.js ‏22.13 أو أحدث.

```sh
npm run install:ci   # تثبيت الحزم
npm run dev          # خادم التطوير على http://localhost:5173
npm run lint         # فحص الكود
npm run build        # بناء نسخة النشر
```

مبني على [vinext](https://github.com/cloudflare/vinext) (Next.js على Cloudflare Workers). تفاصيل النشر وقاعدة البيانات D1 في [docs/sites-starter.md](docs/sites-starter.md).
