# إرسال رمز التحقق عبر واتساب

يرسل النظام رمز التحقق للزائر عبر **WhatsApp Cloud API** من Meta، بقالب مصادقة فيه زر «نسخ الرمز».

## 1) تجهيز حساب Meta (مرة واحدة)

1. ادخل على **developers.facebook.com**، ثم اختر **My Apps → Create App**. اختر نوع **Business**، ثم أضف منتج **WhatsApp**.
2. من **WhatsApp → API Setup** انسخ **Phone number ID**.
   - يعطيك Meta رقمًا تجريبيًا مجانيًا.
   - الرقم التجريبي يرسل فقط لأرقام تضيفها في خانة **To**، وحدّها 5 أرقام. أضف رقم جوالك للتجربة.
3. أنشئ قالب الرسالة من **WhatsApp Manager → Message templates → Create template**:
   - الفئة: **Authentication**
   - الاسم: `otp_code`
   - اللغة: **Arabic**
   - الزر: **Copy code**
   - انتظر حتى تصبح حالة القالب **Active**، وهذا يستغرق عادة دقائق.
4. أنشئ مفتاح وصول دائم من **Business Settings → Users → System users**:
   - أضف مستخدم نظام بصلاحية **Admin**.
   - اضغط **Generate token**، واختر التطبيق، وفعّل صلاحية `whatsapp_business_messaging`.
   - انسخ المفتاح. المفتاح المؤقت في صفحة API Setup ينتهي خلال 24 ساعة، فلا تستخدمه.

## 2) التفعيل في النظام

**على Render:** افتح الخدمة `compound-vms`، ثم **Environment**، وضع القيم التالية، ثم **Save Changes**:

| المتغير | القيمة |
|---|---|
| `SMS_PROVIDER` | `whatsapp` |
| `WHATSAPP_ACCESS_TOKEN` | المفتاح الدائم |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID |
| `WHATSAPP_TEMPLATE_NAME` | `otp_code`، أو اسم قالبك إذا كان مختلفًا |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `ar` |

**على خادم Docker:** ضع نفس القيم في `deploy/.env`، ثم نفّذ `docker compose up -d`.

## 3) التجربة

افتح `رابطك/visitor`، وأدخل رقم هوية ورقم الجوال الذي أضفته في Meta. يجب أن تصلك رسالة واتساب فيها الرمز.

إذا لم تصلك الرسالة، فابحث عن `sms.send_failed` في سجل الخدمة. على Render تجده في **Logs**.

| الرمز في السجل | السبب الشائع |
|---|---|
| HTTP 401 | المفتاح غير صحيح أو منتهي |
| HTTP 400 | اسم القالب أو لغته لا تطابق القالب المعتمد، أو أن الرقم غير مضاف للرقم التجريبي |

## للتشغيل الفعلي

- أضف رقم واتساب حقيقيًا خاصًا بالمجمع بدل الرقم التجريبي، ووثّق النشاط التجاري في Meta Business حتى تقدر ترسل لأي رقم.
- رسائل المصادقة تحاسب عليها Meta لكل رسالة. راجع الأسعار الحالية للسعودية في صفحة أسعار WhatsApp Business.
