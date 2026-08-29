// ══════════════════════════════════════════════════════════════════════════
// فلاش — الموقع العسكري (ملف واحد شامل: إعدادات + موقع + بوت)
// ══════════════════════════════════════════════════════════════════════════

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const mongoose = require("mongoose");
const {
    Client,
    GatewayIntentBits,
    Partials,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
    AttachmentBuilder,
} = require("discord.js");

// ══════════════════════════════════════════════════════════════════════════
// 1) الإعدادات — تُقرأ من Environment Variables بلوحة الاستضافة (Render → Environment)
// ══════════════════════════════════════════════════════════════════════════
const CONFIG = {
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || "",
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || "",
    DISCORD_CALLBACK_URL: process.env.DISCORD_CALLBACK_URL || "",
    BOT_TOKEN: process.env.BOT_TOKEN || "",
    GUILD_ID: process.env.GUILD_ID || "",
    MONGO_URI: process.env.MONGO_URI || "",

    SITE_NAME: "فلاش",
    SESSION_SECRET: process.env.SESSION_SECRET || "غيّر_هذا_السر_2026",
    PORT: process.env.PORT || 7700,

    // رتب العسكر المعتمدة لتسجيل الدخول بالموقع (رولات ديسكورد)
    MILITARY_ROLE_IDS: [
        "1500064443537686588",
        "1533192878510178304",
        "1500064767082233926",
    ],

    // آيديات كبار المسؤولين — نفس أسلوب ملف البنك (مصفوفة ثابتة بالكود)
    SENIOR_ADMIN_IDS: [
         "1003511814140743825",
         "1231269832201207808",
         "1458502584481484952",
    ],

    // الرتب العسكرية الرسمية بالترتيب من الأدنى للأعلى
    MILITARY_RANKS: [
    "جندي", "جندي اول", "عريف", "وكيل رقيب", "رقيب", "رقيب اول", "رئيس رقباء",
    "ملازم", "ملازم اول", "نقيب", "رائد",
    "مقدم", "عقيد", "عميد",
    "لواء", "فريق", "فريق اول",
],
    DEFAULT_POINTS_PER_RANK: 20, // النقاط الافتراضية المطلوبة للترقية للرتبة التالية (قابلة للتعديل من لوحة كبار المسؤولين)

    VIOLATION_TYPES: [
        "تجاوز السرعة المحددة",
        "القيادة العكسية",
        "التفحيط / القيادة المتهورة",
        "تظليل كتم",
        "تظليل نيكل",
        "صدم مركبات امنيه/مواطنين",
        "هروب من رجال الامن",
        "الهروب من نقطة تفتيش",
    ],

    POINTS_ON_APPROVE: 1,
    POINTS_ON_REJECT: 1, // تُخصم (تُطرح) من نقاط العسكري عند رفض مخالفته
    MAX_VEHICLES_ADD: 60,
    MAX_PHOTO_MB: 3,

    // رتبة مديرية مكافحة المخدرات — تسجّل تقارير بدل المخالفات
    ANTI_DRUGS_ROLE_ID: "1500064767082233926",
    REPORT_POINTS_APPROVE: 2, // نقاط قبول تقرير مكافحة المخدرات
    REPORT_POINTS_REJECT: 1,  // نقاط خصم رفض تقرير مكافحة المخدرات

    // رولات ديسكورد تحدد عضوية كل قطاع (تُستخدم لعرض "أعضاء القطاع" لدى قادة ونواب القطاعات)
    PATROL_ROLE_ID: process.env.PATROL_ROLE_ID || "1500064443537686588",
    ROAD_SECURITY_ROLE_ID: process.env.ROAD_SECURITY_ROLE_ID || "1533192878510178304",

    // القطاعات الثلاثة الرسمية (المفتاح يُستخدم بالكود، القيمة تظهر بالواجهة)
    SECTORS: {
        patrol: "الدوريات",
        roadSecurity: "أمن الطرق",
        antiDrugs: "مكافحة المخدرات",
    },
};

// ══════════════════════════════════════════════════════════════════════════
// 2) قاعدة البيانات والموديلات
// ══════════════════════════════════════════════════════════════════════════
mongoose.connect(CONFIG.MONGO_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => console.log("❌ MongoDB error:", err));

const PersonnelSchema = new mongoose.Schema({
    discord: { type: String, required: true, unique: true },
    discordTag: String,
    registeredName: { type: String, default: null },
    unit: { type: String, default: null },
    rank: { type: String, default: "جندي" },
    points: { type: Number, default: 0 },
    notes: [{
        text: String, addedBy: String, addedByTag: String,
        createdAt: { type: Date, default: Date.now }
    }],
    // تحذيرات/إشعارات صادرة له — تظهر بوجهه كشاشة كاملة لين يتعاهد عليها
    warnings: [{
        kind: { type: String, enum: ["warning", "notice"], default: "warning" }, // تحذير | إشعار
        reason: String,
        issuedBy: String, issuedByTag: String,
        acknowledged: { type: Boolean, default: false },
        acknowledgedAt: Date,
        createdAt: { type: Date, default: Date.now }
    }],
    isBlocked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
const Personnel = mongoose.model("Personnel", PersonnelSchema);

const ViolationSchema = new mongoose.Schema({
    reporterDiscord: String,
    reporterTag: String,
    reporterName: String,
    reporterUnit: String,
    violationType: String,
    vehicle: String,
    vehiclePhoto: { type: String, default: null },
    plateNumber: String,
    photo: { type: String, default: null }, // data URL أو رابط
    status: { type: String, default: "pending" },
    rejectReason: { type: String, default: null },
    reviewedBy: String,
    reviewedByTag: String,
    reviewedAt: Date,
    createdAt: { type: Date, default: Date.now },

    // ── حقول تقرير مكافحة المخدرات (kind: "report") ──
    kind: { type: String, enum: ["violation", "report"], default: "violation" },
    reportCategory: { type: String, default: null }, // "جنائي" أو "مخدرات"
    suspectName: { type: String, default: null },
    arrestLocation: { type: String, default: null },
    stopReason: { type: String, default: null },
    seizedItems: { type: String, default: null },
    securityActions: { type: [String], default: [] },

    // حقول خاصة بتقرير "مخدرات" فقط
    drugType: { type: String, default: null },
    drugQuantity: { type: String, default: null },
    concealMethod: { type: String, default: null },
});
const Violation = mongoose.model("Violation", ViolationSchema);

const VehicleSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    photo: { type: String, default: null },
    addedBy: String,
    createdAt: { type: Date, default: Date.now }
});
const Vehicle = mongoose.model("Vehicle", VehicleSchema);

const LogSchema = new mongoose.Schema({
    discordId: { type: String, default: null },     // آيدي الشخص المتأثر بالحدث (العسكري مثلاً)
    discordTag: { type: String, default: null },
    actorId: { type: String, default: null },        // آيدي اللي سوى الإجراء
    actorTag: { type: String, default: null },
    action: String,        // نوع الحدث
    site: { type: String, default: "فلاش" },
    accountNumber: { type: String, default: null },
    details: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now }
});
const Log = mongoose.model("Log", LogSchema);

const SettingsSchema = new mongoose.Schema({
    isMaintenance: { type: Boolean, default: false },
    disableLogin: { type: Boolean, default: false },
    disableViolations: { type: Boolean, default: false },
    adminList: { type: [String], default: [] }, // إداريون معيّنون (يقبلون/يرفضون المخالفات فقط)
    rankThresholds: { type: Map, of: Number, default: {} }, // رتبة -> نقاط مطلوبة للرتبة التالية
    // قادة ونواب القطاعات الثلاثة — يُعيّنهم كبار المسؤولين من الموقع (بحث عن شخص مسجل بالموقع)
    sectorLeadership: {
        patrol: {
            commanderId: { type: String, default: null }, commanderName: { type: String, default: null },
            deputyId: { type: String, default: null }, deputyName: { type: String, default: null },
        },
        roadSecurity: {
            commanderId: { type: String, default: null }, commanderName: { type: String, default: null },
            deputyId: { type: String, default: null }, deputyName: { type: String, default: null },
        },
        antiDrugs: {
            commanderId: { type: String, default: null }, commanderName: { type: String, default: null },
            deputyId: { type: String, default: null }, deputyName: { type: String, default: null },
        },
    },
    violationsChannelId: String,
}, { minimize: false });
const Settings = mongoose.model("Settings", SettingsSchema);

async function getSettings() {
    let s = await Settings.findOne();
    if (!s) s = await Settings.create({});
    return s;
}

async function logEvent({ action, discordId = null, discordTag = null, actorId = null, actorTag = null, site = "فلاش", accountNumber = null, details = "" }) {
    try { await Log.create({ action, discordId, discordTag, actorId, actorTag, site, accountNumber, details }); } catch (e) { /* تجاهل */ }
}

function generatePlate() {
    const letters = "أبجدهوزحطيكلمنسعفصقرشتثخذضظغ";
    const pick = () => letters[Math.floor(Math.random() * letters.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    return `${pick()} ${pick()} ${pick()} - ${num}`;
}

function rankIndex(rank) {
    const i = CONFIG.MILITARY_RANKS.indexOf(rank);
    return i === -1 ? 0 : i;
}

function isSeniorAdmin(userId) {
    return CONFIG.SENIOR_ADMIN_IDS.includes(userId);
}

async function isAnyAdmin(userId) {
    if (isSeniorAdmin(userId)) return true;
    const settings = await getSettings();
    return settings.adminList.includes(userId);
}

async function getThreshold(rank, settings) {
    const s = settings || await getSettings();
    const t = s.rankThresholds && typeof s.rankThresholds.get === "function" ? s.rankThresholds.get(rank) : undefined;
    return (t !== undefined && t !== null) ? t : CONFIG.DEFAULT_POINTS_PER_RANK;
}

async function rankProgress(p, settings) {
    const idx = rankIndex(p.rank);
    const isMax = idx >= CONFIG.MILITARY_RANKS.length - 1;
    const nextRank = isMax ? null : CONFIG.MILITARY_RANKS[idx + 1];
    const threshold = isMax ? 0 : await getThreshold(p.rank, settings);
    const remaining = isMax ? 0 : Math.max(0, threshold - p.points);
    return { currentRank: p.rank, nextRank, threshold, remaining };
}

// ── منطق قادة ونواب القطاعات ────────────────────────────────────────────
// يرجع مفتاح القطاع الذي يقوده/ينوبه هذا الشخص (من إعدادات قاعدة البيانات)، أو null
function getSectorRole(userId, settings) {
    const sl = settings.sectorLeadership || {};
    for (const key of Object.keys(CONFIG.SECTORS)) {
        const sec = sl[key];
        if (!sec) continue;
        if (sec.commanderId === userId) return { sector: key, sectorLabel: CONFIG.SECTORS[key], role: "commander" };
        if (sec.deputyId === userId) return { sector: key, sectorLabel: CONFIG.SECTORS[key], role: "deputy" };
    }
    return null;
}

function sectorRoleId(sectorKey) {
    if (sectorKey === "patrol") return CONFIG.PATROL_ROLE_ID;
    if (sectorKey === "roadSecurity") return CONFIG.ROAD_SECURITY_ROLE_ID;
    if (sectorKey === "antiDrugs") return CONFIG.ANTI_DRUGS_ROLE_ID;
    return null;
}

// يجيب آيديات كل أعضاء القطاع (حسب الرول بديسكورد) عن طريق البوت
// كاش بسيط لقائمة أعضاء السيرفر كاملة (30 ثانية) — عشان ما نعيد جلبها من ديسكورد كل ضغطة تبويب،
// لأن الجلب الكامل ثقيل ويفشل أحياناً (تايم أوت / ريت-ليمت) لو تكرر بسرعة
let guildMembersFetch = { time: 0, promise: null };
async function ensureGuildMembersFetched(guild) {
    const now = Date.now();
    if (guildMembersFetch.promise && (now - guildMembersFetch.time) < 30000) {
        return guildMembersFetch.promise;
    }
    guildMembersFetch.time = now;
    guildMembersFetch.promise = guild.members.fetch().catch(e => { guildMembersFetch.promise = null; throw e; });
    return guildMembersFetch.promise;
}
// يرجع مصفوفة آيديات لو نجح، أو null لو صار خطأ فعلي بالجلب (عشان ما نلخبط "فشل" مع "لا يوجد أعضاء")
async function getSectorMemberIds(sectorKey) {
    const roleId = sectorRoleId(sectorKey);
    if (!roleId) return [];
    if (!botReady) return null;
    try {
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        const role = await guild.roles.fetch(roleId);
        if (!role) return [];
        await ensureGuildMembersFetched(guild);
        return role.members.map(m => m.id);
    } catch (e) {
        console.error("❌ فشل جلب أعضاء القطاع:", e.message);
        return null;
    }
}

// النقاط اللي المفروض يكون العسكري وصلها عشان يستحق هذي الرتبة بشكل طبيعي
// (نفس عدد نقاط عتبة الرتبة اللي قبلها مباشرة)
async function pointsForReachingRank(rankName, settings) {
    const idx = rankIndex(rankName);
    if (idx <= 0) return 0;
    const prevRank = CONFIG.MILITARY_RANKS[idx - 1];
    return await getThreshold(prevRank, settings);
}

// يفحص إذا العسكري وصل للنقاط المطلوبة لرتبته الحالية ويرقّيه تلقائياً
// (يدعم أكثر من رتبة دفعة وحدة لو جمع نقاط كثيرة، وينقل الباقي للرتبة الجديدة)
async function checkAutoPromotion(discordId) {
    const settings = await getSettings();
    const p = await Personnel.findOne({ discord: discordId });
    if (!p) return;
    let promoted = false;
    let guard = 0;
    while (guard++ < CONFIG.MILITARY_RANKS.length) {
        const idx = rankIndex(p.rank);
        if (idx >= CONFIG.MILITARY_RANKS.length - 1) break; // وصل لأعلى رتبة
        const threshold = await getThreshold(p.rank, settings);
        if (threshold <= 0 || p.points < threshold) break;
        const oldRank = p.rank;
        p.rank = CONFIG.MILITARY_RANKS[idx + 1];
        p.points -= threshold;
        promoted = true;
        await logEvent({ action: "ترقية تلقائية", discordId, discordTag: p.discordTag, actorId: "نظام تلقائي", actorTag: "🤖 نظام تلقائي", details: `${oldRank} ← ${p.rank} (وصل للنقاط المطلوبة)` });
    }
    if (promoted) await p.save();
}

// ══════════════════════════════════════════════════════════════════════════
// 3) بوت الديسكورد
// ══════════════════════════════════════════════════════════════════════════
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
});

const pendingMessages = new Map(); // violationId -> { channelId, messageId }
let botReady = false;

async function isMilitary(discordId) {
    if (!botReady) return { ok: false, reason: "البوت لسا ما اتصل بديسكورد، حاول بعد ثوانٍ" };
    try {
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(discordId);
        const has = member.roles.cache.some(r => CONFIG.MILITARY_ROLE_IDS.includes(r.id));
        const isAntiDrugs = member.roles.cache.has(CONFIG.ANTI_DRUGS_ROLE_ID);
        return { ok: has, member, isAntiDrugs };
    } catch (e) {
        console.error("❌ isMilitary خطأ:", e.message);
        return { ok: false, reason: e.message };
    }
}

function buildViolationEmbed(v) {
    if (v.kind === "report") {
        const fields = [
            { name: "اسم العسكري", value: v.reporterName || "-", inline: true },
            { name: "اليونت", value: v.reporterUnit || "-", inline: true },
            { name: "نوع التقرير", value: v.reportCategory || "-", inline: true },
            { name: "اسم المتهم", value: v.suspectName || "-", inline: true },
            { name: "موقع الضبط", value: v.arrestLocation || "-", inline: true },
            { name: "المركبة", value: v.vehicle || "-", inline: true },
            { name: "سبب الاستيقاف", value: v.stopReason || "-", inline: false },
        ];
        if (v.reportCategory === "مخدرات") {
            fields.push(
                { name: "نوع المخدر المضبوط", value: v.drugType || "-", inline: true },
                { name: "الكمية المضبوطة", value: v.drugQuantity || "-", inline: true },
                { name: "طريقة إخفاء المخدر", value: v.concealMethod || "-", inline: false },
            );
        } else {
            fields.push({ name: "المضبوطات", value: v.seizedItems || "-", inline: false });
        }
        fields.push({ name: "الإجراءات الأمنية المتخذة", value: (v.securityActions && v.securityActions.length) ? v.securityActions.map(a => `- ${a}`).join("\n") : "-", inline: false });
        return new EmbedBuilder()
            .setTitle(`🧪 تقرير مكافحة مخدرات جديد (${v.reportCategory || "-"}) — بانتظار المراجعة`)
            .setColor(0xf59e0b)
            .addFields(fields)
            .setFooter({ text: `ID: ${v._id}` })
            .setTimestamp(v.createdAt);
    }
    return new EmbedBuilder()
        .setTitle("🚨 مخالفة جديدة بانتظار المراجعة")
        .setColor(0xf59e0b)
        .addFields(
            { name: "اسم العسكري", value: v.reporterName || "-", inline: true },
            { name: "اليونت", value: v.reporterUnit || "-", inline: true },
            { name: "نوع المخالفة", value: v.violationType, inline: false },
            { name: "المركبة", value: v.vehicle, inline: true },
            { name: "لوحة السيارة", value: v.plateNumber, inline: true },
        )
        .setFooter({ text: `ID: ${v._id}` })
        .setTimestamp(v.createdAt);
}

function buildViolationButtons(id, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_${id}`).setLabel("قبول").setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`reject_${id}`).setLabel("رفض").setStyle(ButtonStyle.Danger).setDisabled(disabled),
    );
}

// إرسال المخالفة تلقائياً لقناة المخالفات فور تسجيلها من الموقع
async function postViolationToChannel(v) {
    const settings = await getSettings();
    if (!botReady || !settings.violationsChannelId) return;
    try {
        const channel = await client.channels.fetch(settings.violationsChannelId);
        const embed = buildViolationEmbed(v);
        const components = [buildViolationButtons(v._id.toString())];
        const files = [];
        if (v.photo && v.photo.startsWith("data:image")) {
            const base64Data = v.photo.split(",")[1];
            const buffer = Buffer.from(base64Data, "base64");
            const ext = v.photo.includes("image/png") ? "png" : "jpg";
            const fname = `violation_${v._id}.${ext}`;
            files.push(new AttachmentBuilder(buffer, { name: fname }));
            embed.setImage(`attachment://${fname}`);
        }
        const msg = await channel.send({ embeds: [embed], components, files });
        pendingMessages.set(v._id.toString(), { channelId: msg.channelId, messageId: msg.id });
    } catch (e) { console.error("❌ فشل إرسال المخالفة للقناة:", e.message); }
}

// تحديث رسالة المخالفة بالقناة بعد قبول/رفض (سواء من البوت أو من الموقع)
async function syncViolationMessage(v) {
    const ref = pendingMessages.get(v._id.toString());
    if (!ref) return;
    try {
        const channel = await client.channels.fetch(ref.channelId);
        const msg = await channel.messages.fetch(ref.messageId);
        const color = v.status === "approved" ? 0x22c55e : v.status === "rejected" ? 0xef4444 : 0xf59e0b;
        const isReport = v.kind === "report";
        const title = v.status === "approved" ? (isReport ? "✅ تقرير مكافحة مخدرات مقبول" : "✅ مخالفة مقبولة")
            : v.status === "rejected" ? (isReport ? "❌ تقرير مكافحة مخدرات مرفوض" : "❌ مخالفة مرفوضة")
            : (isReport ? `🧪 تقرير مكافحة مخدرات جديد (${v.reportCategory || "-"}) — بانتظار المراجعة` : "🚨 مخالفة جديدة بانتظار المراجعة");
        const oldEmbed = msg.embeds[0] ? EmbedBuilder.from(msg.embeds[0]) : buildViolationEmbed(v);
        const embed = oldEmbed.setColor(color).setTitle(title);
        await msg.edit({ embeds: [embed], components: [buildViolationButtons(v._id.toString(), v.status !== "pending")] });
    } catch (e) { /* تجاهل */ }
    if (v.status !== "pending") pendingMessages.delete(v._id.toString());
}

async function approveViolation(v, actorId, actorTag) {
    v.status = "approved"; v.reviewedBy = actorId; v.reviewedByTag = actorTag; v.reviewedAt = new Date();
    await v.save();
    const pts = v.kind === "report" ? CONFIG.REPORT_POINTS_APPROVE : CONFIG.POINTS_ON_APPROVE;
    await Personnel.findOneAndUpdate({ discord: v.reporterDiscord }, { $inc: { points: pts } });
    await checkAutoPromotion(v.reporterDiscord);
    await syncViolationMessage(v);
    const label = v.kind === "report" ? `تقرير مكافحة مخدرات (${v.reportCategory})` : v.violationType;
    await logEvent({ action: v.kind === "report" ? "قبول تقرير" : "قبول مخالفة", discordId: v.reporterDiscord, discordTag: v.reporterTag, actorId, actorTag, details: `${label} — ${v.reporterName}` });
}

async function rejectViolation(v, actorId, actorTag, reason) {
    v.status = "rejected"; v.rejectReason = reason; v.reviewedBy = actorId; v.reviewedByTag = actorTag; v.reviewedAt = new Date();
    await v.save();
    const pts = v.kind === "report" ? CONFIG.REPORT_POINTS_REJECT : CONFIG.POINTS_ON_REJECT;
    await Personnel.findOneAndUpdate({ discord: v.reporterDiscord }, { $inc: { points: -pts } });
    await Personnel.updateOne({ discord: v.reporterDiscord, points: { $lt: 0 } }, { $set: { points: 0 } });
    await syncViolationMessage(v);
    const rlabel = v.kind === "report" ? `تقرير مكافحة مخدرات (${v.reportCategory})` : v.violationType;
    await logEvent({ action: v.kind === "report" ? "رفض تقرير" : "رفض مخالفة", discordId: v.reporterDiscord, discordTag: v.reporterTag, actorId, actorTag, details: `${rlabel} — ${v.reporterName} — السبب: ${reason}` });
}

const commands = [
    new SlashCommandBuilder()
        .setName("حظر")
        .setDescription("حظر عسكري من الموقع (كبار المسؤولين فقط)")
        .addUserOption(o => o.setName("اللاعب").setDescription("العسكري المطلوب حظره").setRequired(true))
        .addStringOption(o => o.setName("السبب").setDescription("سبب الحظر").setRequired(true)),

    new SlashCommandBuilder()
        .setName("فك-حظر")
        .setDescription("فك حظر عسكري عن الموقع (كبار المسؤولين فقط)")
        .addUserOption(o => o.setName("اللاعب").setDescription("العسكري المطلوب فك حظره").setRequired(true)),
].map(c => c.toJSON());

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(CONFIG.BOT_TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID), { body: commands });
        console.log("✅ تم تسجيل أوامر السلاش");
    } catch (e) {
        console.log("❌ خطأ بتسجيل الأوامر:", e);
    }
}

client.on("interactionCreate", async interaction => {
    try {
        // ── أوامر السلاش ─────────────────────────────────────────────
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;

            if (commandName === "حظر") {
                if (!isSeniorAdmin(interaction.user.id)) {
                    return interaction.reply({ content: "🚫 هذا الأمر مخصص لكبار المسؤولين فقط.", ephemeral: true });
                }
                const target = interaction.options.getUser("اللاعب");
                const reason = interaction.options.getString("السبب");
                await Personnel.findOneAndUpdate(
                    { discord: target.id },
                    {
                        $set: { isBlocked: true },
                        $push: { notes: { text: `🚫 حظر من الموقع — السبب: ${reason}`, addedBy: interaction.user.id, addedByTag: interaction.user.username } },
                        $setOnInsert: { discordTag: target.username },
                    },
                    { upsert: true }
                );
                await logEvent({ action: "حظر عسكري (أمر)", discordId: target.id, discordTag: target.username, actorId: interaction.user.id, actorTag: interaction.user.username, details: `السبب: ${reason}` });
                return interaction.reply({ content: `🚫 تم حظر <@${target.id}> من الموقع.\n📝 السبب: ${reason}`, ephemeral: true });
            }

            if (commandName === "فك-حظر") {
                if (!isSeniorAdmin(interaction.user.id)) {
                    return interaction.reply({ content: "🚫 هذا الأمر مخصص لكبار المسؤولين فقط.", ephemeral: true });
                }
                const target = interaction.options.getUser("اللاعب");
                const p = await Personnel.findOneAndUpdate({ discord: target.id }, { isBlocked: false }, { new: true });
                if (!p) return interaction.reply({ content: "❌ هذا اللاعب غير مسجل بالنظام أصلاً.", ephemeral: true });
                await logEvent({ action: "فك حظر عسكري (أمر)", discordId: target.id, discordTag: target.username, actorId: interaction.user.id, actorTag: interaction.user.username });
                return interaction.reply({ content: `✅ تم فك حظر <@${target.id}> من الموقع.`, ephemeral: true });
            }
            return;
        }

        // ── أزرار ─────────────────────────────────────────────────────
        if (interaction.isButton()) {
            const id = interaction.customId;

            if (id.startsWith("approve_") || id.startsWith("reject_")) {
                const [action, vid] = id.split("_");
                const allowed = await isAnyAdmin(interaction.user.id);
                const isDiscordAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
                if (!allowed && !isDiscordAdmin) {
                    return interaction.reply({ content: "🚫 ما تملك صلاحية.", ephemeral: true });
                }
                const v = await Violation.findById(vid);
                if (!v || v.status !== "pending") {
                    return interaction.reply({ content: "هذه المخالفة تمت مراجعتها مسبقاً.", ephemeral: true });
                }
                if (action === "approve") {
                    await approveViolation(v, interaction.user.id, interaction.user.username);
                    return interaction.deferUpdate();
                }
                if (action === "reject") {
                    const modal = new ModalBuilder().setCustomId(`rejectmodal_${vid}`).setTitle("سبب الرفض");
                    const input = new TextInputBuilder()
                        .setCustomId("reason").setLabel("اكتب سبب رفض المخالفة")
                        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
                    modal.addComponents(new ActionRowBuilder().addComponents(input));
                    return interaction.showModal(modal);
                }
                return;
            }

            return;
        }

        // ── نماذج (Modals) ───────────────────────────────────────────
        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith("rejectmodal_")) {
                const vid = interaction.customId.split("_")[1];
                const reason = interaction.fields.getTextInputValue("reason");
                const v = await Violation.findById(vid);
                if (!v || v.status !== "pending") {
                    return interaction.reply({ content: "هذه المخالفة تمت مراجعتها مسبقاً.", ephemeral: true });
                }
                await rejectViolation(v, interaction.user.id, interaction.user.username, reason);
                return interaction.reply({ content: "✅ تم رفض المخالفة وحفظ السبب.", ephemeral: true });
            }
        }
    } catch (e) {
        console.error("❌ خطأ بالتفاعل:", e);
    }
});

const activeVehicleSessions = new Set();
client.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith("-")) return;
    const [cmd] = message.content.slice(1).trim().split(/\s+/);
    if (cmd !== "مركبات") return;

    const senior = isSeniorAdmin(message.author.id);
    if (!senior) return;
    if (activeVehicleSessions.has(message.author.id)) {
        return message.reply("عندك جلسة إضافة مركبات شغالة حالياً، أكملها أول.");
    }
    activeVehicleSessions.add(message.author.id);
    const filter = m => m.author.id === message.author.id;
    try {
        await message.reply(`كم عدد المركبات اللي تبي تضيفها؟ (الأقصى ${CONFIG.MAX_VEHICLES_ADD})`);
        const countCollected = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ["time"] });
        const countMsg = countCollected.first();
        const count = parseInt(countMsg.content.trim());
        if (isNaN(count) || count < 1 || count > CONFIG.MAX_VEHICLES_ADD) {
            activeVehicleSessions.delete(message.author.id);
            return message.reply(`❌ الرقم غير صحيح. لازم يكون بين 1 و ${CONFIG.MAX_VEHICLES_ADD}.`);
        }
        countMsg.delete().catch(() => {});
        const added = [];
        for (let i = 1; i <= count; i++) {
            const p = await message.channel.send(`🚗 اكتب اسم المركبة رقم ${i} من ${count} (يمديك ترفق صورة مع الرسالة):`);
            const collected = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ["time"] });
            const nameMsg = collected.first();
            const name = nameMsg.content.trim();
            const photo = nameMsg.attachments.first()?.url || null;
            nameMsg.delete().catch(() => {});
            p.delete().catch(() => {});
            if (!name) { i--; continue; }
            try {
                await Vehicle.create({ name, photo, addedBy: message.author.id });
                added.push(name);
            } catch (e) {
                await message.channel.send(`⚠️ المركبة "${name}" موجودة مسبقاً، تم تجاوزها.`);
            }
        }
        await message.channel.send(`✅ تم إضافة ${added.length} مركبة:\n${added.map(n => `• ${n}`).join("\n") || "لا شيء"}`);
    } catch (e) {
        await message.channel.send("⏱️ انتهى الوقت، تم إلغاء العملية.");
    } finally {
        activeVehicleSessions.delete(message.author.id);
    }
});

client.once("ready", async () => {
    console.log(`🤖 البوت شغال: ${client.user.tag}`);
    botReady = true;
    await registerCommands();
});

if (CONFIG.BOT_TOKEN) {
    client.login(CONFIG.BOT_TOKEN).catch(e => console.log("❌ فشل تسجيل دخول البوت:", e.message));
} else {
    console.log("⚠️ BOT_TOKEN غير موجود — البوت لن يعمل، تحقق من متغيرات البيئة");
}

// ══════════════════════════════════════════════════════════════════════════
// 4) موقع الويب (Express)
// ══════════════════════════════════════════════════════════════════════════
const app = express();

// 🛠️ يمسك أي خطأ غير متوقع داخل أي راوت (Mongo, إلخ) ويرجّع JSON دايماً
// بدل ما يخلي الطلب "يعلّق" بدون رد، وهذا اللي كان يسبب بقاء "جاري التحميل..."
// معلّقة للأبد بأي صفحة (مخالفاتي، لوحة الإدارة، مخالفات معلّقة...)
["get", "post", "put", "delete", "patch"].forEach(method => {
    const original = app[method].bind(app);
    app[method] = (path, ...handlers) => {
        const wrapped = handlers.map(h => {
            if (typeof h !== "function") return h;
            return (req, res, next) => {
                Promise.resolve(h(req, res, next)).catch(err => {
                    console.error(`❌ خطأ في ${method.toUpperCase()} ${path}:`, err);
                    if (!res.headersSent) res.status(500).json({ error: "صار خطأ بالسيرفر، حاول مرة ثانية", ok: false });
                });
            };
        });
        return original(path, ...wrapped);
    };
});

app.use(express.json({ limit: "8mb" }));
app.use(session({ secret: CONFIG.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: CONFIG.DISCORD_CLIENT_ID,
    clientSecret: CONFIG.DISCORD_CLIENT_SECRET,
    callbackURL: CONFIG.DISCORD_CALLBACK_URL,
    scope: ["identify", "guilds.members.read"],
}, (accessToken, refreshToken, profile, done) => done(null, profile)));

app.get("/auth/discord", passport.authenticate("discord"));
app.get("/auth/discord/callback", passport.authenticate("discord", { failureRedirect: "/" }), (req, res) => res.redirect("/"));
app.get("/auth/logout", (req, res) => { req.logout(() => res.redirect("/")); });

function ensureAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ error: "غير مسجّل دخول" });
}

async function ensureSeniorAdmin(req, res, next) {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "غير مسجّل دخول" });
    if (!isSeniorAdmin(req.user.id)) return res.status(403).json({ error: "هذا القسم لكبار المسؤولين فقط" });
    next();
}

async function ensureAntiDrugsRole(req, res, next) {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "غير مسجّل دخول" });
    if (isSeniorAdmin(req.user.id)) return next();
    const check = await isMilitary(req.user.id);
    if (!check.isAntiDrugs) return res.status(403).json({ error: "تسجيل التقارير مخصص لمديرية مكافحة المخدرات فقط" });
    next();
}

async function ensureAnyAdmin(req, res, next) {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "غير مسجّل دخول" });
    const settings = await getSettings();
    if (!isSeniorAdmin(req.user.id) && !settings.adminList.includes(req.user.id)) {
        return res.status(403).json({ error: "ليست لديك صلاحية" });
    }
    req.settings = settings;
    next();
}

// يسمح لقائد/نائب قطاع بالدخول لمساراته، وأيضاً لكبار المسؤولين (يتحكمون بكل شي)
// لو كان كبير مسؤول لازم يحدد القطاع اللي يبيه عبر ?sector= بالكويري
async function ensureSectorLeader(req, res, next) {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "غير مسجّل دخول" });
    const settings = await getSettings();
    if (isSeniorAdmin(req.user.id)) {
        const q = (req.query.sector || req.body?.sector || "").trim();
        if (!q || !CONFIG.SECTORS[q]) return res.status(400).json({ error: "حدد قطاع صحيح" });
        req.sectorInfo = { sector: q, sectorLabel: CONFIG.SECTORS[q], role: "senior" };
        req.settings = settings;
        return next();
    }
    const info = getSectorRole(req.user.id, settings);
    if (!info) return res.status(403).json({ error: "هذا القسم لقادة ونواب القطاعات فقط" });
    req.sectorInfo = info;
    req.settings = settings;
    next();
}

// فقط قائد/نائب مكافحة المخدرات (أو كبار المسؤولين) يقدرون يقبلون/يرفضون مخالفات وتقارير القطاع
function canReviewSector(sectorInfo) {
    return sectorInfo.role === "senior" || sectorInfo.sector === "antiDrugs";
}

app.get("/api/me", ensureAuth, async (req, res) => {
    const settings = await getSettings();
    const senior = isSeniorAdmin(req.user.id);
    let isAntiDrugs = false;

    // كبار المسؤولين يدخلون دائماً حتى لو كان التسجيل مقفل أو الموقع بالصيانة
    if (!senior) {
        if (settings.disableLogin) {
            return res.json({ blocked: true, reason: "🔒 تسجيل الدخول مغلق حالياً من قبل الإدارة العليا." });
        }
        if (settings.isMaintenance) {
            return res.json({ blocked: true, maintenance: true, reason: "🚨 الموقع مغلق حالياً للصيانة العامة بطلب من الإدارة العليا." });
        }
        const check = await isMilitary(req.user.id);
        if (!check.ok) {
            return res.json({ blocked: true, reason: "هذا الموقع مخصص لمنسوبي الجهات العسكرية فقط" });
        }
        isAntiDrugs = !!check.isAntiDrugs;
    } else {
        // نتحقق من الرول حتى لو كبير مسؤول، فقط عشان نعرف إذا يشوف واجهة تقارير مكافحة المخدرات
        const check = await isMilitary(req.user.id);
        isAntiDrugs = !!check.isAntiDrugs;
    }

    let p = await Personnel.findOne({ discord: req.user.id });
    if (!p) p = await Personnel.create({ discord: req.user.id, discordTag: req.user.username });

    if (!senior && p.isBlocked) {
        return res.json({ blocked: true, reason: "🚫 تم إيقاف حسابك من الموقع من قبل الإدارة." });
    }

    const isAdmin = senior || settings.adminList.includes(req.user.id);
    const progress = await rankProgress(p, settings);
    const sectorInfo = senior ? null : getSectorRole(req.user.id, settings);

    res.json({
        blocked: false,
        discordId: req.user.id,
        discordTag: req.user.username,
        avatar: req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : null,
        registeredName: p.registeredName,
        unit: p.unit,
        rank: p.rank,
        points: p.points,
        notes: p.notes,
        isBlocked: p.isBlocked,
        isAdmin,
        isSeniorAdmin: senior,
        isAntiDrugs,
        sectorInfo,
        maintenance: settings.isMaintenance,
        violationsDisabled: settings.disableViolations,
        nextRank: progress.nextRank,
        pointsThreshold: progress.threshold,
        pointsRemaining: progress.remaining,
    });
});

app.post("/api/profile/setup", ensureAuth, async (req, res) => {
    const { name, unit } = req.body;
    if (!name || !unit) return res.status(400).json({ error: "أكمل الاسم واليونت" });
    const p = await Personnel.findOneAndUpdate(
        { discord: req.user.id }, { registeredName: name, unit }, { new: true, upsert: true }
    );
    res.json({ ok: true, registeredName: p.registeredName, unit: p.unit });
});

app.get("/api/violations/meta", ensureAuth, async (req, res) => {
    const vehicles = await Vehicle.find().sort({ name: 1 });
    res.json({ types: CONFIG.VIOLATION_TYPES, vehicles: vehicles.map(v => ({ name: v.name, photo: v.photo })) });
});

const VIOLATION_COOLDOWN_MS = 30 * 1000;
const violationLocks = new Set(); // يمنع إرسال مخالفتين بنفس اللحظة من نفس الحساب

app.post("/api/violations/submit", ensureAuth, async (req, res) => {
    if (violationLocks.has(req.user.id)) {
        return res.status(429).json({ error: "في مخالفة قيد الإرسال حالياً على حسابك، انتظر لحظة." });
    }
    violationLocks.add(req.user.id);
    try {
        const settings = await getSettings();
        if (settings.disableViolations) return res.status(403).json({ error: "تسجيل المخالفات مغلق حالياً" });
        const p = await Personnel.findOne({ discord: req.user.id });
        if (!p || !p.registeredName || !p.unit) return res.status(400).json({ error: "أكمل بياناتك (الاسم واليونت) أولاً" });
        if (p.isBlocked) return res.status(403).json({ error: "أنت موقوف عن تسجيل مخالفات جديدة" });

        // يمنع تسجيل مخالفة جديدة إذا عنده مخالفة معلّقة بانتظار المراجعة أصلاً
        // (هذا يمنع مشكلة تسجيل مخالفتين دبل لو ضغط المستخدم إرسال أكثر من مرة)
        const existingPending = await Violation.findOne({ reporterDiscord: req.user.id, status: "pending" });
        if (existingPending) {
            return res.status(429).json({ error: "عندك مخالفة معلّقة بانتظار المراجعة، لازم تنتظر رد الإدارة عليها قبل تسجيل مخالفة جديدة." });
        }

        const last = await Violation.findOne({ reporterDiscord: req.user.id }).sort({ createdAt: -1 });
        if (last) {
            const elapsed = Date.now() - last.createdAt.getTime();
            if (elapsed < VIOLATION_COOLDOWN_MS) {
                const wait = Math.ceil((VIOLATION_COOLDOWN_MS - elapsed) / 1000);
                return res.status(429).json({ error: `لازم تنتظر ${wait} ثانية قبل تسجيل مخالفة جديدة`, cooldown: wait });
            }
        }

        const { violationType, vehicle, photo } = req.body;
        if (!violationType || !vehicle) return res.status(400).json({ error: "أكمل نوع المخالفة والمركبة" });
        if (!photo) return res.status(400).json({ error: "لازم ترفق صورة المخالفة" });
        if (photo && photo.length > CONFIG.MAX_PHOTO_MB * 1024 * 1024 * 1.4) {
            return res.status(400).json({ error: `الصورة أكبر من ${CONFIG.MAX_PHOTO_MB}MB` });
        }
        const vehicleDoc = await Vehicle.findOne({ name: vehicle });

        const v = await Violation.create({
            reporterDiscord: req.user.id, reporterTag: req.user.username,
            reporterName: p.registeredName, reporterUnit: p.unit,
            violationType, vehicle, vehiclePhoto: vehicleDoc?.photo || null,
            photo: photo || null,
            plateNumber: generatePlate(), status: "pending",
        });
        postViolationToChannel(v).catch(() => {});
        res.json({ ok: true, violation: v });
    } finally {
        violationLocks.delete(req.user.id);
    }
});

app.get("/api/violations/mine", ensureAuth, async (req, res) => {
    const list = await Violation.find({ reporterDiscord: req.user.id }).sort({ createdAt: -1 });
    res.json({ list });
});

// ── تقارير مديرية مكافحة المخدرات ────────────────────────────────────────
const reportLocks = new Set();

app.post("/api/reports/submit", ensureAntiDrugsRole, async (req, res) => {
    if (reportLocks.has(req.user.id)) {
        return res.status(429).json({ error: "في تقرير قيد الإرسال حالياً على حسابك، انتظر لحظة." });
    }
    reportLocks.add(req.user.id);
    try {
        const settings = await getSettings();
        if (settings.disableViolations) return res.status(403).json({ error: "تسجيل التقارير مغلق حالياً" });
        const p = await Personnel.findOne({ discord: req.user.id });
        if (!p || !p.registeredName || !p.unit) return res.status(400).json({ error: "أكمل بياناتك (الاسم واليونت) أولاً" });
        if (p.isBlocked) return res.status(403).json({ error: "أنت موقوف عن تسجيل تقارير جديدة" });

        const {
            category, suspectName, arrestLocation, vehicle,
            stopReason, seizedItems, securityActions, photo,
            drugType, drugQuantity, concealMethod,
        } = req.body;

        if (!category || !["جنائي", "مخدرات"].includes(category)) {
            return res.status(400).json({ error: "حدد نوع التقرير (جنائي أو مخدرات)" });
        }
        if (!suspectName || !arrestLocation) return res.status(400).json({ error: "أكمل اسم المتهم وموقع الضبط" });
        if (!vehicle) return res.status(400).json({ error: "اختر المركبة" });
        if (!stopReason) return res.status(400).json({ error: "أكمل تفاصيل العملية الميدانية" });
        if (!photo) return res.status(400).json({ error: "لازم ترفق صورة المركبة" });
        if (photo && photo.length > CONFIG.MAX_PHOTO_MB * 1024 * 1024 * 1.4) {
            return res.status(400).json({ error: `الصورة أكبر من ${CONFIG.MAX_PHOTO_MB}MB` });
        }
        if (category === "مخدرات") {
            if (!drugType || !drugQuantity || !concealMethod) {
                return res.status(400).json({ error: "أكمل نوع المخدر وكميته وطريقة إخفائه" });
            }
        } else {
            if (!seizedItems) return res.status(400).json({ error: "اكتب المضبوطات" });
        }
        const cleanActions = Array.isArray(securityActions) ? securityActions.map(a => String(a).trim()).filter(Boolean) : [];
        const vehicleDoc = await Vehicle.findOne({ name: vehicle });

        const v = await Violation.create({
            reporterDiscord: req.user.id, reporterTag: req.user.username,
            reporterName: p.registeredName, reporterUnit: p.unit,
            kind: "report", reportCategory: category,
            suspectName, arrestLocation, vehicle, vehiclePhoto: vehicleDoc?.photo || null,
            stopReason, securityActions: cleanActions,
            seizedItems: category === "جنائي" ? seizedItems : null,
            drugType: category === "مخدرات" ? drugType : null,
            drugQuantity: category === "مخدرات" ? drugQuantity : null,
            concealMethod: category === "مخدرات" ? concealMethod : null,
            photo: photo || null, plateNumber: generatePlate(), status: "pending",
        });
        postViolationToChannel(v).catch(() => {});
        res.json({ ok: true, report: v });
    } finally {
        reportLocks.delete(req.user.id);
    }
});

// ── مسارات الإداري المعيَّن (قبول/رفض فقط) ──────────────────────────────
app.get("/api/admin/pending", ensureAnyAdmin, async (req, res) => {
    const list = await Violation.find({ status: "pending" }).sort({ createdAt: 1 });
    res.json({ list });
});

app.post("/api/admin/violations/:id/approve", ensureAnyAdmin, async (req, res) => {
    const v = await Violation.findById(req.params.id);
    if (!v || v.status !== "pending") return res.status(404).json({ error: "غير موجودة" });
    await approveViolation(v, req.user.id, req.user.username);
    res.json({ ok: true });
});

app.post("/api/admin/violations/:id/reject", ensureAnyAdmin, async (req, res) => {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: "لازم تكتب سبب الرفض" });
    const v = await Violation.findById(req.params.id);
    if (!v || v.status !== "pending") return res.status(404).json({ error: "غير موجودة" });
    await rejectViolation(v, req.user.id, req.user.username, reason.trim());
    res.json({ ok: true });
});

// ── مسارات كبار المسؤولين فقط ────────────────────────────────────────────
app.get("/api/senior/personnel", ensureSeniorAdmin, async (req, res) => {
    const q = (req.query.q || "").trim();
    const filter = q ? { $or: [{ registeredName: new RegExp(q, "i") }, { unit: new RegExp(q, "i") }, { discordTag: new RegExp(q, "i") }] } : {};
    const list = await Personnel.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json({ list });
});

app.post("/api/senior/personnel/:discord/note", ensureSeniorAdmin, async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "اكتب الملاحظة" });
    const p = await Personnel.findOneAndUpdate(
        { discord: req.params.discord },
        { $push: { notes: { text: text.trim(), addedBy: req.user.id, addedByTag: req.user.username } } },
        { new: true }
    );
    if (!p) return res.status(404).json({ error: "غير موجود" });
    await logEvent({ action: "إضافة ملاحظة", discordId: p.discord, discordTag: p.discordTag, actorId: req.user.id, actorTag: req.user.username, details: `على ${p.registeredName || p.discord}: ${text.trim()}` });
    res.json({ ok: true, notes: p.notes });
});

// ── تحذير / إشعار ─────────────────────────────────────────────────────
async function issueWarning({ targetDiscord, kind, reason, actorId, actorTag }) {
    if (!["warning", "notice"].includes(kind)) throw new Error("نوع غير معروف");
    if (!reason || !reason.trim()) throw new Error("لازم تكتب السبب");
    const p = await Personnel.findOneAndUpdate(
        { discord: targetDiscord },
        { $push: { warnings: { kind, reason: reason.trim(), issuedBy: actorId, issuedByTag: actorTag } } },
        { new: true }
    );
    if (!p) throw new Error("غير موجود");
    await logEvent({
        action: kind === "warning" ? "إصدار تحذير" : "إصدار إشعار",
        discordId: p.discord, discordTag: p.discordTag, actorId, actorTag,
        details: `على ${p.registeredName || p.discord}: ${reason.trim()}`,
    });
    return p;
}
app.post("/api/senior/personnel/:discord/warn", ensureSeniorAdmin, async (req, res) => {
    try {
        const p = await issueWarning({ targetDiscord: req.params.discord, kind: req.body.kind, reason: req.body.reason, actorId: req.user.id, actorTag: req.user.username });
        res.json({ ok: true, warnings: p.warnings });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// أقرب تحذير/إشعار لهذا المستخدم لسّه ما اتعاهد عليه — تستخدمها الواجهة للبولينج تعرضه بوجهه
app.get("/api/warnings/pending", async (req, res) => {
    if (!req.isAuthenticated()) return res.json({ warning: null });
    const p = await Personnel.findOne({ discord: req.user.id }, { warnings: 1 });
    if (!p || !p.warnings || !p.warnings.length) return res.json({ warning: null });
    const pending = p.warnings.filter(w => !w.acknowledged).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!pending) return res.json({ warning: null });
    res.json({ warning: { id: pending._id, kind: pending.kind, reason: pending.reason, createdAt: pending.createdAt } });
});

// اتعاهد وأقر بعدم تكرار ذلك
app.post("/api/warnings/:id/ack", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "غير مسجّل دخول" });
    const p = await Personnel.findOne({ discord: req.user.id });
    if (!p) return res.status(404).json({ error: "غير موجود" });
    const w = p.warnings.id(req.params.id);
    if (!w) return res.status(404).json({ error: "غير موجود" });
    if (!w.acknowledged) {
        w.acknowledged = true;
        w.acknowledgedAt = new Date();
        await p.save();
        await logEvent({
            action: "تعاهد على " + (w.kind === "warning" ? "تحذير" : "إشعار"),
            discordId: p.discord, discordTag: p.discordTag, actorId: req.user.id, actorTag: req.user.username,
            details: w.reason,
        });
    }
    res.json({ ok: true });
});

// يجيب كل الملاحظات المضافة على كل العساكر بصفحة وحدة (لكبار المسؤولين)
app.get("/api/senior/notes", ensureSeniorAdmin, async (req, res) => {
    const list = await Personnel.find({ "notes.0": { $exists: true } }, { discord: 1, discordTag: 1, registeredName: 1, notes: 1 });
    const flat = [];
    for (const p of list) {
        for (const n of p.notes) {
            flat.push({
                noteId: n._id, discord: p.discord, personnelName: p.registeredName || p.discordTag || p.discord,
                text: n.text, addedBy: n.addedBy, addedByTag: n.addedByTag, createdAt: n.createdAt,
            });
        }
    }
    flat.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ list: flat });
});

app.delete("/api/senior/personnel/:discord/note/:noteId", ensureSeniorAdmin, async (req, res) => {
    const p = await Personnel.findOneAndUpdate(
        { discord: req.params.discord },
        { $pull: { notes: { _id: req.params.noteId } } },
        { new: true }
    );
    if (!p) return res.status(404).json({ error: "غير موجود" });
    await logEvent({ action: "حذف ملاحظة", discordId: p.discord, discordTag: p.discordTag, actorId: req.user.id, actorTag: req.user.username, details: `من ${p.registeredName || p.discord}` });
    res.json({ ok: true });
});

app.post("/api/senior/personnel/:discord/block", ensureSeniorAdmin, async (req, res) => {
    const { blocked } = req.body;
    const p = await Personnel.findOneAndUpdate({ discord: req.params.discord }, { isBlocked: !!blocked }, { new: true });
    if (!p) return res.status(404).json({ error: "غير موجود" });
    await logEvent({ action: blocked ? "إيقاف عسكري" : "إلغاء إيقاف", discordId: p.discord, discordTag: p.discordTag, actorId: req.user.id, actorTag: req.user.username, details: p.registeredName || p.discord });
    res.json({ ok: true, isBlocked: p.isBlocked });
});

// حذف نهائي لحساب عسكري — يحذف السجل بالكامل من قاعدة البيانات (يختفي من الصفحة نهائياً)
// العسكري يقدر يقدم/يسجل من جديد بعدها عادي لأنه يصير كأنه ما سجل قبل
app.delete("/api/senior/personnel/:discord", ensureSeniorAdmin, async (req, res) => {
    const p = await Personnel.findOneAndDelete({ discord: req.params.discord });
    if (!p) return res.status(404).json({ error: "غير موجود" });
    await logEvent({ action: "حذف حساب نهائي", discordId: p.discord, discordTag: p.discordTag, actorId: req.user.id, actorTag: req.user.username, details: p.registeredName || p.discordTag || p.discord });
    res.json({ ok: true });
});

// تعديل شامل لملف عسكري: الاسم، اليونت، الرتبة، النقاط — من لوحة كبار المسؤولين مباشرة
app.post("/api/senior/personnel/:discord/update", ensureSeniorAdmin, async (req, res) => {
    const { name, unit, rank, points } = req.body;
    const update = {};
    if (typeof name === "string" && name.trim()) update.registeredName = name.trim();
    if (typeof unit === "string" && unit.trim()) update.unit = unit.trim();

    const settings = await getSettings();
    const existing = await Personnel.findOne({ discord: req.params.discord });
    const oldIdx = rankIndex(existing ? existing.rank : "جندي");

    if (typeof rank === "string" && rank.trim()) {
        const newRank = rank.trim();
        if (!CONFIG.MILITARY_RANKS.includes(newRank)) return res.status(400).json({ error: "رتبة غير موجودة" });
        update.rank = newRank;

        // إذا ما حط الأدمن نقاط يدوياً مع الرتبة، نعطيه تلقائياً النقاط المناسبة لرتبته الجديدة
        const explicitPoints = points !== undefined && points !== "" && !isNaN(parseInt(points));
        if (!explicitPoints) {
            const newIdx = rankIndex(newRank);
            if (newIdx > oldIdx) update.points = await pointsForReachingRank(newRank, settings);
            else if (newIdx < oldIdx) update.points = 0; // تنزيل الرتبة يصفّر النقاط عشان ما يترقى تلقائي بنفس النقاط القديمة
        }
    }
    if (points !== undefined && points !== "" && !isNaN(parseInt(points))) update.points = Math.max(0, parseInt(points));

    const p = await Personnel.findOneAndUpdate({ discord: req.params.discord }, update, { new: true });
    if (!p) return res.status(404).json({ error: "غير موجود" });
    await logEvent({ action: "تعديل ملف عسكري", discordId: p.discord, discordTag: p.discordTag, actorId: req.user.id, actorTag: req.user.username, details: JSON.stringify(update) });
    await checkAutoPromotion(req.params.discord);
    res.json({ ok: true, personnel: p });
});

app.get("/api/senior/settings", ensureSeniorAdmin, async (req, res) => {
    const settings = await getSettings();
    res.json({ settings });
});

app.post("/api/senior/settings", ensureSeniorAdmin, async (req, res) => {
    const { isMaintenance, disableLogin, disableViolations, violationsChannelId } = req.body;
    const s = await getSettings();
    if (typeof isMaintenance === "boolean") s.isMaintenance = isMaintenance;
    if (typeof disableLogin === "boolean") s.disableLogin = disableLogin;
    if (typeof disableViolations === "boolean") s.disableViolations = disableViolations;
    if (typeof violationsChannelId === "string") s.violationsChannelId = violationsChannelId.trim() || null;
    await s.save();
    await logEvent({ action: "تعديل إعدادات الموقع", actorId: req.user.id, actorTag: req.user.username, details: JSON.stringify(req.body) });
    res.json({ ok: true });
});

app.get("/api/senior/admins", ensureSeniorAdmin, async (req, res) => {
    const settings = await getSettings();
    res.json({ list: settings.adminList });
});

app.post("/api/senior/hire-admin", ensureSeniorAdmin, async (req, res) => {
    const { discordId, name } = req.body;
    if (!discordId || !discordId.trim()) return res.status(400).json({ error: "حط آيدي الإداري" });
    const settings = await getSettings();
    if (!settings.adminList.includes(discordId.trim())) settings.adminList.push(discordId.trim());
    await settings.save();
    await logEvent({ action: "توظيف إداري", discordId: discordId.trim(), actorId: req.user.id, actorTag: req.user.username, details: name || "" });
    res.json({ ok: true });
});

app.post("/api/senior/fire-admin", ensureSeniorAdmin, async (req, res) => {
    const { discordId } = req.body;
    const settings = await getSettings();
    settings.adminList = settings.adminList.filter(id => id !== discordId);
    await settings.save();
    await logEvent({ action: "فصل إداري", discordId, actorId: req.user.id, actorTag: req.user.username });
    res.json({ ok: true });
});

app.get("/api/senior/vehicles", ensureSeniorAdmin, async (req, res) => {
    const list = await Vehicle.find().sort({ createdAt: -1 });
    res.json({ list });
});

app.post("/api/senior/vehicles", ensureSeniorAdmin, async (req, res) => {
    const { name, photo } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "حط اسم المركبة" });
    if (photo && photo.length > CONFIG.MAX_PHOTO_MB * 1024 * 1024 * 1.4) {
        return res.status(400).json({ error: `الصورة أكبر من ${CONFIG.MAX_PHOTO_MB}MB` });
    }
    try {
        const v = await Vehicle.create({ name: name.trim(), photo: photo || null, addedBy: req.user.id });
        await logEvent({ action: "إضافة مركبة", actorId: req.user.id, actorTag: req.user.username, details: v.name });
        res.json({ ok: true, vehicle: v });
    } catch (e) { res.status(400).json({ error: "المركبة موجودة مسبقاً" }); }
});

app.delete("/api/senior/vehicles/:id", ensureSeniorAdmin, async (req, res) => {
    await Vehicle.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
});

app.get("/api/senior/thresholds", ensureSeniorAdmin, async (req, res) => {
    const settings = await getSettings();
    const obj = {};
    for (const r of CONFIG.MILITARY_RANKS) obj[r] = await getThreshold(r, settings);
    res.json({ ranks: CONFIG.MILITARY_RANKS, thresholds: obj });
});

app.post("/api/senior/thresholds", ensureSeniorAdmin, async (req, res) => {
    const { thresholds } = req.body;
    const settings = await getSettings();
    if (!settings.rankThresholds) settings.rankThresholds = new Map();
    Object.entries(thresholds || {}).forEach(([rank, val]) => {
        if (CONFIG.MILITARY_RANKS.includes(rank)) settings.rankThresholds.set(rank, Math.max(0, parseInt(val) || 0));
    });
    await settings.save();
    await logEvent({ action: "تعديل حدود النقاط", actorId: req.user.id, actorTag: req.user.username, details: "تحديث نقاط الترقية" });
    res.json({ ok: true });
});

app.get("/api/senior/log", ensureSeniorAdmin, async (req, res) => {
    const list = await Log.find().sort({ createdAt: -1 }).limit(200);
    res.json({ list });
});

// ── صفحة "المخالفات المقبولة" (كبار المسؤولين فقط) ──────────────────────
// تعرض كل المخالفات/التقارير اللي تمت مراجعتها (مقبولة أو مرفوضة) مع زر حذف نهائي
app.get("/api/senior/violations/reviewed", ensureSeniorAdmin, async (req, res) => {
    const list = await Violation.find({ status: { $in: ["approved", "rejected"] } })
        .sort({ reviewedAt: -1 }).limit(300);
    res.json({ list });
});

// حذف نهائي لمخالفة/تقرير — ينحذف كلياً من قاعدة البيانات (يختفي من عند كبار المسؤولين وعند صاحبها بصفحة "مخالفاتي")
app.delete("/api/senior/violations/:id", ensureSeniorAdmin, async (req, res) => {
    const v = await Violation.findByIdAndDelete(req.params.id);
    if (!v) return res.status(404).json({ error: "غير موجودة" });
    await logEvent({
        action: "حذف مخالفة نهائي", discordId: v.reporterDiscord, discordTag: v.reporterTag,
        actorId: req.user.id, actorTag: req.user.username,
        details: `${v.kind === "report" ? "تقرير" : "مخالفة"} — ${v.reporterName || v.reporterDiscord}`,
    });
    res.json({ ok: true });
});

// ── صفحة "قادة القطاعات" (كبار المسؤولين فقط) ────────────────────────────
app.get("/api/senior/sectors", ensureSeniorAdmin, async (req, res) => {
    const settings = await getSettings();
    res.json({ sectors: CONFIG.SECTORS, leadership: settings.sectorLeadership || {} });
});

app.post("/api/senior/sectors/:sector/assign", ensureSeniorAdmin, async (req, res) => {
    const { sector } = req.params;
    const { role, discordId } = req.body;
    if (!CONFIG.SECTORS[sector]) return res.status(400).json({ error: "قطاع غير معروف" });
    if (!["commander", "deputy"].includes(role)) return res.status(400).json({ error: "دور غير معروف" });
    if (!discordId || !discordId.trim()) return res.status(400).json({ error: "حدد الشخص" });

    const person = await Personnel.findOne({ discord: discordId.trim() });
    if (!person || !person.registeredName) {
        return res.status(400).json({ error: "لازم يكون هذا الشخص مسجل بالموقع (أكمل بياناته) قبل تعيينه" });
    }

    const settings = await getSettings();
    if (!settings.sectorLeadership) settings.sectorLeadership = {};
    if (!settings.sectorLeadership[sector]) settings.sectorLeadership[sector] = {};
    const displayName = person.registeredName || person.discordTag || person.discord;
    if (role === "commander") {
        settings.sectorLeadership[sector].commanderId = person.discord;
        settings.sectorLeadership[sector].commanderName = displayName;
    } else {
        settings.sectorLeadership[sector].deputyId = person.discord;
        settings.sectorLeadership[sector].deputyName = displayName;
    }
    settings.markModified("sectorLeadership");
    await settings.save();
    await logEvent({
        action: "تعيين قيادة قطاع", discordId: person.discord, discordTag: person.discordTag,
        actorId: req.user.id, actorTag: req.user.username,
        details: `${CONFIG.SECTORS[sector]} — ${role === "commander" ? "قائد" : "نائب"} — ${displayName}`,
    });
    res.json({ ok: true, sectorLeadership: settings.sectorLeadership });
});

app.post("/api/senior/sectors/:sector/remove", ensureSeniorAdmin, async (req, res) => {
    const { sector } = req.params;
    const { role } = req.body;
    if (!CONFIG.SECTORS[sector]) return res.status(400).json({ error: "قطاع غير معروف" });
    if (!["commander", "deputy"].includes(role)) return res.status(400).json({ error: "دور غير معروف" });

    const settings = await getSettings();
    if (!settings.sectorLeadership || !settings.sectorLeadership[sector]) return res.json({ ok: true });
    const sec = settings.sectorLeadership[sector];
    const removedName = role === "commander" ? sec.commanderName : sec.deputyName;
    if (role === "commander") { sec.commanderId = null; sec.commanderName = null; }
    else { sec.deputyId = null; sec.deputyName = null; }
    settings.markModified("sectorLeadership");
    await settings.save();
    await logEvent({
        action: "إزالة قيادة قطاع", actorId: req.user.id, actorTag: req.user.username,
        details: `${CONFIG.SECTORS[sector]} — ${role === "commander" ? "قائد" : "نائب"} — ${removedName || "-"}`,
    });
    res.json({ ok: true, sectorLeadership: settings.sectorLeadership });
});

// ── مسارات لوحة قيادة القطاع (لقادة/نواب القطاعات، وكبار المسؤولين عبر ?sector=) ──
app.get("/api/sector/members", ensureSectorLeader, async (req, res) => {
    const ids = await getSectorMemberIds(req.sectorInfo.sector);
    if (ids === null) return res.status(503).json({ error: "تعذر جلب أعضاء القطاع من ديسكورد حالياً، حاول مرة ثانية بعد شوي" });
    const list = ids.length ? await Personnel.find({ discord: { $in: ids } }).sort({ createdAt: -1 }) : [];
    res.json({ list, sector: req.sectorInfo.sector, sectorLabel: req.sectorInfo.sectorLabel });
});

app.get("/api/sector/violations", ensureSectorLeader, async (req, res) => {
    const ids = await getSectorMemberIds(req.sectorInfo.sector);
    if (ids === null) return res.status(503).json({ error: "تعذر جلب أعضاء القطاع من ديسكورد حالياً، حاول مرة ثانية بعد شوي" });
    const list = ids.length ? await Violation.find({ reporterDiscord: { $in: ids } }).sort({ createdAt: -1 }).limit(300) : [];
    res.json({ list, canReview: canReviewSector(req.sectorInfo) });
});

app.post("/api/sector/violations/:id/approve", ensureSectorLeader, async (req, res) => {
    if (!canReviewSector(req.sectorInfo)) return res.status(403).json({ error: "قبول المخالفات والتقارير مخصص لقيادة مكافحة المخدرات فقط" });
    const v = await Violation.findById(req.params.id);
    if (!v || v.status !== "pending") return res.status(404).json({ error: "غير موجودة" });
    await approveViolation(v, req.user.id, req.user.username);
    res.json({ ok: true });
});

app.post("/api/sector/violations/:id/reject", ensureSectorLeader, async (req, res) => {
    if (!canReviewSector(req.sectorInfo)) return res.status(403).json({ error: "رفض المخالفات والتقارير مخصص لقيادة مكافحة المخدرات فقط" });
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: "لازم تكتب سبب الرفض" });
    const v = await Violation.findById(req.params.id);
    if (!v || v.status !== "pending") return res.status(404).json({ error: "غير موجودة" });
    await rejectViolation(v, req.user.id, req.user.username, reason.trim());
    res.json({ ok: true });
});

// يتأكد أن الشخص المطلوب فعلاً من ضمن أعضاء قطاع هذا القائد قبل أي تعديل عليه
async function ensureInMySector(req, res, discordId) {
    const ids = await getSectorMemberIds(req.sectorInfo.sector);
    if (ids === null) { res.status(503).json({ error: "تعذر التحقق من أعضاء القطاع حالياً، حاول مرة ثانية بعد شوي" }); return false; }
    if (!ids.includes(discordId)) { res.status(403).json({ error: "هذا الشخص ليس من أعضاء قطاعك" }); return false; }
    return true;
}

// عرض ملف عسكري كامل لعضو داخل القطاع (الصفحة الثالثة: عرض ملف عسكري في القطاع)
app.get("/api/sector/personnel/:discord", ensureSectorLeader, async (req, res) => {
    if (!(await ensureInMySector(req, res, req.params.discord))) return;
    const p = await Personnel.findOne({ discord: req.params.discord });
    if (!p) return res.status(404).json({ error: "غير موجود" });
    res.json({ personnel: p });
});

// ترقية أو تنزيل عضو من القطاع رتبة واحدة
app.post("/api/sector/personnel/:discord/rank", ensureSectorLeader, async (req, res) => {
    if (!(await ensureInMySector(req, res, req.params.discord))) return;
    const { direction } = req.body; // 'up' | 'down'
    if (!["up", "down"].includes(direction)) return res.status(400).json({ error: "حدد الاتجاه" });
    const p = await Personnel.findOne({ discord: req.params.discord });
    if (!p) return res.status(404).json({ error: "غير موجود" });
    const idx = rankIndex(p.rank);
    const newIdx = direction === "up" ? idx + 1 : idx - 1;
    if (newIdx < 0 || newIdx >= CONFIG.MILITARY_RANKS.length) return res.status(400).json({ error: "لا توجد رتبة أعلى/أدنى" });
    const settings = await getSettings();
    const newRank = CONFIG.MILITARY_RANKS[newIdx];
    const oldRank = p.rank;
    p.rank = newRank;
    p.points = direction === "up" ? await pointsForReachingRank(newRank, settings) : 0;
    await p.save();
    await logEvent({
        action: direction === "up" ? "ترقية عسكري" : "تنزيل عسكري", discordId: p.discord, discordTag: p.discordTag,
        actorId: req.user.id, actorTag: req.user.username,
        details: `${oldRank} ← ${newRank} (بواسطة قيادة ${req.sectorInfo.sectorLabel})`,
    });
    res.json({ ok: true, personnel: p });
});

// تعيين يونت لعضو القطاع (نفس صلاحية كبار المسؤولين على نفس الحقل)
app.post("/api/sector/personnel/:discord/unit", ensureSectorLeader, async (req, res) => {
    if (!(await ensureInMySector(req, res, req.params.discord))) return;
    const { unit } = req.body;
    if (!unit || !unit.trim()) return res.status(400).json({ error: "حط اسم اليونت" });
    const p = await Personnel.findOneAndUpdate({ discord: req.params.discord }, { unit: unit.trim() }, { new: true });
    if (!p) return res.status(404).json({ error: "غير موجود" });
    await logEvent({ action: "تعيين يونت", discordId: p.discord, discordTag: p.discordTag, actorId: req.user.id, actorTag: req.user.username, details: `→ ${p.unit} (بواسطة قيادة ${req.sectorInfo.sectorLabel})` });
    res.json({ ok: true, personnel: p });
});

// إصدار تحذير/إشعار لعضو القطاع
app.post("/api/sector/personnel/:discord/warn", ensureSectorLeader, async (req, res) => {
    if (!(await ensureInMySector(req, res, req.params.discord))) return;
    try {
        const p = await issueWarning({ targetDiscord: req.params.discord, kind: req.body.kind, reason: req.body.reason, actorId: req.user.id, actorTag: req.user.username + ` (قيادة ${req.sectorInfo.sectorLabel})` });
        res.json({ ok: true, warnings: p.warnings });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// إضافة ملاحظة على عضو القطاع
app.post("/api/sector/personnel/:discord/note", ensureSectorLeader, async (req, res) => {
    if (!(await ensureInMySector(req, res, req.params.discord))) return;
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "اكتب الملاحظة" });
    const p = await Personnel.findOneAndUpdate(
        { discord: req.params.discord },
        { $push: { notes: { text: text.trim(), addedBy: req.user.id, addedByTag: req.user.username } } },
        { new: true }
    );
    if (!p) return res.status(404).json({ error: "غير موجود" });
    await logEvent({ action: "إضافة ملاحظة", discordId: p.discord, discordTag: p.discordTag, actorId: req.user.id, actorTag: req.user.username, details: `على ${p.registeredName || p.discord} (بواسطة قيادة ${req.sectorInfo.sectorLabel}): ${text.trim()}` });
    res.json({ ok: true, notes: p.notes });
});

// ══════════════════════════════════════════════════════════════════════════
// 4.5) APIs مخصصة لموقع البنك (ربط رواتب العساكر) — بدون تسجيل دخول ديسكورد
//      يستخدمها البنك فقط للحصول على قائمة الرتب ورتبة كل عسكري مسجل
// ══════════════════════════════════════════════════════════════════════════

// قائمة الرتب العسكرية الرسمية (يستخدمها البنك لبناء جدول تحديد الرواتب)
app.get("/api/bank/ranks", async (req, res) => {
    res.json({ success: true, ranks: CONFIG.MILITARY_RANKS });
});

// رتبة كل عسكري مسجل (يستخدمها البنك وقت توزيع الرواتب لمطابقة كل حساب برتبته)
app.get("/api/bank/personnel-ranks", async (req, res) => {
    try {
        const list = await Personnel.find({ isBlocked: false }, "discord discordTag rank registeredName");
        const personnel = list.map(p => ({
            discord: p.discord,
            discordTag: p.discordTag,
            rank: p.rank,
            registeredName: p.registeredName,
        }));
        res.json({ success: true, personnel });
    } catch (e) {
        res.json({ success: false, msg: e.message });
    }
});

// ══════════════════════════════════════════════════════════════════════════
// 5) الواجهة (صفحة واحدة SPA)
// ══════════════════════════════════════════════════════════════════════════
app.get("/", (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${CONFIG.SITE_NAME}</title>
<style>
    :root {
        --bg1: #0a1628; --bg2: #0d1f3c; --panel: rgba(255,255,255,0.04); --border: rgba(59,130,246,0.25);
        --gold: #3b82f6; --gold-soft: #60a5fa; --green: #1d4ed8; --green2: #3b82f6;
        --red: #ef4444; --amber: #eab308; --text: #e2e8f0; --muted: #64748b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Tajawal', 'Tahoma', 'Segoe UI', sans-serif; }
    body { background: linear-gradient(135deg, #0a1628 0%, #0d1f3c 40%, #0a2744 70%, #0d3060 100%); color: var(--text); min-height: 100vh; }
    #warn-banner { position: sticky; top: 0; z-index: 1000; width: 100%; background: linear-gradient(90deg,#7f1d1d,#991b1b); color: #fecaca; text-align: center; padding: 10px 14px; font-weight: bold; font-size: 13px; box-shadow: 0 2px 10px rgba(0,0,0,0.4); }
    nav { background: rgba(5,15,30,0.95); backdrop-filter: blur(15px); border-bottom: 1px solid rgba(59,130,246,0.3); padding: 0 1.2rem; display: flex; align-items: center; justify-content: space-between; height: 62px; position: sticky; top: 37px; z-index: 900; }
    .logo { font-size: 1.3rem; font-weight: 900; background: linear-gradient(90deg, #3b82f6, #60a5fa, #93c5fd); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: 2px; }
    .nav-links { display: flex; gap: 0.3rem; list-style: none; flex-wrap: wrap; }
    .nav-links button { background: transparent; border: 1px solid transparent; color: #94a3b8; padding: 0.4rem 0.8rem; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 0.85rem; transition: all 0.2s; }
    .nav-links button:hover { background: rgba(59,130,246,0.2); border-color: #3b82f6; color: #60a5fa; }
    .hamburger-btn { display: none; background: rgba(59,130,246,0.15); border: 1px solid #3b82f6; color: #60a5fa; padding: 0.4rem 0.7rem; border-radius: 8px; cursor: pointer; font-size: 1.2rem; }
    .mobile-menu { display: none; position: fixed; top: 99px; left: 0; width: 230px; background: rgba(5,15,30,0.98); border: 1px solid rgba(59,130,246,0.35); border-radius: 0 0 14px 0; z-index: 950; padding: 8px 0; box-shadow: 4px 8px 30px rgba(0,0,0,0.7); }
    .mobile-menu.open { display: block; }
    .mobile-menu button { display: block; width: 100%; background: transparent; border: none; border-bottom: 1px solid rgba(59,130,246,0.08); color: #94a3b8; padding: 12px 20px; text-align: right; font-family: inherit; font-size: 0.9rem; cursor: pointer; }
    .mobile-menu button:hover { background: rgba(59,130,246,0.18); color: #60a5fa; }
    @media (max-width: 760px) { .nav-links { display: none !important; } .hamburger-btn { display: inline-block; } }
    .wrap { max-width: 940px; margin: 0 auto; padding: 20px 16px 60px; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 20px; margin-bottom: 18px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); }
    h1, h2, h3 { color: var(--gold-soft); margin-bottom: 12px; }
    .btn { display: inline-block; background: linear-gradient(135deg, var(--green), var(--green2)); color: #fff; border: none; border-radius: 8px; padding: 0.6rem 1.3rem; font-size: 0.9rem; font-weight: 700; cursor: pointer; transition: 0.2s; }
    .btn:hover { opacity: 0.85; transform: translateY(-1px); }
    .btn.danger { background: #ef4444; }
    .btn.gray { background: rgba(255,255,255,0.08); border: 1px solid rgba(59,130,246,0.25); color: #94a3b8; }
    .btn.gold { background: linear-gradient(135deg, #1d4ed8, #60a5fa); color: #fff; }
    .btn.sm { padding: 0.4rem 0.9rem; font-size: 0.8rem; }
    input, select, textarea { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: rgba(255,255,255,0.06); color: #fff; margin-bottom: 10px; font-size: 14px; }
    label { display: block; margin-bottom: 6px; color: var(--gold-soft); font-size: 13px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    .badge.pending { background: rgba(234,179,8,0.15); color: #fbbf24; border: 1px solid #eab308; }
    .badge.approved { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid #22c55e; }
    .badge.rejected { background: rgba(239,68,68,0.15); color: #fca5a5; border: 1px solid #ef4444; }
    .stat { text-align: center; padding: 14px; background: rgba(255,255,255,0.03); border-radius: 10px; border: 1px solid var(--border); }
    .stat .num { font-size: 24px; font-weight: 900; color: var(--gold-soft); }
    .stat .lbl { font-size: 12px; color: var(--muted); }
    .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
    .center { text-align: center; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px; border-bottom: 1px solid var(--border); text-align: right; vertical-align: middle; }
    .avatar { width: 70px; height: 70px; border-radius: 50%; border: 3px solid var(--gold); }
    .thumb { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border); cursor: pointer; }
    .tabs { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .tab { background: rgba(255,255,255,0.04); border: 1px solid rgba(59,130,246,0.3); padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; color: #94a3b8; }
    .tab.active { background: var(--green2); color: #fff; border-color: var(--green2); }
    .log-item { background: rgba(255,255,255,0.02); border: 1px solid rgba(59,130,246,0.2); border-radius: 8px; padding: 10px 15px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 0.88rem; }
    .id-card { background: linear-gradient(135deg, #1e3a5f, #0f2848); border: 2px solid var(--gold); border-radius: 20px; padding: 22px; max-width: 400px; margin: 0 auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .rank-line { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 15px; color: var(--gold-soft); margin: 10px 0; font-weight: bold; }
    .hidden { display: none !important; }
    #toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #0d1f3c; padding: 10px 20px; border-radius: 10px; border: 1px solid var(--gold); z-index: 999; display: none; }
    .fab { position: fixed; bottom: 25px; right: 25px; z-index: 998; background: linear-gradient(135deg, #1d4ed8, #3b82f6); color: #fff; border: 2px solid rgba(255,255,255,0.2); padding: 14px 24px; border-radius: 50px; font-weight: bold; font-family: inherit; font-size: 14px; cursor: pointer; box-shadow: 0 4px 20px rgba(0,0,0,0.4); transition: 0.3s; }
    .fab:hover { transform: scale(1.05); }
    .vgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; margin-bottom: 10px; }
    .vcard { border: 2px solid var(--border); border-radius: 10px; padding: 6px; text-align: center; cursor: pointer; font-size: 11px; background: rgba(255,255,255,0.03); }
    .vcard.sel { border-color: var(--gold); background: rgba(59,130,246,0.12); }
    .vcard img { width: 100%; height: 54px; object-fit: cover; border-radius: 6px; margin-bottom: 4px; }
    .login-screen { text-align: center; padding: 4rem 2rem; }
    .login-screen h1 { font-size: 3rem; color: #3b82f6; text-shadow: 0 0 20px rgba(59,130,246,0.5); margin-bottom: 10px; }
    footer { text-align: center; padding: 1.5rem; margin-top: 2rem; border-top: 1px solid var(--border); background: rgba(255,255,255,0.02); color: var(--muted); font-size: 0.9rem; }
    #img-modal { display: none; position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,0.88); align-items: center; justify-content: center; padding: 20px; cursor: zoom-out; }
    #img-modal.open { display: flex; }
    #img-modal img { max-width: 92vw; max-height: 90vh; border-radius: 10px; border: 2px solid var(--gold); box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
    #img-modal .close-hint { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); color: #cbd5e1; font-size: 13px; }

    /* ── تحذير / إشعار (شاشة كاملة) ────────────────────────────────── */
    #warn-overlay { display: none; position: fixed; inset: 0; z-index: 3000; align-items: center; justify-content: center; flex-direction: column; gap: 10px; padding: 20px; text-align: center; }
    #warn-overlay.open { display: flex; }
    #warn-overlay.k-warning { background: radial-gradient(circle at center, #7a1a1a, #3d0d0d); }
    #warn-overlay.k-notice { background: radial-gradient(circle at center, #7a4a12, #3d2506); }
    .warn-box { border: 2px dashed rgba(255,255,255,0.55); border-radius: 10px; padding: 26px 40px; max-width: 480px; }
    .warn-title { font-size: 30px; font-weight: bold; color: #fff; display: flex; align-items: center; justify-content: center; gap: 10px; }
    .warn-title .tri { color: #f87171; }
    #warn-overlay.k-notice .warn-title .tri { color: #fbbf24; }
    .warn-line { border: none; border-top: 1px solid rgba(255,255,255,0.5); margin: 12px 0; }
    .warn-reason { color: #fff; font-size: 19px; margin-top: 8px; line-height: 1.6; }
    .warn-ack-btn { margin-top: 26px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.5); color: #fff; padding: 12px 22px; border-radius: 10px; font-family: inherit; font-size: 14px; cursor: pointer; }
    .warn-ack-btn:hover { background: rgba(255,255,255,0.2); }

    /* ── فورم إرسال تحذير/إشعار (بديل عن prompt/confirm) ─────────────── */
    #wf-overlay { display: none; position: fixed; inset: 0; z-index: 2500; background: rgba(0,0,0,0.75); align-items: center; justify-content: center; padding: 20px; }
    #wf-overlay.open { display: flex; }
    .wf-box { background: #0d1f3c; border: 1px solid var(--gold); border-radius: 14px; padding: 22px; max-width: 380px; width: 100%; text-align: center; }
    .wf-box h3 { margin-bottom: 14px; color: var(--gold-soft); }
    .wf-choice-row { display: flex; gap: 10px; margin-top: 6px; }
    .wf-choice-row button { flex: 1; padding: 14px 8px; border-radius: 10px; font-family: inherit; font-size: 14px; cursor: pointer; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: #fff; }
    .wf-choice-row button.wf-warning:hover { border-color: #f87171; background: rgba(248,113,113,0.12); }
    .wf-choice-row button.wf-notice:hover { border-color: #fbbf24; background: rgba(251,191,36,0.12); }
    .wf-box textarea { width: 100%; min-height: 90px; margin-top: 10px; background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 8px; color: #fff; padding: 10px; font-family: inherit; font-size: 14px; resize: vertical; }
    .wf-actions { display: flex; gap: 8px; margin-top: 14px; }
    .wf-actions button { flex: 1; }
</style>
<div id="wf-overlay">
    <div class="wf-box" id="wf-box"></div>
</div>
<div id="warn-overlay">
    <div class="warn-box">
        <div class="warn-title"><span class="tri">⚠️</span><span id="warn-title-text">تحذير</span><span class="tri">⚠️</span></div>
        <hr class="warn-line">
        <div class="warn-reason" id="warn-reason-text"></div>
    </div>
    <button class="warn-ack-btn" id="warn-ack-btn" onclick="ackCurrentWarning()">🤝 اتعاهد وأقر بعدم تكرار ذلك</button>
</div>
</head>
<body>
<div id="warn-banner">⚠️ تنبيه: هذا الموقع مخصص للمحاكاة واللعب فقط، ولا يمت للواقع بصلة.</div>
<nav>
    <div class="logo">🚨 ${CONFIG.SITE_NAME}</div>
    <ul class="nav-links" id="nav-links"></ul>
    <button class="hamburger-btn" onclick="toggleMobileMenu()">☰</button>
</nav>
<div class="mobile-menu" id="mobile-menu"></div>
<div class="wrap" id="app"><div class="card center">جارِ التحميل...</div></div>
<div id="toast"></div>
<div id="img-modal" onclick="closeImageModal()"><span class="close-hint">اضغط لإغلاق</span><img id="img-modal-img" src=""></div>
<footer><p>جميع الحقوق محفوظة © 2026 | <span style="color:#d4af37;font-weight:bold;">${CONFIG.SITE_NAME}</span></p></footer>

<script>
const MILITARY_RANKS = ${JSON.stringify(CONFIG.MILITARY_RANKS)};
let ME = null;
let lastKnownRank = null;
let META = { types: [], vehicles: [] };
let selectedVehicle = null;
let photoBase64 = null;
let reportMeta = { vehicles: [] };
let reportSelectedVehicle = null;
let reportVehiclePhoto = null;
let currentAdminTab = null;
let pollTimer = null;
let blockedPollTimer = null;

async function api(url, opts) {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'خطأ');
    return data;
}
function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 2800);
}
function openImageModal(src) {
    if (!src) return;
    document.getElementById('img-modal-img').src = src;
    document.getElementById('img-modal').classList.add('open');
}
function closeImageModal() {
    document.getElementById('img-modal').classList.remove('open');
    document.getElementById('img-modal-img').src = '';
}

// ── فورم إرسال تحذير/إشعار (فورم مخصص للموقع، مو نوافذ نظام الجهاز الافتراضية) ──
function openWarnForm(discord, apiBase) {
    const box = document.getElementById('wf-box');
    box.innerHTML = \`
        <h3>وش تبي ترسل لهذا الشخص؟</h3>
        <div class="wf-choice-row">
            <button class="wf-warning" onclick="warnFormReason('\${discord}','\${apiBase}','warning')">⚠️ تحذير</button>
            <button class="wf-notice" onclick="warnFormReason('\${discord}','\${apiBase}','notice')">🔔 إشعار</button>
        </div>
        <div class="wf-actions"><button class="btn gray sm" onclick="closeWarnForm()">إلغاء</button></div>\`;
    document.getElementById('wf-overlay').classList.add('open');
}
function warnFormReason(discord, apiBase, kind) {
    const box = document.getElementById('wf-box');
    box.innerHTML = \`
        <h3>\${kind === 'warning' ? '⚠️ ضع سبب التحذير' : '🔔 ضع سبب الإشعار'}</h3>
        <textarea id="wf-reason" placeholder="اكتب السبب هنا..."></textarea>
        <div class="wf-actions">
            <button class="btn gray sm" onclick="closeWarnForm()">إلغاء</button>
            <button class="btn sm" onclick="submitWarnForm('\${discord}','\${apiBase}','\${kind}')">إرسال</button>
        </div>\`;
}
function closeWarnForm() {
    document.getElementById('wf-overlay').classList.remove('open');
    document.getElementById('wf-box').innerHTML = '';
}
async function submitWarnForm(discord, apiBase, kind) {
    const reason = document.getElementById('wf-reason').value;
    if (!reason || !reason.trim()) return toast('لازم تكتب السبب');
    try {
        await api(apiBase + discord + '/warn', { method: 'POST', body: JSON.stringify({ kind, reason }) });
        toast(kind === 'warning' ? '✅ تم إرسال التحذير' : '✅ تم إرسال الإشعار');
        closeWarnForm();
    } catch (e) { toast(e.message); }
}

// ── عرض التحذير/الإشعار بوجه المستقبِل (شاشة كاملة، تُفتح تلقائياً بالبولينج) ──
let currentWarningId = null;
async function checkPendingWarning() {
    if (document.getElementById('warn-overlay').classList.contains('open')) return; // فيه وحدة معروضة أصلاً
    try {
        const { warning } = await api('/api/warnings/pending');
        if (warning) showWarningOverlay(warning);
    } catch (e) {}
}
function showWarningOverlay(w) {
    currentWarningId = w.id;
    const overlay = document.getElementById('warn-overlay');
    overlay.classList.remove('k-warning', 'k-notice');
    overlay.classList.add(w.kind === 'warning' ? 'k-warning' : 'k-notice');
    document.getElementById('warn-title-text').textContent = w.kind === 'warning' ? 'تحذير' : 'إشعار';
    document.getElementById('warn-reason-text').textContent = w.reason;
    overlay.classList.add('open');
}
async function ackCurrentWarning() {
    if (!currentWarningId) return;
    const btn = document.getElementById('warn-ack-btn');
    btn.disabled = true;
    try {
        await api('/api/warnings/' + currentWarningId + '/ack', { method: 'POST' });
        document.getElementById('warn-overlay').classList.remove('open');
        currentWarningId = null;
        checkPendingWarning(); // لو فيه تحذير ثاني بالطابور
    } catch (e) { toast(e.message); }
    btn.disabled = false;
}
async function init() {
    try { ME = await api('/api/me'); } catch (e) { renderLogin(); return; }
    if (ME.blocked) { renderBlocked(ME.reason); return; }
    lastKnownRank = ME.rank;
    buildNav();
    if (!ME.registeredName || !ME.unit) { renderSetup(); return; }
    renderDashboard();
    checkPendingWarning();
    startPolling();
}
function buildNav() {
    const links = document.getElementById('nav-links');
    const mobile = document.getElementById('mobile-menu');
    if (!ME || ME.blocked) { links.innerHTML = ''; mobile.innerHTML = ''; return; }
    const items = [
        { label: '🏠 الرئيسية', fn: 'renderDashboard()' },
    ];
    if (ME.isAntiDrugs && !ME.isSeniorAdmin) {
        items.push({ label: '📝 تسجيل تقرير', fn: 'renderNewReport()' });
    } else {
        items.push({ label: '📝 تسجيل مخالفة', fn: 'renderNewViolation()' });
    }
    items.push(
        { label: '📋 مخالفاتي', fn: 'renderMinePage()' },
        { label: '🪪 بطاقتي', fn: 'renderCard()' },
    );
    if (ME.isAdmin) items.push({ label: '🛠️ لوحة الإدارة', fn: 'renderAdmin()' });
    if (ME.sectorInfo) items.push({ label: '🎖️ لوحة قيادة القطاع', fn: 'renderSectorPanel()' });
    items.push({ label: '🚪 خروج', fn: "location.href='/auth/logout'" });
    links.innerHTML = items.map(i => \`<button onclick="\${i.fn}">\${i.label}</button>\`).join('');
    mobile.innerHTML = items.map(i => \`<button onclick="\${i.fn}; closeMobileMenu();">\${i.label}</button>\`).join('');
}
function toggleMobileMenu() { document.getElementById('mobile-menu').classList.toggle('open'); }
function closeMobileMenu() { document.getElementById('mobile-menu').classList.remove('open'); }
function renderMinePage() {
    document.getElementById('app').innerHTML = \`<div class="card"><h2>📋 مخالفاتي</h2><div id="mine-list">جارِ التحميل...</div></div>\`;
    loadMine();
}
function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollTick, 5000);
}
async function pollTick() {
    if (!ME || ME.blocked) return;
    try {
        const fresh = await api('/api/me');
        if (fresh.blocked) {
            // صار حظر/إيقاف/صيانة/إغلاق تسجيل وهو شغّال بالموقع — نوقفه فوراً ونعرض السبب
            clearInterval(pollTimer);
            ME = fresh;
            renderBlocked(fresh.reason);
            startBlockedRecheck();
            return;
        }
        if (lastKnownRank && fresh.rank !== lastKnownRank) {
            toast('🎉 مبروك! تمت ترقيتك إلى ' + fresh.rank);
        }
        lastKnownRank = fresh.rank;
        ME = fresh;
        buildNav();
        const rp = document.getElementById('home-points');
        if (rp) {
            document.getElementById('home-points').textContent = ME.points;
            document.getElementById('home-rank').textContent = ME.rank;
            const nx = document.getElementById('home-next');
            if (nx) nx.textContent = ME.nextRank ? (ME.rank + ' ——> ' + ME.nextRank) : 'أعلى رتبة';
            const rem = document.getElementById('home-remaining');
            if (rem) rem.textContent = ME.nextRank ? ('متبقي ' + ME.pointsRemaining + ' نقطة للترقية') : 'وصلت لأعلى رتبة';
        }
        renderNotes();
        if (document.getElementById('mine-list')) loadMine(true);
        if (document.getElementById('pending-box')) loadPending();
        if (currentAdminTab === 'log') loadLog(true);
        checkPendingWarning();
    } catch (e) {}
}
// لو صار عليه حظر/صيانة وهو شغّال، نفضل نتابعه بهدوء، وأول ما يرجع الوضع طبيعي نحدّث الصفحة تلقائياً
function startBlockedRecheck() {
    if (blockedPollTimer) clearInterval(blockedPollTimer);
    blockedPollTimer = setInterval(async () => {
        try {
            const fresh = await api('/api/me');
            if (!fresh.blocked) { clearInterval(blockedPollTimer); location.reload(); }
        } catch (e) {}
    }, 6000);
}
function renderLogin() {
    document.getElementById('nav-links').innerHTML = '';
    document.getElementById('mobile-menu').innerHTML = '';
    document.getElementById('app').innerHTML = \`
        <div class="login-screen">
            <h1>${CONFIG.SITE_NAME}</h1>
            <p style="color:var(--muted);margin-bottom:28px;">نظام إدارة عسكري لمنسوبي الجهات العسكرية</p>
            <a href="/auth/discord" style="display:inline-flex;align-items:center;justify-content:center;gap:10px;background:#5865F2;color:#fff;font-weight:bold;font-size:16px;padding:16px 34px;border-radius:10px;text-decoration:none;box-shadow:0 6px 18px rgba(88,101,242,0.4);">
                <span>🔒</span><span>تسجيل الدخول عبر ديسكورد</span>
            </a>
        </div>\`;
}
function renderBlocked(reason) {
    document.getElementById('nav-links').innerHTML = '';
    document.getElementById('mobile-menu').innerHTML = '';
    document.getElementById('app').innerHTML = \`
        <div class="card center" style="margin-top:60px;">
            <h2 style="color:#fca5a5;">🚫 غير مصرح</h2>
            <p style="color:var(--muted);margin-top:10px;">\${reason}</p>
            <a class="btn gray" href="/auth/logout" style="margin-top:16px;">تسجيل خروج</a>
        </div>\`;
}
function renderSetup() {
    document.getElementById('app').innerHTML = \`
        <div class="card" style="margin-top:40px;">
            <h2>أكمل بياناتك العسكرية</h2>
            <label>الاسم المسجل في السيرفر</label>
            <input id="setup-name" placeholder="مثال: عبدالله الحربي">
            <label>اليونت العسكري</label>
            <input id="setup-unit" placeholder="مثال: الدورية الأولى">
            <button class="btn" onclick="doSetup()">حفظ ومتابعة</button>
        </div>\`;
}
async function doSetup() {
    const name = document.getElementById('setup-name').value.trim();
    const unit = document.getElementById('setup-unit').value.trim();
    if (!name || !unit) return toast('أكمل الحقول');
    try { await api('/api/profile/setup', { method: 'POST', body: JSON.stringify({ name, unit }) }); init(); }
    catch (e) { toast(e.message); }
}
function renderDashboard() {
    document.getElementById('app').innerHTML = \`
        <div class="card row">
            <div class="row" style="gap:14px;">
                \${ME.avatar ? \`<img class="avatar" src="\${ME.avatar}">\` : ''}
                <div><h2 style="margin-bottom:2px;">\${ME.registeredName}</h2><div style="color:var(--muted);font-size:13px;">\${ME.unit} • \${ME.rank}</div></div>
            </div>
            <div class="row" style="gap:8px;">
                \${ME.isAdmin ? '<button class="btn gray sm" onclick="renderAdmin()">لوحة الإدارة</button>' : ''}
                \${ME.sectorInfo ? \`<button class="btn gray sm" onclick="renderSectorPanel()">قيادة \${ME.sectorInfo.sectorLabel}</button>\` : ''}
                <a class="btn gray sm" href="/auth/logout">خروج</a>
            </div>
        </div>
        \${ME.maintenance ? '<div class="card" style="border-color:var(--amber);color:#fbbf24;">⚠️ الموقع في وضع الصيانة حالياً</div>' : ''}
        <div class="id-card">
            \${ME.avatar ? \`<div class="center"><img class="avatar" src="\${ME.avatar}" style="width:84px;height:84px;margin-bottom:10px;"></div>\` : ''}
            <div class="center" style="font-size:18px;font-weight:bold;color:var(--gold-soft);">\${ME.registeredName}</div>
            <div class="center" style="font-size:12px;color:var(--muted);margin-bottom:10px;">${CONFIG.SITE_NAME} • بطاقة تعريف عسكرية</div>
            <div class="rank-line" id="home-next">\${ME.rank} \${ME.nextRank ? ('——> ' + ME.nextRank) : ''}</div>
            <div class="center" style="font-size:13px;color:var(--muted);" id="home-remaining">\${ME.nextRank ? ('متبقي ' + ME.pointsRemaining + ' نقطة للترقية') : 'وصلت لأعلى رتبة'}</div>
        </div>
        <div class="grid3" style="margin-top:16px;">
            <div class="stat"><div class="num" id="home-points">\${ME.points}</div><div class="lbl">النقاط</div></div>
            <div class="stat"><div class="num" id="mine-count">-</div><div class="lbl">مخالفاتي</div></div>
            <div class="stat"><div class="num" id="home-rank" style="font-size:15px;">\${ME.isBlocked ? '🚫 موقوف' : '✅ فعّال'}</div><div class="lbl">الحالة</div></div>
        </div>
        <div class="card">
            <div class="row">
                <h3>مخالفاتي المسجلة</h3>
                <div class="row" style="gap:8px;">
                    <button class="btn sm" onclick="renderCard()">بطاقتي</button>
                    \${!ME.violationsDisabled ? (ME.isAntiDrugs && !ME.isSeniorAdmin
                        ? '<button class="btn sm" onclick="renderNewReport()">+ تسجيل تقرير جديد</button>'
                        : '<button class="btn sm" onclick="renderNewViolation()">+ تسجيل مخالفة جديدة</button>') : ''}
                </div>
            </div>
            <div id="notes-box" style="margin:10px 0;"></div>
            <div id="mine-list">جارِ التحميل...</div>
        </div>
        \${ME.isSeniorAdmin ? '<button class="fab" onclick="renderAdmin()">🛡️ لوحة كبار المسؤولين</button>' : ''}
    \`;
    loadMine();
    renderNotes();
}
function renderNotes() {
    const box = document.getElementById('notes-box');
    if (!box) return;
    if (!ME.notes || ME.notes.length === 0) { box.innerHTML = ''; return; }
    box.innerHTML = '<div style="font-size:13px;color:var(--gold-soft);margin-bottom:6px;">ملاحظات عليك:</div>' +
        ME.notes.map(n => \`<div style="background:rgba(5,15,10,0.6);padding:8px;border-radius:8px;margin-bottom:6px;font-size:13px;">\${n.text}</div>\`).join('');
}
async function loadMine(silent) {
    const box = document.getElementById('mine-list');
    try {
        const { list } = await api('/api/violations/mine');
        const cEl = document.getElementById('mine-count');
        if (cEl) cEl.textContent = list.length;
        if (!box) return;
        if (list.length === 0) { box.innerHTML = '<p style="color:var(--muted);">لا توجد مخالفات مسجلة بعد</p>'; return; }
        box.innerHTML = \`<table><tr><th></th><th>النوع</th><th>المركبة</th><th>اللوحة</th><th>الحالة</th></tr>\` +
            list.map(v => \`<tr>
                <td>\${v.photo ? \`<img class="thumb" src="\${v.photo}" onclick="openImageModal('\${v.photo}')">\` : '—'}</td>
                <td>\${v.kind === 'report' ? ('🧪 تقرير مكافحة مخدرات — ' + v.reportCategory) : v.violationType}</td><td>\${v.vehicle}</td><td>\${v.plateNumber}</td>
                <td><span class="badge \${v.status}">\${v.status === 'pending' ? 'قيد المراجعة' : v.status === 'approved' ? 'مقبولة' : 'مرفوضة'}</span>\${v.status === 'rejected' && v.rejectReason ? \`<div style="font-size:11px;color:var(--muted);margin-top:3px;">\${v.rejectReason}</div>\` : ''}</td>
            </tr>\`).join('') + '</table>';
    } catch (e) {
        if (box) box.innerHTML = \`<p style="color:#f87171;">تعذر تحميل مخالفاتي، حاول تحدّث الصفحة. (\${e.message})</p>\`;
    }
}
async function renderNewViolation() {
    const meta = await api('/api/violations/meta');
    META = meta; selectedVehicle = null; photoBase64 = null;
    document.getElementById('app').innerHTML = \`
        <div class="card">
            <h2>تسجيل مخالفة جديدة</h2>
            <label>نوع المخالفة</label>
            <select id="v-type">\${meta.types.map(t => \`<option>\${t}</option>\`).join('')}</select>
            <label>المركبة</label>
            \${meta.vehicles.length ? \`<div class="vgrid" id="v-grid">\${meta.vehicles.map((v,i) => \`
                <div class="vcard" id="vcard-\${i}" onclick="pickVehicle(\${i})">
                    \${v.photo ? \`<img src="\${v.photo}">\` : ''}
                    <div>\${v.name}</div>
                </div>\`).join('')}</div>\` : '<p style="color:var(--muted);margin-bottom:10px;">لا توجد مركبات مضافة</p>'}
            <label>صورة المخالفة (إجباري)</label>
            <input type="file" id="v-photo" accept="image/*" onchange="previewPhoto()" required>
            <img id="v-photo-preview" style="display:none;max-width:220px;border-radius:8px;margin-bottom:10px;">
            <div class="row" style="gap:8px;margin-top:10px;">
                <button class="btn" id="v-submit-btn" onclick="submitViolation()">إرسال</button>
                <button class="btn gray" onclick="renderDashboard()">رجوع</button>
            </div>
        </div>\`;
    if (meta.vehicles.length) pickVehicle(0);
}
function pickVehicle(i) {
    selectedVehicle = META.vehicles[i].name;
    document.querySelectorAll('.vcard').forEach(el => el.classList.remove('sel'));
    document.getElementById('vcard-' + i).classList.add('sel');
}
function previewPhoto() {
    const f = document.getElementById('v-photo').files[0];
    if (!f) return;
    if (f.size > ${CONFIG.MAX_PHOTO_MB} * 1024 * 1024) { toast('الصورة أكبر من ${CONFIG.MAX_PHOTO_MB}MB'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        photoBase64 = e.target.result;
        const img = document.getElementById('v-photo-preview');
        img.src = photoBase64; img.style.display = 'block';
    };
    reader.readAsDataURL(f);
}
let violationSubmitting = false;
async function submitViolation() {
    if (violationSubmitting) return; // يمنع الدبل-كليك من إرسال الطلب مرتين
    const violationType = document.getElementById('v-type').value;
    if (!selectedVehicle) return toast('اختر المركبة');
    if (!photoBase64) return toast('لازم ترفق صورة المخالفة');
    const btn = document.getElementById('v-submit-btn');
    violationSubmitting = true;
    if (btn) { btn.disabled = true; btn.textContent = 'جارِ الإرسال...'; }
    try {
        await api('/api/violations/submit', { method: 'POST', body: JSON.stringify({ violationType, vehicle: selectedVehicle, photo: photoBase64 }) });
        toast('تم الإرسال، بانتظار قبول الإدارة'); renderDashboard();
    } catch (e) {
        toast(e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'إرسال'; }
    } finally {
        violationSubmitting = false;
    }
}
function renderNewReport() {
    document.getElementById('app').innerHTML = \`
        <div class="card">
            <h2>تسجيل تقرير جديد</h2>
            <p style="color:var(--muted);margin-bottom:14px;">اختر نوع التقرير:</p>
            <div class="row" style="gap:8px;">
                <button class="btn" onclick="renderReportForm('جنائي')">⚖️ جنائي</button>
                <button class="btn" onclick="renderReportForm('مخدرات')">💊 مخدرات</button>
            </div>
            <div style="margin-top:14px;">
                <button class="btn gray" onclick="renderDashboard()">رجوع</button>
            </div>
        </div>\`;
}
async function renderReportForm(category) {
    const meta = await api('/api/violations/meta');
    reportMeta = meta; reportSelectedVehicle = null; reportVehiclePhoto = null;
    const isDrugs = category === 'مخدرات';
    document.getElementById('app').innerHTML = \`
        <div class="card">
            <h2>تسجيل تقرير \${isDrugs ? 'مكافحة مخدرات' : 'جنائي'}</h2>
            <label>اسم المتهم</label>
            <input id="rp-suspect-name" placeholder="اسم المتهم">
            <label>موقع الضبط</label>
            <input id="rp-location" placeholder="موقع الضبط">
            <label>المركبة</label>
            \${meta.vehicles.length ? \`<div class="vgrid" id="rp-v-grid">\${meta.vehicles.map((v,i) => \`
                <div class="vcard" id="rp-vcard-\${i}" onclick="pickReportVehicle(\${i})">
                    \${v.photo ? \`<img src="\${v.photo}">\` : ''}
                    <div>\${v.name}</div>
                </div>\`).join('')}</div>\` : '<p style="color:var(--muted);margin-bottom:10px;">لا توجد مركبات مضافة</p>'}
            <h3 style="margin-top:16px;">تفاصيل العملية الميدانية</h3>
            <label>سبب الاستيقاف</label>
            <input id="rp-stop-reason" placeholder="سبب الاستيقاف">
            \${isDrugs ? \`
            <label>نوع المخدر المضبوط</label>
            <input id="rp-drug-type" placeholder="مثال: حشيش، شبو، حبوب مخدرة">
            <label>الكمية المضبوطة</label>
            <input id="rp-drug-qty" placeholder="مثال: 3 كيلو / 50 حبة">
            <label>طريقة إخفاء المخدر</label>
            <input id="rp-conceal" placeholder="مثال: مخبأ داخل صندوق السيارة">
            \` : \`
            <label>المضبوطات</label>
            <textarea id="rp-seized" placeholder="المضبوطات" rows="3"></textarea>
            \`}
            <label>الإجراءات الأمنية المتخذة</label>
            <div id="rp-actions-box">
                <div class="row rp-action-row" style="gap:6px;flex-wrap:nowrap;">
                    <input class="rp-action" placeholder="- إجراء أمني" style="flex:1;">
                    <button type="button" class="btn danger sm" style="flex:0 0 auto;" onclick="removeSecurityAction(this)">حذف</button>
                </div>
            </div>
            <button class="btn gray sm" style="margin:8px 0;" onclick="addSecurityAction()">+ إضافة إجراء</button>
            <label>صورة المركبة (إجباري)</label>
            <input type="file" id="rp-photo" accept="image/*" onchange="previewReportPhoto()" required>
            <img id="rp-photo-preview" style="display:none;max-width:220px;border-radius:8px;margin-bottom:10px;">
            <div class="row" style="gap:8px;margin-top:10px;">
                <button class="btn" onclick="submitReport('\${category}')">إرسال التقرير</button>
                <button class="btn gray" onclick="renderNewReport()">رجوع</button>
            </div>
        </div>\`;
    if (meta.vehicles.length) pickReportVehicle(0);
}
function pickReportVehicle(i) {
    reportSelectedVehicle = reportMeta.vehicles[i].name;
    document.querySelectorAll('#rp-v-grid .vcard').forEach(el => el.classList.remove('sel'));
    document.getElementById('rp-vcard-' + i).classList.add('sel');
}
function addSecurityAction() {
    const box = document.getElementById('rp-actions-box');
    const row = document.createElement('div');
    row.className = 'row rp-action-row';
    row.style.cssText = 'gap:6px;flex-wrap:nowrap;margin-top:6px;';
    row.innerHTML = '<input class="rp-action" placeholder="- إجراء أمني" style="flex:1;"><button type="button" class="btn danger sm" style="flex:0 0 auto;" onclick="removeSecurityAction(this)">حذف</button>';
    box.appendChild(row);
}
function removeSecurityAction(btn) {
    const box = document.getElementById('rp-actions-box');
    if (box.querySelectorAll('.rp-action-row').length <= 1) {
        // لازم يبقى إجراء واحد على الأقل بالفورم
        btn.closest('.rp-action-row').querySelector('.rp-action').value = '';
        return;
    }
    btn.closest('.rp-action-row').remove();
}
function previewReportPhoto() {
    const f = document.getElementById('rp-photo').files[0];
    if (!f) return;
    if (f.size > ${CONFIG.MAX_PHOTO_MB} * 1024 * 1024) { toast('الصورة أكبر من ${CONFIG.MAX_PHOTO_MB}MB'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        reportVehiclePhoto = e.target.result;
        const img = document.getElementById('rp-photo-preview');
        img.src = reportVehiclePhoto; img.style.display = 'block';
    };
    reader.readAsDataURL(f);
}
async function submitReport(category) {
    const isDrugs = category === 'مخدرات';
    const suspectName = document.getElementById('rp-suspect-name').value.trim();
    const arrestLocation = document.getElementById('rp-location').value.trim();
    const stopReason = document.getElementById('rp-stop-reason').value.trim();
    const securityActions = Array.from(document.querySelectorAll('.rp-action')).map(el => el.value.trim()).filter(Boolean);
    if (!suspectName || !arrestLocation) return toast('أكمل اسم المتهم وموقع الضبط');
    if (!reportSelectedVehicle) return toast('اختر المركبة');
    if (!stopReason) return toast('أكمل تفاصيل العملية الميدانية');
    if (!reportVehiclePhoto) return toast('لازم ترفق صورة المركبة');

    let seizedItems = null, drugType = null, drugQuantity = null, concealMethod = null;
    if (isDrugs) {
        drugType = document.getElementById('rp-drug-type').value.trim();
        drugQuantity = document.getElementById('rp-drug-qty').value.trim();
        concealMethod = document.getElementById('rp-conceal').value.trim();
        if (!drugType || !drugQuantity || !concealMethod) return toast('أكمل نوع المخدر وكميته وطريقة إخفائه');
    } else {
        seizedItems = document.getElementById('rp-seized').value.trim();
        if (!seizedItems) return toast('اكتب المضبوطات');
    }
    try {
        await api('/api/reports/submit', { method: 'POST', body: JSON.stringify({
            category, suspectName, arrestLocation, vehicle: reportSelectedVehicle,
            stopReason, seizedItems, securityActions, photo: reportVehiclePhoto,
            drugType, drugQuantity, concealMethod,
        }) });
        toast('تم إرسال التقرير، بانتظار المراجعة'); renderDashboard();
    } catch (e) { toast(e.message); }
}
function renderCard() {
    document.getElementById('app').innerHTML = \`
        <div style="margin-top:30px;">
            <div class="id-card">
                \${ME.avatar ? \`<img class="avatar" src="\${ME.avatar}" style="display:block;margin:0 auto 12px;">\` : ''}
                <div class="center" style="font-size:18px;font-weight:bold;color:var(--gold-soft);">\${ME.registeredName}</div>
                <div class="center" style="font-size:13px;color:var(--muted);margin-bottom:14px;">${CONFIG.SITE_NAME} • بطاقة تعريف عسكرية</div>
                <table>
                    <tr><td>اليونت</td><td>\${ME.unit}</td></tr>
                    <tr><td>الرتبة</td><td>\${ME.rank}</td></tr>
                    <tr><td>النقاط</td><td>\${ME.points}</td></tr>
                    <tr><td>الحالة</td><td>\${ME.isBlocked ? 'موقوف' : 'فعّال'}</td></tr>
                </table>
            </div>
            <div class="center" style="margin-top:16px;"><button class="btn gray sm" onclick="renderDashboard()">رجوع</button></div>
        </div>\`;
}
function renderAdmin() {
    const tabsHtml = ME.isSeniorAdmin ? \`
        <div class="tabs">
            <div class="tab active" onclick="adminTab('pending', this)">المخالفات المعلّقة</div>
            <div class="tab" onclick="adminTab('reviewed', this)">المخالفات المقبولة</div>
            <div class="tab" onclick="adminTab('sectors', this)">قادة القطاعات</div>
            <div class="tab" onclick="adminTab('personnel', this)">الحسابات</div>
            <div class="tab" onclick="adminTab('vehicles', this)">المركبات</div>
            <div class="tab" onclick="adminTab('hire', this)">توظيف الإدارة</div>
            <div class="tab" onclick="adminTab('thresholds', this)">ترقيات النقاط</div>
            <div class="tab" onclick="adminTab('log', this)">اللوق الشامل</div>
            <div class="tab" onclick="adminTab('notes', this)">📝 الملاحظات</div>
            <div class="tab" onclick="adminTab('settings', this)">الإعدادات</div>
            <div class="tab" onclick="renderNewReport()">🧪 تسجيل تقرير جديد مكافحة</div>
        </div>\` : '';
    document.getElementById('app').innerHTML = \`
        <div class="card row"><h2>\${ME.isSeniorAdmin ? 'لوحة تحكم كبار المسؤولين' : 'لوحة الإدارة'}</h2><button class="btn gray sm" onclick="renderDashboard()">رجوع للوحتي</button></div>
        \${tabsHtml}
        <div id="admin-content"></div>\`;
    adminTab('pending');
}
function adminTab(name, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
    currentAdminTab = name;
    if (name === 'pending') loadPending();
    if (name === 'reviewed') loadReviewed();
    if (name === 'sectors') loadSectors();
    if (name === 'personnel') loadPersonnel();
    if (name === 'vehicles') loadVehicles();
    if (name === 'hire') loadHire();
    if (name === 'thresholds') loadThresholds();
    if (name === 'log') loadLog();
    if (name === 'notes') loadNotesPage();
    if (name === 'settings') loadSettings();
}
async function loadPending() {
    const box = document.getElementById('admin-content');
    if (!box) return;
    if (!box.dataset.loaded) box.innerHTML = '<div class="card">جارِ التحميل...</div>';
    let list;
    try {
        ({ list } = await api('/api/admin/pending'));
    } catch (e) {
        if (currentAdminTab !== 'pending') return;
        box.innerHTML = \`<div class="card" style="color:#f87171;">تعذر تحميل المخالفات المعلّقة، حاول تحدّث الصفحة. (\${e.message})</div>\`;
        return;
    }
    if (currentAdminTab !== 'pending') return; // المستخدم غيّر التبويب أثناء التحميل
    box.id = 'admin-content'; box.dataset.loaded = '1';
    box.innerHTML = '<div id="pending-box"></div>';
    const pbox = document.getElementById('pending-box');
    if (list.length === 0) { pbox.innerHTML = '<div class="card center" style="color:var(--muted);">لا توجد مخالفات معلّقة</div>'; return; }
    pbox.innerHTML = list.map(v => v.kind === 'report' ? \`
        <div class="card">
            <div class="row" style="align-items:flex-start;">
                <div class="row" style="gap:10px;align-items:flex-start;">
                    \${v.photo ? \`<img class="thumb" src="\${v.photo}" onclick="openImageModal('\${v.photo}')">\` : ''}
                    <div>
                        <b>\${v.reporterName}</b> <span style="color:var(--muted);font-size:12px;">(\${v.reporterUnit})</span>
                        <div style="color:var(--gold-soft);margin-top:4px;">🧪 تقرير مكافحة المخدرات — \${v.reportCategory}</div>
                        <div style="color:var(--muted);font-size:13px;">المتهم: \${v.suspectName} • موقع الضبط: \${v.arrestLocation}</div>
                        <div style="color:var(--muted);font-size:13px;">المركبة: \${v.vehicle} • سبب الاستيقاف: \${v.stopReason}</div>
                        \${v.reportCategory === 'مخدرات' ? \`
                        <div style="color:var(--muted);font-size:13px;">نوع المخدر: \${v.drugType || '-'} • الكمية: \${v.drugQuantity || '-'}</div>
                        <div style="color:var(--muted);font-size:13px;">طريقة الإخفاء: \${v.concealMethod || '-'}</div>
                        \` : \`<div style="color:var(--muted);font-size:13px;">المضبوطات: \${v.seizedItems}</div>\`}
                        \${v.securityActions && v.securityActions.length ? \`<div style="color:var(--muted);font-size:13px;">الإجراءات: \${v.securityActions.join('، ')}</div>\` : ''}
                    </div>
                </div>
                <div class="row" style="gap:8px;">
                    <button class="btn sm" onclick="approveV('\${v._id}')">قبول (+2)</button>
                    <button class="btn danger sm" onclick="rejectV('\${v._id}')">رفض (-1)</button>
                </div>
            </div>
        </div>\` : \`
        <div class="card">
            <div class="row">
                <div class="row" style="gap:10px;">
                    \${v.photo ? \`<img class="thumb" src="\${v.photo}" onclick="openImageModal('\${v.photo}')">\` : ''}
                    <div>
                        <b>\${v.reporterName}</b> <span style="color:var(--muted);font-size:12px;">(\${v.reporterUnit})</span>
                        <div style="color:var(--gold-soft);margin-top:4px;">\${v.violationType}</div>
                        <div style="color:var(--muted);font-size:13px;">المركبة: \${v.vehicle} • اللوحة: \${v.plateNumber}</div>
                    </div>
                </div>
                <div class="row" style="gap:8px;">
                    <button class="btn sm" onclick="approveV('\${v._id}')">قبول</button>
                    <button class="btn danger sm" onclick="rejectV('\${v._id}')">رفض</button>
                </div>
            </div>
        </div>\`).join('');
}
const actionLocks = {};
function isActionLocked(id) {
    const until = actionLocks[id];
    if (until && Date.now() < until) return true;
    return false;
}
function lockAction(id) {
    actionLocks[id] = Date.now() + 5000;
    setTimeout(() => { delete actionLocks[id]; }, 5000);
}
async function approveV(id) {
    if (isActionLocked(id)) return toast('انتظر 5 ثواني قبل الضغط مرة أخرى');
    lockAction(id);
    try { await api('/api/admin/violations/' + id + '/approve', { method: 'POST' }); toast('تم القبول'); loadPending(); }
    catch (e) { toast(e.message); }
}
function rejectV(id) {
    if (isActionLocked(id)) return toast('انتظر 5 ثواني قبل الضغط مرة أخرى');
    const reason = prompt('اكتب سبب الرفض:');
    if (reason === null) return;
    if (!reason.trim()) return toast('لازم تكتب سبب');
    lockAction(id);
    api('/api/admin/violations/' + id + '/reject', { method: 'POST', body: JSON.stringify({ reason }) })
        .then(() => { toast('تم الرفض'); loadPending(); }).catch(e => toast(e.message));
}

// ── المخالفات المقبولة (كبار المسؤولين) ──────────────────────────────────
async function loadReviewed() {
    const box = document.getElementById('admin-content');
    if (!box) return;
    box.innerHTML = '<div class="card">جارِ التحميل...</div>';
    let list;
    try { ({ list } = await api('/api/senior/violations/reviewed')); }
    catch (e) {
        if (currentAdminTab !== 'reviewed') return;
        box.innerHTML = \`<div class="card" style="color:#f87171;">تعذر التحميل، حاول تحدّث الصفحة. (\${e.message})</div>\`;
        return;
    }
    if (currentAdminTab !== 'reviewed') return;
    if (list.length === 0) { box.innerHTML = '<div class="card center" style="color:var(--muted);">لا توجد مخالفات أو تقارير تمت مراجعتها بعد</div>'; return; }
    box.innerHTML = list.map(v => \`
        <div class="card">
            <div class="row" style="align-items:flex-start;">
                <div class="row" style="gap:10px;align-items:flex-start;">
                    \${v.photo ? \`<img class="thumb" src="\${v.photo}" onclick="openImageModal('\${v.photo}')">\` : ''}
                    <div>
                        <b>\${v.reporterName || v.reporterTag}</b> <span style="color:var(--muted);font-size:12px;">(\${v.reporterUnit || '-'})</span>
                        <div style="color:var(--gold-soft);margin-top:4px;">\${v.kind === 'report' ? ('🧪 تقرير مكافحة مخدرات — ' + v.reportCategory) : v.violationType}</div>
                        <div style="color:var(--muted);font-size:13px;">المركبة: \${v.vehicle || '-'} \${v.plateNumber ? ('• اللوحة: ' + v.plateNumber) : ''}</div>
                        <div style="margin-top:4px;"><span class="badge \${v.status}">\${v.status === 'approved' ? 'مقبولة' : 'مرفوضة'}</span>\${v.status === 'rejected' && v.rejectReason ? \` — \${v.rejectReason}\` : ''}</div>
                        <div style="color:var(--muted);font-size:11px;margin-top:4px;">راجعها: \${v.reviewedByTag || v.reviewedBy || '-'}</div>
                    </div>
                </div>
                <button class="btn danger sm" onclick="deleteReviewed('\${v._id}')">🗑️ حذف نهائي</button>
            </div>
        </div>\`).join('');
}
function deleteReviewed(id) {
    if (!confirm('متأكد تبي تحذفها نهائياً؟ بتختفي من عندك ومن عند صاحبها.')) return;
    api('/api/senior/violations/' + id, { method: 'DELETE' })
        .then(() => { toast('تم الحذف'); loadReviewed(); }).catch(e => toast(e.message));
}

// ── قادة القطاعات (كبار المسؤولين) ───────────────────────────────────────
let sectorsCache = { sectors: {}, leadership: {} };
async function loadSectors() {
    const box = document.getElementById('admin-content');
    if (!box) return;
    box.innerHTML = '<div class="card">جارِ التحميل...</div>';
    let data;
    try { data = await api('/api/senior/sectors'); }
    catch (e) {
        if (currentAdminTab !== 'sectors') return;
        box.innerHTML = \`<div class="card" style="color:#f87171;">تعذر التحميل. (\${e.message})</div>\`;
        return;
    }
    if (currentAdminTab !== 'sectors') return;
    sectorsCache = data;
    renderSectorsBox();
}
function renderSectorsBox() {
    const box = document.getElementById('admin-content');
    if (!box) return;
    const keys = Object.keys(sectorsCache.sectors);
    box.innerHTML = keys.map(key => {
        const label = sectorsCache.sectors[key];
        const sec = (sectorsCache.leadership && sectorsCache.leadership[key]) || {};
        return \`
        <div class="card">
            <h3>🪖 \${label}</h3>
            <div class="row" style="margin-top:8px;">
                <span>القائد: <b style="color:\${sec.commanderName ? '#4ade80' : 'var(--muted)'};">\${sec.commanderName || 'غير معيّن'}</b></span>
                <div class="row" style="gap:6px;">
                    <button class="btn sm" onclick="openSectorPicker('\${key}','commander')">قائد \${label}</button>
                    \${sec.commanderName ? \`<button class="btn danger sm" onclick="removeSectorRole('\${key}','commander')">إزالة</button>\` : ''}
                </div>
            </div>
            <div class="row" style="margin-top:8px;">
                <span>النائب: <b style="color:\${sec.deputyName ? '#4ade80' : 'var(--muted)'};">\${sec.deputyName || 'غير معيّن'}</b></span>
                <div class="row" style="gap:6px;">
                    <button class="btn sm gray" onclick="openSectorPicker('\${key}','deputy')">نائب \${label}</button>
                    \${sec.deputyName ? \`<button class="btn danger sm" onclick="removeSectorRole('\${key}','deputy')">إزالة</button>\` : ''}
                </div>
            </div>
            <div id="picker-\${key}-commander"></div>
            <div id="picker-\${key}-deputy"></div>
        </div>\`;
    }).join('');
}
function openSectorPicker(sectorKey, role) {
    ['commander', 'deputy'].forEach(r => {
        Object.keys(sectorsCache.sectors).forEach(k => {
            const el = document.getElementById('picker-' + k + '-' + r);
            if (el && (k !== sectorKey || r !== role)) el.innerHTML = '';
        });
    });
    const el = document.getElementById('picker-' + sectorKey + '-' + role);
    if (!el) return;
    if (el.innerHTML.trim()) { el.innerHTML = ''; return; }
    el.innerHTML = \`
        <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">
            <input placeholder="🔍 ابحث عن اسم الشخص المسجل بالموقع..." oninput="searchSectorCandidate('\${sectorKey}','\${role}', this.value)">
            <div id="cand-\${sectorKey}-\${role}"></div>
        </div>\`;
}
let sectorSearchTimer = null;
function searchSectorCandidate(sectorKey, role, q) {
    clearTimeout(sectorSearchTimer);
    sectorSearchTimer = setTimeout(async () => {
        const box = document.getElementById('cand-' + sectorKey + '-' + role);
        if (!box) return;
        if (!q || !q.trim()) { box.innerHTML = ''; return; }
        box.innerHTML = 'جارِ البحث...';
        try {
            const { list } = await api('/api/senior/personnel?q=' + encodeURIComponent(q));
            if (list.length === 0) { box.innerHTML = '<p style="color:var(--muted);font-size:13px;">لا نتائج</p>'; return; }
            box.innerHTML = list.filter(p => p.registeredName).map(p => \`
                <div class="card" style="padding:8px 12px;margin-top:6px;">
                    <div class="row">
                        <span>\${p.registeredName} <span style="color:var(--muted);font-size:12px;">(\${p.unit || '-'} • \${p.rank})</span></span>
                        <button class="btn sm" onclick="assignSectorRole('\${sectorKey}','\${role}','\${p.discord}')">تعيين</button>
                    </div>
                </div>\`).join('');
        } catch (e) { box.innerHTML = '<p style="color:#f87171;font-size:13px;">' + e.message + '</p>'; }
    }, 350);
}
async function assignSectorRole(sectorKey, role, discordId) {
    try {
        await api('/api/senior/sectors/' + sectorKey + '/assign', { method: 'POST', body: JSON.stringify({ role, discordId }) });
        toast('تم التعيين');
        loadSectors();
    } catch (e) { toast(e.message); }
}
async function removeSectorRole(sectorKey, role) {
    if (!confirm('متأكد تبي تزيله من هذا المنصب؟')) return;
    try {
        await api('/api/senior/sectors/' + sectorKey + '/remove', { method: 'POST', body: JSON.stringify({ role }) });
        toast('تم');
        loadSectors();
    } catch (e) { toast(e.message); }
}

// ── لوحة قيادة القطاع (لقادة/نواب القطاعات) ──────────────────────────────
let sectorPanelTab = 'members';
let sectorMembersCache = [];
function renderSectorPanel() {
    if (!ME.sectorInfo) return renderDashboard();
    document.getElementById('app').innerHTML = \`
        <div class="card row"><h2>🎖️ قيادة \${ME.sectorInfo.sectorLabel} (\${ME.sectorInfo.role === 'commander' ? 'قائد' : 'نائب'})</h2><button class="btn gray sm" onclick="renderDashboard()">رجوع للوحتي</button></div>
        <div class="tabs">
            <div class="tab active" onclick="sectorTab('members', this)">أعضاء القطاع</div>
            <div class="tab" onclick="sectorTab('violations', this)">مخالفات القطاع</div>
            <div class="tab" onclick="sectorTab('file', this)">عرض ملف عسكري</div>
        </div>
        <div id="sector-content"></div>\`;
    sectorTab('members');
}
function sectorTab(name, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
    sectorPanelTab = name;
    if (name === 'members') loadSectorMembers();
    if (name === 'violations') loadSectorViolations();
    if (name === 'file') renderSectorFileSearch();
}
async function loadSectorMembers() {
    const box = document.getElementById('sector-content');
    if (!box) return;
    box.innerHTML = '<div class="card">جارِ التحميل...</div>';
    let data;
    try { data = await api('/api/sector/members'); }
    catch (e) {
        if (sectorPanelTab !== 'members') return;
        box.innerHTML = \`<div class="card" style="color:#f87171;">تعذر التحميل. (\${e.message})</div>\`;
        return;
    }
    if (sectorPanelTab !== 'members') return;
    sectorMembersCache = data.list;
    if (data.list.length === 0) { box.innerHTML = '<div class="card center" style="color:var(--muted);">لا يوجد أعضاء مسجّلين بهذا القطاع حالياً</div>'; return; }
    box.innerHTML = data.list.map(p => \`
        <div class="card">
            <div class="row">
                <div>
                    <b>\${p.registeredName || p.discordTag}</b> <span style="color:var(--muted);font-size:12px;">\${p.unit || ''} • \${p.rank}</span>
                    <div style="font-size:13px;color:#94a3b8;">النقاط: \${p.points} \${p.isBlocked ? '• 🚫 موقوف' : ''}</div>
                </div>
                <div class="row" style="gap:6px;">
                    <button class="btn sm gray" onclick="sectorPromote('\${p.discord}','up')">⬆️ ترقية</button>
                    <button class="btn sm gray" onclick="sectorPromote('\${p.discord}','down')">⬇️ تنزيل</button>
                    <button class="btn sm gray" onclick="sectorAssignUnit('\${p.discord}')">🪖 يونت</button>
                    <button class="btn sm gray" onclick="sectorAddNote('\${p.discord}')">📝 ملاحظة</button>
                    <button class="btn sm" style="background:#7f1d1d;color:#fff;" onclick="openWarnForm('\${p.discord}','/api/sector/personnel/')">⚠️ تحذير</button>
                </div>
            </div>
        </div>\`).join('');
}
async function sectorPromote(discord, direction) {
    try {
        await api('/api/sector/personnel/' + discord + '/rank', { method: 'POST', body: JSON.stringify({ direction }) });
        toast(direction === 'up' ? 'تمت الترقية' : 'تم التنزيل');
        loadSectorMembers();
    } catch (e) { toast(e.message); }
}
function sectorAssignUnit(discord) {
    const unit = prompt('اسم اليونت الجديد:');
    if (unit === null) return;
    if (!unit.trim()) return toast('حط اسم اليونت');
    api('/api/sector/personnel/' + discord + '/unit', { method: 'POST', body: JSON.stringify({ unit }) })
        .then(() => { toast('تم التعيين'); loadSectorMembers(); }).catch(e => toast(e.message));
}
function sectorAddNote(discord) {
    const text = prompt('اكتب الملاحظة:');
    if (text === null) return;
    if (!text.trim()) return toast('اكتب الملاحظة');
    api('/api/sector/personnel/' + discord + '/note', { method: 'POST', body: JSON.stringify({ text }) })
        .then(() => toast('تمت الإضافة')).catch(e => toast(e.message));
}
async function loadSectorViolations() {
    const box = document.getElementById('sector-content');
    if (!box) return;
    box.innerHTML = '<div class="card">جارِ التحميل...</div>';
    let data;
    try { data = await api('/api/sector/violations'); }
    catch (e) {
        if (sectorPanelTab !== 'violations') return;
        box.innerHTML = \`<div class="card" style="color:#f87171;">تعذر التحميل. (\${e.message})</div>\`;
        return;
    }
    if (sectorPanelTab !== 'violations') return;
    if (data.list.length === 0) { box.innerHTML = '<div class="card center" style="color:var(--muted);">لا توجد مخالفات أو تقارير بعد</div>'; return; }
    box.innerHTML = data.list.map(v => \`
        <div class="card">
            <div class="row" style="align-items:flex-start;">
                <div class="row" style="gap:10px;align-items:flex-start;">
                    \${v.photo ? \`<img class="thumb" src="\${v.photo}" onclick="openImageModal('\${v.photo}')">\` : ''}
                    <div>
                        <b>\${v.reporterName || v.reporterTag}</b> <span style="color:var(--muted);font-size:12px;">(\${v.reporterUnit || '-'})</span>
                        <div style="color:var(--gold-soft);margin-top:4px;">\${v.kind === 'report' ? ('🧪 تقرير مكافحة مخدرات — ' + v.reportCategory) : v.violationType}</div>
                        <div style="margin-top:4px;"><span class="badge \${v.status}">\${v.status === 'pending' ? 'قيد المراجعة' : v.status === 'approved' ? 'مقبولة' : 'مرفوضة'}</span></div>
                    </div>
                </div>
                \${data.canReview && v.status === 'pending' ? \`
                <div class="row" style="gap:8px;">
                    <button class="btn sm" onclick="sectorApprove('\${v._id}')">قبول</button>
                    <button class="btn danger sm" onclick="sectorReject('\${v._id}')">رفض</button>
                </div>\` : ''}
            </div>
        </div>\`).join('');
}
function sectorApprove(id) {
    api('/api/sector/violations/' + id + '/approve', { method: 'POST' })
        .then(() => { toast('تم القبول'); loadSectorViolations(); }).catch(e => toast(e.message));
}
function sectorReject(id) {
    const reason = prompt('اكتب سبب الرفض:');
    if (reason === null) return;
    if (!reason.trim()) return toast('لازم تكتب سبب');
    api('/api/sector/violations/' + id + '/reject', { method: 'POST', body: JSON.stringify({ reason }) })
        .then(() => { toast('تم الرفض'); loadSectorViolations(); }).catch(e => toast(e.message));
}
function renderSectorFileSearch() {
    const box = document.getElementById('sector-content');
    if (!box) return;
    box.innerHTML = \`
        <div class="card">
            <input id="sector-file-search" placeholder="🔍 ابحث عن اسم عضو من قطاعك..." oninput="filterSectorFileSearch()">
            <div id="sector-file-results"></div>
        </div>
        <div id="sector-file-view"></div>\`;
    if (sectorMembersCache.length === 0) {
        api('/api/sector/members').then(d => { sectorMembersCache = d.list; }).catch(() => {});
    }
}
function filterSectorFileSearch() {
    const q = document.getElementById('sector-file-search').value.trim().toLowerCase();
    const box = document.getElementById('sector-file-results');
    if (!q) { box.innerHTML = ''; return; }
    const matches = sectorMembersCache.filter(p => (p.registeredName || '').toLowerCase().includes(q) || (p.discordTag || '').toLowerCase().includes(q));
    box.innerHTML = matches.map(p => \`
        <div class="card" style="padding:8px 12px;margin-top:6px;">
            <div class="row">
                <span>\${p.registeredName || p.discordTag} <span style="color:var(--muted);font-size:12px;">(\${p.unit || '-'})</span></span>
                <button class="btn sm" onclick="viewSectorFile('\${p.discord}')">عرض الملف</button>
            </div>
        </div>\`).join('') || '<p style="color:var(--muted);font-size:13px;">لا نتائج</p>';
}
async function viewSectorFile(discord) {
    const box = document.getElementById('sector-file-view');
    box.innerHTML = '<div class="card">جارِ التحميل...</div>';
    try {
        const { personnel: p } = await api('/api/sector/personnel/' + discord);
        box.innerHTML = \`
            <div class="id-card" style="margin-top:16px;">
                <div class="center" style="font-size:18px;font-weight:bold;color:var(--gold-soft);">\${p.registeredName || p.discordTag}</div>
                <div class="center" style="font-size:12px;color:var(--muted);margin-bottom:10px;">ملف عسكري كامل</div>
                <table>
                    <tr><td>اليونت</td><td>\${p.unit || '-'}</td></tr>
                    <tr><td>الرتبة</td><td>\${p.rank}</td></tr>
                    <tr><td>النقاط</td><td>\${p.points}</td></tr>
                    <tr><td>الحالة</td><td>\${p.isBlocked ? 'موقوف' : 'فعّال'}</td></tr>
                </table>
                \${p.notes && p.notes.length ? '<div style="margin-top:10px;font-size:13px;color:var(--gold-soft);">الملاحظات:</div>' +
                    p.notes.map(n => \`<div style="background:rgba(5,15,10,0.6);padding:8px;border-radius:8px;margin-top:6px;font-size:13px;">\${n.text}</div>\`).join('') : ''}
            </div>\`;
    } catch (e) { box.innerHTML = \`<div class="card" style="color:#f87171;">\${e.message}</div>\`; }
}

async function loadPersonnel() {
    const box = document.getElementById('admin-content');
    box.innerHTML = \`<div class="card"><input id="p-search" placeholder="بحث بالاسم / اليونت / التاق" onkeyup="if(event.key==='Enter') searchPersonnel()"><button class="btn sm" onclick="searchPersonnel()">بحث</button></div><div id="p-list"></div>\`;
    searchPersonnel();
}
let personnelCache = [];
async function searchPersonnel() {
    const q = document.getElementById('p-search') ? document.getElementById('p-search').value : '';
    const { list } = await api('/api/senior/personnel?q=' + encodeURIComponent(q));
    if (currentAdminTab !== 'personnel') return; // المستخدم غيّر التبويب أثناء التحميل
    personnelCache = list;
    const pListEl = document.getElementById('p-list');
    if (!pListEl) return;
    pListEl.innerHTML = list.map((p, i) => \`
        <div class="card" id="pcard-\${i}">
            <div class="row">
                <div>
                    <b>\${p.registeredName || p.discordTag}</b> <span style="color:var(--muted);font-size:12px;">\${p.unit || ''} • \${p.rank}</span>
                    <div style="font-size:13px;color:#94a3b8;">النقاط: \${p.points} \${p.isBlocked ? '• 🚫 موقوف' : ''}</div>
                </div>
                <div class="row" style="gap:6px;">
                    <button class="btn sm gray" onclick="toggleEdit(\${i})">تعديل</button>
                    <button class="btn sm gray" onclick="addNote('\${p.discord}')">ملاحظة</button>
                    <button class="btn sm" style="background:#7f1d1d;color:#fff;" onclick="openWarnForm('\${p.discord}','/api/senior/personnel/')">⚠️ تحذير</button>
                    <button class="btn sm \${p.isBlocked ? '' : 'danger'}" onclick="toggleBlock('\${p.discord}', \${!p.isBlocked})">\${p.isBlocked ? 'إلغاء الإيقاف' : 'إيقاف (بند)'}</button>
                    <button class="btn sm danger" onclick="deletePersonnel('\${p.discord}', '\${(p.registeredName || p.discordTag || '').replace(/'/g, "\\\\'")}')">🗑️ حذف نهائي</button>
                </div>
            </div>
            <div id="pedit-\${i}" class="hidden" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;">
                <label>الاسم</label><input id="pe-name-\${i}" value="\${p.registeredName || ''}">
                <label>اليونت</label><input id="pe-unit-\${i}" value="\${p.unit || ''}">
                <label>الرتبة العسكرية</label>
                <select id="pe-rank-\${i}">\${MILITARY_RANKS.map(r => \`<option \${r === p.rank ? 'selected' : ''}>\${r}</option>\`).join('')}</select>
                <label>النقاط</label><input type="number" id="pe-points-\${i}" data-original="\${p.points}" value="\${p.points}">
                <button class="btn sm" onclick="saveEdit('\${p.discord}', \${i})">حفظ التعديلات</button>
            </div>
        </div>\`).join('') || '<div class="card center" style="color:var(--muted);">لا نتائج</div>';
}
function toggleEdit(i) {
    document.getElementById('pedit-' + i).classList.toggle('hidden');
}
async function saveEdit(discordId, i) {
    const pointsInput = document.getElementById('pe-points-' + i);
    const pointsChanged = pointsInput.value !== pointsInput.dataset.original;
    const body = {
        name: document.getElementById('pe-name-' + i).value,
        unit: document.getElementById('pe-unit-' + i).value,
        rank: document.getElementById('pe-rank-' + i).value,
        // نرسل النقاط بس إذا الأدمن عدّلها فعلاً بنفسه، عشان النظام يقدر يحسبها تلقائياً وقت تغيير الرتبة بدون ما تظل "معلّقة" على القيمة القديمة
        points: pointsChanged ? pointsInput.value : '',
    };
    try {
        await api('/api/senior/personnel/' + discordId + '/update', { method: 'POST', body: JSON.stringify(body) });
        toast('✅ تم حفظ التعديلات');
        searchPersonnel();
    } catch (e) { toast(e.message); }
}
async function deletePersonnel(discordId, displayName) {
    if (!confirm('متأكد تبي تحذف حساب "' + (displayName || discordId) + '" نهائياً؟ ما يمكن التراجع عن هذا الإجراء.')) return;
    try {
        await api('/api/senior/personnel/' + discordId, { method: 'DELETE' });
        toast('🗑️ تم حذف الحساب نهائياً');
        searchPersonnel();
    } catch (e) { toast(e.message); }
}
function addNote(discordId) {
    const text = prompt('اكتب الملاحظة:');
    if (!text || !text.trim()) return;
    api('/api/senior/personnel/' + discordId + '/note', { method: 'POST', body: JSON.stringify({ text }) })
        .then(() => toast('تمت الإضافة')).catch(e => toast(e.message));
}
function toggleBlock(discordId, blocked) {
    api('/api/senior/personnel/' + discordId + '/block', { method: 'POST', body: JSON.stringify({ blocked }) })
        .then(() => { toast('تم التحديث'); searchPersonnel(); }).catch(e => toast(e.message));
}
let newVehiclePhoto = null;
async function loadVehicles() {
    const box = document.getElementById('admin-content');
    box.innerHTML = \`
        <div class="card">
            <h3>إضافة مركبة</h3>
            <label>اسم المركبة</label>
            <input id="veh-name" placeholder="مثال: فورد F150">
            <label>صورة المركبة</label>
            <input type="file" id="veh-photo" accept="image/*" onchange="previewVehiclePhoto()">
            <img id="veh-photo-preview" style="display:none;max-width:160px;border-radius:8px;margin-bottom:10px;">
            <button class="btn sm" onclick="addVehicle()">إضافة</button>
        </div>
        <div id="veh-list" class="vgrid"></div>\`;
    loadVehicleList();
}
function previewVehiclePhoto() {
    const f = document.getElementById('veh-photo').files[0];
    if (!f) return;
    if (f.size > ${CONFIG.MAX_PHOTO_MB} * 1024 * 1024) { toast('الصورة أكبر من ${CONFIG.MAX_PHOTO_MB}MB'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        newVehiclePhoto = e.target.result;
        const img = document.getElementById('veh-photo-preview');
        img.src = newVehiclePhoto; img.style.display = 'block';
    };
    reader.readAsDataURL(f);
}
async function addVehicle() {
    const name = document.getElementById('veh-name').value.trim();
    if (!name) return toast('حط اسم المركبة');
    try {
        await api('/api/senior/vehicles', { method: 'POST', body: JSON.stringify({ name, photo: newVehiclePhoto }) });
        toast('تمت الإضافة'); newVehiclePhoto = null; loadVehicles();
    } catch (e) { toast(e.message); }
}
async function loadVehicleList() {
    const { list } = await api('/api/senior/vehicles');
    if (currentAdminTab !== 'vehicles') return;
    const box = document.getElementById('veh-list');
    if (!box) return;
    box.innerHTML = list.map(v => \`
        <div class="vcard">
            \${v.photo ? \`<img src="\${v.photo}">\` : ''}
            <div>\${v.name}</div>
            <button class="btn danger sm" style="margin-top:4px;padding:3px 8px;font-size:10px;" onclick="delVehicle('\${v._id}')">حذف</button>
        </div>\`).join('') || '<p style="color:var(--muted);">لا توجد مركبات</p>';
}
function delVehicle(id) {
    api('/api/senior/vehicles/' + id, { method: 'DELETE' }).then(() => { toast('تم الحذف'); loadVehicleList(); });
}
async function loadHire() {
    const box = document.getElementById('admin-content');
    box.innerHTML = \`
        <div class="card">
            <h3>توظيف إداري</h3>
            <p style="color:var(--muted);font-size:12px;margin-bottom:10px;">الإداري المعيّن يقدر فقط يقبل أو يرفض المخالفات المعلّقة.</p>
            <label>آيدي الإداري (Discord ID)</label>
            <input id="hire-id" placeholder="مثال: 123456789012345678">
            <label>اسمه</label>
            <input id="hire-name" placeholder="اسم الإداري">
            <button class="btn sm" onclick="hireAdmin()">تم</button>
        </div>
        <div id="admins-list"></div>\`;
    loadAdminsList();
}
async function hireAdmin() {
    const discordId = document.getElementById('hire-id').value.trim();
    const name = document.getElementById('hire-name').value.trim();
    if (!discordId) return toast('حط آيدي الإداري');
    try { await api('/api/senior/hire-admin', { method: 'POST', body: JSON.stringify({ discordId, name }) }); toast('تم التعيين'); loadHire(); }
    catch (e) { toast(e.message); }
}
async function loadAdminsList() {
    const { list } = await api('/api/senior/admins');
    if (currentAdminTab !== 'hire') return;
    const box = document.getElementById('admins-list');
    if (!box) return;
    box.innerHTML = list.map(id => \`
        <div class="card row"><span>\${id}</span><button class="btn danger sm" onclick="fireAdmin('\${id}')">فصل</button></div>\`).join('') || '<div class="card center" style="color:var(--muted);">لا يوجد إداريون معيّنون</div>';
}
function fireAdmin(id) {
    api('/api/senior/fire-admin', { method: 'POST', body: JSON.stringify({ discordId: id }) }).then(() => { toast('تم الفصل'); loadHire(); });
}
async function loadThresholds() {
    const { ranks, thresholds } = await api('/api/senior/thresholds');
    if (currentAdminTab !== 'thresholds') return;
    const box = document.getElementById('admin-content');
    if (!box) return;
    box.innerHTML = \`<div class="card">
        <h3>نقاط الترقية بين الرتب</h3>
        <p style="color:var(--muted);font-size:12px;margin-bottom:10px;">حدد كم نقطة يحتاجها العسكري بكل رتبة عشان يترقى للي بعدها.</p>
        \${ranks.map((r, i) => i === ranks.length - 1 ? '' : \`
            <div class="row" style="margin-bottom:8px;">
                <span style="font-size:13px;">\${r} ——> \${ranks[i+1]}</span>
                <input type="number" style="width:100px;margin-bottom:0;" id="th-\${i}" value="\${thresholds[r]}">
            </div>\`).join('')}
        <button class="btn sm" onclick="saveThresholds()" style="margin-top:8px;">حفظ</button>
    </div>\`;
    box.dataset.ranks = JSON.stringify(ranks);
}
async function saveThresholds() {
    const ranks = JSON.parse(document.getElementById('admin-content').dataset.ranks);
    const thresholds = {};
    ranks.forEach((r, i) => { const el = document.getElementById('th-' + i); if (el) thresholds[r] = parseInt(el.value) || 0; });
    try { await api('/api/senior/thresholds', { method: 'POST', body: JSON.stringify({ thresholds }) }); toast('تم الحفظ'); }
    catch (e) { toast(e.message); }
}
const LOG_META = {
    "ترقية تلقائية":        { icon: "🎖️", label: "ترقية تلقائية",        color: "#4ade80", border: "#22c55e" },
    "قبول تقرير":           { icon: "✅", label: "قبول تقرير",           color: "#4ade80", border: "#22c55e" },
    "رفض تقرير":            { icon: "❌", label: "رفض تقرير",            color: "#fca5a5", border: "#ef4444" },
    "قبول مخالفة":          { icon: "✅", label: "قبول مخالفة",          color: "#4ade80", border: "#22c55e" },
    "رفض مخالفة":           { icon: "❌", label: "رفض مخالفة",           color: "#fca5a5", border: "#ef4444" },
    "حظر عسكري (أمر)":      { icon: "🚫", label: "حظر عسكري",           color: "#fca5a5", border: "#ef4444" },
    "فك حظر عسكري (أمر)":   { icon: "🔓", label: "فك حظر عسكري",        color: "#60a5fa", border: "#3b82f6" },
    "ترقية عسكري":          { icon: "⬆️", label: "ترقية عسكري",         color: "#4ade80", border: "#22c55e" },
    "تنزيل عسكري":          { icon: "⬇️", label: "تنزيل عسكري",         color: "#fca5a5", border: "#ef4444" },
    "تعيين يونت":           { icon: "🪖", label: "تعيين يونت",          color: "#60a5fa", border: "#3b82f6" },
    "تعديل نقاط":           { icon: "✏️", label: "تعديل نقاط",          color: "#fde047", border: "#eab308" },
    "إضافة ملاحظة":         { icon: "📝", label: "إضافة ملاحظة",        color: "#93c5fd", border: "#3b82f6" },
    "إيقاف عسكري":          { icon: "🚫", label: "إيقاف عسكري",         color: "#fca5a5", border: "#ef4444" },
    "إلغاء إيقاف":          { icon: "✅", label: "إلغاء إيقاف",          color: "#4ade80", border: "#22c55e" },
    "حذف حساب نهائي":       { icon: "🗑️", label: "حذف حساب نهائي",      color: "#fca5a5", border: "#7f1d1d" },
    "تعديل ملف عسكري":      { icon: "✏️", label: "تعديل ملف عسكري",     color: "#93c5fd", border: "#3b82f6" },
    "تعديل إعدادات الموقع": { icon: "⚙️", label: "تعديل إعدادات الموقع", color: "#60a5fa", border: "#3b82f6" },
    "توظيف إداري":          { icon: "⭐", label: "توظيف إداري",          color: "#60a5fa", border: "#3b82f6" },
    "فصل إداري":            { icon: "🚫", label: "فصل إداري",           color: "#fca5a5", border: "#ef4444" },
    "إضافة مركبة":          { icon: "🚗", label: "إضافة مركبة",         color: "#93c5fd", border: "#3b82f6" },
    "تعديل حدود النقاط":    { icon: "🎯", label: "تعديل حدود النقاط",   color: "#60a5fa", border: "#3b82f6" },
    "حذف ملاحظة":           { icon: "🗑️", label: "حذف ملاحظة",          color: "#fca5a5", border: "#7f1d1d" },
    "حذف مخالفة نهائي":     { icon: "🗑️", label: "حذف مخالفة نهائي",    color: "#fca5a5", border: "#7f1d1d" },
    "تعيين قيادة قطاع":     { icon: "🎖️", label: "تعيين قيادة قطاع",    color: "#60a5fa", border: "#3b82f6" },
    "إزالة قيادة قطاع":     { icon: "🚫", label: "إزالة قيادة قطاع",    color: "#fca5a5", border: "#ef4444" },
    "إصدار تحذير":          { icon: "⚠️", label: "إصدار تحذير",         color: "#f87171", border: "#7f1d1d" },
    "إصدار إشعار":          { icon: "🔔", label: "إصدار إشعار",         color: "#fbbf24", border: "#78350f" },
    "تعاهد على تحذير":      { icon: "🤝", label: "تعاهد على تحذير",     color: "#4ade80", border: "#166534" },
    "تعاهد على إشعار":      { icon: "🤝", label: "تعاهد على إشعار",     color: "#4ade80", border: "#166534" },
};
let lastLogId = null;
let allLogsData = [];
async function loadLog(silent) {
    const { list } = await api('/api/senior/log');
    if (currentAdminTab !== 'log') return;
    const box = document.getElementById('admin-content');
    if (!box) return;
    if (silent && list[0] && list[0]._id === lastLogId) return;
    if (list[0]) lastLogId = list[0]._id;
    allLogsData = list;
    if (!document.getElementById('log-search')) {
        box.innerHTML = \`<div class="card"><input id="log-search" placeholder="🔍 ابحث بالاسم، اليوزر، الآيدي، أو نوع الحدث..." oninput="filterLog()" style="margin-bottom:12px;"><div id="log-list"></div></div>\`;
    }
    const q = (document.getElementById('log-search') || {}).value || '';
    renderLog(q.trim() ? filterLogsData(q) : list);
}
function filterLogsData(q) {
    q = q.trim().toLowerCase();
    return allLogsData.filter(log => {
        const meta = LOG_META[log.action] || { label: log.action };
        return [log.discordId, log.discordTag, log.actorId, log.actorTag, log.details, log.action, meta.label]
            .some(v => (v || '').toString().toLowerCase().includes(q));
    });
}
function filterLog() {
    const q = document.getElementById('log-search').value;
    renderLog(q.trim() ? filterLogsData(q) : allLogsData);
}
function renderLog(list) {
    const container = document.getElementById('log-list');
    if (!container) return;
    if (list.length === 0) { container.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px;">لا توجد نتائج.</p>'; return; }
    container.innerHTML = list.map(log => {
        const meta = LOG_META[log.action] || { icon: 'ℹ️', label: log.action, color: '#94a3b8', border: '#64748b' };
        return \`
        <div class="log-item" style="border-color:\${meta.border};flex-wrap:wrap;">
            <div><span style="color:\${meta.color};font-weight:bold;">\${meta.icon} \${meta.label}</span></div>
            <div style="text-align:left;color:#94a3b8;font-size:0.85rem;">
                \${log.discordTag || log.discordId ? \`<div>الشخص: <b style="color:#60a5fa;">\${log.discordTag || ''}</b> \${log.discordId ? '(' + log.discordId + ')' : ''}</div>\` : ''}
                \${log.actorTag || log.actorId ? \`<div>بواسطة: <b style="color:#e2e8f0;">\${log.actorTag || ''}</b> \${log.actorId ? '(' + log.actorId + ')' : ''}</div>\` : ''}
                \${log.details ? \`<div style="color:#93c5fd;">\${log.details}</div>\` : ''}
                <div style="font-size:0.78rem;color:#64748b;">\${new Date(log.createdAt).toLocaleString('ar')}</div>
            </div>
        </div>\`;
    }).join('');
}
async function loadNotesPage() {
    const box = document.getElementById('admin-content');
    if (!box) return;
    box.innerHTML = '<div class="card">جارِ التحميل...</div>';
    let list;
    try {
        ({ list } = await api('/api/senior/notes'));
    } catch (e) {
        if (currentAdminTab !== 'notes') return;
        box.innerHTML = \`<div class="card" style="color:#f87171;">تعذر تحميل الملاحظات، حاول تحدّث الصفحة. (\${e.message})</div>\`;
        return;
    }
    if (currentAdminTab !== 'notes') return;
    if (list.length === 0) { box.innerHTML = '<div class="card center" style="color:var(--muted);">لا توجد ملاحظات مسجلة</div>'; return; }
    box.innerHTML = list.map(n => \`
        <div class="card">
            <div class="row" style="align-items:flex-start;">
                <div>
                    <b>\${n.personnelName}</b>
                    <div style="margin-top:4px;">\${n.text}</div>
                    <div style="color:var(--muted);font-size:12px;margin-top:4px;">أضافها: \${n.addedByTag || n.addedBy || '-'} • \${new Date(n.createdAt).toLocaleString('ar')}</div>
                </div>
                <button class="btn danger sm" onclick="deleteNote('\${n.discord}', '\${n.noteId}')">🗑️ حذف</button>
            </div>
        </div>\`).join('');
}
async function deleteNote(discord, noteId) {
    if (!confirm('متأكد تبي تحذف هذي الملاحظة؟')) return;
    try { await api('/api/senior/personnel/' + discord + '/note/' + noteId, { method: 'DELETE' }); toast('تم الحذف'); loadNotesPage(); }
    catch (e) { toast(e.message); }
}
async function loadSettings() {
    const { settings } = await api('/api/senior/settings');
    if (currentAdminTab !== 'settings') return;
    const box = document.getElementById('admin-content');
    if (!box) return;
    box.innerHTML = \`
        <div class="card">
            <div class="row"><span>وضع الصيانة</span><input type="checkbox" id="s-maint" \${settings.isMaintenance ? 'checked' : ''}></div>
            <div class="row" style="margin-top:10px;"><span>إغلاق تسجيل الدخول</span><input type="checkbox" id="s-login" \${settings.disableLogin ? 'checked' : ''}></div>
            <div class="row" style="margin-top:10px;"><span>إغلاق تسجيل المخالفات</span><input type="checkbox" id="s-viol" \${settings.disableViolations ? 'checked' : ''}></div>
            <label style="margin-top:10px;">آيدي قناة إرسال المخالفات والتقارير بديسكورد (اختياري)</label>
            <input id="s-channel" placeholder="آيدي القناة" value="\${settings.violationsChannelId || ''}">
            <button class="btn" style="margin-top:14px;" onclick="saveSettings()">حفظ الإعدادات</button>
        </div>\`;
}
async function saveSettings() {
    const body = {
        isMaintenance: document.getElementById('s-maint').checked,
        disableLogin: document.getElementById('s-login').checked,
        disableViolations: document.getElementById('s-viol').checked,
        violationsChannelId: document.getElementById('s-channel').value.trim(),
    };
    try { await api('/api/senior/settings', { method: 'POST', body: JSON.stringify(body) }); toast('تم الحفظ'); }
    catch (e) { toast(e.message); }
}
init();
</script>
</body>
</html>`);
});

app.listen(CONFIG.PORT, "0.0.0.0", () => {
    console.log(`🚀 ${CONFIG.SITE_NAME} server running on port ${CONFIG.PORT}`);
});
