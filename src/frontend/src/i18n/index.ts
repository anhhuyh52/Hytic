import { createSignal } from "solid-js";

// Lightweight bilingual layer (English + Vietnamese). The URL is authoritative:
// unprefixed routes are English and /vi routes are Vietnamese.
// All user-facing copy reads through `t()`, with clear localized errors.

export type Locale = "en" | "vi";

const en = {
  // ── Landing page ────────────────────────────────────────────────────────────
  "landing.seo.title": "Hytic RAW Editor | Online RAW Editing, Film Color & 3D LUTs",
  "landing.seo.description":
    "Hytic is a browser-based RAW photo editor for cinematic color grading, film emulation, reference matching, and 3D LUT export with local browser processing.",
  "landing.nav.primaryAria": "Primary navigation",
  "landing.nav.features": "Features",
  "landing.nav.workflow": "Workflow",
  "landing.nav.faq": "FAQ",
  "landing.nav.panels": "Panels",
  "landing.nav.looks": "Looks",
   "landing.nav.launch": "Launch editor",
  "landing.nav.menu": "Open navigation",
  "landing.hero.toolsAria": "Creative app and workflow compatibility",
  "landing.hero.eyebrow": "Hytic RAW editor, color grading tool, and LUT builder",
  "landing.hero.title": "Browser-based RAW editing for cinematic color.",
  "landing.hero.subtitle":
    "Hytic is a browser-based RAW photo editor for cinematic color grading, film emulation, reference matching, and 3D LUT export. Craft film-inspired looks with grain, halation, bloom, curves, and a local-first grading engine that runs in your browser.",
  "landing.hero.ctaPrimary": "Get started",
  "landing.hero.ctaSecondary": "Explore editor",
  "landing.hero.note": "No registration required",
  "landing.hero.showcaseAlt": "A photograph color-graded in Hytic",
  "landing.hero.badgeBefore": "Original",
  "landing.hero.badgeAfter": "Graded",
  "landing.trust.aria": "Highlights",
  "landing.trust.gpu.title": "GPU-accelerated",
  "landing.trust.gpu.body": "A WebGL2 engine renders every adjustment in real time.",
  "landing.trust.private.title": "Private by design",
  "landing.trust.private.body": "Images are decoded and processed locally in your browser; no photo upload is required for editing.",
  "landing.trust.offline.title": "Works offline",
  "landing.trust.offline.body": "Install once and keep editing without a connection.",
  "landing.features.eyebrow": "Film grading features",
  "landing.features.title": "Everything needed to build, match, and export cinematic looks",
  "landing.feature.raw.title": "True RAW decoding",
  "landing.feature.raw.body":
    "Open CR2, CR3, NEF, ARW, DNG, RAF, RW2, ORF, HEIC, and TIFF with a high-bit-depth pipeline that protects highlight and shadow detail.",
  "landing.feature.grade.title": "Cinematic color",
  "landing.feature.grade.body":
    "Curves, color wheels, HSL and live scopes give you precise, filmic control over tone and mood.",
  "landing.feature.presets.title": "Presets & LUTs",
  "landing.feature.presets.body":
    "Build, import and share looks. Apply 3D LUTs and one-click presets across an entire shoot.",
  "landing.feature.match.title": "Reference matching",
  "landing.feature.match.body":
    "Match the palette of any reference image and let Hytic rebuild the grade for you.",
  "landing.feature.export.title": "Studio-grade export",
  "landing.feature.export.body":
    "Export high-resolution images with your color science baked in, ready to deliver.",
  "landing.feature.offline.title": "Installable & offline",
  "landing.feature.offline.body":
    "A progressive web app that installs to your desktop and keeps working offline.",
  "landing.preview.eyebrow": "Online color grading app",
  "landing.preview.title": "Revolutionary film color at your fingertips.",
  "landing.preview.body":
    "One-of-a-kind color modelling simulates the light response of film. Embedded in an intuitive, blazing fast interface designed to help you build polished looks in less time.",
  "landing.preview.canvasAlt": "A cinematic night-street scene graded in Hytic",
  "landing.preview.scope": "Vectorscope",
  "landing.preview.curve": "Tone curve",
  "landing.preview.exposure": "Exposure",
  "landing.preview.contrast": "Contrast",
  "landing.preview.temp": "Temperature",
  "landing.preview.saturation": "Saturation",
  "landing.analogTools.eyebrow": "GPU Accelerated Processing",
  "landing.analogTools.title": "Analog Color Tools.",
  "landing.analogTools.body":
    "One-of-a-kind color modelling that simulates the light response of film. Embedded in an intuitive, blazingly fast user interface designed to get you twice the results in half the time.",
  "landing.analogTools.cta": "Explore the tools",
  "landing.video.eyebrow": "Video color grading",
  "landing.video.title": "Film color for video.",
  "landing.video.body":
    "Import video clips, preview grades in motion, and build cinematic looks with the same analog-inspired color engine used for stills.",
  "landing.video.previewAlt": "Video clip being color graded in Hytic",
  "landing.audience.chipsAria": "Creative audiences",
  "landing.audience.photographers": "Photographers",
  "landing.audience.cinematographers": "Cinematographers",
  "landing.audience.colorists": "Colorists",
  "landing.audience.titleMutedA": "Hytic is a dedicated",
  "landing.audience.titleStrongA": "look development tool",
  "landing.audience.titleMutedB": "for photographers and a first-class",
  "landing.audience.titleStrongB": "3D LUT Builder",
  "landing.audience.titleMutedC": "for video and cinematography workflows.",
  "landing.audience.card.raw.eyebrow": "Logarithmic grading for photographers",
  "landing.audience.card.raw.title": "Film-like RAW.",
  "landing.audience.card.texture.eyebrow": "Film texture emulation",
  "landing.audience.card.texture.title": "True Grain & Halation",
  "landing.density.visualAlt": "Film density image comparison",
  "landing.density.eyebrow": "Image response",
  "landing.density.beforeAlt": "Original image",
  "landing.density.afterAlt": "Image with film density",
  "landing.density.labelBefore": "Original",
  "landing.density.labelAfter": "Density",
  "landing.density.handleAlt": "Before and after comparison",
  "landing.density.noteDrag": "Drag the center handle",
  "landing.density.noteLive": "Live preview",
  "landing.density.titleTop": "Film",
  "landing.density.titleBottom": "Density",
  "landing.density.softAlt": "Soft image",
  "landing.density.denseAlt": "Dense image",
  "landing.density.lede":
    "Density reshapes the tone response rather than applying a flat exposure change. It gently lowers the midtones and brighter values while keeping the black point and white point anchored, producing a richer, more film-like image.",
  "landing.density.curveTitle": "Density response curve",
  "landing.density.curveAlt": "Film density response curve",
  "landing.density.axisInput": "Input luminance",
  "landing.density.axisOutput": "Output",
  "landing.density.sliderLabel": "Density",
  "landing.density.sliderAlt": "Film density amount",
  "landing.density.exp1Title": "Anchor endpoints",
  "landing.density.exp1Text":
    "Pure black and pure white remain stable, so the adjustment does not simply move the whole image darker.",
  "landing.density.exp2Title": "Build midtone weight",
  "landing.density.exp2Text":
    "Midtones are pushed below the neutral diagonal, adding visual weight and reducing the thin digital look.",
  "landing.density.exp3Title": "Roll highlights smoothly",
  "landing.density.exp3Text":
    "Brighter values transition gradually instead of clipping, preserving a softer highlight shoulder.",
  "landing.density.formulaLabel": "Preview curve:",
  "landing.panels.eyebrow": "The grading stack",
  "landing.panels.title": "Sixteen image adjustment panels for color grading",
  "landing.panels.body":
    "The Hytic editor stacks sixteen GPU-accelerated panels for photo color adjustment and film grading — from AI reference matching and tone curves to scattering, refraction, halation, bloom, diffusion, and film grain. Panels marked “Included in LUT Exports” bake into your 3D LUT; FX panels are real-time, render-only optical effects.",
  "landing.panel.scope.lut": "Included in LUT Exports",
  "landing.panel.scope.render": "Render-Only (Not Included in LUTs)",
  "landing.panel.scope.adjustment": "Adjustment panel",
  "landing.panel.presets.label": "Presets",
  "landing.panel.presets.body":
    "Start from curated film looks and preset packs, then refine every panel to taste.",
  "landing.panel.match.label": "Color Match",
  "landing.panel.match.body":
    "Match the color, brightness and contrast of a reference image to your current image. Ideal for replicating film looks or kickstarting a grade.",
  "landing.panel.retouch.label": "Retouch",
  "landing.panel.retouch.body":
    "Remove blemishes with a manually positioned Heal or Clone source. Drag either circle independently and use the source handle to resize and rotate.",
  "landing.panel.balance.label": "Balance",
  "landing.panel.balance.body":
    "Adjust global exposure, saturation, temperature and tint with the 2-axis controls.",
  "landing.panel.exposure.label": "Exposure Curve",
  "landing.panel.exposure.body":
    "Shape brightness across shadows, midtones and highlights with precise control over luminance ranges.",
  "landing.panel.contrast.label": "Contrast Curve",
  "landing.panel.contrast.body":
    "Adjust contrast distribution across tonal zones with film-density modeling and full control over curve shape.",
  "landing.panel.scattering.label": "Scattering",
  "landing.panel.scattering.body":
    "Add physically accurate shadow and highlight tinting based on natural light behavior using the two color wheels.",
  "landing.panel.refraction.label": "Refraction",
  "landing.panel.refraction.body":
    "Filmic HSL. Change hue and saturation in shadows and highlights independently for all color vectors.",
  "landing.panel.density.label": "Density Curve",
  "landing.panel.density.body":
    "Control color richness and saturation hue-by-hue, based on analog film density behavior.",
  "landing.panel.chroma.label": "Chroma Curve",
  "landing.panel.chroma.body":
    "Adjust saturation based on how colorful pixels already are. Boost muted tones or protect vibrant highlights.",
  "landing.panel.radiance.label": "Radiance Curve",
  "landing.panel.radiance.body":
    "Adjust brightness per hue for subtle tonal balancing and natural color contrast without masking.",
  "landing.panel.saturation.label": "Saturation Curve",
  "landing.panel.saturation.body":
    "Control saturation across brightness ranges. Boost shadows or reduce highlights to avoid color clipping.",
  "landing.panel.rgb.label": "Shadow Highlight",
  "landing.panel.rgb.body":
    "Adjust brightness and introduce subtle hue shifts separately in the shadows and highlights of your image.",
  "landing.panel.spotlight.label": "Spotlight",
  "landing.panel.spotlight.body":
    "Dynamic re-illumination with localized exposure and pop. Drag the point on the image to position the light; double-click it to recenter.",
  "landing.panel.halation.label": "Halation",
  "landing.panel.halation.body":
    "Simulate the iconic red-orange glow around highlights seen in analog film photography.",
  "landing.panel.diffusion.label": "Diffusion",
  "landing.panel.diffusion.body":
    "Real-time optical diffusion that softens highlights while maintaining subject focus. Drag the point on the image to position the protected area; double-click it to recenter.",
  "landing.panel.texture.label": "Texture",
  "landing.panel.texture.body":
    "Re-texture every pixel with volumetric film grain and localized micro-contrast, from fine 35mm to gritty ISO 800.",
  "landing.looks.eyebrow": "Film emulation presets",
  "landing.looks.title": "Start from cinematic film looks, then make them yours",
  "landing.looks.body":
    "Use print film, night street, editorial, vintage negative, and modern cinema looks as flexible starting points. Refine density, curves, saturation, halation, bloom, grain, and export the final grade as a reusable look.",
  "landing.looks.previewAlt": "{name} film color grading preset preview",
  "landing.looks.motionPicture": "Motion Picture Negative",
  "landing.looks.nightStreet": "Night Street Film",
  "landing.looks.softPrint": "Soft Print Film",
  "landing.looks.cinematic": "Cinematic Film Looks",
  "landing.looks.classicStill": "Classic Still Film",
  "landing.looks.naturalStill": "Natural Still Film",
  "landing.looks.modernCinema": "Modern Cinema Pack",
  "landing.looks.editorial": "Editorial Essentials",
  "landing.looks.tetrachrome": "Tetrachrome",
  "landing.looks.vintageNegative": "Vintage Color Negative",
  "landing.workflow.eyebrow": "Browser grading workflow",
  "landing.workflow.title": "Import a RAW photo, match a reference, export a 3D LUT",
  "landing.step.1.title": "Open your image",
  "landing.step.1.body": "Drag in a RAW file or send one straight from your phone with a QR code.",
  "landing.step.2.title": "Shape the color",
  "landing.step.2.body": "Dial in exposure, color and contrast, or start from a preset.",
  "landing.step.3.title": "Export & share",
  "landing.step.3.body": "Save your look as a preset and export the final image.",
  "landing.faq.eyebrow": "FAQ",
  "landing.faq.title": "Browser-based film grading answers",
  "landing.faq.body":
    "Short answers for photographers, filmmakers, and creators comparing web grading, film emulation, RAW editing, and LUT export workflows.",
  "landing.faq.q1": "What is Hytic?",
  "landing.faq.a1":
    "Hytic is a browser-based RAW photo editor for cinematic color grading, film emulation, reference matching, and 3D LUT export. It is designed for photographers, filmmakers, and color-focused teams who want pro color tools without a desktop install.",
  "landing.faq.q2": "Can Hytic edit RAW photos online?",
  "landing.faq.a2":
    "Yes. Hytic edits RAW photos online in your browser and supports CR2, CR3, NEF, ARW, DNG, RAF, RW2, ORF, HEIC, and TIFF. Import and processing happen locally on your device rather than through a remote render server.",
  "landing.faq.q3": "Does Hytic upload my images?",
  "landing.faq.a3":
    "No photo upload is required for editing. Hytic decodes and processes imported image pixels locally in the browser; app assets and optional site analytics may use the network.",
  "landing.faq.q4": "Can Hytic export 3D LUTs?",
  "landing.faq.a4":
    "Yes. Hytic lets you build a look in the browser and export a standard 3D LUT (.cube) for compatible workflows in DaVinci Resolve, Premiere Pro, OBS, Darktable, and other color-managed apps.",
  "landing.faq.q5": "Is Hytic a Lightroom alternative?",
  "landing.faq.a5":
    "Yes, for photographers who want a focused browser workflow for RAW adjustment, cinematic color, film looks, and reusable exports. Lightroom remains stronger for deep cataloging, sync, and broader Adobe ecosystem workflows.",
  "landing.faq.q6": "Which RAW formats does Hytic support?",
  "landing.faq.a6":
    "Hytic recognizes common photo formats including CR2, CR3, NEF, ARW, DNG, RAF, RW2, ORF, HEIC, and TIFF. Camera-specific behavior can vary, so important workflows should still be tested with a representative file from your camera.",
  "landing.faq.q7": "Is Hytic private enough for client or unreleased work?",
  "landing.faq.a7":
    "Hytic is built for local browser processing, which keeps editing pixels on your device instead of sending them to a render server. That makes it a strong fit for privacy-sensitive work, although your own device, browser extensions, and device security and browser extensions still matter.",
  "landing.faq.q8": "Who is Hytic for?",
  "landing.faq.a8":
    "Hytic is for photographers, cinematographers, filmmakers, and color-focused creators who want browser-based RAW editing, film emulation, reference matching, scopes, presets, and 3D LUT export.",
  "landing.cta.title": "Build cinematic color in the browser",
  "landing.cta.body":
    "Open Hytic to grade RAW photos, create film-inspired looks, match references, and export LUTs for your editing workflow.",
  "landing.cta.button": "Open editor",
  "landing.footer.tagline": "RAW photo editing and cinematic color grading, in your browser.",
  "landing.footer.product": "Product",
  "landing.footer.legal": "Legal",
  "landing.footer.notices": "Third-party notices",
  "landing.footer.photoEditor": "Photo editor",
  "landing.footer.lightroom": "Lightroom alternative",
  "landing.footer.darktable": "Darktable alternative",
  "landing.footer.guides": "Guides",
  "landing.footer.about": "About",
  "landing.footer.privacy": "Privacy",
  "landing.footer.terms": "Terms",
  "landing.footer.contact": "Contact",
  "landing.footer.changelog": "Changelog",
  "landing.footer.rights": "All rights reserved.",

  "error.network": "Can't reach the server. Check your internet connection and try again.",
  "error.server": "The server ran into a problem. Please try again in a moment.",
  "error.generic": "Something went wrong. Please try again.",
  "error.tooMany": "Too many attempts. Please wait a minute, then try again.",
  "error.invalidCredentials": "Incorrect email or password. Please try again.",
  "error.invalidInput": "Please double-check the details you entered.",

  // ── Sender (phone upload) page ──────────────────────────────────────────────
  "send.eyebrow": "Hytic phone upload",
  "send.title": "Send an image to your editor",
  "send.desktopHint":
    "This page is made for your phone. Scan the QR code shown in the desktop editor to open it on mobile.",
  "send.field.code": "Enter code",
  "send.action.connect": "Connect",
  "send.status.connecting": "Connecting to your Hytic editor…",
  "send.status.connected": "Connected to your Hytic editor.",
  "send.action.chooseImage": "Choose image",
  "send.status.confirming": "Confirming the editor received it…",
  "send.status.sending": "Sending {name}…",
  "send.done.title": "Sent to Hytic",
  "send.done.body": "The desktop has received your image.",
  "send.action.sendAnother": "Send another",
  "send.action.tryAgain": "Try again",
  "send.error.connectionClosed": "The connection to the desktop closed. Please try again.",
  "send.error.peerLeft": "The editor stopped waiting for this upload.",
  "send.error.connect": "We couldn't connect to the editor. Please try again.",
  "send.error.finishConnection": "We couldn't finish connecting. Please try again.",
  "send.error.open": "We couldn't open the upload page. Please try again.",
  "send.error.noAck": "The editor didn't confirm it received the image.",
  "send.error.notConnected": "The editor isn't connected yet. Please reconnect and try again.",
  "send.error.uploadFailed": "The upload failed. Please try again.",
  "send.error.generic": "Something went wrong during the transfer. Please try again.",

  // ── Relay (server-sent) reasons ─────────────────────────────────────────────
  "relay.tooMany": "Too many attempts. Please wait a minute, then try again.",
  "relay.expired": "This link has expired. Show a fresh QR code on the desktop and scan it again.",
  "relay.busy": "A phone is already connected to this editor.",
  "relay.connectFirst": "Please connect to the editor first.",
  "relay.peerNotReady": "The other device isn't connected yet.",
  "relay.startFailed": "We couldn't start the phone connection. Please try again.",
  "relay.protocol": "Something went wrong with the connection. Please try again.",

  // ── Language switch ─────────────────────────────────────────────────────────
  "locale.label": "Language",
} as const;

export type MessageKey = keyof typeof en;

const vi: Record<MessageKey, string> = {
  "landing.seo.title": "Trình chỉnh sửa ảnh RAW và chỉnh màu phim trực tuyến miễn phí | Hytic",
  "landing.seo.description":
    "Chỉnh sửa ảnh RAW và tạo phong cách phim điện ảnh ngay trong trình duyệt với Hytic. Xử lý cục bộ, đường cong, hạt phim, halation, preset và gói miễn phí hữu ích.",
  "landing.nav.primaryAria": "Điều hướng chính",
  "landing.nav.features": "Tính năng",
  "landing.nav.workflow": "Quy trình",
  "landing.nav.faq": "Câu hỏi thường gặp",
  "landing.nav.panels": "Bảng điều chỉnh",
  "landing.nav.looks": "Phong cách",
   "landing.nav.launch": "Mở trình chỉnh sửa",
  "landing.nav.menu": "Mở điều hướng",
  "landing.hero.toolsAria": "Khả năng tương thích ứng dụng và quy trình sáng tạo",
  "landing.hero.eyebrow": "Chỉnh RAW trực tuyến · màu phim · xuất LUT 3D",
  "landing.hero.title":
    "Trình chỉnh sửa ảnh trực tuyến để chỉnh màu phim cho ảnh RAW và LUT điện ảnh",
  "landing.hero.subtitle":
    "Trình chỉnh sửa ảnh trên trình duyệt được xây dựng cho màu sắc. Điều chỉnh ảnh RAW và khung hình video bằng phơi sáng, tương phản và đường cong màu; khớp ảnh tham chiếu; tinh chỉnh halation, bloom, hạt phim và xuất LUT 3D cho quy trình sáng tạo của bạn.",
  "landing.hero.ctaPrimary": "Bắt đầu miễn phí",
  "landing.hero.ctaSecondary": "Xem cách hoạt động",
  "landing.hero.note": "Chạy ngoại tuyến · Không hình mờ · Có gói miễn phí",
  "landing.hero.showcaseAlt": "Một bức ảnh được chỉnh màu trong Hytic",
  "landing.hero.badgeBefore": "Ảnh gốc",
  "landing.hero.badgeAfter": "Đã chỉnh màu",
  "landing.trust.aria": "Điểm nổi bật",
  "landing.trust.gpu.title": "Tăng tốc GPU",
  "landing.trust.gpu.body": "Bộ máy WebGL2 kết xuất mọi điều chỉnh theo thời gian thực.",
  "landing.trust.private.title": "Riêng tư từ thiết kế",
  "landing.trust.private.body": "Ảnh được giải mã và xử lý cục bộ — không có gì được tải lên.",
  "landing.trust.offline.title": "Chạy ngoại tuyến",
  "landing.trust.offline.body": "Cài đặt một lần và tiếp tục chỉnh sửa mà không cần kết nối.",
  "landing.features.eyebrow": "Tính năng chỉnh màu phim",
  "landing.features.title": "Mọi công cụ cần thiết để tạo, khớp và xuất phong cách điện ảnh",
  "landing.feature.raw.title": "Giải mã RAW thực thụ",
  "landing.feature.raw.body":
    "Mở RAW máy ảnh, HEIC và TIFF với quy trình độ sâu bit cao, giữ trọn chi tiết vùng sáng và vùng tối.",
  "landing.feature.grade.title": "Màu điện ảnh",
  "landing.feature.grade.body":
    "Đường cong, vòng màu, HSL và biểu đồ trực tiếp cho bạn kiểm soát tông và sắc thái một cách chính xác.",
  "landing.feature.presets.title": "Preset & LUT",
  "landing.feature.presets.body":
    "Tạo, nhập và chia sẻ các phong cách. Áp dụng LUT 3D và preset một chạm cho cả buổi chụp.",
  "landing.feature.match.title": "Khớp ảnh tham chiếu",
  "landing.feature.match.body":
    "Khớp bảng màu của bất kỳ ảnh tham chiếu nào và để Hytic dựng lại bản chỉnh màu cho bạn.",
  "landing.feature.export.title": "Xuất chất lượng studio",
  "landing.feature.export.body":
    "Xuất ảnh độ phân giải cao với khoa học màu đã được tích hợp, sẵn sàng bàn giao.",
  "landing.feature.offline.title": "Cài đặt & ngoại tuyến",
  "landing.feature.offline.body":
    "Ứng dụng web tiến bộ cài vào máy tính và vẫn hoạt động khi ngoại tuyến.",
  "landing.preview.eyebrow": "Bên trong trình chỉnh sửa",
  "landing.preview.title": "Bàn chỉnh màu chuyên nghiệp, trong một tab trình duyệt.",
  "landing.preview.body":
    "Biểu đồ trực tiếp, đường cong tông màu và các điều khiển màu cập nhật theo thời gian thực khi bạn chỉnh — trải nghiệm như phần mềm máy tính, không cần cài đặt.",
  "landing.preview.canvasAlt": "Cảnh phố đêm điện ảnh được chỉnh màu trong Hytic",
  "landing.preview.scope": "Vectorscope",
  "landing.preview.curve": "Đường cong tông màu",
  "landing.preview.exposure": "Phơi sáng",
  "landing.preview.contrast": "Tương phản",
  "landing.preview.temp": "Nhiệt độ màu",
  "landing.preview.saturation": "Độ bão hòa",
  "landing.analogTools.eyebrow": "Xử lý tăng tốc GPU",
  "landing.analogTools.title": "Công cụ màu analog.",
  "landing.analogTools.body":
    "Mô hình màu độc đáo mô phỏng phản hồi ánh sáng của phim. Được đặt trong giao diện trực quan, cực nhanh để giúp bạn đạt kết quả gấp đôi trong một nửa thời gian.",
  "landing.analogTools.cta": "Khám phá công cụ",
  "landing.video.eyebrow": "Chỉnh màu video",
  "landing.video.title": "Màu phim cho hình ảnh chuyển động.",
  "landing.video.body":
    "Nhập clip video, xem grade khi đang chuyển động và xây dựng look điện ảnh bằng cùng engine màu lấy cảm hứng analog dùng cho ảnh tĩnh.",
  "landing.video.previewAlt": "Clip video đang được chỉnh màu trong Hytic",
  "landing.audience.chipsAria": "Nhóm sáng tạo",
  "landing.audience.photographers": "Nhiếp ảnh gia",
  "landing.audience.cinematographers": "Nhà quay phim",
  "landing.audience.colorists": "Colorist",
  "landing.audience.titleMutedA": "Hytic là công cụ chuyên biệt để",
  "landing.audience.titleStrongA": "phát triển look màu",
  "landing.audience.titleMutedB": "cho nhiếp ảnh gia và là",
  "landing.audience.titleStrongB": "trình tạo LUT 3D",
  "landing.audience.titleMutedC": "cho quy trình video và điện ảnh.",
  "landing.audience.card.raw.eyebrow": "Chỉnh màu logarithmic cho nhiếp ảnh",
  "landing.audience.card.raw.title": "RAW mang chất phim.",
  "landing.audience.card.texture.eyebrow": "Mô phỏng kết cấu phim",
  "landing.audience.card.texture.title": "Grain & Halation chân thực",
  "landing.density.visualAlt": "So sánh ảnh mật độ phim",
  "landing.density.eyebrow": "Phản hồi ảnh",
  "landing.density.beforeAlt": "Ảnh gốc",
  "landing.density.afterAlt": "Ảnh với mật độ phim",
  "landing.density.labelBefore": "Gốc",
  "landing.density.labelAfter": "Mật độ",
  "landing.density.handleAlt": "So sánh trước và sau",
  "landing.density.noteDrag": "Kéo thanh trượt ở giữa",
  "landing.density.noteLive": "Xem trước trực tiếp",
  "landing.density.titleTop": "Mật độ",
  "landing.density.titleBottom": "Phim",
  "landing.density.softAlt": "Ảnh mềm",
  "landing.density.denseAlt": "Ảnh đậm",
  "landing.density.lede":
    "Mật độ định hình lại phản hồi tông màu thay vì chỉ thay đổi phơi sáng đơn thuần. Nó nhẹ nhàng hạ thấp vùng trung gian và vùng sáng trong khi giữ nguyên điểm đen và điểm trắng, tạo ra hình ảnh đậm đà và mang chất phim hơn.",
  "landing.density.curveTitle": "Đường cong phản hồi mật độ",
  "landing.density.curveAlt": "Đường cong phản hồi mật độ phim",
  "landing.density.axisInput": "Độ chói đầu vào",
  "landing.density.axisOutput": "Đầu ra",
  "landing.density.sliderLabel": "Mật độ",
  "landing.density.sliderAlt": "Mức độ mật độ phim",
  "landing.density.exp1Title": "Cố định điểm đầu cuối",
  "landing.density.exp1Text":
    "Màu đen thuần và trắng thuần được giữ nguyên, vì vậy sự điều chỉnh không làm cho toàn bộ hình ảnh tối đi một cách đơn giản.",
  "landing.density.exp2Title": "Tăng trọng lượng vùng trung gian",
  "landing.density.exp2Text":
    "Vùng trung gian được đẩy xuống dưới đường chéo trung tính, tăng thêm độ đậm đà và giảm bớt vẻ kỹ thuật số mỏng manh.",
  "landing.density.exp3Title": "Cuộn vùng sáng mượt mà",
  "landing.density.exp3Text":
    "Các giá trị sáng chuyển tiếp dần dần thay vì bị cắt gắt, bảo toàn vùng sáng mềm mại hơn.",
  "landing.density.formulaLabel": "Đường cong xem trước:",
  "landing.panels.eyebrow": "Hệ thống chỉnh màu",
  "landing.panels.title": "Mười sáu bảng điều chỉnh ảnh dành cho chỉnh màu",
  "landing.panels.body":
    "Trình chỉnh sửa Hytic kết hợp mười sáu bảng điều chỉnh tăng tốc GPU cho màu ảnh và chỉnh màu phim — từ khớp ảnh tham chiếu bằng AI và đường cong tông màu đến scattering, refraction, halation, bloom, diffusion và hạt phim. Các bảng có nhãn “Có trong LUT xuất” sẽ được ghi vào LUT 3D; bảng FX là hiệu ứng quang học thời gian thực chỉ áp dụng khi kết xuất.",
  "landing.panel.scope.lut": "Có trong LUT xuất",
  "landing.panel.scope.render": "Chỉ kết xuất (Không có trong LUT)",
  "landing.panel.scope.adjustment": "Bảng điều chỉnh",
  "landing.panel.presets.label": "Preset",
  "landing.panel.presets.body":
    "Bắt đầu từ các phong cách phim và gói preset được tuyển chọn, sau đó tinh chỉnh từng bảng theo ý muốn.",
  "landing.panel.match.label": "Khớp màu",
  "landing.panel.match.body":
    "Khớp màu sắc, độ sáng và tương phản của ảnh tham chiếu với ảnh hiện tại. Phù hợp để tái tạo màu phim hoặc bắt đầu nhanh một bản chỉnh màu.",
  "landing.panel.retouch.label": "Chỉnh sửa khuyết điểm",
  "landing.panel.retouch.body":
    "Loại bỏ khuyết điểm bằng nguồn Heal hoặc Clone đặt thủ công. Kéo từng vòng tròn độc lập và dùng tay cầm nguồn để đổi kích thước, xoay.",
  "landing.panel.balance.label": "Cân bằng",
  "landing.panel.balance.body":
    "Điều chỉnh tổng thể phơi sáng, độ bão hòa, nhiệt độ màu và sắc độ bằng điều khiển hai trục.",
  "landing.panel.exposure.label": "Đường cong phơi sáng",
  "landing.panel.exposure.body":
    "Định hình độ sáng ở vùng tối, trung gian và vùng sáng với khả năng kiểm soát chính xác các dải độ chói.",
  "landing.panel.contrast.label": "Đường cong tương phản",
  "landing.panel.contrast.body":
    "Điều chỉnh phân bố tương phản theo các vùng tông màu bằng mô hình mật độ phim và kiểm soát đầy đủ hình dạng đường cong.",
  "landing.panel.scattering.label": "Tán xạ",
  "landing.panel.scattering.body":
    "Thêm sắc màu vùng tối và vùng sáng chính xác theo vật lý dựa trên hành vi ánh sáng tự nhiên bằng hai vòng màu.",
  "landing.panel.refraction.label": "Khúc xạ",
  "landing.panel.refraction.body":
    "HSL mang chất phim. Thay đổi riêng biệt sắc độ và độ bão hòa ở vùng tối và vùng sáng cho mọi dải màu.",
  "landing.panel.density.label": "Đường cong mật độ",
  "landing.panel.density.body":
    "Kiểm soát độ đậm màu và độ bão hòa theo từng sắc độ, dựa trên hành vi mật độ của phim analog.",
  "landing.panel.chroma.label": "Đường cong chroma",
  "landing.panel.chroma.body":
    "Điều chỉnh độ bão hòa dựa trên mức độ rực màu hiện tại của điểm ảnh. Tăng các tông nhạt hoặc bảo vệ vùng sáng rực rỡ.",
  "landing.panel.radiance.label": "Đường cong độ rạng",
  "landing.panel.radiance.body":
    "Điều chỉnh độ sáng theo từng sắc độ để cân bằng tông tinh tế và tạo tương phản màu tự nhiên mà không cần mặt nạ.",
  "landing.panel.saturation.label": "Đường cong bão hòa",
  "landing.panel.saturation.body":
    "Kiểm soát độ bão hòa theo các dải sáng. Tăng vùng tối hoặc giảm vùng sáng để tránh cắt màu.",
  "landing.panel.rgb.label": "Vùng tối và vùng sáng",
  "landing.panel.rgb.body":
    "Điều chỉnh độ sáng và thêm chuyển sắc tinh tế riêng biệt cho vùng tối và vùng sáng của ảnh.",
  "landing.panel.spotlight.label": "Ánh sáng điểm",
  "landing.panel.spotlight.body":
    "Tái chiếu sáng linh hoạt với phơi sáng cục bộ và độ nổi khối. Kéo điểm trên ảnh để đặt ánh sáng; nhấp đúp để đưa về giữa.",
  "landing.panel.halation.label": "Quầng sáng phim",
  "landing.panel.halation.body":
    "Mô phỏng quầng đỏ cam đặc trưng quanh vùng sáng thường thấy trong ảnh chụp phim analog.",
  "landing.panel.diffusion.label": "Khuếch tán",
  "landing.panel.diffusion.body":
    "Khuếch tán quang học thời gian thực giúp làm mềm vùng sáng mà vẫn giữ chủ thể rõ nét. Kéo điểm trên ảnh để đặt vùng được bảo vệ; nhấp đúp để đưa về giữa.",
  "landing.panel.texture.label": "Kết cấu",
  "landing.panel.texture.body":
    "Tạo lại kết cấu từng điểm ảnh bằng hạt phim có chiều sâu và vi tương phản cục bộ, từ 35mm mịn đến ISO 800 thô ráp.",
  "landing.looks.eyebrow": "Preset mô phỏng phim",
  "landing.looks.title": "Bắt đầu từ màu phim điện ảnh rồi biến thành phong cách của bạn",
  "landing.looks.body":
    "Dùng phong cách phim in, phố đêm, biên tập, âm bản cổ điển và điện ảnh hiện đại làm điểm khởi đầu linh hoạt. Tinh chỉnh mật độ, đường cong, độ bão hòa, halation, bloom, hạt phim và xuất bản chỉnh màu cuối thành phong cách tái sử dụng.",
  "landing.looks.previewAlt": "Xem trước preset chỉnh màu phim {name}",
  "landing.looks.motionPicture": "Âm bản phim điện ảnh",
  "landing.looks.nightStreet": "Phim phố đêm",
  "landing.looks.softPrint": "Phim in dịu nhẹ",
  "landing.looks.cinematic": "Phong cách phim điện ảnh",
  "landing.looks.classicStill": "Phim chụp cổ điển",
  "landing.looks.naturalStill": "Phim chụp tự nhiên",
  "landing.looks.modernCinema": "Gói điện ảnh hiện đại",
  "landing.looks.editorial": "Tinh tuyển phong cách biên tập",
  "landing.looks.tetrachrome": "Tetrachrome",
  "landing.looks.vintageNegative": "Âm bản màu cổ điển",
  "landing.workflow.eyebrow": "Quy trình chỉnh màu trên trình duyệt",
  "landing.workflow.title": "Nhập ảnh RAW, khớp ảnh tham chiếu, xuất LUT 3D",
  "landing.step.1.title": "Mở ảnh của bạn",
  "landing.step.1.body": "Kéo thả tệp RAW vào hoặc gửi trực tiếp từ điện thoại bằng mã QR.",
  "landing.step.2.title": "Tạo hình khối màu",
  "landing.step.2.body": "Tinh chỉnh phơi sáng, màu sắc và tương phản, hoặc bắt đầu từ một preset.",
  "landing.step.3.title": "Xuất & chia sẻ",
  "landing.step.3.body": "Lưu phong cách của bạn thành preset và xuất ảnh thành phẩm.",
  "landing.faq.eyebrow": "Câu hỏi thường gặp",
  "landing.faq.title": "Giải đáp về chỉnh màu phim trên trình duyệt",
  "landing.faq.body":
    "Câu trả lời ngắn cho nhiếp ảnh gia, nhà làm phim và nhà sáng tạo đang so sánh chỉnh màu web, mô phỏng phim, chỉnh RAW và quy trình xuất LUT.",
  "landing.faq.q1": "Hytic có phải là trình chỉnh sửa ảnh trực tuyến không?",
  "landing.faq.a1":
    "Có. Hytic là trình chỉnh sửa ảnh trên trình duyệt tập trung vào màu sắc. Ứng dụng mở ảnh RAW và khung hình video, đồng thời cung cấp mười sáu bảng điều chỉnh phơi sáng, tương phản, đường cong, cân bằng màu và màu phim — không cần cài đặt hay tải ảnh lên.",
  "landing.faq.q2": "Hytic có thể chỉnh sửa ảnh RAW trực tuyến không?",
  "landing.faq.a2":
    "Có. Hytic chỉnh sửa ảnh RAW trực tuyến trong trình duyệt và hỗ trợ CR2, CR3, NEF, ARW, DNG, RAF, RW2, ORF, HEIC và TIFF. Việc nhập và xử lý ảnh diễn ra cục bộ trên thiết bị của bạn thay vì qua máy chủ dựng hình từ xa.",
  "landing.faq.q3": "Hytic có nhanh và đơn giản hơn trình chỉnh sửa ảnh trên máy tính không?",
  "landing.faq.a3":
    "Với công việc màu sắc, thường là có. Hytic mở trong một tab trình duyệt, không cần cài đặt, đồng bộ hay thiết lập catalog, và tập trung bộ công cụ vào màu sắc cùng màu phim. Nhờ đó, tạo phong cách điện ảnh và xuất LUT 3D nhanh, đơn giản hơn việc học một bộ phần mềm máy tính đầy đủ.",
  "landing.faq.q4": "Tôi có thể điều chỉnh những gì trong Hytic?",
  "landing.faq.a4":
    "Hytic hỗ trợ đường cong phơi sáng và tương phản, cân bằng màu, độ bão hòa, mật độ, chroma và độ rạng, sắc màu vùng tối và vùng sáng, khớp màu bằng AI, cùng các hiệu ứng phim như tán xạ, khúc xạ, halation, bloom, khuếch tán và hạt phim.",
  "landing.faq.q5": "Chỉnh màu phim trên trình duyệt là gì?",
  "landing.faq.a5":
    "Đó là quá trình định hình màu sắc, tương phản, mật độ, chuyển tiếp vùng sáng, hạt phim, halation và phong cách điện ảnh trực tiếp trong ứng dụng web mà không cần cài một bộ phần mềm chỉnh màu máy tính đầy đủ.",
  "landing.faq.q6": "Tôi có thể chỉnh màu ảnh RAW trong Hytic không?",
  "landing.faq.a6":
    "Có. Hytic được thiết kế cho quy trình chỉnh màu ảnh RAW, mang đến cho nhiếp ảnh gia không gian trên trình duyệt để chỉnh phơi sáng, tương phản, đường cong, khớp màu, kết cấu phim và tạo phong cách tái sử dụng.",
  "landing.faq.q7": "Tôi có thể tạo và xuất LUT 3D trực tuyến không?",
  "landing.faq.a7":
    "Có. Hytic cho phép bạn tạo phong cách điện ảnh trong trình duyệt và xuất thành LUT 3D để dùng trong các trình chỉnh sửa video, ảnh và quy trình sáng tạo có quản lý màu tương thích.",
  "landing.faq.q8": "Hytic dành cho ai?",
  "landing.faq.a8":
    "Hytic dành cho nhiếp ảnh gia, nhà làm phim, nhà sáng tạo và nhóm tập trung vào màu sắc muốn có quy trình web nhanh cho màu phim, khớp ảnh tham chiếu, biểu đồ, preset và xuất LUT.",
  "landing.cta.title": "Tạo màu điện ảnh ngay trong trình duyệt",
  "landing.cta.body":
    "Mở Hytic để chỉnh màu ảnh RAW, tạo phong cách lấy cảm hứng từ phim, khớp ảnh tham chiếu và xuất LUT cho quy trình chỉnh sửa của bạn.",
  "landing.cta.button": "Mở trình chỉnh sửa",
  "landing.footer.tagline": "Chỉnh sửa ảnh RAW và chỉnh màu điện ảnh, ngay trong trình duyệt.",
  "landing.footer.product": "Sản phẩm",
  "landing.footer.legal": "Pháp lý",
  "landing.footer.notices": "Thông báo bên thứ ba",
  "landing.footer.photoEditor": "Trình chỉnh sửa ảnh",
  "landing.footer.lightroom": "Lựa chọn thay thế Lightroom",
  "landing.footer.darktable": "Lựa chọn thay thế Darktable",
  "landing.footer.guides": "Hướng dẫn",
  "landing.footer.about": "Giới thiệu",
  "landing.footer.privacy": "Quyền riêng tư",
  "landing.footer.terms": "Điều khoản",
  "landing.footer.contact": "Liên hệ",
  "landing.footer.changelog": "Nhật ký thay đổi",
  "landing.footer.rights": "Bảo lưu mọi quyền.",

  "error.network": "Không thể kết nối tới máy chủ. Vui lòng kiểm tra kết nối mạng và thử lại.",
  "error.server": "Máy chủ đang gặp sự cố. Vui lòng thử lại sau giây lát.",
  "error.generic": "Đã có lỗi xảy ra. Vui lòng thử lại.",
  "error.tooMany": "Bạn đã thử quá nhiều lần. Vui lòng đợi một phút rồi thử lại.",
  "error.invalidCredentials": "Email hoặc mật khẩu không đúng. Vui lòng thử lại.",
  "error.invalidInput": "Vui lòng kiểm tra lại thông tin bạn đã nhập.",

  "send.eyebrow": "Gửi ảnh từ điện thoại",
  "send.title": "Gửi ảnh tới trình chỉnh sửa",
  "send.desktopHint":
    "Trang này dành cho điện thoại của bạn. Hãy quét mã QR hiển thị trong trình chỉnh sửa trên máy tính để mở trên điện thoại.",
  "send.field.code": "Nhập mã",
  "send.action.connect": "Kết nối",
  "send.status.connecting": "Đang kết nối tới trình chỉnh sửa Hytic…",
  "send.status.connected": "Đã kết nối tới trình chỉnh sửa Hytic.",
  "send.action.chooseImage": "Chọn ảnh",
  "send.status.confirming": "Đang xác nhận trình chỉnh sửa đã nhận ảnh…",
  "send.status.sending": "Đang gửi {name}…",
  "send.done.title": "Đã gửi tới Hytic",
  "send.done.body": "Máy tính đã nhận được ảnh của bạn.",
  "send.action.sendAnother": "Gửi ảnh khác",
  "send.action.tryAgain": "Thử lại",
  "send.error.connectionClosed": "Kết nối tới máy tính đã đóng. Vui lòng thử lại.",
  "send.error.peerLeft": "Trình chỉnh sửa đã ngừng chờ ảnh này.",
  "send.error.connect": "Không thể kết nối tới trình chỉnh sửa. Vui lòng thử lại.",
  "send.error.finishConnection": "Không thể hoàn tất kết nối. Vui lòng thử lại.",
  "send.error.open": "Không thể mở trang gửi ảnh. Vui lòng thử lại.",
  "send.error.noAck": "Trình chỉnh sửa chưa xác nhận đã nhận ảnh.",
  "send.error.notConnected": "Trình chỉnh sửa chưa được kết nối. Vui lòng kết nối lại và thử lại.",
  "send.error.uploadFailed": "Gửi ảnh thất bại. Vui lòng thử lại.",
  "send.error.generic": "Đã có lỗi trong quá trình truyền ảnh. Vui lòng thử lại.",

  "relay.tooMany": "Bạn đã thử quá nhiều lần. Vui lòng đợi một phút rồi thử lại.",
  "relay.expired": "Liên kết đã hết hạn. Hãy hiển thị mã QR mới trên máy tính và quét lại.",
  "relay.busy": "Đã có một điện thoại kết nối với trình chỉnh sửa này.",
  "relay.connectFirst": "Vui lòng kết nối tới trình chỉnh sửa trước.",
  "relay.peerNotReady": "Thiết bị còn lại chưa được kết nối.",
  "relay.startFailed": "Không thể khởi động kết nối điện thoại. Vui lòng thử lại.",
  "relay.protocol": "Đã có lỗi với kết nối. Vui lòng thử lại.",

  "locale.label": "Ngôn ngữ",
};

const tables: Record<Locale, Record<MessageKey, string>> = { en, vi };

// Canonical English server text (lowercased) → message key. Backend auth and
// relay messages are fixed constants, so an exact (case-insensitive) match is
// reliable; anything unmatched falls back to a friendly generic message.
const SERVER_TEXT: Record<string, MessageKey> = {
  "invalid email or password": "error.invalidCredentials",
  "invalid request body": "error.invalidInput",
  "origin is not allowed": "error.generic",
  "internal server error": "error.server",
  "not found": "error.generic",
  // Relay (WebSocket room-error reasons)
  "too many relay attempts. try again in a minute.": "relay.tooMany",
  "this phone link expired. show a fresh qr code on the desktop.": "relay.expired",
  "this phone link expired.": "relay.expired",
  "a phone is already connected to this editor.": "relay.busy",
  "connect to the editor first.": "relay.connectFirst",
  "the other device is not connected yet.": "relay.peerNotReady",
  "unable to start phone relay.": "relay.startFailed",
  "turn is not configured for device relay": "relay.startFailed",
  "relay message was invalid.": "relay.protocol",
  "relay message was too large.": "relay.protocol",
  "relay message was not readable.": "relay.protocol",
  "relay only accepts signaling messages.": "relay.protocol",
  "relay command was not recognized.": "relay.protocol",
};

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const pathname = window.location.pathname;
  return pathname === "/vi" || pathname.startsWith("/vi/") ? "vi" : "en";
}

function applyDocumentLang(next: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = next;
}

const [locale, setLocaleSignal] = createSignal<Locale>(detectInitialLocale());
applyDocumentLang(locale());

export { locale };

export function setLocale(next: Locale): void {
  setLocaleSignal(next);
  applyDocumentLang(next);
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => setLocale(detectInitialLocale()));
  window.addEventListener("hytic:navigation", () => applyDocumentLang(locale()));
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(locale(), key, vars);
}

export function translate(
  targetLocale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  let text = tables[targetLocale][key] ?? en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(`{${name}}`, String(value));
    }
  }
  return text;
}

function mapServerText(text: string): MessageKey | null {
  return SERVER_TEXT[text.trim().toLowerCase()] ?? null;
}

function isNetworkError(error: unknown): boolean {
  // A failed fetch (offline, DNS, CORS, connection refused) rejects with a
  // TypeError rather than producing an HTTP response.
  return error instanceof TypeError;
}

// Resolve an error thrown by `apiRequest` to a message key. Known server
// messages map to a specific message; otherwise status drives the choice, then
// the caller's fallback. Returning the key (not the text) lets callers store it
// and re-translate reactively when the locale changes.
export function apiErrorKey(error: unknown, fallback: MessageKey): MessageKey {
  if (isNetworkError(error)) return "error.network";
  return fallback;
}

// Resolve an arbitrary server-provided string (relay room-error reason, OAuth
// redirect notice) to a message key. Unmapped text falls back to a friendly key.
export function serverMessageKey(
  text: string | null | undefined,
  fallback: MessageKey,
): MessageKey {
  if (text) {
    const mapped = mapServerText(text);
    if (mapped) return mapped;
  }
  return fallback;
}

// String-returning convenience wrappers, for call sites that show the message
// immediately and don't need to re-translate on a later locale change.
export function localizeError(error: unknown, fallback: MessageKey): string {
  return t(apiErrorKey(error, fallback));
}

export function localizeServerText(text: string | null | undefined, fallback: MessageKey): string {
  return t(serverMessageKey(text, fallback));
}
