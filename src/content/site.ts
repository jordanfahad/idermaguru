export type Locale = "en" | "ar";

export const locales = {
  en: {
    nav: {
      demo: "Try demo",
      widget: "Widget",
      admin: "Admin",
      faq: "FAQ",
      dictionary: "Skin dictionary",
      privacy: "Privacy",
      terms: "Terms",
    },
    brand: "AI Skin Advisor",
    secondaryBrand: "AI Derma Guru",
    heroTitle: "AI-powered OTC skincare routines for safer product discovery.",
    heroText:
      "A commercial skin concierge that helps shoppers describe cosmetic concerns, screens red flags, and recommends catalog-approved skincare routines with clear safety notes.",
    ctaPrimary: "Start skin routine",
    ctaSecondary: "View merchant widget",
    trust: ["Safety triage first", "Catalog-only recommendations", "Sponsored results disclosed"],
    scanTitle: "From skin concern to routine in minutes",
    scanText:
      "Inspired by modern skin-scanner experiences, the platform blends guided intake, optional photo consent, education, and product attribution without claiming diagnosis.",
    articlesTitle: "Explore skincare education",
    faqTitle: "Frequently asked questions",
    privacyTitle: "Privacy policy",
    termsTitle: "Terms of use",
    dictionaryTitle: "Skincare dictionary",
  },
  ar: {
    nav: {
      demo: "جرّب العرض",
      widget: "الأداة",
      admin: "الإدارة",
      faq: "الأسئلة",
      dictionary: "قاموس البشرة",
      privacy: "الخصوصية",
      terms: "الشروط",
    },
    brand: "خبير التجميل الذكي",
    secondaryBrand: "AI Derma Guru",
    heroTitle: "روتين عناية بالبشرة بدون وصفة طبية مدعوم بالذكاء الاصطناعي.",
    heroText:
      "مساعد تجميلي يساعد المتسوق على شرح مخاوف البشرة، يراجع مؤشرات السلامة، ويوصي بروتين من منتجات معتمدة في كتالوج المتجر مع تنبيهات واضحة.",
    ctaPrimary: "ابدأ الروتين",
    ctaSecondary: "شاهد أداة المتجر",
    trust: ["فحص السلامة أولاً", "توصيات من الكتالوج فقط", "إفصاح واضح عن النتائج الممولة"],
    scanTitle: "من سؤال البشرة إلى روتين واضح خلال دقائق",
    scanText:
      "تجربة حديثة مستوحاة من أدوات فحص البشرة: أسئلة موجهة، موافقة اختيارية للصور، محتوى تثقيفي، وتتبع للنقرات بدون ادعاء التشخيص.",
    articlesTitle: "تثقيف العناية بالبشرة",
    faqTitle: "الأسئلة الشائعة",
    privacyTitle: "سياسة الخصوصية",
    termsTitle: "شروط الاستخدام",
    dictionaryTitle: "قاموس العناية بالبشرة",
  },
};

export const articleCards = [
  {
    title: "How OTC routines are built",
    titleAr: "كيف نبني روتيناً آمناً",
    text: "Cleanser, moisturizer, sunscreen, then targeted actives only when the intake allows it.",
    textAr: "منظف، مرطب، واقي شمس، ثم مكونات فعالة عند ملاءمتها فقط.",
    image: "https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=900&q=80",
  },
  {
    title: "When product advice should stop",
    titleAr: "متى تتوقف توصيات المنتجات",
    text: "Pain, infection signs, swelling, bleeding, or changing moles trigger referral instead of selling.",
    textAr: "الألم أو علامات العدوى أو التورم أو النزيف أو تغير الشامات تعني الإحالة لطبيب.",
    image: "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=900&q=80",
  },
  {
    title: "Sponsored results without hiding safety",
    titleAr: "نتائج ممولة مع الحفاظ على السلامة",
    text: "Commercial boosts are capped and cannot override allergy, pregnancy, sensitivity, or red-flag filters.",
    textAr: "الدعم التجاري محدود ولا يتجاوز فلاتر الحساسية أو الحمل أو البشرة الحساسة.",
    image: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=900&q=80",
  },
];

export const faqItems = [
  {
    q: "Is AI Derma Guru a dermatologist?",
    a: "No. It is an OTC skincare education and product discovery assistant. It does not diagnose, prescribe, or replace a doctor.",
    arQ: "هل AI Derma Guru طبيب جلدية؟",
    arA: "لا. هو مساعد تثقيفي للعناية بالبشرة بدون وصفة طبية ولا يشخص أو يصف علاجاً أو يستبدل الطبيب.",
  },
  {
    q: "Can merchants sponsor recommendations?",
    a: "Yes, but sponsored products must pass the same safety and suitability filters and are visibly disclosed.",
    arQ: "هل يمكن للمتاجر تمويل التوصيات؟",
    arA: "نعم، لكن المنتجات الممولة تخضع لنفس فلاتر السلامة والملاءمة ويتم توضيح أنها ممولة.",
  },
  {
    q: "What happens with red flags?",
    a: "Urgent or clinician-review signals block normal commercial product recommendations and show referral guidance.",
    arQ: "ماذا يحدث عند وجود علامات خطورة؟",
    arA: "يتم إيقاف التوصيات التجارية المعتادة وعرض رسالة توجيه لمراجعة مختص.",
  },
  {
    q: "Can a customer upload a photo?",
    a: "Yes, only after explicit optional consent. The MVP stores consent records and supports image deletion.",
    arQ: "هل يمكن رفع صورة؟",
    arA: "نعم، فقط بعد موافقة اختيارية وصريحة، مع حفظ سجل الموافقة ودعم حذف الصورة.",
  },
];

export const dictionaryItems = [
  ["Niacinamide", "A common cosmetic ingredient used for the look of uneven tone, oiliness, and redness.", "نياسيناميد", "مكون تجميلي شائع لمظهر اللون غير المتجانس والدهون والاحمرار."],
  ["Ceramides", "Barrier-supporting lipids often used in moisturizers for dry or sensitive-feeling skin.", "سيراميدات", "دهون داعمة لحاجز البشرة وتستخدم غالباً في المرطبات."],
  ["Salicylic acid", "A BHA used in some OTC products for oily skin and blackhead-prone routines. Avoid if allergic.", "حمض الساليسيليك", "حمض BHA يستخدم لبعض روتينات البشرة الدهنية والرؤوس السوداء مع تجنبه عند الحساسية."],
  ["Mineral sunscreen", "Sunscreen using mineral UV filters such as zinc oxide or titanium dioxide.", "واقي شمس معدني", "واقي يستخدم فلاتر معدنية مثل أكسيد الزنك أو ثاني أكسيد التيتانيوم."],
  ["Patch test", "Trying a small amount first to check tolerance before using a new product broadly.", "اختبار موضعي", "تجربة كمية صغيرة أولاً لمعرفة تحمل البشرة قبل الاستخدام الواسع."],
  ["Barrier damage", "A cosmetic description for skin that feels tight, dry, stinging, or over-exfoliated.", "ضعف حاجز البشرة", "وصف تجميلي لبشرة مشدودة أو جافة أو لاذعة أو متأثرة بالتقشير الزائد."],
];
